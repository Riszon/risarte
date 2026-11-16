"use server";

import { mensagemDoAcordoEmAberto } from "@/lib/acordo-em-aberto";
import { prepararParcelasDoAcordo } from "@/lib/renegociacao/excecao";
import { comBoletosCancelados } from "@/lib/asaas/boletos-da-operacao";
import { cancelarCobrancasDasMensalidades } from "@/lib/asaas/mensalidades";
import { criarCobrancasAutomaticas } from "@/lib/asaas/cobrancas-automaticas";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { CancellationDestination } from "@/lib/finance/cancellation";

export type CancellationResult = {
  ok: boolean;
  error?: string;
  /** 4017a: a recusa foi por acordo de renegociação (a tela mostra os acordos). */
  acordo?: boolean;
  /** Id do termo criado — a tela navega para ele. */
  cancellationId?: string;
};

/**
 * 0206 — passo 1: APURAR. Calcula e congela o acerto de contas, sem desfazer
 * nada. Enquanto o termo não for assinado e efetivado, o tratamento continua
 * de pé: se a conversa com o paciente mudar de rumo, é só descartar.
 */
export async function openPlanCancellation(input: {
  clientId: string;
  negotiationId: string;
  reason: string;
  destination: CancellationDestination | null;
  returnDate: string | null;
  notes: string;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  if (!input.reason.trim()) {
    return { ok: false, error: "Escreva o motivo do cancelamento." };
  }

  const { data, error } = await supabase.rpc("open_plan_cancellation", {
    p_negotiation_id: input.negotiationId,
    p_reason: input.reason,
    p_destination: input.destination,
    p_return_date: input.returnDate,
    p_notes: input.notes || null,
  });
  if (error) {
    const m = error.message;
    const acordo = mensagemDoAcordoEmAberto(m);
    if (acordo) return { ok: false, error: acordo, acordo: true };
    if (m.includes("ALREADY_OPEN")) {
      return {
        ok: false,
        error: "Já existe um termo de cancelamento em aberto para este plano.",
      };
    }
    if (m.includes("PENDING_FIRST")) {
      return {
        ok: false,
        error:
          "Há um acordo de renegociação desta venda que ainda não vale (aguardando autorização ou assinatura). Cancele o acordo pendente antes de abrir o distrato.",
        acordo: true,
      };
    }
    if (m.includes("ALREADY_CANCELLED")) {
      return { ok: false, error: "Este plano já foi cancelado." };
    }
    if (m.includes("DESTINATION_REQUIRED")) {
      return {
        ok: false,
        error: "Escolha para onde o cliente vai depois do cancelamento.",
      };
    }
    if (m.includes("RETURN_DATE_REQUIRED")) {
      return { ok: false, error: "Informe a data de retorno do acompanhamento." };
    }
    if (m.includes("REASON_REQUIRED")) {
      return { ok: false, error: "Escreva o motivo do cancelamento." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Cancelar tratamento é do Gerente da unidade ou do Admin Master.",
      };
    }
    console.error("open_plan_cancellation failed:", m);
    return { ok: false, error: "Não foi possível apurar o cancelamento." };
  }

  await logAudit({
    action: "create",
    entityType: "plan_cancellation",
    entityId: typeof data === "string" ? data : input.negotiationId,
  });
  revalidatePath(`/apresentacao/${input.clientId}`);
  revalidatePath(`/comercial/${input.clientId}`);
  return { ok: true, cancellationId: typeof data === "string" ? data : undefined };
}

/** Passo 2: o cliente assinou o termo (marcação manual, como o fechamento). */
export async function signPlanCancellation(input: {
  id: string;
  clientId: string;
  signed: boolean;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("sign_plan_cancellation", {
    p_id: input.id,
    p_signed: input.signed,
  });
  if (error) {
    if (error.message.includes("ALREADY_APPLIED")) {
      return { ok: false, error: "Este cancelamento já foi efetivado." };
    }
    if (error.message.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Sua função não permite esta ação." };
    }
    console.error("sign_plan_cancellation failed:", error.message);
    return { ok: false, error: "Não foi possível registrar a assinatura." };
  }

  await logAudit({
    action: "update",
    entityType: "plan_cancellation_sign",
    entityId: input.id,
  });
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  return { ok: true };
}

/**
 * Passo 3: EFETIVAR. É só aqui que sessões, cobranças e fase mudam — e o banco
 * exige o termo assinado antes.
 */
export async function applyPlanCancellation(input: {
  id: string;
  clientId: string;
  /** 4015 (19.26.1): a pessoa confirmou que o cancelamento cancela os boletos vivos. */
  confirmarCancelamento?: boolean;
}): Promise<CancellationResult & { precisaConfirmar?: number }> {
  const session = await getSessionContext();
  const supabase = await createClient();

  // 4015: aplicar o cancelamento cancela no Asaas os boletos vivos das parcelas
  // em aberto da venda, na mesma operação (com a confirmação da tela).
  const { data: canc } = await supabase
    .from("plan_cancellations")
    .select("negotiation_id, direct_sale_id, exception_id, checklist_required, kind")
    .eq("id", input.id)
    .maybeSingle();
  const distrato = Boolean(canc?.checklist_required);
  const negotiationId = (canc?.negotiation_id as string | null) ?? null;
  const directSaleId = (canc?.direct_sale_id as string | null) ?? null;
  // 4020 (D12): no distrato, nada é cancelado no Asaas antes de a checklist
  // estar concluída e o termo assinado (o banco confere de novo ao efetivar).
  if (distrato) {
    const admin = createAdminClient();
    const pronto = await admin.rpc("_distrato_ready", { p_id: input.id });
    if (pronto.error) return { ok: false, error: mensagemDoDistrato(pronto.error.message) ?? "Não foi possível conferir o distrato." };
  }
  // A parcial também cai no distrato (6a).
  let abertas: { id: string }[] = [];
  if (negotiationId || directSaleId) {
    let q = supabase.from("payment_installments").select("id").in("status", distrato ? ["em_aberto", "parcial"] : ["em_aberto"]);
    q = negotiationId ? q.eq("negotiation_id", negotiationId) : q.eq("direct_sale_id", directSaleId as string);
    abertas = ((await q).data ?? []) as { id: string }[];
  }
  // 4017a: com a exceção, as parcelas do acordo em aberto também caem (os
  // boletos delas no Asaas; o cartão parcelado ainda não aprovado, inteiro).
  // 4020: no distrato, as de todo acordo da venda (as que caem e as reduzidas).
  const doAcordo = (canc?.exception_id || distrato) && (negotiationId || directSaleId)
    ? await prepararParcelasDoAcordo({ negotiationId, directSaleId, actorId: session.userId })
    : { ok: true as const, installmentIds: [] as string[] };
  if (!doAcordo.ok) return { ok: false, error: doAcordo.error };
  // 4020: as mensalidades futuras da Ortodontia da venda caem; as cobranças
  // vivas delas são canceladas no Asaas antes.
  if (distrato && negotiationId) {
    const admin = createAdminClient();
    const { data: futuras } = await admin.rpc("_distrato_ortho_future", { p_neg: negotiationId });
    const ids = ((futuras ?? []) as string[]).filter(Boolean);
    if (ids.length) {
      const r = await cancelarCobrancasDasMensalidades({ tipo: "ortho_charge", ids, actorId: session.userId, motivo: "distrato da venda" });
      if (!r.ok) return { ok: false, error: `As mensalidades da Ortodontia não foram canceladas no Asaas, então nada foi mudado. ${r.error}` };
    }
  }
  const op = await comBoletosCancelados<unknown>({
    operacao: "cancelamento do plano",
    motivo: "cancelamento do plano",
    installmentIds: [...(abertas ?? []).map((x) => x.id as string), ...doAcordo.installmentIds],
    actorId: session.userId,
    confirmar: Boolean(input.confirmarCancelamento),
    venda: { negotiationId, directSaleId },
    tentar: async () => {
      const r = await supabase.rpc("apply_plan_cancellation", { p_id: input.id });
      return { error: r.error };
    },
  });
  if (!op.ok && op.precisaConfirmar) return { ok: false, error: op.error, precisaConfirmar: op.precisaConfirmar };
  const error = op.ok ? null : { message: op.error };
  if (error) {
    const m = error.message;
    const acordo = mensagemDoAcordoEmAberto(m);
    if (acordo) return { ok: false, error: acordo };
    if (m.includes("TERM_NOT_SIGNED")) {
      return {
        ok: false,
        error:
          "O termo precisa estar assinado pelo cliente antes de efetivar o cancelamento.",
      };
    }
    if (m.includes("ALREADY_APPLIED")) {
      return { ok: false, error: "Este cancelamento já foi efetivado." };
    }
    const d = mensagemDoDistrato(m);
    if (d) return { ok: false, error: d };
    if (m.includes("EXCEPTION_INVALID")) {
      return {
        ok: false,
        error:
          "A exceção autorizada não vale mais (venceu, já foi usada ou o acordo mudou). Peça de novo ao Financeiro e abra um novo termo.",
      };
    }
    if (m.includes("NOT_ALLOWED")) {
      return {
        ok: false,
        error: "Cancelar tratamento é do Gerente da unidade ou do Admin Master.",
      };
    }
    console.error("apply_plan_cancellation failed:", m);
    return { ok: false, error: "Não foi possível efetivar o cancelamento." };
  }

  await logAudit({
    action: "update",
    entityType: "plan_cancellation_apply",
    entityId: input.id,
  });
  // 4020 (19.35.5): a parcela do acordo de várias vendas, reduzida, volta à
  // rotina das cobranças com o valor novo (o boleto antigo já foi cancelado).
  if (distrato) {
    const admin = createAdminClient();
    const { data: depois } = await admin.from("plan_cancellations").select("agreement_changes").eq("id", input.id).maybeSingle();
    const reduzidos = new Set(
      (((depois?.agreement_changes ?? []) as { acordo: string; acao: string }[]) || [])
        .filter((x) => x.acao === "reduzir")
        .map((x) => x.acordo)
    );
    for (const renegotiationId of reduzidos) {
      await criarCobrancasAutomaticas({ origem: "gatilho", ator: session.userId, renegotiationId }).catch(() => null);
    }
  }
  revalidatePath(`/cancelamentos/${input.id}/termo`);
  revalidatePath(`/prontuarios/${input.clientId}`);
  revalidatePath(`/apresentacao/${input.clientId}`);
  revalidatePath("/jornada");
  revalidatePath("/comercial");
  return { ok: true };
}

/** Desistiu do cancelamento: joga o termo fora sem tocar no tratamento. */
export async function discardPlanCancellation(input: {
  id: string;
  clientId: string;
}): Promise<CancellationResult> {
  await getSessionContext();
  const supabase = await createClient();

  const { error } = await supabase.rpc("discard_plan_cancellation", {
    p_id: input.id,
  });
  if (error) {
    if (error.message.includes("ALREADY_APPLIED")) {
      return {
        ok: false,
        error: "Este cancelamento já foi efetivado — não dá para descartar.",
      };
    }
    console.error("discard_plan_cancellation failed:", error.message);
    return { ok: false, error: "Não foi possível descartar o termo." };
  }

  revalidatePath(`/apresentacao/${input.clientId}`);
  return { ok: true };
}

/** 4020: as recusas do distrato (D12). Devolve null quando não é do distrato. */
function mensagemDoDistrato(m: string): string | null {
  if (m.includes("CHECKLIST_INCOMPLETE"))
    return "Conclua a checklist do distrato antes de efetivar: cada item fica \"Feito\" ou \"Não se aplica\", com o motivo.";
  if (m.includes("SETTLEMENT_CHANGED"))
    return "Entrou pagamento depois do termo, então o acerto do termo não vale mais. Descarte este termo e abra o distrato de novo, para o termo sair com o acerto certo.";
  if (m.includes("TERM_NOT_SIGNED")) return "O termo precisa estar assinado pelo cliente antes de efetivar o distrato.";
  return null;
}
