"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { podeImportarDividas } from "@/lib/finance/dividas-acesso";
import {
  conferirPlanilha,
  type Ajustes,
  type Aviso,
  type Decisao,
  type LinhaConferida,
  type LinhaDaPlanilha,
  type Mapeamento,
} from "@/lib/finance/dividas-importacao";
import { carregarContexto, carregarLote, reconferir, type ResultadoDoLote } from "./dados";

// IMPORTAÇÃO DE DÍVIDAS (0407). A conferência é código puro
// (`dividas-importacao.ts`) rodado AQUI, no servidor, com o que o banco sabe
// agora; o banco guarda o resultado e grava pelas portas do cadastro. A cada
// correção a conferência roda de novo, inteira (uma linha pode mudar a outra:
// o protesto aponta para a dívida pelo "#").

type Result = { ok: boolean; error?: string; id?: string };

function mensagem(error: { code?: string; message?: string }, padrao: string): string {
  return error.code === "P0001" && error.message ? error.message : padrao;
}

const paraOBanco = (l: LinhaConferida) => ({
  sheet: l.aba,
  row_no: l.numero,
  source_key: l.chave,
  cells: l.celulas,
  overrides: l.ajustes,
  computed: l.dados,
  warnings: l.avisos,
  has_error: l.temErro,
  blocking: l.bloqueia,
  suggested: l.sugerida,
  decision: l.decisao,
});

async function guarda() {
  const session = await getSessionContext();
  return podeImportarDividas(session);
}

/** Abre o lote: confere a planilha lida no navegador e guarda o resultado. */
export async function conferirArquivo(input: {
  nomeArquivo: string;
  hash: string;
  modeloId: string | null;
  mapeamento: Mapeamento;
  linhas: LinhaDaPlanilha[];
}): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  if (input.linhas.length === 0) return { ok: false, error: "A planilha não tem linhas de dívida." };
  if (input.linhas.length > 3000) return { ok: false, error: "A planilha tem linhas demais (máximo 3.000 por lote)." };

  const { ok, ctx } = await carregarContexto();
  if (!ok) return { ok: false, error: "Não foi possível ler o cadastro para conferir. Tente de novo." };
  const conf = conferirPlanilha(input.linhas, ctx);

  // O mesmo arquivo já entrou? (duplicidade do ARQUIVO, além da das linhas.)
  const supabase = await createClient();
  const avisos: Aviso[] = [];
  if (input.hash) {
    const { data: antes } = await supabase
      .from("debt_import_batches")
      .select("code, committed_at")
      .eq("file_hash", input.hash)
      .eq("status", "importado")
      .limit(1);
    const a = (antes ?? [])[0] as { code: string; committed_at: string } | undefined;
    if (a) {
      avisos.push({ nivel: "aviso", texto: `Este mesmo arquivo já foi importado no lote ${a.code}. As linhas iguais às dívidas cadastradas aparecem para ignorar.` });
    }
  }

  const { data, error } = await supabase.rpc("debt_import_stage", {
    p: {
      file_name: input.nomeArquivo.slice(0, 200),
      file_hash: input.hash || null,
      template_id: input.modeloId,
      mapping: input.mapeamento,
      warnings: avisos,
      totals: conf.totais,
      rows: conf.linhas.map(paraOBanco),
    },
  });
  if (error) {
    console.error("conferirArquivo failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível abrir a conferência.") };
  }
  await logAudit({ action: "create", entityType: "debt_import", entityId: String(data) });
  revalidatePath("/financeiro/dividas/importar");
  return { ok: true, id: String(data) };
}

/** Uma correção na conferência: decisão e/ou ajustes de UMA linha; a conferência roda de novo, inteira. */
export async function corrigirLinha(
  batchId: string,
  rowId: string,
  mudanca: { decisao?: Decisao | null; ajustes?: Ajustes }
): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  const carga = await carregarLote(batchId);
  if (!carga) return { ok: false, error: "Lote não encontrado." };
  if (carga.lote.status !== "conferencia") return { ok: false, error: "Este lote não está mais em conferência." };
  const linhas = carga.linhas.map((l) =>
    l.id === rowId
      ? {
          ...l,
          decisao: mudanca.decisao !== undefined ? mudanca.decisao : l.decisao,
          ajustes: mudanca.ajustes !== undefined ? mudanca.ajustes : l.ajustes,
        }
      : l
  );
  if (!linhas.some((l) => l.id === rowId)) return { ok: false, error: "Linha não encontrada." };
  return guardarConferencia(batchId, linhas);
}

/** Muitas linhas de uma vez (ex.: "ignorar todas as linhas com erro"). */
export async function decidirVarias(batchId: string, rowIds: string[], decisao: Decisao | null): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  const carga = await carregarLote(batchId);
  if (!carga) return { ok: false, error: "Lote não encontrado." };
  if (carga.lote.status !== "conferencia") return { ok: false, error: "Este lote não está mais em conferência." };
  const alvo = new Set(rowIds);
  return guardarConferencia(
    batchId,
    carga.linhas.map((l) => (alvo.has(l.id) ? { ...l, decisao } : l))
  );
}

/** Refaz a conferência com o cadastro de agora (ex.: depois de corrigir um CNPJ na unidade). */
export async function reconferirLote(batchId: string): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  const carga = await carregarLote(batchId);
  if (!carga) return { ok: false, error: "Lote não encontrado." };
  if (carga.lote.status !== "conferencia") return { ok: false, error: "Este lote não está mais em conferência." };
  return guardarConferencia(batchId, carga.linhas);
}

async function guardarConferencia(batchId: string, linhas: NonNullable<Awaited<ReturnType<typeof carregarLote>>>["linhas"]): Promise<Result> {
  const { ok, ctx } = await carregarContexto();
  if (!ok) return { ok: false, error: "Não foi possível ler o cadastro para conferir. Tente de novo." };
  const conf = reconferir(linhas, ctx);
  const idDe = new Map(linhas.map((l) => [`${l.aba}:${l.numero}`, l.id]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_import_update", {
    p_batch_id: batchId,
    p: {
      totals: conf.totais,
      rows: conf.linhas.map((l) => ({ id: idDe.get(`${l.aba}:${l.numero}`), ...paraOBanco(l), decision: l.decisao ?? "" })),
    },
  });
  if (error) {
    console.error("guardarConferencia failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível guardar a correção.") };
  }
  revalidatePath(`/financeiro/dividas/importar/${batchId}`);
  return { ok: true };
}

/** Grava o lote (uma transação) e, se pedido, gera os títulos no Contas a Pagar. */
export async function gravarLote(batchId: string, gerarTitulos: boolean): Promise<Result & { resultado?: ResultadoDoLote }> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  // A conferência roda uma última vez com o cadastro de agora: entre abrir o
  // lote e gravar, alguém pode ter cadastrado o credor ou a dívida.
  const re = await reconferirLote(batchId);
  if (!re.ok) return re;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_import_commit", { p_batch_id: batchId, p_generate_titles: gerarTitulos });
  if (error) {
    console.error("gravarLote failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível gravar a importação. Nada foi gravado.") };
  }
  await logAudit({ action: "create", entityType: "debt_import", entityId: batchId, details: { committed: true } });
  revalidatePath("/financeiro/dividas");
  revalidatePath(`/financeiro/dividas/importar/${batchId}`);
  return { ok: true, resultado: data as ResultadoDoLote };
}

export async function desfazerLote(batchId: string, motivo: string): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  if (motivo.trim().length < 5) return { ok: false, error: "Escreva o motivo para desfazer a importação." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_import_undo", { p_batch_id: batchId, p_reason: motivo.trim() });
  if (error) {
    console.error("desfazerLote failed:", error.message);
    return { ok: false, error: mensagem(error, "Não foi possível desfazer a importação.") };
  }
  await logAudit({ action: "update", entityType: "debt_import_undo", entityId: batchId });
  revalidatePath("/financeiro/dividas");
  revalidatePath(`/financeiro/dividas/importar/${batchId}`);
  return { ok: true };
}

export async function descartarLote(batchId: string): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("debt_import_discard", { p_batch_id: batchId });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível descartar o lote.") };
  revalidatePath("/financeiro/dividas/importar");
  return { ok: true };
}

export async function salvarModelo(nome: string, mapeamento: Mapeamento): Promise<Result> {
  if (!(await guarda())) return { ok: false, error: "Você não tem permissão para importar dívidas." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("debt_import_save_template", { p: { name: nome, mapping: mapeamento } });
  if (error) return { ok: false, error: mensagem(error, "Não foi possível salvar o modelo.") };
  await logAudit({ action: "create", entityType: "debt_import_template", entityId: String(data) });
  return { ok: true, id: String(data) };
}
