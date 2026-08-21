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
import { NETWORK_FEES, type NetworkFeeRule } from "@/lib/finance/network-fees";
import { NetworkFeesView, type FeeSummaryRow } from "./fees-client";

export const metadata: Metadata = { title: "Taxas da rede" };

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

/** Regra crua → regra tipada, com o padrão de fábrica quando não há linha. */
function toRule(row: FeeRow | undefined, fee: string): NetworkFeeRule {
  const kind =
    (NETWORK_FEES.find((f) => f.fee === fee)?.kind as "percent" | "fixed") ??
    "percent";
  return {
    fee: fee as NetworkFeeRule["fee"],
    kind: (row?.kind as "percent" | "fixed") ?? kind,
    percent: Number(row?.percent ?? 0),
    amountCents: Number(row?.amount_cents ?? 0),
    dueDay: Number(row?.due_day ?? 10),
    active: row?.active ?? true,
    isOverride: !!row?.clinic_id,
    note: row?.note ?? "",
  };
}

/**
 * FIN8.1 — as taxas que a rede cobra das unidades.
 *
 * Cascata: o padrão da rede vale para todas; uma unidade pode ter acordo
 * próprio, e a linha dela guarda o MOTIVO. O que está aqui é a referência do
 * split: cada baixa de parcela cobra estes percentuais sobre o valor recebido.
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
  // A Franqueadora escolhe a unidade; a unidade vê só a si mesma.
  const unitId = isNetworkAdmin
    ? (pick("unidade") ?? activeClinicId)
    : activeClinicId;

  const supabase = await createClient();
  const [{ data: feeRows }, { data: clinics }, { data: summaryRows }] =
    await Promise.all([
      supabase
        .from("network_fees")
        .select(
          "clinic_id, fee, kind, percent, amount_cents, due_day, active, note"
        )
        .returns<FeeRow[]>(),
      supabase
        .from("clinics")
        .select("id, name, type, ownership")
        .eq("is_active", true)
        .order("name"),
      unitId
        ? supabase.rpc("network_fee_summary", {
            p_clinic_id: unitId,
            p_year: year,
            p_month: month,
          })
        : Promise.resolve({ data: null }),
    ]);

  const rows = feeRows ?? [];
  const network = NETWORK_FEES.map((f) =>
    toRule(
      rows.find((r) => r.clinic_id === null && r.fee === f.fee),
      f.fee
    )
  );
  const unit = NETWORK_FEES.map((f) => {
    const own = rows.find((r) => r.clinic_id === unitId && r.fee === f.fee);
    // Sem acordo próprio, a unidade segue a rede — e a tela diz qual é qual.
    return own
      ? toRule(own, f.fee)
      : { ...network.find((n) => n.fee === f.fee)!, isOverride: false };
  });

  const summary: FeeSummaryRow[] = (
    (summaryRows ?? []) as {
      fee: string;
      label: string;
      kind: string;
      percent: number;
      is_override: boolean;
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
    baseCents: Number(s.base_cents ?? 0),
    amountCents: Number(s.amount_cents ?? 0),
    receipts: Number(s.receipts ?? 0),
    payableStatus: s.payable_status,
  }));

  const units = ((clinics ?? []) as { id: string; name: string; type: string }[])
    .filter((c) => c.type !== "franchisor")
    .filter((c) => isNetworkAdmin || c.id === activeClinicId)
    .map((c) => ({ id: c.id, name: c.name }));

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
            ? "O padrão vale para toda a rede; uma unidade só precisa de linha própria quando o acordo dela for diferente."
            : "Quem define é a Franqueadora."}
        </p>
      </div>

      <NetworkFeesView
        isNetworkAdmin={isNetworkAdmin}
        network={network}
        unit={unit}
        unitId={unitId}
        units={units}
        year={year}
        month={month}
        summary={summary}
      />
    </div>
  );
}
