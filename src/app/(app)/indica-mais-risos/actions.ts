"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { indicaDb } from "@/lib/indica/db";
import { canIndicar, canViewIndica } from "@/lib/indica/access";
import { mensagemDoBanco } from "@/lib/indica/erros";
import { INDICACAO_STATUS, type IndicacaoStatus } from "@/lib/indica/status";
import { formatCpf, formatPhone } from "@/lib/masks";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const SEM_PERMISSAO = "Você não tem permissão para o Indica +Risos.";

function revalidar(id?: string) {
  revalidatePath("/indica-mais-risos", "layout");
  if (id) revalidatePath(`/indica-mais-risos/indicacoes/${id}`);
}

// -----------------------------------------------------------------------------
// Busca de quem indica
// -----------------------------------------------------------------------------

export type Indicador = {
  clienteId: string | null;
  nome: string;
  codigoCliente: string | null;
  unidade: string | null;
  embaixadorId: string | null;
  embaixadorCodigo: string | null;
  embaixadorAtivo: boolean;
  nivel: string | null;
};

/**
 * Nome, código do cliente, CPF, telefone ou código pessoal do Embaixador. O
 * código pessoal vale na rede toda: o Embaixador de outra unidade aparece com o
 * primeiro nome (o resto da ficha é da unidade dele).
 */
export async function buscarIndicador(termo: string): Promise<Indicador[]> {
  const session = await getSessionContext();
  if (!canIndicar(session)) return [];
  const texto = termo.trim();
  if (texto.length < 2) return [];

  const db = await indicaDb();
  const [{ data: achados, error }, { data: porCodigo }] = await Promise.all([
    db.rpc("buscar_indicador", { p_termo: texto }),
    /^[a-z0-9]{4,12}$/i.test(texto)
      ? db.rpc("embaixador_pelo_codigo", { p_codigo: texto })
      : Promise.resolve({ data: [] }),
  ]);
  if (error) {
    console.error("buscar_indicador:", error.message);
    return [];
  }

  type Linha = {
    cliente_id: string;
    nome: string;
    codigo_cliente: string | null;
    unidade: string | null;
    embaixador_id: string | null;
    embaixador_codigo: string | null;
    embaixador_status: string | null;
    nivel: string | null;
  };
  const lista: Indicador[] = ((achados ?? []) as Linha[]).map((r) => ({
    clienteId: r.cliente_id,
    nome: r.nome,
    codigoCliente: r.codigo_cliente,
    unidade: r.unidade,
    embaixadorId: r.embaixador_id,
    embaixadorCodigo: r.embaixador_codigo,
    embaixadorAtivo: r.embaixador_status === "ativo",
    nivel: r.nivel,
  }));

  type PorCodigo = {
    embaixador_id: string;
    codigo: string;
    primeiro_nome: string;
    nivel: string;
    status: string;
  };
  for (const e of (porCodigo ?? []) as PorCodigo[]) {
    if (lista.some((x) => x.embaixadorId === e.embaixador_id)) continue;
    lista.unshift({
      clienteId: null,
      nome: e.primeiro_nome,
      codigoCliente: null,
      unidade: "outra unidade",
      embaixadorId: e.embaixador_id,
      embaixadorCodigo: e.codigo,
      embaixadorAtivo: e.status === "ativo",
      nivel: e.nivel,
    });
  }
  return lista;
}

/** Transforma o cliente em Embaixador, com o aceite do regulamento vigente. */
export async function tornarEmbaixador(
  clienteId: string,
  versaoRegulamento: string,
  aceitou: boolean
): Promise<Resultado<{ embaixadorId: string; codigo: string }>> {
  const session = await getSessionContext();
  if (!canIndicar(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!aceitou) {
    return { ok: false, error: "Confirme que o cliente aceitou o regulamento." };
  }
  const db = await indicaDb();
  const { data, error } = await db.rpc("criar_embaixador", {
    p_cliente_id: clienteId,
    p_versao_regulamento: versaoRegulamento,
  });
  if (error) {
    console.error("criar_embaixador:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const embaixadorId = data as string;
  const { data: emb } = await db
    .from("embaixadores")
    .select("codigo")
    .eq("id", embaixadorId)
    .single<{ codigo: string }>();
  revalidar();
  return { ok: true, embaixadorId, codigo: emb?.codigo ?? "" };
}

// -----------------------------------------------------------------------------
// Conferência em tempo real e registro
// -----------------------------------------------------------------------------

export type Conferencia = {
  situacao:
    | "livre"
    | "duplicada"
    | "ja_e_cliente"
    | "autoindicacao"
    | "incompleto"
    | "sem_permissao"
    | "erro";
  codigo?: string | null;
  janelaMeses?: number | null;
  cadastroEncontrado?: boolean;
  expiraAoRegistrar?: number;
};

export async function conferirIndicacao(dados: {
  unidadeId: string;
  embaixadorId: string | null;
  telefone: string;
  cpf: string;
}): Promise<Conferencia> {
  const session = await getSessionContext();
  if (!canIndicar(session)) return { situacao: "sem_permissao" };
  const db = await indicaDb();
  const { data, error } = await db.rpc("conferir_indicacao", {
    p_dados: {
      unidade_id: dados.unidadeId,
      embaixador_id: dados.embaixadorId,
      indicado_telefone: dados.telefone,
      indicado_cpf: dados.cpf,
    },
  });
  if (error || !data) {
    if (error) console.error("conferir_indicacao:", error.message);
    return { situacao: "erro" };
  }
  const r = data as {
    situacao: Conferencia["situacao"];
    codigo: string | null;
    janela_meses: number | null;
    cadastro_encontrado: boolean;
    expira_ao_registrar: number;
  };
  return {
    situacao: r.situacao,
    codigo: r.codigo,
    janelaMeses: r.janela_meses,
    cadastroEncontrado: r.cadastro_encontrado,
    expiraAoRegistrar: r.expira_ao_registrar,
  };
}

export async function registrarIndicacao(
  formData: FormData
): Promise<Resultado<{ id: string; codigo: string }>> {
  const session = await getSessionContext();
  if (!canIndicar(session)) return { ok: false, error: SEM_PERMISSAO };

  const campo = (n: string) => String(formData.get(n) ?? "").trim();
  // Mesmas máscaras do navegador, de novo no servidor (padrão do projeto).
  const telefone = campo("indicado_telefone") ? formatPhone(campo("indicado_telefone")) : "";
  const cpf = campo("indicado_cpf") ? formatCpf(campo("indicado_cpf")) : "";

  const db = await indicaDb();
  const { data, error } = await db.rpc("registrar_indicacao", {
    p_dados: {
      unidade_id: campo("unidade_id"),
      canal: campo("canal"),
      embaixador_id: campo("embaixador_id") || null,
      indicado_nome: campo("indicado_nome"),
      indicado_telefone: telefone || null,
      indicado_cpf: cpf || null,
      indicado_email: campo("indicado_email") || null,
      // LGPD: presencial | telefone (a equipe registra) | vazio = convite.
      consentimento: ["presencial", "telefone"].includes(campo("consentimento"))
        ? campo("consentimento")
        : null,
    },
  });
  if (error) {
    console.error("registrar_indicacao:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  const id = data as string;
  const { data: ind } = await db
    .from("indicacoes")
    .select("codigo")
    .eq("id", id)
    .single<{ codigo: string }>();
  revalidar();
  return { ok: true, id, codigo: ind?.codigo ?? "" };
}

// -----------------------------------------------------------------------------
// Avançar etapa
// -----------------------------------------------------------------------------

export async function avancarStatus(
  indicacaoId: string,
  para: IndicacaoStatus,
  motivo: string | null,
  dados: { agendamentoId?: string; vendaId?: string } = {}
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!INDICACAO_STATUS.includes(para)) return { ok: false, error: "Etapa desconhecida." };

  const db = await indicaDb();
  const { error } = await db.rpc("avancar_status", {
    p_indicacao_id: indicacaoId,
    p_novo_status: para,
    p_motivo: motivo?.trim() || null,
    p_dados: {
      ...(dados.agendamentoId ? { agendamento_id: dados.agendamentoId } : {}),
      ...(dados.vendaId ? { venda_id: dados.vendaId } : {}),
    },
  });
  if (error) {
    console.error("avancar_status:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidar(indicacaoId);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// O que escolher em cada etapa (agenda e venda do indicado)
// -----------------------------------------------------------------------------

export type OpcaoDeAvaliacao = {
  id: string;
  startsAt: string;
  status: string;
  checkedIn: boolean;
};

/** As avaliações do cliente (não canceladas), mais novas primeiro. */
export async function avaliacoesDoCliente(clienteId: string): Promise<OpcaoDeAvaliacao[]> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, status, checked_in_at")
    .eq("client_id", clienteId)
    .eq("type", "evaluation")
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    .limit(20)
    .returns<{ id: string; starts_at: string; status: string; checked_in_at: string | null }[]>();
  return (data ?? []).map((a) => ({
    id: a.id,
    startsAt: a.starts_at,
    status: a.status,
    checkedIn: a.checked_in_at !== null,
  }));
}

export type OpcaoDeVenda = {
  id: string;
  codigoNegociacao: string | null;
  valorCentavos: number;
  fechadaEm: string;
};

/** As vendas FECHADAS (contrato + pagamento) e não canceladas do cliente. */
export async function vendasDoCliente(clienteId: string): Promise<OpcaoDeVenda[]> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("plan_negotiations")
    .select("code, commercial_sales ( id, final_cents, closed_at, cancelled_at )")
    .eq("client_id", clienteId)
    .returns<
      {
        code: string | null;
        commercial_sales:
          | { id: string; final_cents: number; closed_at: string | null; cancelled_at: string | null }[]
          | { id: string; final_cents: number; closed_at: string | null; cancelled_at: string | null }
          | null;
      }[]
    >();
  const vendas: OpcaoDeVenda[] = [];
  for (const n of data ?? []) {
    const lista = Array.isArray(n.commercial_sales)
      ? n.commercial_sales
      : n.commercial_sales
        ? [n.commercial_sales]
        : [];
    for (const s of lista) {
      if (!s.closed_at || s.cancelled_at) continue;
      vendas.push({
        id: s.id,
        codigoNegociacao: n.code,
        valorCentavos: s.final_cents,
        fechadaEm: s.closed_at,
      });
    }
  }
  return vendas.sort((a, b) => b.fechadaEm.localeCompare(a.fechadaEm));
}

/** Aceite do indicado registrado DEPOIS (ex.: a recepção ligou para ele). */
export async function registrarAceite(
  indicacaoId: string,
  canal: "presencial" | "telefone"
): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canViewIndica(session)) return { ok: false, error: SEM_PERMISSAO };
  const db = await indicaDb();
  const { error } = await db.rpc("registrar_aceite", { p_indicacao_id: indicacaoId, p_canal: canal });
  if (error) {
    console.error("registrar_aceite:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidar(indicacaoId);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// "Pedi indicação" (ficha do cliente)
// -----------------------------------------------------------------------------

const MOMENTOS = ["fechamento", "entrega_etapa", "elogio", "retorno", "outro"] as const;
const RESULTADOS = ["pendente", "indicou", "recusou", "vai_pensar"] as const;

export async function registrarPedido(dados: {
  clienteId: string;
  unidadeId: string;
  momento: string;
  resultado: string;
  observacao: string;
}): Promise<Resultado> {
  const session = await getSessionContext();
  if (!canIndicar(session)) return { ok: false, error: SEM_PERMISSAO };
  if (!(MOMENTOS as readonly string[]).includes(dados.momento)) {
    return { ok: false, error: "Escolha em que momento você pediu." };
  }
  if (!(RESULTADOS as readonly string[]).includes(dados.resultado)) {
    return { ok: false, error: "Escolha o que o cliente respondeu." };
  }
  const db = await indicaDb();
  const { error } = await db.from("pedidos_indicacao").insert({
    cliente_id: dados.clienteId,
    unidade_id: dados.unidadeId,
    risartano_id: session.userId,
    momento: dados.momento,
    resultado: dados.resultado,
    observacao: dados.observacao.trim() || null,
  });
  if (error) {
    console.error("pedidos_indicacao:", error.message);
    return { ok: false, error: mensagemDoBanco(error) };
  }
  revalidatePath(`/prontuarios/${dados.clienteId}`);
  return { ok: true };
}
