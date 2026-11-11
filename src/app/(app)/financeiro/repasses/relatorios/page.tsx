import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManagePayoutReports, canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { carregarCobrancas } from "@/lib/finance/payout-report-db";
import {
  candidateFromDb,
  monthError,
  reportFromDb,
  type CandidateDb,
  type ReportDb,
} from "@/lib/finance/payout-report";
import { ReportsBoard, type WithheldRow } from "./reports-board";

/**
 * Repasse, Etapa 2 (0390) — os RELATÓRIOS DE REPASSE da unidade.
 *
 * Quem monta é o Financeiro da Franqueadora (decisão 1 do dono); o Gerente e
 * o franqueado leem os da própria unidade. A regra de quem vê o quê é do
 * banco (`finance_visible_clinic_ids`); a tela só mostra o que ele devolve.
 */
export default async function PayoutReportsPage(
  props: PageProps<"/financeiro/repasses/relatorios">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const today = todayInBrazil();
  const mesParam = (await props.searchParams).mes;
  const pedido = Array.isArray(mesParam) ? mesParam[0] : mesParam;
  const month =
    pedido && monthError(pedido, today) === null ? pedido : today.slice(0, 7);

  const supabase = await createClient();
  const canManage = canManagePayoutReports(session);

  const [cands, lista, retidos] = await Promise.all([
    supabase.rpc("payout_report_candidates", {
      p_clinic_id: clinicId,
      p_month: `${month}-01`,
    }),
    supabase.rpc("payout_report_list", {
      p_clinic_id: clinicId,
      p_report_id: null,
    }),
    supabase.rpc("payout_withheld_list", { p_clinic_id: clinicId }),
  ]);
  for (const [nome, r] of [
    ["payout_report_candidates", cands],
    ["payout_report_list", lista],
    ["payout_withheld_list", retidos],
  ] as const) {
    if (r.error) console.error(`${nome} failed:`, r.error.message);
  }

  const reports = ((lista.data ?? []) as ReportDb[]).map(reportFromDb);
  const cobrancas = await carregarCobrancas(
    supabase,
    reports.filter((r) => !["rascunho", "cancelado", "com_gerente"].includes(r.status)).map((r) => r.id)
  );

  const withheld: WithheldRow[] = (
    (retidos.data ?? []) as {
      payout_id: string;
      provider_name: string | null;
      procedure_name: string | null;
      finished_on: string;
      amount_cents: number | string;
      reason: string | null;
      withheld_by_name: string | null;
      withheld_at: string | null;
    }[]
  ).map((r) => ({
    payoutId: r.payout_id,
    providerName: r.provider_name ?? "—",
    procedureName: r.procedure_name ?? "Procedimento",
    finishedOn: r.finished_on,
    amountCents: Number(r.amount_cents ?? 0),
    reason: r.reason ?? "",
    byName: r.withheld_by_name,
    at: r.withheld_at,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileText className="size-6 text-primary" />
          Relatórios de repasse
        </h1>
        <p className="text-sm text-muted-foreground">
          Um relatório por dentista, nesta unidade ({session.activeClinic?.name}
          ), com cada procedimento finalizado. Um procedimento só entra em{" "}
          <strong>um relatório por vez</strong>. Procedimento apurado com R$
          0,00 não entra: resolva em{" "}
          <Link href="/financeiro/repasses" className="underline">
            Repasses → Pendências
          </Link>
          .
        </p>
      </div>

      <ReportsBoard
        clinicId={clinicId}
        month={month}
        today={today}
        canManage={canManage}
        candidates={((cands.data ?? []) as CandidateDb[]).map(candidateFromDb)}
        reports={reports}
        billing={[...cobrancas.values()]}
        userId={session.userId}
        withheld={withheld}
        loadFailed={Boolean(cands.error || lista.error)}
      />
    </div>
  );
}
