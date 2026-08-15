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
    { data: noKitRows },
    { data: runningOutRows },
    { data: ledgerRow },
    { data: costCenterRows },
    { data: replenishRows },
    { data: overstockRows },
    { data: openCountRow },
  ] = await Promise.all([
    supabase
      .from("stock_items")
      .select(
        "id, code, name, brand, unit_of_measure, purchase_unit, units_per_purchase, category, notes, is_active, track_open_package, general_use"
      )
      .order("name")
      .limit(1000),
    supabase
      .from("stock_balances")
      .select(
        "item_id, quantity, min_quantity, max_quantity, avg_cost_cents, storage_location, preferred_supplier_id, in_use_quantity, open_packages"
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
      .from("stock_kits")
      .select(
        "id, clinic_id, name, notes, active, kind, stock_kit_items ( item_id, quantity ), procedure_kit_links ( procedure_id, clinic_id )"
      )
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("name"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("active", true)
      .order("name"),
    supabase.rpc("stock_expiring", { p_clinic_id: clinicId, p_days: 120 }),
    // 0217: procedimento concluído sem kit não consome nada. Normal no começo,
    // problema quando ninguém percebe — o saldo para de bater e a culpa cai no
    // estoque.
    supabase.rpc("sessions_without_kit", {
      p_clinic_id: clinicId,
      p_days: 30,
    }),
    // 0219: o sistema AVISA que o frasco em uso deve estar acabando; quem olha
    // a bancada é que decide abrir outro.
    supabase.rpc("packages_running_out", {
      p_clinic_id: clinicId,
      p_threshold_percent: 15,
    }),
    // 0221: prateleira × contabilidade. Se os dois divergem, algo escapou — e
    // é melhor descobrir por um número do que por um balanço.
    supabase.rpc("stock_ledger_check", { p_clinic_id: clinicId }),
    supabase
      .from("cost_centers")
      .select("id, name, clinic_id")
      .eq("active", true)
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .order("code"),
    // 0222: o que comprar (em embalagens), o que está sobrando, e a contagem
    // em aberto — se houver.
    supabase.rpc("replenishment_list", { p_clinic_id: clinicId }),
    supabase.rpc("overstocked_items", { p_clinic_id: clinicId }),
    supabase
      .from("stock_counts")
      .select(
        "id, count_date, status, notes, stock_count_items ( id, item_id, expected_quantity, counted_quantity )"
      )
      .eq("clinic_id", clinicId)
      .eq("status", "aberta")
      .maybeSingle(),
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
        inUseQuantity: Number(b.in_use_quantity ?? 0),
        openPackages: Number(b.open_packages ?? 0),
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
      trackOpenPackage: Boolean(i.track_open_package),
      generalUse: Boolean(i.general_use),
      inUseQuantity: b?.inUseQuantity ?? 0,
      openPackages: b?.openPackages ?? 0,
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

  const withoutKit = (
    (noKitRows ?? []) as {
      procedure_id: string;
      procedure_name: string;
      sessions: number;
      last_done: string;
    }[]
  ).map((r) => ({
    procedureId: r.procedure_id,
    procedureName: r.procedure_name,
    sessions: Number(r.sessions ?? 0),
    lastDone: r.last_done ?? "",
  }));

  const runningOut = (
    (runningOutRows ?? []) as {
      item_id: string;
      item_name: string;
      purchase_unit: string;
      stock_unit: string;
      in_use_quantity: number;
      units_per_purchase: number;
      percent_left: number;
      closed_packages: number;
      state: string;
    }[]
  ).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    purchaseUnit: r.purchase_unit,
    stockUnit: r.stock_unit,
    inUseQuantity: Number(r.in_use_quantity ?? 0),
    unitsPerPurchase: Number(r.units_per_purchase ?? 1),
    percentLeft: Number(r.percent_left ?? 0),
    closedPackages: Number(r.closed_packages ?? 0),
    state: r.state as "sem_aberta" | "deve_ter_acabado" | "acabando",
  }));

  const replenishment = (
    (replenishRows ?? []) as {
      item_id: string;
      item_name: string;
      brand: string | null;
      purchase_unit: string;
      stock_unit: string;
      total_quantity: number;
      min_quantity: number;
      max_quantity: number | null;
      suggested_packages: number;
      estimated_cost_cents: number;
      state: string;
    }[]
  ).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    brand: r.brand ?? "",
    purchaseUnit: r.purchase_unit,
    stockUnit: r.stock_unit,
    total: Number(r.total_quantity ?? 0),
    minQuantity: Number(r.min_quantity ?? 0),
    maxQuantity: r.max_quantity === null ? null : Number(r.max_quantity),
    suggestedPackages: Number(r.suggested_packages ?? 0),
    estimatedCostCents: Number(r.estimated_cost_cents ?? 0),
    state: r.state,
  }));

  const overstocked = (
    (overstockRows ?? []) as {
      item_id: string;
      item_name: string;
      stock_unit: string;
      total_quantity: number;
      max_quantity: number;
      excess_quantity: number;
      excess_cents: number;
    }[]
  ).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    stockUnit: r.stock_unit,
    total: Number(r.total_quantity ?? 0),
    maxQuantity: Number(r.max_quantity ?? 0),
    excess: Number(r.excess_quantity ?? 0),
    excessCents: Number(r.excess_cents ?? 0),
  }));

  const openCount = openCountRow
    ? {
        id: openCountRow.id as string,
        countDate: openCountRow.count_date as string,
        notes: (openCountRow.notes as string | null) ?? "",
        lines: (
          (openCountRow.stock_count_items ?? []) as {
            id: string;
            item_id: string;
            expected_quantity: number;
            counted_quantity: number | null;
          }[]
        ).map((l) => ({
          id: l.id,
          itemId: l.item_id,
          expectedQuantity: Number(l.expected_quantity ?? 0),
          countedQuantity:
            l.counted_quantity === null ? null : Number(l.counted_quantity),
        })),
      }
    : null;

  const lc = Array.isArray(ledgerRow) ? ledgerRow[0] : ledgerRow;
  const ledger = {
    stockValueCents: Number(lc?.stock_value_cents ?? 0),
    ledgerValueCents: Number(lc?.ledger_value_cents ?? 0),
    differenceCents: Number(lc?.difference_cents ?? 0),
    manualEntries: Number(lc?.manual_entries ?? 0),
    manualEntriesCents: Number(lc?.manual_entries_cents ?? 0),
  };

  // 0215: kits têm nome e se ligam a vários procedimentos. O vínculo da
  // unidade vence o da rede — se a unidade montou os seus, são só eles.
  const kits = (kitRows ?? []).map((k) => ({
    id: k.id as string,
    clinicId: (k.clinic_id as string | null) ?? null,
    name: k.name as string,
    notes: (k.notes as string | null) ?? "",
    active: Boolean(k.active),
    kind: ((k.kind as string) ?? "procedimento") as
      | "procedimento"
      | "atendimento",
    lines: ((k.stock_kit_items ?? []) as { item_id: string; quantity: number }[])
      .map((l) => ({
        itemId: l.item_id,
        quantity: Number(l.quantity ?? 0),
      })),
    procedureIds: (
      (k.procedure_kit_links ?? []) as {
        procedure_id: string;
        clinic_id: string | null;
      }[]
    )
      .filter((l) => l.clinic_id === (k.clinic_id ?? null))
      .map((l) => l.procedure_id),
  }));

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
        withoutKit={withoutKit}
        runningOut={runningOut}
        ledger={ledger}
        replenishment={replenishment}
        overstocked={overstocked}
        openCount={openCount}
        costCenters={(costCenterRows ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
        }))}
        suppliers={(supplierRows ?? []).map((s) => ({
          id: s.id as string,
          name: s.name as string,
        }))}
        procedures={(procRows ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          specialty: (p.specialty as string | null) ?? null,
        }))}
        kits={kits}
      />
    </div>
  );
}
