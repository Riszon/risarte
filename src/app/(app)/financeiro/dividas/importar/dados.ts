import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import { lerTodasAsPaginas } from "@/lib/paginar";
import {
  conferirPlanilha,
  lerCentavos,
  lerData,
  type Ajustes,
  type DadosDaDivida,
  type DadosDoProtesto,
  type LinhaConferida,
  type Aviso,
  type Contexto,
  type Decisao,
  type LinhaDaPlanilha,
  type Mapeamento,
  type StatusDoLote,
  type TotalPorDevedor,
} from "@/lib/finance/dividas-importacao";
export type { StatusDoLote };

// IMPORTAÇÃO DE DÍVIDAS (0407) — o que as telas da importação leem. Tudo pela
// RLS: sem o módulo, vem vazio.

type Linha = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** O que a conferência precisa saber do banco (o mesmo para conferir e reconferir). */
export async function carregarContexto(): Promise<{ ok: boolean; ctx: Contexto }> {
  const supabase = await createClient();
  // A API entrega no máximo 1.000 linhas por chamada: o que pode passar disso
  // (fornecedores, dívidas, títulos em aberto) é lido em páginas.
  const [cl, su, ca, na, dv, ti] = await Promise.all([
    supabase.from("clinics").select("id, name, legal_name, cnpj, type, is_active"),
    lerTodasAsPaginas<Linha>((de, ate) => supabase.from("suppliers").select("id, name, legal_name, document").order("id").range(de, ate)),
    supabase.from("debt_categories").select("id, parent_id, name, nature_code, active"),
    supabase.from("debt_natures").select("code, label, active"),
    lerTodasAsPaginas<Linha>((de, ate) =>
      supabase
        .from("debts")
        .select("id, code, clinic_id, supplier_id, contract_number, due_date, original_cents, updated_cents")
        .is("deleted_at", null)
        .order("id")
        .range(de, ate)
    ),
    lerTodasAsPaginas<Linha>((de, ate) =>
      supabase
        .from("payables")
        .select("id, clinic_id, supplier_id, description, amount_cents, due_date, document_number")
        .is("debt_id", null)
        .in("status", ["aberta", "parcial", "aguardando_autorizacao"])
        .order("id")
        .range(de, ate)
    ),
  ]);
  const ok = !cl.error && su.ok && !ca.error && !na.error && dv.ok && ti.ok;
  return {
    ok,
    ctx: {
      devedores: ((cl.data ?? []) as Linha[])
        .filter((c) => c.is_active !== false)
        .map((c) => ({ id: c.id as string, nome: c.name as string, razaoSocial: s(c.legal_name), cnpj: s(c.cnpj), franqueadora: c.type === "franchisor" })),
      credores: (su.ok ? su.linhas : []).map((c) => ({ id: c.id as string, nome: c.name as string, razaoSocial: s(c.legal_name), documento: s(c.document) })),
      categorias: ((ca.data ?? []) as Linha[]).map((c) => ({
        id: c.id as string,
        parentId: s(c.parent_id),
        nome: c.name as string,
        natureza: s(c.nature_code),
        ativa: c.active !== false,
      })),
      naturezas: ((na.data ?? []) as Linha[]).filter((n) => n.active !== false).map((n) => ({ code: n.code as string, label: n.label as string })),
      dividas: (dv.ok ? dv.linhas : []).map((d) => ({
        id: d.id as string,
        code: d.code as string,
        clinicId: d.clinic_id as string,
        supplierId: d.supplier_id as string,
        contrato: s(d.contract_number),
        vencimento: d.due_date as string,
        valorCents: Number(d.updated_cents ?? d.original_cents ?? 0),
      })),
      titulosLivres: (ti.ok ? ti.linhas : []).map((t) => ({
        id: t.id as string,
        clinicId: t.clinic_id as string,
        fornecedorId: s(t.supplier_id),
        descricao: t.description as string,
        valorCents: Number(t.amount_cents),
        vencimento: t.due_date as string,
        documento: s(t.document_number),
      })),
      hoje: todayInBrazil(),
    },
  };
}

export type Modelo = { id: string; nome: string; mapeamento: Mapeamento; padrao: boolean; sistema: boolean };

export async function carregarModelos(): Promise<Modelo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("debt_import_templates")
    .select("id, name, mapping, is_default, system, active")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("name");
  return ((data ?? []) as Linha[]).map((m) => ({
    id: m.id as string,
    nome: m.name as string,
    mapeamento: m.mapping as Mapeamento,
    padrao: m.is_default === true,
    sistema: m.system === true,
  }));
}

export type ResultadoDoLote = {
  debts: number;
  protests: number;
  suppliers_created: number;
  categories_created: number;
  titles: number;
  title_failures: { id: string; code: string; motivo: string }[];
  tag: string;
};
export type Lote = {
  id: string;
  code: string;
  arquivo: string;
  hash: string | null;
  status: StatusDoLote;
  avisos: Aviso[];
  totais: TotalPorDevedor[];
  resultado: ResultadoDoLote | null;
  criadoEm: string;
  criadoPor: string | null;
  gravadoEm: string | null;
  desfeitoEm: string | null;
  motivoDesfeito: string | null;
  linhas: number;
};

const loteDaLinha = (b: Linha, nomes: Map<string, string>): Lote => ({
  id: b.id as string,
  code: b.code as string,
  arquivo: b.file_name as string,
  hash: s(b.file_hash),
  status: b.status as StatusDoLote,
  avisos: (b.warnings as Aviso[]) ?? [],
  totais: (b.totals as TotalPorDevedor[]) ?? [],
  resultado: (b.result as ResultadoDoLote | null) ?? null,
  criadoEm: b.created_at as string,
  criadoPor: nomes.get(b.created_by as string) ?? null,
  gravadoEm: s(b.committed_at),
  desfeitoEm: s(b.undone_at),
  motivoDesfeito: s(b.undone_reason),
  linhas: Array.isArray(b.debt_import_rows) ? Number((b.debt_import_rows[0] as { count?: number })?.count ?? 0) : 0,
});

async function nomesDe(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]));
}

const COLUNAS_DO_LOTE =
  "id, code, file_name, file_hash, status, warnings, totals, result, created_at, created_by, committed_at, undone_at, undone_reason, debt_import_rows(count)";

/** Os lotes, do mais novo para o mais antigo. Nulo = a tabela não existe (falta a 0407). */
export async function carregarLotes(): Promise<Lote[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("debt_import_batches").select(COLUNAS_DO_LOTE).order("created_at", { ascending: false }).limit(50);
  if (error) return null;
  const rows = (data ?? []) as Linha[];
  const nomes = await nomesDe(rows.map((r) => r.created_by as string).filter(Boolean));
  return rows.map((r) => loteDaLinha(r, nomes));
}

/** Uma linha do lote como o banco guardou (a conferência refeita parte dela). */
export type LinhaDoLote = {
  id: string;
  aba: "dividas" | "protestos";
  numero: number;
  chave: string | null;
  celulas: Record<string, string | number | null>;
  ajustes: Ajustes;
  decisao: Decisao | null;
  debtId: string | null;
  /** O que a última conferência guardou (vale para o lote já gravado: a foto do momento). */
  guardado: { dados: unknown; avisos: Aviso[]; temErro: boolean; bloqueia: boolean; sugerida: Decisao };
};

export async function carregarLote(id: string): Promise<{ lote: Lote; linhas: LinhaDoLote[] } | null> {
  const supabase = await createClient();
  const [b, r] = await Promise.all([
    supabase.from("debt_import_batches").select(COLUNAS_DO_LOTE).eq("id", id).maybeSingle(),
    lerTodasAsPaginas<Linha>((de, ate) =>
      supabase
        .from("debt_import_rows")
        .select("id, sheet, row_no, source_key, cells, overrides, decision, debt_id, computed, warnings, has_error, blocking, suggested")
        .eq("batch_id", id)
        .order("sheet")
        .order("row_no")
        .range(de, ate)
    ),
  ]);
  if (b.error || !b.data || !r.ok) return null;
  const nomes = await nomesDe([((b.data as Linha).created_by as string) ?? ""].filter(Boolean));
  return {
    lote: loteDaLinha(b.data as Linha, nomes),
    linhas: r.linhas.map((x) => ({
      id: x.id as string,
      aba: x.sheet as "dividas" | "protestos",
      numero: Number(x.row_no),
      chave: s(x.source_key),
      celulas: (x.cells as Record<string, string | number | null>) ?? {},
      ajustes: (x.overrides as Ajustes) ?? {},
      decisao: (s(x.decision) as Decisao | null) ?? null,
      debtId: s(x.debt_id),
      guardado: {
        dados: x.computed ?? null,
        avisos: (x.warnings as Aviso[]) ?? [],
        temErro: x.has_error === true,
        bloqueia: x.blocking === true,
        sugerida: x.suggested as Decisao,
      },
    })),
  };
}

/** A conferência de um lote guardado, refeita com o que o banco sabe AGORA. */
export function reconferir(linhas: LinhaDoLote[], ctx: Contexto) {
  const entrada: LinhaDaPlanilha[] = linhas.map((l) => ({ aba: l.aba, numero: l.numero, celulas: l.celulas, ajustes: l.ajustes, decisao: l.decisao }));
  return conferirPlanilha(entrada, ctx);
}

/**
 * A conferência de um lote JÁ GRAVADO (ou desfeito): a foto do que foi
 * conferido no momento de gravar. Refazer com o banco de agora seria errado —
 * as dívidas do próprio lote passariam a parecer repetidas.
 */
export function conferenciaGuardada(linhas: LinhaDoLote[], devedores: { id: string; nome: string }[]): LinhaConferida[] {
  const nome = new Map(devedores.map((d) => [d.id, d.nome]));
  return linhas.map((l) => {
    const g = l.guardado;
    const d = (g.dados ?? null) as (DadosDaDivida & DadosDoProtesto) | null;
    const div = l.aba === "dividas" ? (d as DadosDaDivida | null) : ((d as DadosDoProtesto | null)?.nova ?? null);
    const clinicId = div?.clinic_id ?? l.ajustes.clinicId ?? null;
    const valor = l.aba === "dividas"
      ? div?.debt.updated_cents ?? div?.debt.original_cents ?? lerCentavos(l.celulas.valor_atualizado) ?? lerCentavos(l.celulas.valor_original)
      : (d as DadosDoProtesto | null)?.protest.amount_cents ?? lerCentavos(l.celulas.valor);
    return {
      aba: l.aba,
      numero: l.numero,
      chave: l.chave,
      celulas: l.celulas,
      ajustes: l.ajustes,
      devedorId: clinicId,
      devedorNome: (clinicId && nome.get(clinicId)) || (l.celulas.devedor ? String(l.celulas.devedor) : null),
      credorNome: l.celulas.credor ? String(l.celulas.credor) : null,
      valorCents: valor ?? null,
      vencimento: l.aba === "dividas" ? div?.debt.due_date ?? lerData(l.celulas.vencimento) : lerData(l.celulas.data),
      avisos: g.avisos,
      temErro: g.temErro,
      bloqueia: g.bloqueia,
      sugerida: g.sugerida,
      decisao: l.decisao,
      titulosParecidos: [],
      duplicadaDe: null,
      credorNovo: null,
      categoriasNovas: [],
      dados: g.dados as LinhaConferida["dados"],
    };
  });
}

/** O que entrou de cada lote, por devedor (para a conferência pós-importação). */
/** Nulo = não deu para ler (a tela esconde a conferência em vez de acusar diferença). */
export async function importadoPorDevedor(batchId: string): Promise<Map<string, { quantidade: number; valorCents: number }> | null> {
  const supabase = await createClient();
  const lido = await lerTodasAsPaginas<Linha>((de, ate) =>
    supabase
      .from("debts")
      .select("id, clinic_id, original_cents, updated_cents, deleted_at")
      .eq("import_batch_id", batchId)
      .order("id")
      .range(de, ate)
  );
  if (!lido.ok) return null;
  const m = new Map<string, { quantidade: number; valorCents: number }>();
  for (const d of lido.linhas) {
    if (d.deleted_at) continue;
    const k = d.clinic_id as string;
    const x = m.get(k) ?? { quantidade: 0, valorCents: 0 };
    x.quantidade += 1;
    x.valorCents += Number(d.updated_cents ?? d.original_cents ?? 0);
    m.set(k, x);
  }
  return m;
}
