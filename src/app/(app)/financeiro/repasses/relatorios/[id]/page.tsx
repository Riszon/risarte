import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePayoutReports, canViewFinance } from "@/lib/finance/access";
import {
  reportFromDb,
  reportItemFromDb,
  type ReportDb,
  type ReportItemDb,
} from "@/lib/finance/payout-report";
import { ReportDetail, type HistoryRow } from "./report-detail";

/**
 * Repasse, Etapa 2 (0390) — UM relatório de repasse: os procedimentos, o que
 * foi excluído (e por quê) e a linha do tempo. Quem não vê o financeiro da
 * unidade do relatório recebe "não encontrado" (o banco não devolve a linha).
 */
export default async function PayoutReportPage(
  props: PageProps<"/financeiro/repasses/relatorios/[id]">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: cab, error: cabErro } = await supabase.rpc("payout_report_list", {
    p_clinic_id: null,
    p_report_id: id,
  });
  if (cabErro) console.error("payout_report_list failed:", cabErro.message);
  const linha = ((cab ?? []) as ReportDb[])[0];
  if (!linha) notFound();
  const report = reportFromDb(linha);

  const [itens, hist] = await Promise.all([
    supabase.rpc("payout_report_items_detail", { p_report_id: id }),
    supabase.rpc("payout_report_history", { p_report_id: id }),
  ]);
  if (itens.error) console.error("payout_report_items_detail failed:", itens.error.message);
  if (hist.error) console.error("payout_report_history failed:", hist.error.message);

  const history: HistoryRow[] = (
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
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <Link
        href="/financeiro/repasses/relatorios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        Relatórios de repasse
      </Link>

      <ReportDetail
        report={report}
        items={((itens.data ?? []) as ReportItemDb[]).map(reportItemFromDb)}
        history={history}
        canManage={canManagePayoutReports(session)}
        loadFailed={Boolean(itens.error)}
      />
    </div>
  );
}
