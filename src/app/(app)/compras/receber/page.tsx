import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canManagePurchaseRequests,
  canViewPurchases,
  isPurchaser,
} from "@/lib/purchases-access";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import type { OrderStatus } from "@/lib/purchases";
import { ReceivingView, type OrderCard } from "./receiving-client";
import { TrilhaDaCompra } from "../trilha";
import { contarEtapasDaCompra } from "../trilha-dados";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";

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
  // Os números da trilha, da mesma fonte que todas as telas do fluxo usam.
  const etapas = await contarEtapasDaCompra(supabase, clinicId);
  const podeVerMesa = isPurchaser(session) || canConfigureFinanceNetwork(session);
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
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <CabecalhoDeModulo
        chapeu="Suprimentos"
        icone={PackageCheck}
        titulo="Receber entrega"
        descricao="Confirme o que realmente chegou."
        voltar={{ href: "/compras", rotulo: "Compras" }}
      />

      <TrilhaDaCompra atual="receber" {...etapas} podeVerMesa={podeVerMesa} />

      <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          O material entra no estoque e a conta a pagar nasce pelo mesmo caminho de
          qualquer compra.
        </p>
        <p className="mt-2 border-t pt-2">
          O preço que vale é o <strong className="text-foreground">da nota</strong>. Se ele estiver
          diferente do negociado, o sistema <strong className="text-foreground">aceita e registra a
          diferença</strong> — barrar deixaria o material fora do estoque.
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
