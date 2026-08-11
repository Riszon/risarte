"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Plus, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  ALERT_LABELS,
  MANUAL_KINDS,
  MOVEMENT_LABELS,
  PURCHASE_UNITS,
  STOCK_UNITS,
  balanceAlerts,
  conversionSummary,
  kitCost,
  unitShort,
  type MovementKind,
} from "@/lib/stock";
import {
  postMovement,
  saveItemSettings,
  saveKit,
  saveStockItem,
} from "./actions";

type Item = {
  id: string;
  code: string;
  name: string;
  brand: string;
  unitOfMeasure: string;
  purchaseUnit: string;
  unitsPerPurchase: number;
  category: string;
  notes: string;
  isActive: boolean;
  quantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  avgCostCents: number;
  storageLocation: string;
  supplierId: string;
};

type Movement = {
  id: string;
  itemId: string;
  kind: string;
  quantity: number;
  unitCostCents: number;
  totalCents: number;
  movementDate: string;
  createdAt: string;
  reason: string;
  balanceAfter: number;
  purchaseQuantity: number | null;
  purchaseUnitCostCents: number | null;
  purchaseUnit: string;
  lotCode: string;
  expiresAt: string;
  invoiceNumber: string;
  supplierName: string;
  byName: string | null;
};

type Expiring = {
  itemId: string;
  itemName: string;
  lotCode: string;
  expiresAt: string;
  quantity: number;
  daysLeft: number;
};

type Kit = {
  scope: "rede" | "unidade";
  lines: { itemId: string; quantity: number }[];
};

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(".", ",");
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Data e HORA do lançamento — pedido do dono: o momento importa. */
function fmtDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** Custo unitário pode ter centavos fracionados (R$ 0,2571 por grama). */
function fmtUnitCost(cents: number): string {
  if (Number.isInteger(cents)) return formatBRL(cents);
  return `R$ ${(cents / 100).toFixed(4).replace(".", ",")}`;
}

export function StockManager({
  clinicId,
  today,
  canManage,
  canConsume,
  canManageCatalog,
  items,
  movements,
  expiring,
  suppliers,
  procedures,
  kits,
}: {
  clinicId: string;
  today: string;
  canManage: boolean;
  canConsume: boolean;
  canManageCatalog: boolean;
  items: Item[];
  movements: Movement[];
  expiring: Expiring[];
  suppliers: { id: string; name: string }[];
  procedures: { id: string; name: string; specialty: string | null }[];
  kits: Record<string, Kit>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  // Movimento
  const [mvItem, setMvItem] = useState("");
  const [mvKind, setMvKind] = useState<MovementKind>("entrada");
  const [mvQty, setMvQty] = useState("");
  const [mvCost, setMvCost] = useState("");
  const [mvDate, setMvDate] = useState(today);
  const [mvReason, setMvReason] = useState("");
  const [mvLot, setMvLot] = useState("");
  const [mvExpiry, setMvExpiry] = useState("");
  const [mvSupplier, setMvSupplier] = useState("");
  const [mvInvoice, setMvInvoice] = useState("");

  // Cadastro de item
  const emptyItem = {
    name: "",
    brand: "",
    unitOfMeasure: "unidade",
    purchaseUnit: "unidade",
    unitsPerPurchase: "1",
    category: "",
  };
  const [newItem, setNewItem] = useState<typeof emptyItem | null>(null);

  // Configuração do item na unidade
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [stMin, setStMin] = useState("");
  const [stMax, setStMax] = useState("");
  const [stLocation, setStLocation] = useState("");
  const [stSupplier, setStSupplier] = useState("");

  // Histórico de um item
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  // Kit
  const [kitProc, setKitProc] = useState("");
  const [kitScope, setKitScope] = useState<"rede" | "unidade">("rede");
  const [kitLines, setKitLines] = useState<
    { itemId: string; quantity: string }[]
  >([]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const avgByItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of items) map[i.id] = i.avgCostCents;
    return map;
  }, [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.brand.toLowerCase().includes(q) ||
            i.code.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q) ||
            i.storageLocation.toLowerCase().includes(q)
        )
      : items;
  }, [items, search]);

  const withAlerts = items.filter((i) => balanceAlerts(i).length > 0);
  const selectedItem = mvItem ? itemById.get(mvItem) : undefined;

  // "1 caixa a R$ 25,00 = 100 un a R$ 0,25" — a conta na frente de quem digita.
  const entryByPackage = mvKind === "entrada" && selectedItem !== undefined;
  const preview =
    entryByPackage && mvQty && mvCost
      ? conversionSummary({
          packages: Number(mvQty.replace(",", ".")) || 0,
          packageUnit: selectedItem.purchaseUnit,
          packageCostCents: parseBRLToCents(mvCost) ?? 0,
          unitsPerPackage: selectedItem.unitsPerPurchase,
          stockUnit: selectedItem.unitOfMeasure,
        })
      : null;

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        after?.();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const kindsAllowed = MANUAL_KINDS.filter((k) =>
    canManage ? true : k === "consumo" || k === "perda"
  );

  function openKit(procedureId: string) {
    setKitProc(procedureId);
    const kit = kits[procedureId];
    setKitScope(kit?.scope ?? "rede");
    setKitLines(
      kit?.lines.map((l) => ({
        itemId: l.itemId,
        quantity: fmtQty(l.quantity),
      })) ?? []
    );
  }

  function openSettings(i: Item) {
    setSettingsFor(settingsFor === i.id ? null : i.id);
    setStMin(fmtQty(i.minQuantity));
    setStMax(i.maxQuantity === null ? "" : fmtQty(i.maxQuantity));
    setStLocation(i.storageLocation);
    setStSupplier(i.supplierId);
  }

  const kitPreview = kitCost(
    kitLines
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity.replace(",", ".")) || 0,
      })),
    avgByItem
  );

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      {/* -- ALERTAS ----------------------------------------------------- */}
      {(withAlerts.length > 0 || expiring.length > 0) && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="space-y-2 p-4">
            {withAlerts.length > 0 && (
              <>
                <h2 className="flex items-center gap-1 text-sm font-medium text-amber-900">
                  <TriangleAlert className="size-4" />
                  {withAlerts.length}{" "}
                  {withAlerts.length === 1 ? "item pede" : "itens pedem"} atenção
                </h2>
                <ul className="space-y-0.5 text-xs text-amber-900">
                  {withAlerts.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <strong>{i.name}</strong> ({fmtQty(i.quantity)}{" "}
                      {unitShort(i.unitOfMeasure)}) —{" "}
                      {ALERT_LABELS[balanceAlerts(i)[0]]}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {expiring.length > 0 && (
              <>
                <h2 className="flex items-center gap-1 pt-1 text-sm font-medium text-amber-900">
                  <CalendarClock className="size-4" />
                  Vencendo nos próximos 120 dias
                </h2>
                <ul className="space-y-0.5 text-xs text-amber-900">
                  {expiring.slice(0, 8).map((e, idx) => (
                    <li key={`${e.itemId}-${e.lotCode}-${idx}`}>
                      <strong>{e.itemName}</strong>
                      {e.lotCode && ` · lote ${e.lotCode}`} — vence em{" "}
                      {fmtDate(e.expiresAt)}{" "}
                      {e.daysLeft < 0
                        ? "(VENCIDO)"
                        : `(${e.daysLeft} dia${e.daysLeft === 1 ? "" : "s"})`}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-800">
                  O consumo ainda <strong>não escolhe lote</strong>: o sistema
                  aponta o que vence primeiro, mas quem separa na prateleira é
                  você. Baixa por lote entra depois da baixa automática.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* -- LANÇAR MOVIMENTO -------------------------------------------- */}
      {canConsume && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="font-medium">Lançar movimento</h2>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="block sm:col-span-3">
                <Label className="text-[11px]">Item</Label>
                <select
                  value={mvItem}
                  onChange={(e) => setMvItem(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Escolher…</option>
                  {items
                    .filter((i) => i.isActive)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.brand && ` · ${i.brand}`} — {fmtQty(i.quantity)}{" "}
                        {unitShort(i.unitOfMeasure)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Tipo</Label>
                <select
                  value={mvKind}
                  onChange={(e) => setMvKind(e.target.value as MovementKind)}
                  className={selectClass}
                >
                  {kindsAllowed.map((k) => (
                    <option key={k} value={k}>
                      {MOVEMENT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">
                  {entryByPackage
                    ? `Quantas ${selectedItem.purchaseUnit}s`
                    : `Quantidade (${selectedItem ? unitShort(selectedItem.unitOfMeasure) : "un"})`}
                </Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={mvQty}
                  onChange={(e) => setMvQty(e.target.value)}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">
                  {entryByPackage
                    ? `Preço da ${selectedItem.purchaseUnit} (R$)`
                    : "Custo unitário (R$)"}
                </Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={mvCost}
                  disabled={mvKind !== "entrada"}
                  placeholder={
                    mvKind === "entrada" ? "obrigatório" : "sai pelo médio"
                  }
                  onChange={(e) => setMvCost(e.target.value)}
                />
              </label>
            </div>

            {/* A conversão embalagem → consumo, na frente de quem digita. */}
            {preview && selectedItem && (
              <p className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs">
                {mvQty} {selectedItem.purchaseUnit}
                {Number(mvQty.replace(",", ".")) === 1 ? "" : "s"} a{" "}
                {formatBRL(parseBRLToCents(mvCost) ?? 0)} ={" "}
                <strong>
                  {fmtQty(preview.units)} {selectedItem.unitOfMeasure}
                  {preview.units === 1 ? "" : "s"}
                </strong>{" "}
                a <strong>{fmtUnitCost(preview.unitCostCents)}</strong> cada.
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-6">
              <label className="block">
                <Label className="text-[11px]">Data</Label>
                <Input
                  className="h-8"
                  type="date"
                  value={mvDate}
                  onChange={(e) => setMvDate(e.target.value)}
                />
              </label>
              {mvKind === "entrada" && (
                <>
                  <label className="block">
                    <Label className="text-[11px]">Lote</Label>
                    <Input
                      className="h-8"
                      value={mvLot}
                      onChange={(e) => setMvLot(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Validade</Label>
                    <Input
                      className="h-8"
                      type="date"
                      value={mvExpiry}
                      onChange={(e) => setMvExpiry(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Fornecedor</Label>
                    <select
                      value={mvSupplier}
                      onChange={(e) => setMvSupplier(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">—</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <Label className="text-[11px]">Nota fiscal</Label>
                    <Input
                      className="h-8"
                      value={mvInvoice}
                      onChange={(e) => setMvInvoice(e.target.value)}
                    />
                  </label>
                </>
              )}
              <label
                className={cn(
                  "block",
                  mvKind === "entrada" ? "sm:col-span-6" : "sm:col-span-4"
                )}
              >
                <Label className="text-[11px]">
                  Motivo
                  {(mvKind === "perda" ||
                    mvKind === "ajuste_entrada" ||
                    mvKind === "ajuste_saida") &&
                    " (obrigatório)"}
                </Label>
                <Input
                  className="h-8"
                  value={mvReason}
                  onChange={(e) => setMvReason(e.target.value)}
                  placeholder="Ex.: contagem do inventário de agosto"
                />
              </label>
              <div className="flex items-end sm:col-span-1">
                <Button
                  size="sm"
                  className="h-8 w-full"
                  disabled={isPending || !mvItem || !mvQty}
                  onClick={() =>
                    run(
                      () =>
                        postMovement({
                          clinicId,
                          itemId: mvItem,
                          kind: mvKind,
                          quantity: entryByPackage ? "" : mvQty,
                          unitCost: entryByPackage ? "" : mvCost,
                          packages: entryByPackage ? mvQty : "",
                          packageCost: entryByPackage ? mvCost : "",
                          movementDate: mvDate,
                          reason: mvReason,
                          lotCode: mvLot,
                          expiresAt: mvExpiry,
                          supplierId: mvSupplier,
                          invoiceNumber: mvInvoice,
                        }),
                      "Movimento lançado.",
                      () => {
                        setMvQty("");
                        setMvCost("");
                        setMvReason("");
                        setMvLot("");
                        setMvExpiry("");
                        setMvInvoice("");
                      }
                    )
                  }
                >
                  Lançar
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Saída <strong>não é recusada</strong> por falta de saldo: fica
              negativo e o alerta aparece. Travar aqui seria parar um
              atendimento por causa de cadastro — o saldo negativo é a
              informação de que faltou dar entrada em alguma nota.
            </p>
          </CardContent>
        </Card>
      )}

      {/* -- SALDO -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Saldo ({shown.length})</h2>
            <div className="flex items-center gap-2">
              {canManageCatalog && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => setNewItem(newItem ? null : { ...emptyItem })}
                >
                  <Plus className="mr-1 size-4" />
                  Novo item
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-52 pl-7"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar item, marca, local"
                />
              </div>
            </div>
          </div>

          {newItem && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
              <p className="sm:col-span-3 text-[11px] font-medium">
                Cadastro do item (vale para toda a rede)
              </p>
              <label className="block">
                <Label className="text-[11px]">Nome</Label>
                <Input
                  className="h-8"
                  value={newItem.name}
                  onChange={(e) =>
                    setNewItem({ ...newItem, name: e.target.value })
                  }
                  placeholder="Ex.: Resina composta A2"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Marca</Label>
                <Input
                  className="h-8"
                  value={newItem.brand}
                  onChange={(e) =>
                    setNewItem({ ...newItem, brand: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Categoria</Label>
                <Input
                  className="h-8"
                  value={newItem.category}
                  onChange={(e) =>
                    setNewItem({ ...newItem, category: e.target.value })
                  }
                  placeholder="Ex.: Dentística"
                />
              </label>

              <label className="block">
                <Label className="text-[11px]">Compra em</Label>
                <select
                  value={newItem.purchaseUnit}
                  onChange={(e) =>
                    setNewItem({ ...newItem, purchaseUnit: e.target.value })
                  }
                  className={selectClass}
                >
                  {PURCHASE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Consome em</Label>
                <select
                  value={newItem.unitOfMeasure}
                  onChange={(e) =>
                    setNewItem({ ...newItem, unitOfMeasure: e.target.value })
                  }
                  className={selectClass}
                >
                  {STOCK_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">
                  Quantos {newItem.unitOfMeasure}s por {newItem.purchaseUnit}
                </Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={newItem.unitsPerPurchase}
                  onChange={(e) =>
                    setNewItem({
                      ...newItem,
                      unitsPerPurchase: e.target.value,
                    })
                  }
                />
              </label>

              <p className="sm:col-span-3 rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                <strong>É aqui que o custo deixa de mentir.</strong> Uma caixa
                de sugadores de R$ 25,00 com <strong>100</strong> unidades faz
                cada sugador custar R$ 0,25 — sem isso, o procedimento cobraria
                R$ 25,00 por sugador. Vale igual para o que rende: um frasco de
                adesivo que dá <strong>20</strong> restaurações se cadastra como
                &quot;20 aplicações por frasco&quot;. Se compra e consumo são a
                mesma coisa, deixe 1.
              </p>

              <div className="sm:col-span-3 flex justify-end">
                <Button
                  size="sm"
                  disabled={isPending || !newItem.name.trim()}
                  onClick={() =>
                    run(
                      () =>
                        saveStockItem({
                          id: null,
                          name: newItem.name,
                          brand: newItem.brand,
                          unitOfMeasure: newItem.unitOfMeasure,
                          purchaseUnit: newItem.purchaseUnit,
                          unitsPerPurchase: newItem.unitsPerPurchase,
                          category: newItem.category,
                          notes: "",
                          isActive: true,
                        }),
                      "Item cadastrado.",
                      () => setNewItem(null)
                    )
                  }
                >
                  Salvar item
                </Button>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum item no catálogo ainda.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {shown.map((i) => {
                const alerts = balanceAlerts(i);
                const open = settingsFor === i.id;
                const showHistory = historyFor === i.id;
                const itemMoves = showHistory
                  ? movements.filter((m) => m.itemId === i.id)
                  : [];
                return (
                  <li key={i.id} className="border-b border-dashed py-1 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        {i.name}
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {i.code}
                          {i.brand && ` · ${i.brand}`}
                          {i.storageLocation && ` · ${i.storageLocation}`}
                          {i.unitsPerPurchase !== 1 &&
                            ` · ${fmtQty(i.unitsPerPurchase)} ${unitShort(i.unitOfMeasure)}/${unitShort(i.purchaseUnit)}`}
                        </span>
                        {alerts.length > 0 && (
                          <Badge
                            variant="outline"
                            className="ml-2 border-amber-400 text-[10px] text-amber-800"
                          >
                            {alerts[0] === "negativo"
                              ? "negativo"
                              : alerts[0] === "abaixo_minimo"
                                ? "repor"
                                : "sem custo"}
                          </Badge>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-xs tabular-nums">
                        <span
                          className={cn(
                            i.quantity < 0 && "font-medium text-destructive"
                          )}
                        >
                          {fmtQty(i.quantity)} {unitShort(i.unitOfMeasure)}
                        </span>
                        <span className="text-muted-foreground">
                          {fmtUnitCost(i.avgCostCents)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryFor(showHistory ? null : i.id)
                          }
                          className="rounded px-1 text-muted-foreground hover:bg-muted"
                        >
                          histórico
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openSettings(i)}
                            className="rounded px-1 text-muted-foreground hover:bg-muted"
                          >
                            mín. {fmtQty(i.minQuantity)}
                            {i.maxQuantity !== null &&
                              ` / máx. ${fmtQty(i.maxQuantity)}`}
                          </button>
                        )}
                      </span>
                    </div>

                    {open && (
                      <div className="mt-1 grid gap-2 rounded-lg border bg-muted/30 p-2 sm:grid-cols-5">
                        <p className="sm:col-span-5 text-[11px] text-muted-foreground">
                          Isto vale <strong>nesta unidade</strong> — cada uma
                          guarda onde quer e compra de quem quer.
                        </p>
                        <label className="block">
                          <Label className="text-[11px]">Mínimo</Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={stMin}
                            onChange={(e) => setStMin(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">Máximo</Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={stMax}
                            onChange={(e) => setStMax(e.target.value)}
                            placeholder="sem limite"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <Label className="text-[11px]">
                            Onde fica guardado
                          </Label>
                          <Input
                            className="h-8"
                            value={stLocation}
                            onChange={(e) => setStLocation(e.target.value)}
                            placeholder="Ex.: Sala 2 · gaveta 3 / Geladeira"
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">
                            Fornecedor habitual
                          </Label>
                          <select
                            value={stSupplier}
                            onChange={(e) => setStSupplier(e.target.value)}
                            className={selectClass}
                          >
                            <option value="">—</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="sm:col-span-5 flex justify-end">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () =>
                                  saveItemSettings({
                                    clinicId,
                                    itemId: i.id,
                                    min: stMin,
                                    max: stMax,
                                    storageLocation: stLocation,
                                    supplierId: stSupplier,
                                  }),
                                "Configuração salva.",
                                () => setSettingsFor(null)
                              )
                            }
                          >
                            Salvar
                          </Button>
                        </div>
                      </div>
                    )}

                    {showHistory && (
                      <div className="mt-1 rounded-lg border bg-muted/20 p-2">
                        {itemMoves.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            Nenhum movimento deste item nesta unidade.
                          </p>
                        ) : (
                          <ul className="space-y-0.5">
                            {itemMoves.map((m) => (
                              <MovementLine
                                key={m.id}
                                movement={m}
                                itemName={i.name}
                                stockUnit={i.unitOfMeasure}
                                compact
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* -- KIT DO PROCEDIMENTO ------------------------------------------ */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-medium">Kit do procedimento</h2>
          <p className="text-xs text-muted-foreground">
            O que cada procedimento consome, <strong>na unidade de consumo</strong>{" "}
            — 1 sugador, 0,2 grama de resina, 1 aplicação de adesivo. É daqui que
            sai a <strong>baixa automática</strong> quando a sessão for
            concluída, e o custo do kit alimenta o preço e a margem no lugar da
            estimativa.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <Label className="text-[11px]">Procedimento</Label>
              <select
                value={kitProc}
                onChange={(e) => openKit(e.target.value)}
                className={selectClass}
              >
                <option value="">Escolher…</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {kits[p.id] ? ` · kit da ${kits[p.id].scope}` : " · sem kit"}
                  </option>
                ))}
              </select>
            </label>
            {kitProc && (
              <label className="block">
                <Label className="text-[11px]">Vale para</Label>
                <select
                  value={kitScope}
                  onChange={(e) =>
                    setKitScope(e.target.value as "rede" | "unidade")
                  }
                  className={selectClass}
                  disabled={!canManageCatalog}
                >
                  <option value="rede">Toda a rede (padrão)</option>
                  <option value="unidade">Só esta unidade</option>
                </select>
              </label>
            )}
          </div>

          {kitProc && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              {kitLines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum item no kit ainda.
                </p>
              )}
              {kitLines.map((line, idx) => {
                const li = line.itemId ? itemById.get(line.itemId) : undefined;
                return (
                  <div key={idx} className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-52 flex-1">
                      <Label className="text-[11px]">Item</Label>
                      <select
                        value={line.itemId}
                        onChange={(e) =>
                          setKitLines((ls) =>
                            ls.map((l, i) =>
                              i === idx ? { ...l, itemId: e.target.value } : l
                            )
                          )
                        }
                        className={selectClass}
                      >
                        <option value="">Escolher…</option>
                        {items
                          .filter((i) => i.isActive)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} — {fmtUnitCost(i.avgCostCents)}/
                              {unitShort(i.unitOfMeasure)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block w-32">
                      <Label className="text-[11px]">
                        {li ? li.unitOfMeasure : "Quantidade"}
                      </Label>
                      <Input
                        className="h-8"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) =>
                          setKitLines((ls) =>
                            ls.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        setKitLines((ls) => ls.filter((_, i) => i !== idx))
                      }
                    >
                      Remover
                    </Button>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setKitLines((ls) => [...ls, { itemId: "", quantity: "1" }])
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  Adicionar item
                </Button>
                <span className="text-sm">
                  Custo do kit:{" "}
                  <strong>{formatBRL(kitPreview.totalCents)}</strong>
                </span>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () =>
                        saveKit({
                          procedureId: kitProc,
                          clinicId: kitScope === "rede" ? null : clinicId,
                          activeClinicId: clinicId,
                          lines: kitLines,
                        }),
                      "Kit salvo — o custo do procedimento foi recalculado."
                    )
                  }
                >
                  Salvar kit
                </Button>
              </div>

              {kitPreview.missingItemIds.length > 0 && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <TriangleAlert className="mr-1 inline size-3" />
                  {kitPreview.missingItemIds.length}{" "}
                  {kitPreview.missingItemIds.length === 1
                    ? "item entrou com custo zero"
                    : "itens entraram com custo zero"}{" "}
                  ({kitPreview.missingItemIds
                    .map((id) => itemById.get(id)?.name ?? "item")
                    .join(", ")}
                  ) — nunca houve entrada com valor. Enquanto isso, o custo
                  deste procedimento sai menor do que é.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* -- MOVIMENTOS --------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Últimos movimentos</h2>
          {movements.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nenhum movimento registrado nesta unidade.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {movements.slice(0, 40).map((m) => {
                const i = itemById.get(m.itemId);
                return (
                  <MovementLine
                    key={m.id}
                    movement={m}
                    itemName={i?.name ?? "item"}
                    stockUnit={i?.unitOfMeasure ?? "unidade"}
                  />
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Uma linha do razão do estoque.
 *
 * Mostra a hora (pedido do dono) e as DUAS versões da quantidade quando a
 * entrada veio pela embalagem: é assim que se confere contra a nota sem refazer
 * a conta de cabeça.
 */
function MovementLine({
  movement: m,
  itemName,
  stockUnit,
  compact = false,
}: {
  movement: Movement;
  itemName: string;
  stockUnit: string;
  compact?: boolean;
}) {
  const details = [
    m.lotCode && `lote ${m.lotCode}`,
    m.expiresAt && `validade ${fmtDate(m.expiresAt)}`,
    m.supplierName,
    m.invoiceNumber && `NF ${m.invoiceNumber}`,
    m.reason,
  ].filter(Boolean);

  return (
    <li className="border-b border-dashed py-1 text-xs last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">
          <span className="text-muted-foreground">
            {fmtDateTime(m.createdAt)}
          </span>{" "}
          <strong>
            {MOVEMENT_LABELS[m.kind as MovementKind] ?? m.kind}
          </strong>
          {!compact && <> {itemName}</>}
          {m.byName && (
            <span className="ml-1 text-[10px] text-muted-foreground">
              por {m.byName}
            </span>
          )}
        </span>
        <span className="tabular-nums">
          {m.purchaseQuantity !== null && (
            <span className="text-muted-foreground">
              {fmtQty(m.purchaseQuantity)} {m.purchaseUnit}
              {m.purchaseUnitCostCents !== null &&
                ` a ${formatBRL(m.purchaseUnitCostCents)}`}
              {" = "}
            </span>
          )}
          {fmtQty(m.quantity)} {unitShort(stockUnit)} ×{" "}
          {fmtUnitCost(m.unitCostCents)} ={" "}
          <strong>{formatBRL(m.totalCents)}</strong>
          <span className="ml-2 text-muted-foreground">
            saldo {fmtQty(m.balanceAfter)}
          </span>
        </span>
      </div>
      {details.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {details.join(" · ")}
          {m.movementDate !== m.createdAt.slice(0, 10) &&
            ` · competência ${fmtDate(m.movementDate)}`}
        </p>
      )}
    </li>
  );
}
