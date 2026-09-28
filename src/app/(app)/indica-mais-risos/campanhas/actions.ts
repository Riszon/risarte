"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { indicaDb } from "@/lib/indica/db";
import { canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import {
  ACOES_CAMPANHA,
  campanhaComecou,
  lerRegras,
  type AcaoCampanha,
  type CampanhaStatus,
  type PublicoCampanha,
  type RegrasCampanha,
} from "@/lib/indica/campanhas";
import { instantFromInputValue } from "@/lib/dates";
import { parseBRLToCents } from "@/lib/pricing";

const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

export type DadosCampanha = {
  nome: string;
  descricao: string;
  modelo: string;
  escopo: "rede" | "unidades";
  unidades: string[];
  inicio: string;
  fim: string;
  regras: { multiplicador: string; registro: string; comparecimento: string; fechamento: string; marcos: string };
  publico: PublicoCampanha;
  especialidade: string;
  orcamento: string;
  beneficioIndicado: string;
  regulamento: string;
};

type Lido = {
  regras: RegrasCampanha;
  inicio: Date;
  fim: Date;
  orcamento: number | null;
};

function ler(d: DadosCampanha): { ok: true; v: Lido } | { ok: false; error: string } {
  if (!d.nome.trim()) return { ok: false, error: "Dê um nome à campanha." };
  const regras = lerRegras(d.regras);
  if (!regras.ok) return { ok: false, error: regras.error };
  const inicio = instantFromInputValue(d.inicio);
  const fim = instantFromInputValue(d.fim);
  if (!inicio || !fim) return { ok: false, error: "Informe o começo e o fim da campanha." };
  if (fim <= inicio) return { ok: false, error: "O fim precisa ser depois do começo." };
  if (d.escopo === "unidades" && d.unidades.length === 0) {
    return { ok: false, error: "Marque pelo menos uma unidade (ou escolha a rede toda)." };
  }
  const orcamento = d.orcamento.trim() ? parseBRLToCents(d.orcamento) : null;
  if (d.orcamento.trim() && (orcamento === null || orcamento <= 0)) {
    return { ok: false, error: "Orçamento em reais inválido (deixe em branco para sem teto)." };
  }
  return { ok: true, v: { regras: regras.valor, inicio, fim, orcamento } };
}

const limparPublico = (p: PublicoCampanha): PublicoCampanha => {
  const r: PublicoCampanha = {};
  if (p.niveis?.length) r.niveis = p.niveis;
  if (p.especialidades?.length) r.especialidades = p.especialidades;
  if (p.empresas?.length) r.empresas = p.empresas;
  return r;
};

/**
 * Cria (rascunho) ou altera uma campanha. Quem pode, a RLS decide (rede =
 * franqueadora; unidades = gestor de todas). Depois de começar, o banco só
 * aceita AMPLIAR (`campanha_protege_regras`) — aqui nem mandamos público,
 * unidades e começo, para a mensagem ser a de ampliar e não a de "mudou".
 */
export async function salvarCampanha(
  d: DadosCampanha,
  id?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const lido = ler(d);
  if (!lido.ok) return lido;
  const { regras, inicio, fim, orcamento } = lido.v;
  const db = await indicaDb();

  const comum = {
    nome: d.nome.trim(),
    descricao: d.descricao.trim() || null,
    regras,
    fim: fim.toISOString(),
    orcamento_max_centavos: orcamento,
    beneficio_indicado: d.beneficioIndicado.trim() ? { descricao: d.beneficioIndicado.trim() } : null,
    regulamento_md: d.regulamento.trim() || null,
    atualizado_em: new Date().toISOString(),
  };
  const estrutura = {
    modelo: d.modelo || null,
    escopo: d.escopo,
    unidades: d.escopo === "rede" ? [] : d.unidades,
    publico: limparPublico(d.publico),
    especialidade: d.especialidade.trim() || null,
    inicio: inicio.toISOString(),
  };

  let resultado;
  if (id) {
    const { data: atual } = await db.from("campanhas").select("status").eq("id", id).maybeSingle<{ status: CampanhaStatus }>();
    if (!atual) return { ok: false, error: "Campanha não encontrada." };
    const linha = campanhaComecou(atual.status) ? comum : { ...comum, ...estrutura };
    resultado = await db.from("campanhas").update(linha).eq("id", id).select("id").maybeSingle<{ id: string }>();
  } else {
    resultado = await db
      .from("campanhas")
      .insert({ ...comum, ...estrutura, criado_por: session.userId })
      .select("id")
      .maybeSingle<{ id: string }>();
  }
  const { data, error } = resultado;
  if (error || !data) {
    if (error) console.error("campanhas:", error.message);
    return { ok: false, error: error ? mensagemDoBanco(error) : "Você não pode alterar esta campanha." };
  }
  await logAudit({ action: id ? "update" : "create", entityType: "indica_campanha", entityId: data.id });
  revalidatePath("/indica-mais-risos/campanhas");
  return { ok: true, id: data.id };
}

export async function mudarCampanha(
  id: string,
  acao: AcaoCampanha,
  motivo?: string
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!ACOES_CAMPANHA.includes(acao)) return { ok: false, error: "Ação inválida." };
  const db = await indicaDb();
  const { data, error } = await db.rpc("mudar_campanha", { p_id: id, p_acao: acao, p_motivo: motivo ?? null });
  if (error) {
    console.error("mudar_campanha:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath("/indica-mais-risos/campanhas");
  revalidatePath(`/indica-mais-risos/campanhas/${id}`);
  return { ok: true, status: String(data) };
}

export type Simulacao = {
  historico_dias: number;
  historico_indicacoes: number;
  taxa_comparecimento: number | null;
  taxa_fechamento: number | null;
  previstas: { indicacoes: number; comparecimentos: number; fechamentos: number };
  riso_coins_sem_campanha: number;
  riso_coins_com_campanha: number;
  custo_extra_centavos: number;
  custo_total_centavos: number;
};

/** Simulador de custo pelo histórico real das unidades (180 dias). */
export async function simularCampanha(
  d: DadosCampanha
): Promise<{ ok: true; simulacao: Simulacao } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const lido = ler(d);
  if (!lido.ok) return lido;
  const db = await indicaDb();
  const { data, error } = await db.rpc("simular_campanha", {
    p_unidades: d.escopo === "rede" ? [] : d.unidades,
    p_regras: lido.v.regras,
    p_inicio: lido.v.inicio.toISOString(),
    p_fim: lido.v.fim.toISOString(),
  });
  if (error) {
    console.error("simular_campanha:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  return { ok: true, simulacao: data as Simulacao };
}
