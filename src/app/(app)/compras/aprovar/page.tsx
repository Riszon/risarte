import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canManagePurchaseRequests,
  canViewPurchases,
} from "@/lib/purchases-access";
import { ApprovalView, type AllocationRow, type OrderRow } from "./approval-client";

export const metadata: Metadata = { title: "Aprovar compra" };

/**
 * Compras C3a — a unidade aprova, e o pedido nasce.
 *
 * A parte da unidade foi CONGELADA quando a rodada fechou: editar a rodada
 * depois não muda o que ela já decidiu.
 */
export default async function ApprovalPage() {
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
  const [{ data: allocRows }, { data: orderRows }] = await Promise.all([
    supabase
      .from("purchase_allocations")
      .select(
        "id, round_id, description, requested_quantity, allocated_quantity, unit_cents, total_cents, estimated_total_cents, status, refuse_reason, order_id, supplier:suppliers ( name ), round:purchase_rounds ( code, name )"
      )
      .eq("clinic_id", clinicId)
      .order("description"),
    supabase
      .from("purchase_orders")
      .select(
        "id, code, status, total_cents, created_at, supplier:suppliers ( name ), items:purchase_order_items ( description, quantity, unit_cents, total_cents )"
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  type Embed = { name: string } | { name: string }[] | null;
  const one = (v: Embed): string =>
    Array.isArray(v) ? (v[0]?.name ?? "") : (v?.name ?? "");
  type RoundEmbed =
    | { code: string | null; name: string | null }
    | { code: string | null; name: string | null }[]
    | null;
  const roundOf = (v: RoundEmbed) => (Array.isArray(v) ? v[0] : v);

  const allocations: AllocationRow[] = (
    (allocRows ?? []) as {
      id: string;
      round_id: string;
      description: string;
      requested_quantity: number;
      allocated_quantity: number;
      unit_cents: number;
      total_cents: number;
      estimated_total_cents: number;
      status: string;
      refuse_reason: string | null;
      order_id: string | null;
      supplier: Embed;
      round: RoundEmbed;
    }[]
  ).map((a) => ({
    id: a.id,
    roundId: a.round_id,
    roundCode: roundOf(a.round)?.code ?? "",
    roundName: roundOf(a.round)?.name ?? "",
    description: a.description,
    supplierName: one(a.supplier),
    requestedQuantity: Number(a.requested_quantity ?? 0),
    allocatedQuantity: Number(a.allocated_quantity ?? 0),
    unitCents: Number(a.unit_cents ?? 0),
    totalCents: Number(a.total_cents ?? 0),
    estimatedTotalCents: Number(a.estimated_total_cents ?? 0),
    status: a.status as AllocationRow["status"],
    refuseReason: a.refuse_reason ?? "",
    ordered: !!a.order_id,
  }));

  const orders: OrderRow[] = (
    (orderRows ?? []) as {
      id: string;
      code: string | null;
      status: string;
      total_cents: number;
      created_at: string;
      supplier: Embed;
      items:
        | {
            description: string;
            quantity: number;
            unit_cents: number;
            total_cents: number;
          }[]
        | null;
    }[]
  ).map((o) => ({
    id: o.id,
    code: o.code ?? "",
    supplierName: one(o.supplier),
    status: o.status,
    totalCents: Number(o.total_cents ?? 0),
    createdAt: o.created_at,
    items: (o.items ?? []).map((i) => ({
      description: i.description,
      quantity: Number(i.quantity ?? 0),
      unitCents: Number(i.unit_cents ?? 0),
      totalCents: Number(i.total_cents ?? 0),
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck className="size-6 text-primary" />
          Aprovar compra — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          O que a Franqueadora negociou para a sua unidade, com{" "}
          <strong>o preço negociado ao lado da previsão</strong>. Você aprova ou
          recusa item a item; o que for aprovado vira <strong>pedido</strong> —
          um por fornecedor, faturado e entregue aqui.
        </p>
      </div>

      <ApprovalView
        clinicId={clinicId}
        allocations={allocations}
        orders={orders}
        canDecide={canManagePurchaseRequests(session, clinicId)}
      />
    </div>
  );
}
