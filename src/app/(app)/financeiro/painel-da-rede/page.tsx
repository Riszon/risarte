import type { ReactNode } from "react";
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
import { parseNetworkTab, periodoDoMes } from "@/lib/finance/network-areas";
import { NetworkPanelView } from "./panel-client";
import { AbasDaRede } from "./abas-da-rede";
import { AbaCaixa, AbaDre, AbaHora, AbaPagar, AbaReceber, AvisoDeLeitura } from "./areas";
import {
  carregarCaixa,
  carregarDre,
  carregarHora,
  carregarPagar,
  carregarReceber,
  unidadesDaRede,
} from "./dados-por-area";

export const metadata: Metadata = { title: "Painel da rede" };

/**
 * FIN8.3 — o painel da rede.
 *
 * Olhar dez unidades em dez segundos e saber em qual entrar. Só a Franqueadora:
 * gerente e franqueado continuam com a própria unidade.
 *
 * OC-00121 — ganhou abas por área (Contas a pagar · Recebíveis · Fluxo de
 * caixa · DRE), todas no mesmo mês, e o "Abrir na unidade" em cada linha.
 * ⚠️ Cada aba lê SÓ o que ela mostra: o fluxo de caixa são duas chamadas por
 * unidade, e não há por que pagá-las para quem está olhando a DRE.
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
  const periodo = periodoDoMes(
    Number(pick("ano") ?? today.slice(0, 4)),
    Number(pick("mes") ?? today.slice(5, 7)),
    today
  );
  const aba = parseNetworkTab(pick("aba"));

  // O seletor de quem olha (OC-00120): unidade fora dele aparece na lista,
  // mas sem o "Abrir na unidade".
  const podeAbrir = new Set(
    session.clinics.filter((c) => c.type !== "franchisor").map((c) => c.id)
  );
  const ctx = { de: periodo.de, ate: periodo.ate, podeAbrir };

  const supabase = await createClient();

  let conteudo: ReactNode;
  if (aba === "visao") {
    conteudo = await visaoGeral(supabase, periodo, [...podeAbrir]);
  } else if (aba === "receber") {
    const r = await carregarReceber(supabase, periodo);
    conteudo = r.ok ? <AbaReceber unidades={r.unidades} ctx={ctx} /> : <AvisoDeLeitura erro={r.erro} />;
  } else if (aba === "dre") {
    const r = await carregarDre(supabase, periodo);
    conteudo = r.ok ? <AbaDre unidades={r.unidades} ctx={ctx} /> : <AvisoDeLeitura erro={r.erro} />;
  } else {
    const base = await unidadesDaRede(supabase);
    if (!base.ok) {
      conteudo = <AvisoDeLeitura erro={base.erro} />;
    } else if (aba === "hora") {
      const r = await carregarHora(
        supabase,
        base.unidades,
        today,
        `${periodo.ano}-${String(periodo.mes).padStart(2, "0")}`
      );
      conteudo = r.ok ? <AbaHora unidades={r.unidades} ctx={ctx} /> : <AvisoDeLeitura erro={r.erro} />;
    } else if (aba === "pagar") {
      const r = await carregarPagar(supabase, base.unidades, periodo, today);
      conteudo = r.ok ? <AbaPagar unidades={r.unidades} ctx={ctx} /> : <AvisoDeLeitura erro={r.erro} />;
    } else {
      const r = await carregarCaixa(supabase, base.unidades, periodo);
      conteudo = r.ok ? <AbaCaixa unidades={r.unidades} ctx={ctx} /> : <AvisoDeLeitura erro={r.erro} />;
    }
  }

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

      <AbasDaRede
        aba={aba}
        ano={periodo.ano}
        mes={periodo.mes}
        anoAtual={Number(today.slice(0, 4))}
      />

      {conteudo}
    </div>
  );
}

async function visaoGeral(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodo: { ano: number; mes: number; de: string; ate: string },
  podeAbrir: string[]
) {
  const [{ data: panelRows }, { data: monthRows }] = await Promise.all([
    supabase.rpc("network_panel", { p_year: periodo.ano, p_month: periodo.mes }),
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
    <NetworkPanelView
      year={periodo.ano}
      month={periodo.mes}
      rows={rows}
      totals={panelTotals(rows)}
      points={points}
      de={periodo.de}
      ate={periodo.ate}
      podeAbrir={podeAbrir}
    />
  );
}
