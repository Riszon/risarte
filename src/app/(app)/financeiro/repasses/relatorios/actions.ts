"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { todayInBrazil } from "@/lib/dates";
import { canManagePayoutReports } from "@/lib/finance/access";
import {
  billingErrorText,
  correctionError,
  monthError,
  reasonError,
  reportErrorText,
  type ExclusionKind,
  type FinanceAction,
} from "@/lib/finance/payout-report";
import {
  guidanceError,
  mediationError,
  type MediationChannel,
  type MediationOutcome,
  type MediationParty,
} from "@/lib/finance/payout-divergencia";

// Repasse, Etapa 2 (0390). Toda regra mora no banco; a guarda daqui é só para
// a pessoa ouvir "não" antes de preencher.

export type ReportResult = { ok: boolean; error?: string; count?: number };

const NEGADO = "Só o Financeiro da Franqueadora monta o relatório de repasse.";

function refresh(reportId?: string) {
  revalidatePath("/financeiro/repasses");
  revalidatePath("/financeiro/repasses/relatorios");
  revalidatePath("/repasses");
  if (reportId) {
    revalidatePath(`/financeiro/repasses/relatorios/${reportId}`);
    revalidatePath(`/repasses/${reportId}`);
  }
}

/**
 * 0391 — envia UM rascunho para aprovação. O banco decide quem aprova (o
 * Gerente; o Coordenador quando a unidade não tem Gerente; o Financeiro
 * quando o relatório é do próprio aprovador) e avisa pelo sino.
 */
export async function sendPayoutReport(input: {
  reportId: string;
}): Promise<ReportResult & { approver?: string }> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_report_send", {
    p_report_id: input.reportId,
  });
  if (error) {
    console.error("payout_report_send failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  return { ok: true, approver: (data as string) ?? undefined };
}

/**
 * 0391 — envia todos os rascunhos da unidade, um a um. Enviar pode ser de
 * uma vez (pedido do dono); APROVAR nunca é.
 */
export async function sendAllDraftReports(input: {
  clinicId: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const supabase = await createClient();
  const { data: rascunhos, error: erroLista } = await supabase
    .from("payout_reports")
    .select("id, item_count")
    .eq("clinic_id", input.clinicId)
    .eq("status", "rascunho");
  if (erroLista) {
    console.error("sendAllDraftReports list failed:", erroLista.message);
    return { ok: false, error: "Não foi possível ler os rascunhos." };
  }
  let enviados = 0;
  let falhas = 0;
  for (const r of rascunhos ?? []) {
    if (Number(r.item_count ?? 0) === 0) continue;
    const { error } = await supabase.rpc("payout_report_send", {
      p_report_id: r.id as string,
    });
    if (error) {
      console.error("payout_report_send failed:", error.message);
      falhas++;
    } else enviados++;
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  if (falhas > 0) {
    return {
      ok: false,
      count: enviados,
      error: `${enviados} enviado(s) e ${falhas} com erro. Abra os que ficaram em rascunho.`,
    };
  }
  return { ok: true, count: enviados };
}

/**
 * 0402 — o ROTEIRO da divergência: o Financeiro registra a conversa com a
 * unidade ou com o dentista (ou que não conseguiu contato). Sem os dois
 * registros, o banco recusa a decisão.
 */
export async function recordMediation(input: {
  reportId: string;
  itemId: string;
  party: MediationParty;
  outcome: MediationOutcome;
  channel: MediationChannel | null;
  contactUserId: string | null;
  summary: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = mediationError(input);
  if (erro) return { ok: false, error: erro };
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_mediation_record", {
    p_item_id: input.itemId,
    p_party: input.party,
    p_outcome: input.outcome,
    p_channel: input.outcome === "conversou" ? input.channel : null,
    p_contact_user_id: input.contactUserId,
    p_summary: input.summary.trim(),
  });
  if (error) {
    console.error("payout_mediation_record failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({ action: "create", entityType: "payout_mediation", entityId: input.itemId });
  refresh(input.reportId);
  return { ok: true };
}

/**
 * A DECISÃO do Financeiro sobre uma linha contestada duas vezes (ou
 * encaminhada pelo aprovador): manter, propor outro valor (0402: a unidade
 * confirma e o dentista aceita; na rodada final, decide de vez) ou tirar do
 * relatório. Leva a orientação à unidade e ao dentista.
 */
export async function decideContestedItem(input: {
  reportId: string;
  itemId: string;
  action: FinanceAction;
  reason: string;
  newAmountCents: number | null;
  currentAmountCents: number;
  exclusionKind: ExclusionKind | null;
  guidance: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = reasonError(input.reason) ?? guidanceError(input.guidance);
  if (erro) return { ok: false, error: erro };
  if (input.action === "corrigir") {
    const e = correctionError(input.newAmountCents, input.currentAmountCents);
    if (e) return { ok: false, error: e };
  }
  if (input.action === "excluir" && !input.exclusionKind) {
    return { ok: false, error: "Escolha adiar ou não pagar." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_finance_decide", {
    p_item_id: input.itemId,
    p_action: input.action,
    p_reason: input.reason.trim(),
    p_new_amount_cents:
      input.action === "corrigir" ? Math.round(input.newAmountCents ?? 0) : null,
    p_exclusion_kind: input.action === "excluir" ? input.exclusionKind : null,
    p_guidance: input.guidance.trim(),
  });
  if (error) {
    console.error("payout_report_finance_decide failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  return { ok: true };
}

/**
 * 0393 — GERA A CONTA A PAGAR do que está liberado em UM relatório (aprovado
 * pelo aprovador e pelo dentista, ou decidido pelo Financeiro). O banco só
 * leva o que ainda não foi para uma conta: clicar de novo não paga duas vezes.
 */
export async function billPayoutReport(input: {
  reportId: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_bill", {
    p_report_id: input.reportId,
  });
  if (error) {
    console.error("payout_report_bill failed:", error.message);
    return { ok: false, error: billingErrorText(error.message) };
  }
  await logAudit({
    action: "create",
    entityType: "payout_payment",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, count: 1 };
}

/** 0393 — o mesmo, para todos os relatórios da unidade com algo liberado. */
export async function billAllPayoutReports(input: {
  clinicId: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_reports_bill_all", {
    p_clinic_id: input.clinicId,
  });
  if (error) {
    console.error("payout_reports_bill_all failed:", error.message);
    return { ok: false, error: billingErrorText(error.message) };
  }
  await logAudit({
    action: "create",
    entityType: "payout_payment",
    entityId: input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, count: Number(data ?? 0) };
}

/** Gera (ou completa) o relatório de um dentista, ou de todos os da unidade. */
export async function generatePayoutReports(input: {
  clinicId: string;
  /** AAAA-MM */
  month: string;
  providerId: string | null;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = monthError(input.month, todayInBrazil());
  if (erro) return { ok: false, error: erro };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_report_generate", {
    p_clinic_id: input.clinicId,
    p_month: `${input.month}-01`,
    p_provider_id: input.providerId,
  });
  if (error) {
    console.error("payout_report_generate failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "create",
    entityType: "payout_report",
    entityId: input.providerId ?? input.clinicId,
    clinicId: input.clinicId,
  });
  refresh();
  return { ok: true, count: Number(data ?? 0) };
}

export async function excludeReportItem(input: {
  reportId: string;
  itemId: string;
  kind: ExclusionKind;
  reason: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = reasonError(input.reason);
  if (erro) return { ok: false, error: erro };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_exclude_item", {
    p_item_id: input.itemId,
    p_kind: input.kind,
    p_reason: input.reason.trim(),
  });
  if (error) {
    console.error("payout_report_exclude_item failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  return { ok: true };
}

export async function restoreReportItem(input: {
  reportId: string;
  itemId: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_restore_item", {
    p_item_id: input.itemId,
  });
  if (error) {
    console.error("payout_report_restore_item failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  return { ok: true };
}

export async function cancelPayoutReport(input: {
  reportId: string;
  reason: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = reasonError(input.reason);
  if (erro) return { ok: false, error: erro };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_cancel", {
    p_report_id: input.reportId,
    p_reason: input.reason.trim(),
  });
  if (error) {
    console.error("payout_report_cancel failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: input.reportId,
  });
  refresh(input.reportId);
  return { ok: true };
}

/** Tira o procedimento do "não pagar": ele volta a poder entrar em relatório. */
export async function releaseWithheldPayout(input: {
  payoutId: string;
  reason: string;
}): Promise<ReportResult> {
  const session = await getSessionContext();
  if (!canManagePayoutReports(session)) return { ok: false, error: NEGADO };
  const erro = reasonError(input.reason);
  if (erro) return { ok: false, error: erro };

  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_release_withheld", {
    p_payout_id: input.payoutId,
    p_reason: input.reason.trim(),
  });
  if (error) {
    console.error("payout_release_withheld failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  refresh();
  return { ok: true };
}
