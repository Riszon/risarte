"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { todayInBrazil } from "@/lib/dates";
import { canManagePayoutReports } from "@/lib/finance/access";
import {
  monthError,
  reasonError,
  reportErrorText,
  type ExclusionKind,
} from "@/lib/finance/payout-report";

// Repasse, Etapa 2 (0390). Toda regra mora no banco; a guarda daqui é só para
// a pessoa ouvir "não" antes de preencher.

export type ReportResult = { ok: boolean; error?: string; count?: number };

const NEGADO = "Só o Financeiro da Franqueadora monta o relatório de repasse.";

function refresh(reportId?: string) {
  revalidatePath("/financeiro/repasses");
  revalidatePath("/financeiro/repasses/relatorios");
  if (reportId) revalidatePath(`/financeiro/repasses/relatorios/${reportId}`);
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
