import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { addDays } from "@/lib/payments";
import {
  buildCashFlow,
  cashTotals,
  firstNegative,
  type CashGroupBy,
  type CashSeriesRow,
} from "@/lib/finance/cash-flow";
import { CashFlowView } from "./cash-flow-client";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const GROUPS: CashGroupBy[] = ["dia", "semana", "mes"];

/**
 * FIN6.2 — o fluxo de caixa.
 *
 * A DRE responde "o mês deu lucro?". Esta responde a pergunta que quebra
 * clínica lucrativa: **vai faltar dinheiro, e quando?**
 *
 * O período padrão olha para trás e para a frente ao mesmo tempo (30 dias de
 * realizado, 90 de projeção): o passado dá a régua de quanto costuma entrar, e
 * é ela que diz se a projeção é plausível.
 */
export default async function CashFlowPage(
  props: PageProps<"/financeiro/fluxo-de-caixa">
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
  const from = pick("de") ?? addDays(today, -30);
  const to = pick("ate") ?? addDays(today, 90);
  const rawGroup = pick("agrupar") ?? "semana";
  const groupBy: CashGroupBy = GROUPS.includes(rawGroup as CashGroupBy)
    ? (rawGroup as CashGroupBy)
    : "semana";

  const supabase = await createClient();
  const [
    { data: seriesRows },
    { data: openingData },
    { data: todayBalanceData },
    { data: overdueRows },
    { data: bankRows },
  ] = await Promise.all([
    supabase.rpc("cash_flow_series", {
      p_clinic_id: clinicId,
      p_from: from,
      p_to: to,
    }),
    supabase.rpc("cash_balance_before", {
      p_clinic_id: clinicId,
      p_date: from,
    }),
    // Saldo de hoje = tudo o que já virou dinheiro até o fim do dia.
    supabase.rpc("cash_balance_before", {
      p_clinic_id: clinicId,
      p_date: addDays(today, 1),
    }),
    supabase.rpc("cash_overdue", { p_clinic_id: clinicId }),
    supabase
      .from("bank_accounts")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .limit(1),
  ]);

  const rows: CashSeriesRow[] = (
    (seriesRows ?? []) as {
      day: string;
      kind: string;
      activity: string;
      inflow_cents: number;
      outflow_cents: number;
    }[]
  ).map((r) => ({
    day: r.day,
    kind: r.kind === "previsto" ? "previsto" : "realizado",
    activity:
      r.activity === "investimento" || r.activity === "financiamento"
        ? r.activity
        : "operacional",
    inflowCents: Number(r.inflow_cents ?? 0),
    outflowCents: Number(r.outflow_cents ?? 0),
  }));

  const openingCents = Number(openingData ?? 0);
  const periods = buildCashFlow({ rows, from, to, groupBy, openingCents });
  const totals = cashTotals(periods, openingCents);

  // O aviso sai SEMPRE da série diária: agrupado por mês, um buraco no dia 8
  // coberto por um recebimento no dia 25 desapareceria — e é justamente ele que
  // faz o cheque voltar.
  const daily = buildCashFlow({ rows, from, to, groupBy: "dia", openingCents });
  const negative = firstNegative(daily);

  const overdue = (
    (overdueRows ?? []) as {
      receivable_cents: number;
      receivable_count: number;
      payable_cents: number;
      payable_count: number;
    }[]
  )[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Wallet className="size-6 text-primary" />
          Fluxo de caixa — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          O dinheiro pela data em que ele <strong>entra e sai</strong>, não pela
          data em que o fato aconteceu. É a outra metade do mesmo razão: o que a
          DRE ignora, esta tela lê. Clínica que dá lucro e quebra por falta de
          caixa é exatamente a diferença entre as duas.
        </p>
      </div>

      <CashFlowView
        clinicId={clinicId}
        from={from}
        to={to}
        today={today}
        groupBy={groupBy}
        periods={periods}
        totals={totals}
        openingCents={openingCents}
        todayBalanceCents={Number(todayBalanceData ?? 0)}
        negative={
          negative
            ? { day: negative.key, balanceCents: negative.balanceCents }
            : null
        }
        overdue={{
          receivableCents: Number(overdue?.receivable_cents ?? 0),
          receivableCount: Number(overdue?.receivable_count ?? 0),
          payableCents: Number(overdue?.payable_cents ?? 0),
          payableCount: Number(overdue?.payable_count ?? 0),
        }}
        hasBankAccount={(bankRows ?? []).length > 0}
      />
    </div>
  );
}
