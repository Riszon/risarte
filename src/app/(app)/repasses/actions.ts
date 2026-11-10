"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  CONTEST_KINDS,
  dentistResponseError,
  reasonError,
  reportErrorText,
  type ContestInput,
  type ExclusionKind,
  type ManagerAction,
} from "@/lib/finance/payout-report";

// Repasse, Etapa 3 (0391) — os atos do APROVADOR (Gerente; Coordenador quando
// a unidade não tem Gerente; Financeiro quando o relatório é do próprio
// aprovador) e do DENTISTA. Quem pode o quê é decidido pelo banco, relatório
// a relatório (`can_approve_payout_report`, `provider_id = auth.uid()`): aqui
// não há lista de funções para conferir, só a sessão e a entrada.

export type FlowResult = { ok: boolean; error?: string; status?: string };

function refresh(reportId: string) {
  revalidatePath("/repasses");
  revalidatePath(`/repasses/${reportId}`);
  revalidatePath("/financeiro/repasses/relatorios");
  revalidatePath(`/financeiro/repasses/relatorios/${reportId}`);
}

async function registrar(reportId: string) {
  await logAudit({
    action: "update",
    entityType: "payout_report",
    entityId: reportId,
  });
}

/** O aprovador aprova UM relatório e envia ao dentista. Não existe em lote. */
export async function approvePayoutReport(input: {
  reportId: string;
}): Promise<FlowResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_manager_approve", {
    p_report_id: input.reportId,
  });
  if (error) {
    console.error("payout_report_manager_approve failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true };
}

/** O aprovador devolve o relatório ao Financeiro, com motivo. */
export async function returnPayoutReport(input: {
  reportId: string;
  reason: string;
}): Promise<FlowResult> {
  await getSessionContext();
  const erro = reasonError(input.reason);
  if (erro) return { ok: false, error: erro };
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_return", {
    p_report_id: input.reportId,
    p_reason: input.reason.trim(),
  });
  if (error) {
    console.error("payout_report_return failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true };
}

/** O aprovador tira um procedimento do relatório, na vez dele, com motivo. */
export async function approverExcludeItem(input: {
  reportId: string;
  itemId: string;
  kind: ExclusionKind;
  reason: string;
}): Promise<FlowResult> {
  await getSessionContext();
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
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true };
}

export async function approverRestoreItem(input: {
  reportId: string;
  itemId: string;
}): Promise<FlowResult> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("payout_report_restore_item", {
    p_item_id: input.itemId,
  });
  if (error) {
    console.error("payout_report_restore_item failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true };
}

/** O aprovador responde a UMA linha contestada. */
export async function answerContest(input: {
  reportId: string;
  itemId: string;
  action: ManagerAction;
  text: string;
  exclusionKind: ExclusionKind | null;
}): Promise<FlowResult> {
  await getSessionContext();
  const erro = reasonError(input.text);
  if (erro) return { ok: false, error: erro };
  if (input.action === "excluir" && !input.exclusionKind) {
    return { ok: false, error: "Escolha adiar ou não pagar." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_report_manager_answer", {
    p_item_id: input.itemId,
    p_action: input.action,
    p_text: input.text.trim(),
    p_exclusion_kind: input.action === "excluir" ? input.exclusionKind : null,
  });
  if (error) {
    console.error("payout_report_manager_answer failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true, status: (data as string) ?? undefined };
}

/**
 * O dentista responde ao relatório dele: o que não contestar fica APROVADO
 * (a aprovação parcial, decisão 2 do dono).
 */
export async function respondToMyReport(input: {
  reportId: string;
  contests: ContestInput[];
  missing: string;
}): Promise<FlowResult> {
  await getSessionContext();
  const contests = input.contests.filter((c) => CONTEST_KINDS.includes(c.kind));
  const erro = dentistResponseError(contests, input.missing);
  if (erro) return { ok: false, error: erro };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_report_dentist_respond", {
    p_report_id: input.reportId,
    p_contests: contests.map((c) => ({
      item_id: c.itemId,
      kind: c.kind,
      text: c.text.trim(),
    })),
    p_missing: input.missing.trim() || null,
  });
  if (error) {
    console.error("payout_report_dentist_respond failed:", error.message);
    return { ok: false, error: reportErrorText(error.message) };
  }
  await registrar(input.reportId);
  refresh(input.reportId);
  return { ok: true, status: (data as string) ?? undefined };
}
