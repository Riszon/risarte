import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import {
  canConsumeStock,
  canManageStock,
  canManageStockCatalog,
  canViewStock,
} from "@/lib/stock-access";
import { StockManager } from "./stock-client";

export const metadata: Metadata = { title: "Estoque" };

/**
 * 0213 — Estoque E1+E2.
 *
 * O documento base já registra como este módulo morre: "falta de baixa no uso".
 * Por isso o KIT nasce junto da fundação — sem a lista do que cada procedimento
 * consome, a baixa automática (E3) não tem de onde sair, e o módulo volta a
 * depender de alguém digitar no meio do atendimento.
 */
export default async function StockPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  if (!canViewStock(session, clinicId)) redirect("/");

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral — saldo e custo são sempre da
          unidade.
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  const [
    { data: itemRows },
    { data: balanceRows },
    { data: movementRows },
    { data: procRows },
    { data: kitRows },
    { data: supplierRows },
    { data: expiringRows },
  ] = await Promise.all([
    supabase
      .from("stock_items")
      .select(
        "id, code, name, brand, unit_of_measure, purchase_unit, units_per_purchase, category, notes, is_active"
      )
      .order("name")
      .limit(1000),
    supabase
      .from("stock_balances")
      .select(
        "item_id, quantity, min_quantity, max_quantity, avg_cost_cents, storage_location, preferred_supplier_id"
      )
      .eq("clinic_id", clinicId),
    supabase
      .from("stock_movements")
      .select(
        "id, item_id, kind, quantity, unit_cost_cents, total_cents, movement_date, created_at, reason, balance_after, purchase_quantity, purchase_unit_cost_cents, purchase_unit, lot_code, expires_at, invoice_number, supplier_id, created_by"
      )
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("procedures")
      .select("id, name, specialty")
      .eq("is_active", true)
      .order("name")
      .limit(1000),
    supabase
      .from("procedure_kits")
      .select("id, procedure_id, clinic_id, procedure_kit_items ( item_id, quantity )")
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("name"),
    supabase.rpc("stock_expiring", { p_clinic_id: clinicId, p_days: 120 }),
  ]);

  // O nome de quem lançou vem numa consulta à parte: o atalho de embed em
  // `created_by` fica ambíguo quando a tabela tem mais de uma FK para profiles.
  const authorIds = [
    ...new Set(
      (movementRows ?? [])
        .map((m) => m.created_by as string | null)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const { data: authorRows } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
    : { data: [] };
  const authorName = new Map(
    (authorRows ?? []).map((p) => [p.id as string, p.full_name as string])
  );

  const supplierName = new Map(
    (supplierRows ?? []).map((s) => [s.id as string, s.name as string])
  );

  const balanceByItem = new Map(
    (balanceRows ?? []).map((b) => [
      b.item_id as string,
      {
        quantity: Number(b.quantity ?? 0),
        minQuantity: Number(b.min_quantity ?? 0),
        maxQuantity:
          b.max_quantity === null ? null : Number(b.max_quantity ?? 0),
        avgCostCents: Number(b.avg_cost_cents ?? 0),
        storageLocation: (b.storage_location as string | null) ?? "",
        supplierId: (b.preferred_supplier_id as string | null) ?? "",
      },
    ])
  );

  const items = (itemRows ?? []).map((i) => {
    const b = balanceByItem.get(i.id as string);
    return {
      id: i.id as string,
      code: (i.code as string | null) ?? "",
      name: i.name as string,
      brand: (i.brand as string | null) ?? "",
      unitOfMeasure: (i.unit_of_measure as string) ?? "unidade",
      purchaseUnit: (i.purchase_unit as string) ?? "unidade",
      unitsPerPurchase: Number(i.units_per_purchase ?? 1),
      category: (i.category as string | null) ?? "",
      notes: (i.notes as string | null) ?? "",
      isActive: Boolean(i.is_active),
      quantity: b?.quantity ?? 0,
      minQuantity: b?.minQuantity ?? 0,
      maxQuantity: b?.maxQuantity ?? null,
      avgCostCents: b?.avgCostCents ?? 0,
      storageLocation: b?.storageLocation ?? "",
      supplierId: b?.supplierId ?? "",
    };
  });

  const movements = (movementRows ?? []).map((m) => ({
    id: m.id as string,
    itemId: m.item_id as string,
    kind: m.kind as string,
    quantity: Number(m.quantity ?? 0),
    unitCostCents: Number(m.unit_cost_cents ?? 0),
    totalCents: Number(m.total_cents ?? 0),
    movementDate: m.movement_date as string,
    createdAt: m.created_at as string,
    reason: (m.reason as string | null) ?? "",
    balanceAfter: Number(m.balance_after ?? 0),
    purchaseQuantity:
      m.purchase_quantity === null ? null : Number(m.purchase_quantity),
    purchaseUnitCostCents:
      m.purchase_unit_cost_cents === null
        ? null
        : Number(m.purchase_unit_cost_cents),
    purchaseUnit: (m.purchase_unit as string | null) ?? "",
    lotCode: (m.lot_code as string | null) ?? "",
    expiresAt: (m.expires_at as string | null) ?? "",
    invoiceNumber: (m.invoice_number as string | null) ?? "",
    supplierName: m.supplier_id
      ? (supplierName.get(m.supplier_id as string) ?? "")
      : "",
    byName: m.created_by
      ? (authorName.get(m.created_by as string) ?? null)
      : null,
  }));

  const expiring = (
    (expiringRows ?? []) as {
      item_id: string;
      item_name: string;
      lot_code: string | null;
      expires_at: string;
      quantity: number;
      days_left: number;
    }[]
  ).map((e) => ({
    itemId: e.item_id,
    itemName: e.item_name,
    lotCode: e.lot_code ?? "",
    expiresAt: e.expires_at,
    quantity: Number(e.quantity ?? 0),
    daysLeft: Number(e.days_left ?? 0),
  }));

  // Kit da unidade vence o da rede (mesma cascata de preço e protocolo).
  const kitByProcedure: Record<
    string,
    { scope: "rede" | "unidade"; lines: { itemId: string; quantity: number }[] }
  > = {};
  for (const k of kitRows ?? []) {
    const procedureId = k.procedure_id as string;
    const scope = k.clinic_id === null ? "rede" : "unidade";
    if (kitByProcedure[procedureId] && scope === "rede") continue;
    kitByProcedure[procedureId] = {
      scope,
      lines: (
        (k.procedure_kit_items ?? []) as {
          item_id: string;
          quantity: number;
        }[]
      ).map((l) => ({
        itemId: l.item_id,
        quantity: Number(l.quantity ?? 0),
      })),
    };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Boxes className="size-6 text-primary" />
          Estoque — {session.activeClinic?.name ?? "unidade"}
        </h1>
        <p className="text-sm text-muted-foreground">
          O saldo aqui é <strong>projeção dos movimentos</strong>, nunca um
          número digitado: toda entrada, consumo, perda e ajuste fica
          registrado, e por isso dá para descobrir <em>por que</em> um saldo
          está errado. O custo é <strong>médio ponderado</strong> — a saída sai
          pelo custo vigente e fica congelada, então comprar mais caro amanhã
          não reescreve o que foi usado ontem.
        </p>
      </div>

      <StockManager
        clinicId={clinicId}
        today={todayInBrazil()}
        canManage={canManageStock(session, clinicId)}
        canConsume={canConsumeStock(session, clinicId)}
        canManageCatalog={canManageStockCatalog(session)}
        items={items}
        movements={movements}
        expiring={expiring}
        suppliers={(supplierRows ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
        }))}
        procedures={(procRows ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          specialty: (p.specialty as string | null) ?? null,
        }))}
        kits={kitByProcedure}
      />
    </div>
  );
}
