import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPurchases, isPurchaser } from "@/lib/purchases-access";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import { addDays } from "@/lib/payments";
import type {
  LeakageRow,
  SavingsRow,
  SupplierRow,
} from "@/lib/purchases";
import { PurchaseDashboard, type TopItemRow } from "./dashboard-client";

export const metadata: Metadata = { title: "Painel de compras" };

/**
 * Compras C4 — o painel.
 *
 * Existe para provar (ou derrubar) a tese do módulo: concentrar a compra na
 * franqueadora melhora a negociação. Por isso os dois indicadores principais
 * são a economia da negociação e o quanto foi comprado por fora.
 *
 * A franqueadora vê a rede inteira; gerente e franqueado veem a própria
 * unidade — e mostrar ao franqueado quanto a rede economizou para ele é
 * justamente o argumento que sustenta a centralização.
 */
export default async function PurchaseDashboardPage(
  props: PageProps<"/compras/painel">
) {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  if (!canViewPurchases(session, clinicId)) redirect("/");

  const isNetwork = isPurchaser(session) || canConfigureFinanceNetwork(session);
  if (!isNetwork && !clinicId) {
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
  const from = pick("de") ?? addDays(today, -180);
  const to = pick("ate") ?? today;
  // A franqueadora pode olhar a rede (nulo) ou uma unidade; a unidade só a si.
  const scopeClinic = isNetwork ? (pick("unidade") || null) : clinicId;

  const supabase = await createClient();
  const [
    { data: savingsRows },
    { data: leakageRows },
    { data: supplierRows },
    { data: itemRows },
    { data: clinicRows },
  ] = await Promise.all([
    supabase.rpc("purchase_savings", {
      p_from: from,
      p_to: to,
      p_clinic_id: scopeClinic,
    }),
    supabase.rpc("purchase_leakage", {
      p_from: from,
      p_to: to,
      p_clinic_id: scopeClinic,
    }),
    supabase.rpc("purchase_suppliers", {
      p_from: from,
      p_to: to,
      p_clinic_id: scopeClinic,
    }),
    supabase.rpc("purchase_top_items", {
      p_from: from,
      p_to: to,
      p_clinic_id: scopeClinic,
      p_limit: 15,
    }),
    isNetwork
      ? supabase
          .from("clinics")
          .select("id, name, type")
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: null }),
  ]);

  const savings: SavingsRow[] = (
    (savingsRows ?? []) as {
      round_id: string;
      round_code: string | null;
      round_name: string | null;
      closed_at: string | null;
      items_awarded: number;
      items_pending: number;
      estimated_cents: number;
      awarded_cents: number;
      saved_cents: number;
    }[]
  ).map((r) => ({
    roundId: r.round_id,
    roundCode: r.round_code ?? "",
    roundName: r.round_name ?? "",
    closedAt: r.closed_at,
    itemsAwarded: Number(r.items_awarded ?? 0),
    itemsPending: Number(r.items_pending ?? 0),
    estimatedCents: Number(r.estimated_cents ?? 0),
    awardedCents: Number(r.awarded_cents ?? 0),
    savedCents: Number(r.saved_cents ?? 0),
  }));

  const leakage: LeakageRow[] = (
    (leakageRows ?? []) as {
      clinic_id: string;
      clinic_name: string;
      network_cents: number;
      local_cents: number;
      local_purchases: number;
      declared_local_requests: number;
    }[]
  ).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    networkCents: Number(r.network_cents ?? 0),
    localCents: Number(r.local_cents ?? 0),
    localPurchases: Number(r.local_purchases ?? 0),
    declaredLocalRequests: Number(r.declared_local_requests ?? 0),
  }));

  const suppliers: SupplierRow[] = (
    (supplierRows ?? []) as {
      supplier_id: string | null;
      supplier_name: string;
      orders: number;
      ordered_cents: number;
      received_cents: number;
      price_diff_cents: number;
      avg_delivery_days: number | null;
    }[]
  ).map((r) => ({
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    orders: Number(r.orders ?? 0),
    orderedCents: Number(r.ordered_cents ?? 0),
    receivedCents: Number(r.received_cents ?? 0),
    priceDiffCents: Number(r.price_diff_cents ?? 0),
    avgDeliveryDays:
      r.avg_delivery_days === null ? null : Number(r.avg_delivery_days),
  }));

  const topItems: TopItemRow[] = (
    (itemRows ?? []) as {
      description: string;
      orders: number;
      quantity: number;
      total_cents: number;
      avg_unit_cents: number | null;
    }[]
  ).map((r) => ({
    description: r.description,
    orders: Number(r.orders ?? 0),
    quantity: Number(r.quantity ?? 0),
    totalCents: Number(r.total_cents ?? 0),
    avgUnitCents: r.avg_unit_cents === null ? null : Number(r.avg_unit_cents),
  }));

  const clinics = ((clinicRows ?? []) as { id: string; name: string; type: string }[])
    .filter((c) => c.type !== "franchisor")
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="size-6 text-primary" />
          Painel de compras
          {!isNetwork && ` — ${session.activeClinic?.name ?? "unidade"}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isNetwork
            ? "Os dois números que medem a tese do módulo: quanto a negociação conjunta economizou, e quanto está sendo comprado por fora."
            : "Quanto a rede negociou para a sua unidade, e quanto você comprou por fora dela."}
        </p>
      </div>

      <PurchaseDashboard
        isNetwork={isNetwork}
        from={from}
        to={to}
        scopeClinic={scopeClinic}
        clinics={clinics}
        savings={savings}
        leakage={leakage}
        suppliers={suppliers}
        topItems={topItems}
      />
    </div>
  );
}
