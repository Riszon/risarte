"use server";

/**
 * ASA4, entrega 6 (4020, spec 19.35): o DISTRATO com checklist.
 *
 * - O pedido de distrato é registrado na ficha por quem atende; o Gerente
 *   abre o distrato ou mantém o contrato, com o motivo (nada é automático).
 * - A checklist (8 itens + o termo assinado) vem antes de efetivar: sem ela,
 *   nada é cancelado no Asaas nem no riSZon.
 * - A devolução por Pix da conta da unidade: o Gerente pede com o termo
 *   anexado; o Financeiro da Franqueadora ou o Admin Master autorizam.
 */
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

type Resultado = { ok: true } | { ok: false; error: string };

export type DistratoLido = {
  id: string;
  codigo: string | null;
  tipo: "contrato" | "venda_direta";
  situacao: string;
  checklist_obrigatoria: boolean;
  pode_operar: boolean;
  pode_pedir_devolucao: boolean;
  dias_aberto: number;
  acerto: {
    contrato: number;
    feito: number;
    pendente: number;
    multa_pct: number;
    multa: number;
    devido: number;
    pago: number;
    pago_no_acordo: number;
    cartao_a_receber: number;
    cliente_deve: number;
    unidade_devolve: number;
    pago_agora: number;
  };
  multa: { pct: number; origem: "unidade" | "rede" | "zero" | "sem_multa" };
  checklist: Record<string, { situacao: "feito" | "nao_se_aplica"; motivo: string | null; quem: string | null; quando: string }>;
  pendencias: { sessoes_a_cancelar: number; sessoes_feitas: number; consultas_futuras: number };
  acordos: { id: string; codigo: string | null; parte: number; multi_venda: boolean; pendente: boolean; aberto: number; pago: number; pago_parte: number; aberto_parte: number }[];
  plano_dos_acordos: { codigo: string | null; parte: number; acao: "cancelar" | "reduzir"; seq: number | null; vencimento: string; antes: number; depois: number }[];
  cobrancas_vivas: { id: string; meio: string | null; valor: number; vencimento: string; situacao: string; parcelado: boolean }[];
  listas_forma2: number;
  ortodontia: { casos_ativos: number; futuras: number; futuras_valor: number; vencidas: number; vencidas_valor: number } | null;
  taxa_da_rede: { recebimentos: number; taxa: number; dispensada: number } | null;
  indica: { situacao: string } | null;
  devolucoes: { id: string; valor: number; situacao: string; pedido_em: string; nota: string | null }[];
};

const mensagem = (m: string): string => {
  if (m.includes("NOT_ALLOWED")) return "Sua função não permite esta ação.";
  if (m.includes("REASON_REQUIRED")) return "Escreva o motivo (pelo menos 5 letras).";
  if (m.includes("ALREADY_REQUESTED")) return "Já existe um pedido de distrato aberto para esta venda.";
  if (m.includes("ALREADY_DECIDED")) return "Este pedido já foi decidido.";
  if (m.includes("ALREADY_OPEN")) return "Já existe um distrato aberto para esta venda.";
  if (m.includes("ALREADY_CANCELLED")) return "Esta venda já foi cancelada.";
  if (m.includes("ALREADY_APPLIED")) return "Este distrato já foi efetivado.";
  if (m.includes("PENDING_FIRST"))
    return "Há um acordo de renegociação desta venda que ainda não vale (aguardando autorização ou assinatura). Cancele o acordo pendente antes.";
  if (m.includes("TERM_REQUIRED")) return "Anexe o termo de distrato assinado. Sem o anexo, a devolução não é registrada.";
  if (m.includes("AMOUNT_OVER_BALANCE")) return "O valor passa do que ainda falta devolver neste distrato.";
  if (m.includes("NOT_APPLIED")) return "A devolução é pedida depois de o distrato ser efetivado.";
  if (m.includes("RETURN_ALREADY_DECIDED")) return "Este pedido já foi decidido.";
  if (m.includes("SELF_APPROVAL")) return "Quem pediu a devolução não pode autorizá-la.";
  if (m.includes("NOT_FOUND")) return "Não encontrado.";
  return "Não foi possível concluir. Tente de novo.";
};

export async function lerDistrato(id: string): Promise<{ ok: true; d: DistratoLido } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distrato_read", { p_id: id });
  if (error) return { ok: false, error: mensagem(error.message) };
  return { ok: true, d: data as DistratoLido };
}

/** A ficha: o pedido registrado por quem atende (Recepção, Gerente, Comercial). */
export async function pedirDistrato(input: {
  clientId: string;
  negotiationId?: string | null;
  directSaleId?: string | null;
  reason: string;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distrato_request", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  await logAudit({ action: "create", entityType: "distrato_request", entityId: String(data ?? "") });
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true };
}

/** O Gerente decide manter o contrato, com o motivo. */
export async function manterContrato(input: { id: string; reason: string }): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("distrato_request_keep", { p_id: input.id, p_reason: input.reason });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true };
}

export async function marcarItemDoDistrato(input: {
  id: string;
  item: number;
  state: "feito" | "nao_se_aplica" | null;
  reason?: string;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("distrato_checklist_set", {
    p_id: input.id,
    p_item: input.item,
    p_state: input.state,
    p_reason: input.reason ?? null,
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  return { ok: true };
}

/** 4a: a venda direta com algo pago passa pelo distrato (acerto sem multa). */
export async function abrirDistratoDaVendaDireta(input: {
  clientId: string;
  saleId: string;
  reason: string;
}): Promise<{ ok: true; cancellationId: string } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_direct_sale_distrato", { p_sale_id: input.saleId, p_reason: input.reason });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath(`/prontuarios/${input.clientId}`);
  return { ok: true, cancellationId: String(data) };
}

/** A devolução por Pix da conta da unidade, com o termo anexado (a pasta privada `devolucoes`). */
export async function pedirDevolucaoDoDistrato(input: {
  cancellationId: string;
  amountCents: number;
  reason: string;
  termPath: string;
  termName: string;
  /** 4020a: o estorno pelo Asaas primeiro (numa cobrança paga), ou o Pix da conta da unidade. */
  method?: "estorno_asaas" | "pix_unidade";
  chargeId?: string | null;
}): Promise<Resultado> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("distrato_refund_request", {
    p: {
      cancellation_id: input.cancellationId,
      amount_cents: input.amountCents,
      reason: input.reason,
      term_path: input.termPath,
      term_name: input.termName,
      method: input.method ?? "pix_unidade",
      charge_id: input.chargeId ?? null,
    },
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  revalidatePath(`/cancelamentos/${input.cancellationId}/termo`);
  return { ok: true };
}

export async function decidirDevolucaoDoDistrato(input: { id: string; approve: boolean; note: string }): Promise<Resultado> {
  await getSessionContext();
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distrato_refund_decide", { p_id: input.id, p_approve: input.approve, p_note: input.note });
  if (error) return { ok: false, error: mensagem(error.message) };
  // 4020a: a devolução pelo estorno do Asaas vai agora (a autorização do Financeiro é a confirmação).
  if (input.approve && data) {
    const { data: dr } = await supabase.from("distrato_refunds").select("method").eq("id", input.id).maybeSingle();
    if (dr?.method === "estorno_asaas") {
      const { enviarPedidoDeEstorno } = await import("@/lib/asaas/estorno-parcial");
      const e = await enviarPedidoDeEstorno(String(data), session.userId);
      revalidatePath("/financeiro/cobrancas-automaticas");
      if (!e.ok) return { ok: false, error: `Autorizada, mas o estorno não saiu: ${e.error}` };
    }
  }
  revalidatePath("/financeiro/cobrancas-automaticas");
  return { ok: true };
}

/** Link curto (10 min) para abrir o termo anexado; a regra da pasta decide quem vê. */
export async function linkDoTermoDoDistrato(path: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("devolucoes").createSignedUrl(path, 600);
  if (error || !data) return { ok: false, error: "Não foi possível abrir o termo." };
  await logAudit({ action: "view", entityType: "distrato_refund_term", entityId: path });
  return { ok: true, url: data.signedUrl };
}

export type DistratosDaRede = {
  pedidos: {
    id: string;
    unidade: string;
    cliente: string | null;
    client_id: string;
    venda: string | null;
    negotiation_id: string | null;
    direct_sale_id: string | null;
    origem: "pedido" | "atraso";
    motivo: string;
    pedido_em: string;
    atraso_desde: string | null;
    quem_pediu: string | null;
    pode_decidir: boolean;
  }[];
  abertos: {
    id: string;
    codigo: string | null;
    unidade: string;
    cliente: string | null;
    client_id: string;
    tipo: string;
    situacao: string;
    aberto_em: string;
    dias: number;
    itens_feitos: number;
  }[];
};

export async function lerDistratos(): Promise<{ ok: true; d: DistratosDaRede } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distratos_read");
  if (error) return { ok: false, error: mensagem(error.message) };
  return { ok: true, d: data as DistratosDaRede };
}

export type Devolucao = {
  id: string;
  tipo: "pix_unidade" | "estorno_asaas";
  origem: string;
  unidade: string;
  cliente: string | null;
  client_id: string | null;
  valor: number;
  motivo: string;
  situacao: string;
  pedido_em: string;
  quem_pediu: string | null;
  termo: string | null;
  nota: string | null;
  pode_decidir: boolean;
};

export async function lerDevolucoes(): Promise<{ ok: true; d: Devolucao[] } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("devolucoes_read");
  if (error) return { ok: false, error: mensagem(error.message) };
  return { ok: true, d: (data ?? []) as Devolucao[] };
}

export type SituacaoDoDistratoDaVenda = {
  pedido: { id: string; origem: string; motivo: string; pedido_em: string } | null;
  distrato: { id: string; codigo: string | null; situacao: string } | null;
  pago: number;
  pode_pedir: boolean;
  pode_decidir: boolean;
};

export async function situacaoDoDistratoDaVenda(input: {
  negotiationId?: string | null;
  directSaleId?: string | null;
}): Promise<{ ok: true; s: SituacaoDoDistratoDaVenda } | { ok: false; error: string }> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distrato_sale_status", {
    p_negotiation_id: input.negotiationId ?? null,
    p_direct_sale_id: input.directSaleId ?? null,
  });
  if (error) return { ok: false, error: mensagem(error.message) };
  return { ok: true, s: data as SituacaoDoDistratoDaVenda };
}

/** 4020a: as cobranças pagas pelo Asaas (Pix ou cartão à vista) do cliente do distrato — o estorno vem primeiro. */
export async function cobrancasParaEstornoDoDistrato(cancellationId: string): Promise<{ id: string; valor: number; pagaEm: string | null; meio: string }[]> {
  await getSessionContext();
  const supabase = await createClient();
  const { data: pc } = await supabase.from("plan_cancellations").select("client_id").eq("id", cancellationId).maybeSingle();
  if (!pc?.client_id) return [];
  const { data } = await supabase
    .from("charges")
    .select("id, paid_cents, paid_on, billing_type")
    .eq("client_id", pc.client_id)
    .in("status", ["paga", "liquidada"])
    .in("billing_type", ["PIX", "CREDIT_CARD"])
    .is("installment_block", null)
    .eq("is_external", false)
    .not("asaas_payment_id", "is", null)
    .order("paid_on", { ascending: false });
  return ((data ?? []) as { id: string; paid_cents: number | null; paid_on: string | null; billing_type: string }[]).map((c) => ({
    id: c.id,
    valor: Number(c.paid_cents ?? 0),
    pagaEm: c.paid_on,
    meio: c.billing_type === "PIX" ? "Pix" : "Cartão",
  }));
}
