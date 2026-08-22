import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPurchaser } from "@/lib/purchases-access";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { RoundsView, type RoundItemRow, type RoundRow } from "./rounds-client";

export const metadata: Metadata = { title: "Rodadas de compra" };

/**
 * Compras C2 — a mesa de negociação da franqueadora.
 *
 * A unidade NÃO entra aqui: ela vê a própria parte quando a rodada fecha.
 * Mostrar a cotação dos fornecedores para o franqueado seria entregar a
 * negociação da rede para o outro lado dela.
 */
export default async function RoundsPage(
  props: PageProps<"/compras/rodadas">
) {
  const session = await getSessionContext();
  if (!isPurchaser(session) && !canConfigureFinanceNetwork(session)) {
    redirect("/compras");
  }

  const params = await props.searchParams;
  const pick = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const roundId = pick("rodada") ?? null;

  const supabase = await createClient();
  const [
    { data: roundRows },
    { data: pendingRows },
    { data: supplierRows },
  ] = await Promise.all([
    supabase
      .from("purchase_rounds")
      .select("id, code, name, status, closed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    // As listas enviadas que ainda não entraram em rodada nenhuma.
    supabase
      .from("purchase_requests")
      .select(
        "id, code, clinic_id, sent_at, clinic:clinics!purchase_requests_clinic_id_fkey ( name )"
      )
      .eq("status", "enviada")
      .is("round_id", null)
      .order("sent_at"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ]);

  const rounds: RoundRow[] = (
    (roundRows ?? []) as {
      id: string;
      code: string | null;
      name: string | null;
      status: string;
      closed_at: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name ?? "",
    status: r.status as RoundRow["status"],
    closedAt: r.closed_at,
    createdAt: r.created_at,
  }));

  const current = roundId ?? rounds.find((r) => r.status !== "fechada")?.id ?? null;

  type Embed = { name: string } | { name: string }[] | null;
  const one = (v: Embed): string =>
    Array.isArray(v) ? (v[0]?.name ?? "") : (v?.name ?? "");

  const pending = (
    (pendingRows ?? []) as {
      id: string;
      code: string | null;
      sent_at: string | null;
      clinic: Embed;
    }[]
  ).map((r) => ({
    id: r.id,
    code: r.code ?? "",
    clinicName: one(r.clinic),
    sentAt: r.sent_at,
  }));

  const suppliers = ((supplierRows ?? []) as { id: string; name: string }[]).map(
    (s) => ({ id: s.id, name: s.name })
  );

  // A mesa da rodada em foco.
  let items: RoundItemRow[] = [];
  let quotes: {
    id: string;
    supplierId: string;
    supplierName: string;
    deliveryDays: number | null;
    paymentTerms: string;
    prices: Record<string, number | null>;
  }[] = [];
  let allocation: {
    clinicName: string;
    description: string;
    supplierName: string;
    requested: number;
    allocated: number;
    unitCents: number;
    totalCents: number;
  }[] = [];

  if (current) {
    const [{ data: itemRows }, { data: quoteRows }, { data: allocRows }] =
      await Promise.all([
        supabase.rpc("round_items_view", { p_round_id: current }),
        supabase
          .from("purchase_quotes")
          .select(
            "id, supplier_id, delivery_days, payment_terms, supplier:suppliers ( name ), items:purchase_quote_items ( round_item_id, unit_cents )"
          )
          .eq("round_id", current),
        supabase.rpc("round_allocation", { p_round_id: current }),
      ]);

    items = (
      (itemRows ?? []) as {
        round_item_id: string;
        item_id: string | null;
        description: string;
        purchase_unit: string | null;
        requested_quantity: number;
        adjusted_quantity: number | null;
        adjust_reason: string | null;
        clinics: number;
        estimated_total_cents: number;
        quotes: number;
        best_supplier_id: string | null;
        best_unit_cents: number | null;
        awarded_supplier_id: string | null;
        awarded_supplier_name: string | null;
        awarded_unit_cents: number | null;
        awarded_total_cents: number;
      }[]
    ).map((i) => ({
      id: i.round_item_id,
      description: i.description,
      purchaseUnit: i.purchase_unit ?? "",
      requestedQuantity: Number(i.requested_quantity ?? 0),
      adjustedQuantity:
        i.adjusted_quantity === null ? null : Number(i.adjusted_quantity),
      adjustReason: i.adjust_reason ?? "",
      clinics: Number(i.clinics ?? 0),
      estimatedTotalCents: Number(i.estimated_total_cents ?? 0),
      quotes: Number(i.quotes ?? 0),
      bestSupplierId: i.best_supplier_id,
      bestUnitCents:
        i.best_unit_cents === null ? null : Number(i.best_unit_cents),
      awardedSupplierId: i.awarded_supplier_id,
      awardedSupplierName: i.awarded_supplier_name ?? "",
      awardedUnitCents:
        i.awarded_unit_cents === null ? null : Number(i.awarded_unit_cents),
      awardedTotalCents: Number(i.awarded_total_cents ?? 0),
    }));

    quotes = (
      (quoteRows ?? []) as {
        id: string;
        supplier_id: string;
        delivery_days: number | null;
        payment_terms: string | null;
        supplier: Embed;
        items: { round_item_id: string; unit_cents: number | null }[] | null;
      }[]
    ).map((q) => ({
      id: q.id,
      supplierId: q.supplier_id,
      supplierName: one(q.supplier),
      deliveryDays: q.delivery_days,
      paymentTerms: q.payment_terms ?? "",
      prices: Object.fromEntries(
        (q.items ?? []).map((it) => [
          it.round_item_id,
          it.unit_cents === null ? null : Number(it.unit_cents),
        ])
      ),
    }));

    allocation = (
      (allocRows ?? []) as {
        clinic_name: string;
        description: string;
        supplier_name: string | null;
        requested_quantity: number;
        allocated_quantity: number;
        unit_cents: number;
        total_cents: number;
      }[]
    ).map((a) => ({
      clinicName: a.clinic_name,
      description: a.description,
      supplierName: a.supplier_name ?? "",
      requested: Number(a.requested_quantity ?? 0),
      allocated: Number(a.allocated_quantity ?? 0),
      unitCents: Number(a.unit_cents ?? 0),
      totalCents: Number(a.total_cents ?? 0),
    }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-primary" />
          Rodadas de compra
        </h1>
        <p className="text-sm text-muted-foreground">
          As listas das unidades, juntas, viram poder de negociação. Aqui a
          franqueadora cota com os fornecedores e escolhe de quem comprar{" "}
          <strong>cada item</strong> — podendo dividir. A rodada é da rede;{" "}
          <strong>o pedido é da unidade</strong>, e nasce depois que ela aprova.
        </p>
      </div>

      <RoundsView
        rounds={rounds}
        currentId={current}
        pending={pending}
        suppliers={suppliers}
        items={items}
        quotes={quotes}
        allocation={allocation}
      />
    </div>
  );
}
