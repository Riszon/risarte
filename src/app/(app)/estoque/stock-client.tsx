"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
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
  removeStockItem,
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
  /** 0218: embalagem aberta importa â€” o saldo separa fechados de "em uso". */
  trackOpenPackage: boolean;
  /** 0218: uso geral do atendimento; fora dos kits de procedimento. */
  generalUse: boolean;
  inUseQuantity: number;
  openPackages: number;
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

type KitKind = "procedimento" | "atendimento";

type Kit = {
  id: string;
  clinicId: string | null;
  name: string;
  notes: string;
  active: boolean;
  kind: KitKind;
  lines: { itemId: string; quantity: number }[];
  procedureIds: string[];
};

/** FormulÃ¡rio do kit em ediÃ§Ã£o (o "novo" nasce sem id). */
type KitDraft = {
  id: string | null;
  clinicId: string | null;
  name: string;
  notes: string;
  active: boolean;
  kind: KitKind;
  lines: { itemId: string; quantity: string }[];
  procedureIds: string[];
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

/** Data e HORA do lanÃ§amento â€” pedido do dono: o momento importa. */
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

/** Custo unitÃ¡rio pode ter centavos fracionados (R$ 0,2571 por grama). */
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
  withoutKit,
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
  /** 0217: procedimentos concluÃ­dos que nÃ£o baixaram nada por nÃ£o ter kit. */
  withoutKit: {
    procedureId: string;
    procedureName: string;
    sessions: number;
    lastDone: string;
  }[];
  suppliers: { id: string; name: string }[];
  procedures: { id: string; name: string; specialty: string | null }[];
  kits: Kit[];
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

  // Cadastro / ediÃ§Ã£o de item
  const emptyItem = {
    id: null as string | null,
    name: "",
    brand: "",
    unitOfMeasure: "unidade",
    purchaseUnit: "unidade",
    unitsPerPurchase: "1",
    category: "",
    hasHistory: false,
    trackOpenPackage: false,
    generalUse: false,
  };
  const [newItem, setNewItem] = useState<typeof emptyItem | null>(null);

  // ConfiguraÃ§Ã£o do item na unidade
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [stMin, setStMin] = useState("");
  const [stMax, setStMax] = useState("");
  const [stLocation, setStLocation] = useState("");
  const [stSupplier, setStSupplier] = useState("");

  // HistÃ³rico de um item
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  // Kit em ediÃ§Ã£o / kit apenas aberto para ver
  const [kitDraft, setKitDraft] = useState<KitDraft | null>(null);
  const [kitProcSearch, setKitProcSearch] = useState("");
  const [kitOpen, setKitOpen] = useState<string | null>(null);

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

  // 0218: o mÃ­nimo olha o TOTAL (fechado + o que resta na embalagem aberta) â€”
  // senÃ£o um frasco aberto pela metade nÃ£o contaria como estoque nenhum.
  const alertsFor = (i: Item) =>
    balanceAlerts({
      quantity: i.quantity + i.inUseQuantity,
      avgCostCents: i.avgCostCents,
      minQuantity: i.minQuantity,
    });

  const withAlerts = items.filter((i) => alertsFor(i).length > 0);
  const selectedItem = mvItem ? itemById.get(mvItem) : undefined;

  // "1 caixa a R$ 25,00 = 100 un a R$ 0,25" â€” a conta na frente de quem digita.
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
        // ok COM mensagem = aviso, nÃ£o erro (ex.: item inativado em vez de
        // excluÃ­do porque jÃ¡ tinha histÃ³rico).
        if (r.error) toast.info(r.error);
        else toast.success(msg);
        after?.();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const kindsAllowed = MANUAL_KINDS.filter((k) =>
    canManage ? true : k === "consumo" || k === "perda"
  );

  function openKit(kit: Kit | null) {
    setKitProcSearch("");
    setKitDraft(
      kit
        ? {
            id: kit.id,
            clinicId: kit.clinicId,
            name: kit.name,
            notes: kit.notes,
            active: kit.active,
            kind: kit.kind,
            lines: kit.lines.map((l) => ({
              itemId: l.itemId,
              quantity: fmtQty(l.quantity),
            })),
            procedureIds: [...kit.procedureIds],
          }
        : {
            id: null,
            clinicId: canManageCatalog ? null : clinicId,
            name: "",
            notes: "",
            active: true,
            kind: "procedimento",
            lines: [],
            procedureIds: [],
          }
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
    (kitDraft?.lines ?? [])
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity.replace(",", ".")) || 0,
      })),
    avgByItem
  );

  const procName = useMemo(
    () => new Map(procedures.map((p) => [p.id, p.name])),
    [procedures]
  );

  const kitProcOptions = useMemo(() => {
    const q = kitProcSearch.trim().toLowerCase();
    return q
      ? procedures.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.specialty ?? "").toLowerCase().includes(q)
        )
      : procedures.slice(0, 40);
  }, [procedures, kitProcSearch]);

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
                  {withAlerts.length === 1 ? "item pede" : "itens pedem"} atenÃ§Ã£o
                </h2>
                <ul className="space-y-0.5 text-xs text-amber-900">
                  {withAlerts.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <strong>{i.name}</strong> ({fmtQty(i.quantity)}{" "}
                      {unitShort(i.unitOfMeasure)}) â€”{" "}
                      {ALERT_LABELS[alertsFor(i)[0]]}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {expiring.length > 0 && (
              <>
                <h2 className="flex items-center gap-1 pt-1 text-sm font-medium text-amber-900">
                  <CalendarClock className="size-4" />
                  Vencendo nos prÃ³ximos 120 dias
                </h2>
                <ul className="space-y-0.5 text-xs text-amber-900">
                  {expiring.slice(0, 8).map((e, idx) => (
                    <li key={`${e.itemId}-${e.lotCode}-${idx}`}>
                      <strong>{e.itemName}</strong>
                      {e.lotCode && ` Â· lote ${e.lotCode}`} â€” vence em{" "}
                      {fmtDate(e.expiresAt)}{" "}
                      {e.daysLeft < 0
                        ? "(VENCIDO)"
                        : `(${e.daysLeft} dia${e.daysLeft === 1 ? "" : "s"})`}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-800">
                  O consumo ainda <strong>nÃ£o escolhe lote</strong>: o sistema
                  aponta o que vence primeiro, mas quem separa na prateleira Ã©
                  vocÃª. Baixa por lote entra depois da baixa automÃ¡tica.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* -- SEM KIT: o furo da baixa automÃ¡tica (0217) -------------------- */}
      {withoutKit.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardContent className="space-y-1 p-4">
            <h2 className="flex items-center gap-1 text-sm font-medium text-amber-900">
              <TriangleAlert className="size-4" />
              ConcluÃ­dos sem baixar estoque (Ãºltimos 30 dias)
            </h2>
            <p className="text-[11px] text-amber-900">
              Estes procedimentos foram <strong>concluÃ­dos</strong> e nÃ£o
              descontaram nada, porque nÃ£o tÃªm kit cadastrado. NÃ£o Ã© erro do
              sistema â€” Ã© cadastro faltando. Enquanto ficar assim, o saldo vai
              parando de bater e a culpa cai no estoque.
            </p>
            <ul className="space-y-0.5 text-xs text-amber-900">
              {withoutKit.slice(0, 10).map((w) => (
                <li key={w.procedureId}>
                  <strong>{w.procedureName}</strong> â€” {w.sessions} sessÃ£o
                  {w.sessions === 1 ? "" : "Ãµes"}
                  {w.lastDone && ` Â· Ãºltima em ${fmtDate(w.lastDone)}`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* -- LANÃ‡AR MOVIMENTO -------------------------------------------- */}
      {canConsume && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="font-medium">LanÃ§ar movimento</h2>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="block sm:col-span-3">
                <Label className="text-[11px]">Item</Label>
                <select
                  value={mvItem}
                  onChange={(e) => setMvItem(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Escolherâ€¦</option>
                  {items
                    .filter((i) => i.isActive)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.brand && ` Â· ${i.brand}`} â€” {fmtQty(i.quantity)}{" "}
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
                    ? `PreÃ§o da ${selectedItem.purchaseUnit} (R$)`
                    : "Custo unitÃ¡rio (R$)"}
                </Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={mvCost}
                  disabled={mvKind !== "entrada"}
                  placeholder={
                    mvKind === "entrada" ? "obrigatÃ³rio" : "sai pelo mÃ©dio"
                  }
                  onChange={(e) => setMvCost(e.target.value)}
                />
              </label>
            </div>

            {/* A conversÃ£o embalagem â†’ consumo, na frente de quem digita. */}
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
                      <option value="">â€”</option>
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
                    " (obrigatÃ³rio)"}
                </Label>
                <Input
                  className="h-8"
                  value={mvReason}
                  onChange={(e) => setMvReason(e.target.value)}
                  placeholder="Ex.: contagem do inventÃ¡rio de agosto"
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
                      "Movimento lanÃ§ado.",
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
                  LanÃ§ar
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              SaÃ­da <strong>nÃ£o Ã© recusada</strong> por falta de saldo: fica
              negativo e o alerta aparece. Travar aqui seria parar um
              atendimento por causa de cadastro â€” o saldo negativo Ã© a
              informaÃ§Ã£o de que faltou dar entrada em alguma nota.
              <br />
              O consumo do kit Ã© <strong>baixado sozinho</strong> quando a
              sessÃ£o Ã© concluÃ­da, e Ã© o <em>previsto</em>: se usaram duas
              anestesias em vez de uma, registre a diferenÃ§a aqui como consumo
              avulso.
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
                {newItem.id ? "Editar item" : "Cadastro do item"} (vale para
                toda a rede)
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
                  placeholder="Ex.: DentÃ­stica"
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
                <Label className="text-[11px]">
                  Consome em
                  {newItem.hasHistory && (
                    <span className="ml-1 text-muted-foreground">
                      (travado)
                    </span>
                  )}
                </Label>
                <select
                  value={newItem.unitOfMeasure}
                  disabled={newItem.hasHistory}
                  onChange={(e) =>
                    setNewItem({ ...newItem, unitOfMeasure: e.target.value })
                  }
                  className={cn(
                    selectClass,
                    newItem.hasHistory && "opacity-60"
                  )}
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

              <label className="flex items-center gap-2 sm:col-span-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={newItem.trackOpenPackage}
                  onChange={(e) =>
                    setNewItem({
                      ...newItem,
                      trackOpenPackage: e.target.checked,
                    })
                  }
                />
                <span className="text-xs">
                  <strong>Controlar embalagem aberta</strong> â€” o saldo separa
                  &quot;fechados&quot; de &quot;em uso&quot;. NinguÃ©m tem 2,78 ml
                  de adesivo: tem <em>1 frasco pela metade</em>. Marque em
                  adesivo, resina, anestÃ©sico; nÃ£o precisa em sugador.
                </span>
              </label>
              <label className="flex items-center gap-2 sm:col-span-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={newItem.generalUse}
                  onChange={(e) =>
                    setNewItem({ ...newItem, generalUse: e.target.checked })
                  }
                />
                <span className="text-xs">
                  <strong>Uso geral do atendimento</strong> â€” mÃ¡scara e gorro do
                  profissional, que ele veste de manhÃ£ e tira no fim do dia.
                  NÃ£o entra em kit de procedimento: esse custo Ã©{" "}
                  <em>estrutura</em> e jÃ¡ estÃ¡ na hora de cadeira. RateÃ¡-lo por
                  procedimento contaria duas vezes.
                </span>
              </label>

              <p className="sm:col-span-3 rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                <strong>Ã‰ aqui que o custo deixa de mentir.</strong> Uma caixa
                de sugadores de R$ 25,00 com <strong>100</strong> unidades faz
                cada sugador custar R$ 0,25 â€” sem isso, o procedimento cobraria
                R$ 25,00 por sugador. Vale igual para o que rende: um frasco de
                adesivo que dÃ¡ <strong>20</strong> restauraÃ§Ãµes se cadastra como
                &quot;20 aplicaÃ§Ãµes por frasco&quot;. Se compra e consumo sÃ£o a
                mesma coisa, deixe 1.
                {newItem.id && (
                  <>
                    {" "}
                    <strong>Mudar o fator nÃ£o mexe no saldo atual</strong> â€” ele
                    jÃ¡ estÃ¡ contado em {newItem.unitOfMeasure}s; o fator novo
                    vale para as prÃ³ximas entradas.
                  </>
                )}
                {newItem.hasHistory && (
                  <>
                    {" "}
                    A <strong>unidade de consumo estÃ¡ travada</strong> porque jÃ¡
                    existe saldo ou movimento: trocÃ¡-la transformaria o que estÃ¡
                    em estoque em outra coisa, e levaria junto o custo de todo
                    procedimento que usa o item.
                  </>
                )}
              </p>

              <div className="sm:col-span-3 flex justify-between gap-2">
                {newItem.id && canManageCatalog ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => removeStockItem(newItem.id as string),
                        "Item excluÃ­do.",
                        () => setNewItem(null)
                      )
                    }
                  >
                    <Trash2 className="mr-1 size-4" />
                    Excluir / inativar
                  </Button>
                ) : (
                  <span />
                )}
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setNewItem(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending || !newItem.name.trim()}
                    onClick={() =>
                      run(
                        () =>
                          saveStockItem({
                            id: newItem.id,
                            name: newItem.name,
                            brand: newItem.brand,
                            unitOfMeasure: newItem.unitOfMeasure,
                            purchaseUnit: newItem.purchaseUnit,
                            unitsPerPurchase: newItem.unitsPerPurchase,
                            category: newItem.category,
                            notes: "",
                            isActive: true,
                            trackOpenPackage: newItem.trackOpenPackage,
                            generalUse: newItem.generalUse,
                          }),
                        newItem.id ? "Item atualizado." : "Item cadastrado.",
                        () => setNewItem(null)
                      )
                    }
                  >
                    Salvar item
                  </Button>
                </span>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum item no catÃ¡logo ainda.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {shown.map((i) => {
                const alerts = alertsFor(i);
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
                          {i.brand && ` Â· ${i.brand}`}
                          {i.storageLocation && ` Â· ${i.storageLocation}`}
                          {i.unitsPerPurchase !== 1 &&
                            ` Â· ${fmtQty(i.unitsPerPurchase)} ${unitShort(i.unitOfMeasure)}/${unitShort(i.purchaseUnit)}`}
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
                        {/* 0218: com embalagem aberta, "1 frasco em uso" diz
                            mais que "2,78 ml" â€” que Ã© o que ele apontou. */}
                        {i.trackOpenPackage ? (
                          <span>
                            <span
                              className={cn(
                                i.quantity < 0 &&
                                  "font-medium text-destructive"
                              )}
                            >
                              {fmtQty(i.quantity / (i.unitsPerPurchase || 1))}{" "}
                              {unitShort(i.purchaseUnit)} fechado
                              {Math.abs(
                                i.quantity / (i.unitsPerPurchase || 1)
                              ) === 1
                                ? ""
                                : "s"}
                            </span>
                            {(i.inUseQuantity !== 0 || i.openPackages > 0) && (
                              <span className="ml-1 text-primary">
                                + {Math.max(i.openPackages, 1)} em uso (
                                {fmtQty(i.inUseQuantity)}{" "}
                                {unitShort(i.unitOfMeasure)})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              i.quantity < 0 && "font-medium text-destructive"
                            )}
                          >
                            {fmtQty(i.quantity)} {unitShort(i.unitOfMeasure)}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {fmtUnitCost(i.avgCostCents)}
                        </span>
                        {canManageCatalog && (
                          <button
                            type="button"
                            onClick={() =>
                              setNewItem({
                                id: i.id,
                                name: i.name,
                                brand: i.brand,
                                unitOfMeasure: i.unitOfMeasure,
                                purchaseUnit: i.purchaseUnit,
                                unitsPerPurchase: fmtQty(i.unitsPerPurchase),
                                category: i.category,
                                // A trava Ã© do banco; aqui Ã© sÃ³ para a tela
                                // explicar antes de deixar tentar.
                                hasHistory:
                                  i.quantity !== 0 ||
                                  movements.some((m) => m.itemId === i.id),
                                trackOpenPackage: i.trackOpenPackage,
                                generalUse: i.generalUse,
                              })
                            }
                            className="rounded px-1 text-muted-foreground hover:bg-muted"
                          >
                            editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryFor(showHistory ? null : i.id)
                          }
                          className="rounded px-1 text-muted-foreground hover:bg-muted"
                        >
                          histÃ³rico
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openSettings(i)}
                            className="rounded px-1 text-muted-foreground hover:bg-muted"
                          >
                            mÃ­n. {fmtQty(i.minQuantity)}
                            {i.maxQuantity !== null &&
                              ` / mÃ¡x. ${fmtQty(i.maxQuantity)}`}
                          </button>
                        )}
                      </span>
                    </div>

                    {open && (
                      <div className="mt-1 grid gap-2 rounded-lg border bg-muted/30 p-2 sm:grid-cols-5">
                        <p className="sm:col-span-5 text-[11px] text-muted-foreground">
                          Isto vale <strong>nesta unidade</strong> â€” cada uma
                          guarda onde quer e compra de quem quer.
                        </p>
                        <label className="block">
                          <Label className="text-[11px]">MÃ­nimo</Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={stMin}
                            onChange={(e) => setStMin(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">MÃ¡ximo</Label>
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
                            placeholder="Ex.: Sala 2 Â· gaveta 3 / Geladeira"
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
                            <option value="">â€”</option>
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
                                "ConfiguraÃ§Ã£o salva.",
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

      {/* -- KITS (0215: nome prÃ³prio, vÃ¡rios procedimentos) -------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Kits ({kits.length})</h2>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => openKit(null)}
              >
                <Plus className="mr-1 size-4" />
                Novo kit
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            O kit tem <strong>nome</strong> e se liga a vÃ¡rios procedimentos â€”
            &quot;Kit restauraÃ§Ã£o&quot; serve para 1, 2 e 3 faces sem virar trÃªs
            cÃ³pias que saem do ar uma a uma. Um procedimento pode ter mais de um
            kit (o bÃ¡sico + o especÃ­fico), e o custo soma os dois. Ã‰ daqui que
            sai a <strong>baixa automÃ¡tica</strong>, e o custo alimenta o preÃ§o
            no lugar da estimativa.
          </p>

          {kits.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nenhum kit cadastrado.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {kits.map((k) => {
                const cost = kitCost(
                  k.lines.map((l) => ({
                    itemId: l.itemId,
                    quantity: l.quantity,
                  })),
                  avgByItem
                );
                const open = kitOpen === k.id;
                return (
                  <li
                    key={k.id}
                    className="border-b border-dashed py-1 last:border-0"
                  >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setKitOpen(open ? null : k.id)}
                      className="min-w-0 rounded px-1 text-left hover:bg-muted/60"
                    >
                      {k.name}
                      {k.clinicId === null && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Rede
                        </Badge>
                      )}
                      {!k.active && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Inativo
                        </Badge>
                      )}
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {k.lines.length} item
                        {k.lines.length === 1 ? "" : "s"} Â·{" "}
                        {k.procedureIds.length} procedimento
                        {k.procedureIds.length === 1 ? "" : "s"}
                        {k.procedureIds.length > 0 &&
                          `: ${k.procedureIds
                            .slice(0, 3)
                            .map((id) => procName.get(id) ?? "â€”")
                            .join(", ")}${k.procedureIds.length > 3 ? "â€¦" : ""}`}
                      </span>
                    </button>
                    <span className="flex items-center gap-3 text-xs">
                      <strong className="tabular-nums">
                        {formatBRL(cost.totalCents)}
                      </strong>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openKit(k)}
                          className="rounded px-1 text-muted-foreground hover:bg-muted"
                        >
                          editar
                        </button>
                      )}
                    </span>
                  </div>

                  {/* Ver o que compÃµe o kit SEM abrir a ediÃ§Ã£o â€” clicar para
                      olhar nÃ£o deveria exigir entrar no modo de mexer. */}
                  {open && (
                    <div className="mt-1 rounded-lg border bg-muted/20 p-2 text-xs">
                      <ul className="space-y-0.5">
                        {k.lines.map((l) => {
                          const li = itemById.get(l.itemId);
                          const avg = avgByItem[l.itemId] ?? 0;
                          return (
                            <li
                              key={l.itemId}
                              className="flex flex-wrap justify-between gap-2"
                            >
                              <span>
                                {li?.name ?? "item"}
                                <span className="ml-1 text-muted-foreground">
                                  {fmtQty(l.quantity)}{" "}
                                  {unitShort(li?.unitOfMeasure ?? "unidade")} Ã—{" "}
                                  {fmtUnitCost(avg)}
                                </span>
                              </span>
                              <span className="tabular-nums">
                                {avg > 0 ? (
                                  formatBRL(Math.round(l.quantity * avg))
                                ) : (
                                  <span className="text-amber-700">
                                    sem custo
                                  </span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                        {k.lines.length === 0 && (
                          <li className="text-muted-foreground">
                            Kit sem itens.
                          </li>
                        )}
                      </ul>
                      {k.procedureIds.length > 0 && (
                        <p className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
                          <strong>Procedimentos:</strong>{" "}
                          {k.procedureIds
                            .map((id) => procName.get(id) ?? "â€”")
                            .join(" Â· ")}
                        </p>
                      )}
                    </div>
                  )}
                  </li>
                );
              })}
            </ul>
          )}

          {kitDraft && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="block sm:col-span-2">
                  <Label className="text-[11px]">Nome do kit</Label>
                  <Input
                    className="h-8"
                    value={kitDraft.name}
                    onChange={(e) =>
                      setKitDraft({ ...kitDraft, name: e.target.value })
                    }
                    placeholder="Ex.: Kit restauraÃ§Ã£o"
                  />
                </label>
                <label className="block">
                  <Label className="text-[11px]">Vale para</Label>
                  <select
                    value={kitDraft.clinicId === null ? "rede" : "unidade"}
                    onChange={(e) =>
                      setKitDraft({
                        ...kitDraft,
                        clinicId: e.target.value === "rede" ? null : clinicId,
                      })
                    }
                    className={selectClass}
                    disabled={!canManageCatalog}
                  >
                    <option value="rede">Toda a rede (padrÃ£o)</option>
                    <option value="unidade">SÃ³ esta unidade</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={kitDraft.active}
                    onChange={(e) =>
                      setKitDraft({ ...kitDraft, active: e.target.checked })
                    }
                  />
                  <span className="text-xs">Kit ativo</span>
                </label>

                {/* 0218: o kit de ATENDIMENTO baixa por paciente, nÃ£o por
                    procedimento â€” quem faz trÃªs procedimentos na mesma consulta
                    nÃ£o usa trÃªs gorros. */}
                <label className="block sm:col-span-2">
                  <Label className="text-[11px]">Quando baixa</Label>
                  <select
                    value={kitDraft.kind}
                    onChange={(e) =>
                      setKitDraft({
                        ...kitDraft,
                        kind: e.target.value as KitKind,
                      })
                    }
                    className={selectClass}
                  >
                    <option value="procedimento">
                      A cada procedimento concluÃ­do
                    </option>
                    <option value="atendimento">
                      Uma vez por atendimento (gorro, propÃ©, babador)
                    </option>
                  </select>
                </label>
                <p className="sm:col-span-2 self-end pb-1 text-[10px] text-muted-foreground">
                  {kitDraft.kind === "atendimento"
                    ? "Baixa quando a recepÃ§Ã£o encerra o atendimento, uma vez sÃ³ â€” e nÃ£o se liga a procedimento nenhum."
                    : "Baixa a cada sessÃ£o concluÃ­da deste procedimento."}
                </p>
              </div>

              {/* ITENS */}
              <p className="text-[11px] font-medium">Itens do kit</p>
              {kitDraft.lines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum item ainda.
                </p>
              )}
              {kitDraft.lines.map((line, idx) => {
                const li = line.itemId ? itemById.get(line.itemId) : undefined;
                return (
                  <div key={idx} className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-52 flex-1">
                      <Label className="text-[11px]">Item</Label>
                      <select
                        value={line.itemId}
                        onChange={(e) =>
                          setKitDraft({
                            ...kitDraft,
                            lines: kitDraft.lines.map((l, i) =>
                              i === idx ? { ...l, itemId: e.target.value } : l
                            ),
                          })
                        }
                        className={selectClass}
                      >
                        <option value="">Escolherâ€¦</option>
                        {items
                          .filter((i) => i.isActive)
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} â€” {fmtUnitCost(i.avgCostCents)}/
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
                          setKitDraft({
                            ...kitDraft,
                            lines: kitDraft.lines.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            ),
                          })
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        setKitDraft({
                          ...kitDraft,
                          lines: kitDraft.lines.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      Remover
                    </Button>
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  setKitDraft({
                    ...kitDraft,
                    lines: [...kitDraft.lines, { itemId: "", quantity: "1" }],
                  })
                }
              >
                <Plus className="mr-1 size-3.5" />
                Adicionar item
              </Button>

              {/* PROCEDIMENTOS VINCULADOS â€” sÃ³ faz sentido no kit de
                  procedimento; no de atendimento, ligar a procedimento traria o
                  gorro de volta para o custo de cada um. */}
              {kitDraft.kind === "procedimento" && (
              <>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] font-medium">
                  Procedimentos que usam este kit (
                  {kitDraft.procedureIds.length})
                </p>
                <Input
                  className="h-7 w-52 text-xs"
                  type="search"
                  value={kitProcSearch}
                  onChange={(e) => setKitProcSearch(e.target.value)}
                  placeholder="Buscar procedimento"
                />
              </div>

              {kitDraft.procedureIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {kitDraft.procedureIds.map((id) => (
                    <Badge
                      key={id}
                      variant="outline"
                      className="cursor-pointer text-[10px]"
                      onClick={() =>
                        setKitDraft({
                          ...kitDraft,
                          procedureIds: kitDraft.procedureIds.filter(
                            (x) => x !== id
                          ),
                        })
                      }
                    >
                      {procName.get(id) ?? "â€”"} âœ•
                    </Badge>
                  ))}
                </div>
              )}

              <div className="max-h-44 overflow-y-auto rounded-md border bg-background p-1">
                {kitProcOptions.map((p) => {
                  const on = kitDraft.procedureIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={on}
                        onChange={() =>
                          setKitDraft({
                            ...kitDraft,
                            procedureIds: on
                              ? kitDraft.procedureIds.filter((x) => x !== p.id)
                              : [...kitDraft.procedureIds, p.id],
                          })
                        }
                      />
                      {p.name}
                      {p.specialty && (
                        <span className="text-[10px] text-muted-foreground">
                          {p.specialty}
                        </span>
                      )}
                    </label>
                  );
                })}
                {kitProcOptions.length === 0 && (
                  <p className="p-1 text-[11px] text-muted-foreground">
                    Nenhum procedimento encontrado.
                  </p>
                )}
              </div>
              {!kitProcSearch && procedures.length > kitProcOptions.length && (
                <p className="text-[10px] text-muted-foreground">
                  Mostrando {kitProcOptions.length} de {procedures.length} â€”
                  use a busca para achar o resto.
                </p>
              )}
              </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <span className="text-sm">
                  Custo do kit:{" "}
                  <strong>{formatBRL(kitPreview.totalCents)}</strong>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setKitDraft(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isPending || !kitDraft.name.trim()}
                    onClick={() =>
                      run(
                        () =>
                          saveKit({
                            kitId: kitDraft.id,
                            clinicId: kitDraft.clinicId,
                            name: kitDraft.name,
                            notes: kitDraft.notes,
                            active: kitDraft.active,
                            kind: kitDraft.kind,
                            lines: kitDraft.lines,
                            procedureIds: kitDraft.procedureIds,
                          }),
                        "Kit salvo â€” o custo dos procedimentos foi recalculado.",
                        () => setKitDraft(null)
                      )
                    }
                  >
                    Salvar kit
                  </Button>
                </span>
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
                  ) â€” nunca houve entrada com valor. Enquanto isso, o custo dos
                  procedimentos ligados sai menor do que Ã©.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* -- MOVIMENTOS --------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="font-medium">Ãšltimos movimentos</h2>
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
 * Uma linha do razÃ£o do estoque.
 *
 * Mostra a hora (pedido do dono) e as DUAS versÃµes da quantidade quando a
 * entrada veio pela embalagem: Ã© assim que se confere contra a nota sem refazer
 * a conta de cabeÃ§a.
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
          {fmtQty(m.quantity)} {unitShort(stockUnit)} Ã—{" "}
          {fmtUnitCost(m.unitCostCents)} ={" "}
          <strong>{formatBRL(m.totalCents)}</strong>
          <span className="ml-2 text-muted-foreground">
            saldo {fmtQty(m.balanceAfter)}
          </span>
        </span>
      </div>
      {details.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {details.join(" Â· ")}
          {m.movementDate !== m.createdAt.slice(0, 10) &&
            ` Â· competÃªncia ${fmtDate(m.movementDate)}`}
        </p>
      )}
    </li>
  );
}

