import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Network } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canConfigureFinanceNetwork,
  canViewFinance,
} from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import type {
  FeeCampaign,
  NetworkFeeRule,
  NetworkFeeType,
} from "@/lib/finance/network-fees";
import { NetworkFeesView, type FeeSummaryRow } from "./fees-client";

export const metadata: Metadata = { title: "Taxas da rede" };

type TypeRow = {
  key: string;
  label: string;
  kind: string;
  unit_account: string;
  franchisor_account: string;
  system: boolean;
  active: boolean;
  sort_order: number;
  note: string | null;
};

type FeeRow = {
  clinic_id: string | null;
  fee: string;
  kind: string;
  percent: number;
  amount_cents: number;
  due_day: number;
  active: boolean;
  note: string | null;
};

/**
 * FIN8.1 — as taxas que a rede cobra das unidades.
 *
 * O catálogo é DADO (0233): criar a sétima taxa é operação de tela. A regra que
 * vale para cada unidade tem três níveis — campanha vigente ganha do acordo da
 * unidade, que ganha do padrão da rede.
 */
export default async function NetworkFeesPage(
  props: PageProps<"/financeiro/taxas-da-rede">
) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const isNetworkAdmin = canConfigureFinanceNetwork(session);
  const activeClinicId = session.activeClinic?.id ?? null;

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const today = todayInBrazil();
  const year = Number(pick("ano") ?? today.slice(0, 4));
  const month = Number(pick("mes") ?? today.slice(5, 7));
  const unitId = isNetworkAdmin
    ? (pick("unidade") ?? activeClinicId)
    : activeClinicId;

  const supabase = await createClient();
  const [
    { data: typeRows },
    { data: feeRows },
    { data: clinics },
    { data: summaryRows },
    { data: campaignRows },
    { data: accountRows },
  ] = await Promise.all([
    supabase
      .from("network_fee_types")
      .select(
        "key, label, kind, unit_account, franchisor_account, system, active, sort_order, note"
      )
      .order("sort_order")
      .returns<TypeRow[]>(),
    supabase
      .from("network_fees")
      .select("clinic_id, fee, kind, percent, amount_cents, due_day, active, note")
      .returns<FeeRow[]>(),
    supabase
      .from("clinics")
      .select("id, name, type")
      .eq("is_active", true)
      .order("name"),
    unitId
      ? supabase.rpc("network_fee_summary", {
          p_clinic_id: unitId,
          p_year: year,
          p_month: month,
        })
      : Promise.resolve({ data: null }),
    supabase
      .from("network_fee_campaigns")
      .select(
        "id, name, clinic_id, fees, starts_on, ends_on, mode, percent, amount_cents, discount_percent, note, active"
      )
      .order("starts_on", { ascending: false }),
    supabase
      .from("chart_of_accounts")
      .select("code, name, scope")
      .eq("is_analytic", true)
      .eq("active", true)
      .order("code"),
  ]);

  const types: NetworkFeeType[] = (typeRows ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    kind: t.kind === "fixed" ? "fixed" : "percent",
    unitAccount: t.unit_account,
    franchisorAccount: t.franchisor_account,
    system: t.system,
    active: t.active,
    sortOrder: Number(t.sort_order ?? 100),
    note: t.note ?? "",
  }));

  const rows = feeRows ?? [];

  /** A regra crua de um nível, com o padrão quando não há linha. */
  const toRule = (row: FeeRow | undefined, t: NetworkFeeType): NetworkFeeRule => ({
    fee: t.key,
    label: t.label,
    kind: (row?.kind as "percent" | "fixed") ?? t.kind,
    percent: Number(row?.percent ?? 0),
    amountCents: Number(row?.amount_cents ?? 0),
    dueDay: Number(row?.due_day ?? 10),
    active: (row?.active ?? false) && t.active,
    isOverride: !!row?.clinic_id,
    note: row?.note ?? "",
    campaignName: null,
  });

  const network = types.map((t) =>
    toRule(
      rows.find((r) => r.clinic_id === null && r.fee === t.key),
      t
    )
  );

  // Sem acordo próprio, a unidade segue a rede — e a tela diz qual é qual.
  const unit = types.map((t) => {
    const own = rows.find((r) => r.clinic_id === unitId && r.fee === t.key);
    return own
      ? toRule(own, t)
      : { ...network.find((n) => n.fee === t.key)!, isOverride: false };
  });

  const summary: FeeSummaryRow[] = (
    (summaryRows ?? []) as {
      fee: string;
      label: string;
      kind: string;
      percent: number;
      is_override: boolean;
      campaign_name: string | null;
      base_cents: number;
      amount_cents: number;
      receipts: number;
      payable_status: string | null;
    }[]
  ).map((s) => ({
    fee: s.fee,
    label: s.label,
    kind: s.kind === "fixed" ? "fixed" : "percent",
    percent: Number(s.percent ?? 0),
    isOverride: !!s.is_override,
    campaignName: s.campaign_name,
    baseCents: Number(s.base_cents ?? 0),
    amountCents: Number(s.amount_cents ?? 0),
    receipts: Number(s.receipts ?? 0),
    payableStatus: s.payable_status,
  }));

  const campaigns: FeeCampaign[] = (
    (campaignRows ?? []) as {
      id: string;
      name: string;
      clinic_id: string | null;
      fees: string[] | null;
      starts_on: string;
      ends_on: string;
      mode: string;
      percent: number | null;
      amount_cents: number | null;
      discount_percent: number | null;
      note: string | null;
      active: boolean;
    }[]
  ).map((c) => ({
    id: c.id,
    name: c.name,
    clinicId: c.clinic_id,
    fees: c.fees && c.fees.length > 0 ? c.fees : null,
    startsOn: c.starts_on,
    endsOn: c.ends_on,
    mode: c.mode === "desconto" ? "desconto" : "valor",
    percent: c.percent === null ? null : Number(c.percent),
    amountCents: c.amount_cents === null ? null : Number(c.amount_cents),
    discountPercent:
      c.discount_percent === null ? null : Number(c.discount_percent),
    note: c.note ?? "",
    active: c.active,
  }));

  const units = ((clinics ?? []) as { id: string; name: string; type: string }[])
    .filter((c) => c.type !== "franchisor")
    .filter((c) => isNetworkAdmin || c.id === activeClinicId)
    .map((c) => ({ id: c.id, name: c.name }));

  const accounts = (
    (accountRows ?? []) as { code: string; name: string; scope: string }[]
  ).map((a) => ({ code: a.code, name: a.name, scope: a.scope }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Network className="size-6 text-primary" />
          Taxas da rede
        </h1>
        <p className="text-sm text-muted-foreground">
          O que a Franqueadora cobra das unidades. Os percentuais incidem sobre{" "}
          <strong>o dinheiro que entra</strong> — cada baixa de parcela cobra na
          hora, sobre o valor recebido. As taxas fixas são mensais, independem
          de faturamento.{" "}
          {isNetworkAdmin
            ? "Campanha vigente ganha do acordo da unidade, que ganha do padrão da rede."
            : "Quem define é a Franqueadora."}
        </p>
      </div>

      <NetworkFeesView
        isNetworkAdmin={isNetworkAdmin}
        types={types}
        network={network}
        unit={unit}
        unitId={unitId}
        units={units}
        year={year}
        month={month}
        today={today}
        summary={summary}
        campaigns={campaigns}
        accounts={accounts}
      />
    </div>
  );
}
