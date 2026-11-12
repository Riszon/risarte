import type { SupabaseClient } from "@supabase/supabase-js";
import {
  billingFromDb,
  reportFromDb,
  reportItemFromDb,
  reportPaymentFromDb,
  type Report,
  type ReportBilling,
  type ReportBillingDb,
  type ReportDb,
  type ReportItem,
  type ReportItemDb,
  type ReportPayment,
  type ReportPaymentDb,
} from "@/lib/finance/payout-report";
import {
  mediationFromDb,
  personFromDb,
  type MediationContact,
  type MediationContactDb,
  type MediationPerson,
  type MediationPersonDb,
} from "@/lib/finance/payout-divergencia";

// Repasse (0390/0391) — a leitura de UM relatório para quem cuida dele (o
// Financeiro e o aprovador). Usada pelas duas portas: Financeiro › Relatórios
// de repasse e Repasses › para aprovar. O banco decide quem lê.

export type HistoryRow = {
  at: string;
  action: string;
  note: string | null;
  actorName: string | null;
  procedureName: string | null;
};

export type ReportData = {
  report: Report;
  items: ReportItem[];
  history: HistoryRow[];
  /** As contas a pagar geradas deste relatório (0393). */
  payments: ReportPayment[];
  /** O usuário é o aprovador DESTE relatório (o banco responde). */
  canApprove: boolean;
  loadFailed: boolean;
  /** 0402 — o roteiro da divergência (só o Financeiro lê). */
  mediation: MediationContact[];
  people: MediationPerson[];
};

/**
 * As contas a pagar de UM relatório (0393). Serve às três visões: o banco
 * devolve ao dentista só as que valem, sem o registro interno.
 */
export async function carregarPagamentos(
  supabase: SupabaseClient,
  reportId: string
): Promise<ReportPayment[]> {
  const { data, error } = await supabase.rpc("payout_report_payments", {
    p_report_id: reportId,
  });
  if (error) {
    console.error("payout_report_payments failed:", error.message);
    return [];
  }
  return ((data ?? []) as ReportPaymentDb[]).map(reportPaymentFromDb);
}

/** O resumo do pagamento de vários relatórios, por id (0393). */
export async function carregarCobrancas(
  supabase: SupabaseClient,
  reportIds: string[]
): Promise<Map<string, ReportBilling>> {
  const mapa = new Map<string, ReportBilling>();
  if (reportIds.length === 0) return mapa;
  const { data, error } = await supabase.rpc("payout_report_billing", {
    p_report_ids: reportIds,
  });
  if (error) {
    console.error("payout_report_billing failed:", error.message);
    return mapa;
  }
  for (const r of (data ?? []) as ReportBillingDb[]) {
    mapa.set(r.report_id, billingFromDb(r));
  }
  return mapa;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` = não existe ou a pessoa não pode ler (a tela responde "não encontrado"). */
export async function carregarRelatorio(
  supabase: SupabaseClient,
  id: string,
  /** O Financeiro lê também o roteiro da divergência (0402). */
  opcoes: { roteiro?: boolean } = {}
): Promise<ReportData | null> {
  if (!UUID.test(id)) return null;

  const { data: cab, error: cabErro } = await supabase.rpc("payout_report_list", {
    p_clinic_id: null,
    p_report_id: id,
  });
  if (cabErro) console.error("payout_report_list failed:", cabErro.message);
  const linha = ((cab ?? []) as ReportDb[])[0];
  if (!linha) return null;

  const [itens, hist, pode, payments] = await Promise.all([
    supabase.rpc("payout_report_items_detail", { p_report_id: id }),
    supabase.rpc("payout_report_history", { p_report_id: id }),
    supabase.rpc("can_approve_payout_report", { p_report_id: id }),
    carregarPagamentos(supabase, id),
  ]);
  if (itens.error) console.error("payout_report_items_detail failed:", itens.error.message);
  if (hist.error) console.error("payout_report_history failed:", hist.error.message);
  if (pode.error) console.error("can_approve_payout_report failed:", pode.error.message);

  const items = ((itens.data ?? []) as ReportItemDb[]).map(reportItemFromDb);
  let mediation: MediationContact[] = [];
  let people: MediationPerson[] = [];
  // Só quando há divergência no Financeiro (ou já houve conversa): evita duas
  // idas ao banco em todo relatório.
  if (opcoes.roteiro && items.some((i) => i.reviewState === "no_financeiro" || i.financeAction)) {
    const [m, p] = await Promise.all([
      supabase.rpc("payout_mediation_list", { p_report_id: id }),
      supabase.rpc("payout_mediation_people", { p_report_id: id }),
    ]);
    if (m.error) console.error("payout_mediation_list failed:", m.error.message);
    if (p.error) console.error("payout_mediation_people failed:", p.error.message);
    mediation = ((m.data ?? []) as MediationContactDb[]).map(mediationFromDb);
    people = ((p.data ?? []) as MediationPersonDb[]).map(personFromDb);
  }

  return {
    report: reportFromDb(linha),
    items,
    history: (
      (hist.data ?? []) as {
        created_at: string;
        action: string;
        note: string | null;
        actor_name: string | null;
        procedure_name: string | null;
      }[]
    ).map((h) => ({
      at: h.created_at,
      action: h.action,
      note: h.note,
      actorName: h.actor_name,
      procedureName: h.procedure_name,
    })),
    payments,
    canApprove: pode.data === true,
    loadFailed: Boolean(itens.error),
    mediation,
    people,
  };
}
