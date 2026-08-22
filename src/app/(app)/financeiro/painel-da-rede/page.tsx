import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import {
  panelTotals,
  type MonthPoint,
  type UnitPanelRow,
} from "@/lib/finance/network-panel";
import { NetworkPanelView } from "./panel-client";

export const metadata: Metadata = { title: "Painel da rede" };

/**
 * FIN8.3 — o painel da rede.
 *
 * Olhar dez unidades em dez segundos e saber em qual entrar. Só a Franqueadora:
 * gerente e franqueado continuam com a própria unidade.
 */
export default async function NetworkPanelPage(
  props: PageProps<"/financeiro/painel-da-rede">
) {
  const session = await getSessionContext();
  if (!canConfigureFinanceNetwork(session)) redirect("/financeiro/dre");

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const today = todayInBrazil();
  const year = Number(pick("ano") ?? today.slice(0, 4));
  const month = Number(pick("mes") ?? today.slice(5, 7));

  const supabase = await createClient();
  const [{ data: panelRows }, { data: monthRows }] = await Promise.all([
    supabase.rpc("network_panel", { p_year: year, p_month: month }),
    supabase.rpc("network_monthly_revenue", { p_months: 12 }),
  ]);

  const rows: UnitPanelRow[] = (
    (panelRows ?? []) as {
      clinic_id: string;
      clinic_name: string;
      ownership: string;
      alerts: number;
      alert_caixa: string | null;
      alert_orcamento: string | null;
      alert_equilibrio: string | null;
      alert_atraso: string | null;
      overdue_cents: number;
      prev_month_closed: boolean;
      fees_due_cents: number;
      fees_paid_cents: number;
      fees_open_cents: number;
      fees_overdue_cents: number;
    }[]
  ).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    ownership: r.ownership === "own" ? "own" : "franchised",
    alerts: Number(r.alerts ?? 0),
    alertCaixa: r.alert_caixa,
    alertOrcamento: r.alert_orcamento,
    alertEquilibrio: r.alert_equilibrio,
    alertAtraso: r.alert_atraso,
    overdueCents: Number(r.overdue_cents ?? 0),
    prevMonthClosed: !!r.prev_month_closed,
    feesDueCents: Number(r.fees_due_cents ?? 0),
    feesPaidCents: Number(r.fees_paid_cents ?? 0),
    feesOpenCents: Number(r.fees_open_cents ?? 0),
    feesOverdueCents: Number(r.fees_overdue_cents ?? 0),
  }));

  const points: MonthPoint[] = (
    (monthRows ?? []) as {
      month: string;
      gross_cents: number;
      units: number;
    }[]
  ).map((p) => ({
    month: p.month,
    grossCents: Number(p.gross_cents ?? 0),
    units: Number(p.units ?? 0),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <LayoutDashboard className="size-6 text-primary" />
          Painel da rede
        </h1>
        <p className="text-sm text-muted-foreground">
          O que está pegando fogo agora, unidade por unidade. É a resposta para{" "}
          <em>&quot;em qual eu entro primeiro?&quot;</em> — o Consolidado
          responde outra coisa: quanto a rede deu.
        </p>
      </div>

      <NetworkPanelView
        year={year}
        month={month}
        rows={rows}
        totals={panelTotals(rows)}
        points={points}
      />
    </div>
  );
}
