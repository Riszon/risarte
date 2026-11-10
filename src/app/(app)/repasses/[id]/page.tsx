import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePayoutReports } from "@/lib/finance/access";
import { carregarRelatorio } from "@/lib/finance/payout-report-db";
import {
  myItemFromDb,
  myReportFromDb,
  type MyItemDb,
  type MyReportDb,
} from "@/lib/finance/payout-report";
import { ReportDetail } from "@/app/(app)/financeiro/repasses/relatorios/[id]/report-detail";
import { MyReportView } from "./my-report-view";

/**
 * Repasse, Etapa 3 (0391) — UM relatório, pela porta de quem não é do
 * Financeiro. O banco diz o que a pessoa é NESTE relatório
 * (`payout_report_viewer`):
 *
 *  • o DENTISTA dele → a visão "Meus repasses": só as linhas incluídas, sem o
 *    registro interno (o que foi excluído, por quem e por quê);
 *  • o APROVADOR (ou quem lê o financeiro da unidade) → a visão de conferência.
 *
 * Quem não é nenhum dos dois recebe "não encontrado".
 */
export default async function RepassePage(props: PageProps<"/repasses/[id]">) {
  const session = await getSessionContext();
  const { id } = await props.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: quem, error } = await supabase.rpc("payout_report_viewer", {
    p_report_id: id,
  });
  if (error) console.error("payout_report_viewer failed:", error.message);
  const eu = (
    (quem ?? []) as {
      is_provider: boolean;
      can_approve: boolean;
      can_manage: boolean;
      can_read: boolean;
      status: string;
    }[]
  )[0];
  if (!eu) notFound();

  // O dentista do relatório vê SEMPRE a visão dele, mesmo que também leia o
  // financeiro da unidade: ninguém confere o próprio repasse.
  if (eu.is_provider) {
    const [lista, itens] = await Promise.all([
      supabase.rpc("my_payout_reports"),
      supabase.rpc("my_payout_report_detail", { p_report_id: id }),
    ]);
    if (lista.error) console.error("my_payout_reports failed:", lista.error.message);
    if (itens.error) console.error("my_payout_report_detail failed:", itens.error.message);
    const linha = ((lista.data ?? []) as MyReportDb[]).find((r) => r.id === id);
    if (!linha) notFound();
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <MyReportView
          report={myReportFromDb(linha)}
          items={((itens.data ?? []) as MyItemDb[]).map(myItemFromDb)}
          loadFailed={Boolean(itens.error)}
        />
      </div>
    );
  }

  if (!eu.can_read && !eu.can_approve) notFound();
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
        backHref="/repasses"
        loadFailed={dados.loadFailed}
      />
    </div>
  );
}
