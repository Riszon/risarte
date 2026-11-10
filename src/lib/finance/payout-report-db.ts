import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reportFromDb,
  reportItemFromDb,
  type Report,
  type ReportDb,
  type ReportItem,
  type ReportItemDb,
} from "@/lib/finance/payout-report";

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
  /** O usuário é o aprovador DESTE relatório (o banco responde). */
  canApprove: boolean;
  loadFailed: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` = não existe ou a pessoa não pode ler (a tela responde "não encontrado"). */
export async function carregarRelatorio(
  supabase: SupabaseClient,
  id: string
): Promise<ReportData | null> {
  if (!UUID.test(id)) return null;

  const { data: cab, error: cabErro } = await supabase.rpc("payout_report_list", {
    p_clinic_id: null,
    p_report_id: id,
  });
  if (cabErro) console.error("payout_report_list failed:", cabErro.message);
  const linha = ((cab ?? []) as ReportDb[])[0];
  if (!linha) return null;

  const [itens, hist, pode] = await Promise.all([
    supabase.rpc("payout_report_items_detail", { p_report_id: id }),
    supabase.rpc("payout_report_history", { p_report_id: id }),
    supabase.rpc("can_approve_payout_report", { p_report_id: id }),
  ]);
  if (itens.error) console.error("payout_report_items_detail failed:", itens.error.message);
  if (hist.error) console.error("payout_report_history failed:", hist.error.message);
  if (pode.error) console.error("can_approve_payout_report failed:", pode.error.message);

  return {
    report: reportFromDb(linha),
    items: ((itens.data ?? []) as ReportItemDb[]).map(reportItemFromDb),
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
    canApprove: pode.data === true,
    loadFailed: Boolean(itens.error),
  };
}
