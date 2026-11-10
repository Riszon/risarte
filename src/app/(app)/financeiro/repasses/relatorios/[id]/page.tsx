import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePayoutReports, canViewFinance } from "@/lib/finance/access";
import { carregarRelatorio } from "@/lib/finance/payout-report-db";
import { ReportDetail } from "./report-detail";

/**
 * Repasse (0390/0391) — UM relatório, pela porta do Financeiro: os
 * procedimentos, o que foi excluído (e por quê), a conversa de cada linha e a
 * linha do tempo. Quem não vê o financeiro da unidade do relatório recebe
 * "não encontrado" (o banco não devolve a linha).
 */
export default async function PayoutReportPage(
  props: PageProps<"/financeiro/repasses/relatorios/[id]">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const { id } = await props.params;
  const supabase = await createClient();
  const dados = await carregarRelatorio(supabase, id);
  if (!dados) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <ReportDetail
        report={dados.report}
        items={dados.items}
        history={dados.history}
        canManage={canManagePayoutReports(session)}
        canApprove={dados.canApprove}
        backHref="/financeiro/repasses/relatorios"
        loadFailed={dados.loadFailed}
      />
    </div>
  );
}
