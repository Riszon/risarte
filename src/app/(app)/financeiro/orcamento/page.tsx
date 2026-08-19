import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canPostFinance, canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { buildBudgetReport, type BudgetRow } from "@/lib/finance/budget";
import { BudgetView } from "./budget-client";

export const metadata: Metadata = { title: "Orçamento" };

/** Contas que recebem meta: as analíticas que formam o resultado. */
const BUDGETABLE = ["1.", "2.", "3.", "4.", "5.2"];

/**
 * FIN7.1/7.2 — orçamento e orçado × realizado.
 *
 * Realizado = COMPETÊNCIA, o mesmo recorte da DRE (decisão do dono): o aluguel
 * de agosto conta em agosto mesmo que seja pago em setembro. Comparar com o que
 * já foi pago faria toda conta em aberto parecer economia.
 */
export default async function BudgetPage(
  props: PageProps<"/financeiro/orcamento">
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

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const today = todayInBrazil();
  const year = Number(pick("ano") ?? today.slice(0, 4));
  const month = Number(pick("mes") ?? today.slice(5, 7));
  const view = pick("vista") === "planejar" ? "planejar" : "comparar";

  const supabase = await createClient();
  const [{ data: compareRows }, { data: accountRows }, { data: lineRows }] =
    await Promise.all([
      supabase.rpc("budget_vs_actual", {
        p_clinic_id: clinicId,
        p_year: year,
        p_month: month,
      }),
      supabase
        .from("chart_of_accounts")
        .select("code, name")
        .eq("is_analytic", true)
        .eq("active", true)
        .in("scope", ["unit", "both"])
        .order("code"),
      supabase
        .from("budget_lines")
        .select("account_code, amount_cents")
        .eq("clinic_id", clinicId)
        .eq("year", year)
        .eq("month", month),
    ]);

  const rows: BudgetRow[] = (
    (compareRows ?? []) as {
      account_code: string;
      account_name: string;
      block: string;
      budget_cents: number;
      actual_cents: number;
      ytd_budget_cents: number;
      ytd_actual_cents: number;
    }[]
  ).map((r) => ({
    accountCode: r.account_code,
    accountName: r.account_name,
    block: r.block as BudgetRow["block"],
    budgetCents: Number(r.budget_cents ?? 0),
    actualCents: Number(r.actual_cents ?? 0),
    ytdBudgetCents: Number(r.ytd_budget_cents ?? 0),
    ytdActualCents: Number(r.ytd_actual_cents ?? 0),
  }));

  const accounts = ((accountRows ?? []) as { code: string; name: string }[])
    .filter((a) => BUDGETABLE.some((p) => a.code.startsWith(p)))
    .map((a) => ({ code: a.code, name: a.name }));

  const current: Record<string, number> = {};
  for (const l of (lineRows ?? []) as {
    account_code: string;
    amount_cents: number;
  }[]) {
    // A tela trabalha em magnitude: o sinal é assunto do banco.
    current[l.account_code] = Math.abs(Number(l.amount_cents ?? 0));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="size-6 text-primary" />
          Orçamento — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          A meta ao lado do que aconteceu. O orçamento é{" "}
          <strong>da unidade</strong>: quem monta é quem responde por ele. O
          realizado sai do mesmo recorte da DRE — o aluguel de agosto conta em
          agosto mesmo que seja pago em setembro.
        </p>
      </div>

      <BudgetView
        clinicId={clinicId}
        year={year}
        month={month}
        view={view}
        report={buildBudgetReport(rows)}
        accounts={accounts}
        currentBudget={current}
        canEdit={canPostFinance(session, clinicId)}
      />
    </div>
  );
}
