import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canManagePurchaseRequests,
  canViewPurchases,
} from "@/lib/purchases-access";
import { todayInBrazil } from "@/lib/dates";
import type { OrderStatus } from "@/lib/purchases";
import { ReceivingView, type OrderCard } from "./receiving-client";

export const metadata: Metadata = { title: "Receber entrega" };

/**
 * Compras C3b — o recebimento.
 *
 * A entrada no estoque e a conta a pagar saem do mesmo caminho da compra
 * avulsa. O preço que vale é o da NOTA; a diferença contra o negociado fica
 * registrada, porque é ela que a franqueadora leva para a próxima negociação.
 */
export default async function ReceivingPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  if (!canViewPurchases(session, clinicId)) redirect("/");

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: orderRows } = await supabase
    .from("purchase_orders")
    .select(
      "id, code, status, total_cents, expected_delivery, created_at, " +
        "supplier:suppliers ( name ), " +
        "items:purchase_order_items ( id, item_id, description, quantity, " +
        "received_quantity, unit_cents )"
    )
    .eq("clinic_id", clinicId)
    .in("status", ["aberto", "recebido_parcial", "recebido"])
    .order("created_at", { ascending: false })
    .limit(50);

  type Embed = { name: string } | { name: string }[] | null;
  const one = (v: Embed): string =>
    Array.isArray(v) ? (v[0]?.name ?? "") : (v?.name ?? "");

  const orders: OrderCard[] = (
    (orderRows ?? []) as unknown as {
      id: string;
      code: string | null;
      status: string;
      total_cents: number;
      expected_delivery: string | null;
      supplier: Embed;
      items: {
        id: string;
        item_id: string | null;
        description: string;
        quantity: number;
        received_quantity: number;
        unit_cents: number;
      }[];
    }[]
  ).map((o) => ({
    id: o.id,
    code: o.code ?? "",
    status: o.status as OrderStatus,
    totalCents: Number(o.total_cents ?? 0),
    expectedDelivery: o.expected_delivery,
    supplierName: one(o.supplier),
    items: (o.items ?? []).map((i) => ({
      orderItemId: i.id,
      isStockItem: !!i.item_id,
      description: i.description,
      orderedQuantity: Number(i.quantity ?? 0),
      alreadyReceived: Number(i.received_quantity ?? 0),
      orderedUnitCents: Number(i.unit_cents ?? 0),
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <PackageCheck className="size-6 text-primary" />
          Receber entrega
        </h1>
        <p className="text-sm text-muted-foreground">
          Confirme <strong>o que realmente chegou</strong>. O material entra no
          estoque e a conta a pagar nasce pelo mesmo caminho de qualquer compra.
          O preço que vale é o <strong>da nota</strong> — se ele estiver
          diferente do negociado, o sistema aceita e registra a diferença.
        </p>
      </div>

      <ReceivingView
        clinicId={clinicId}
        orders={orders}
        today={todayInBrazil()}
        canReceive={canManagePurchaseRequests(session, clinicId)}
      />
    </div>
  );
}
