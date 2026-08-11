"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  ALERT_LABELS,
  MANUAL_KINDS,
  MOVEMENT_LABELS,
  balanceAlerts,
  kitCost,
  type MovementKind,
} from "@/lib/stock";
import { postMovement, saveKit, saveStockItem, setStockMin } from "./actions";

type Item = {
  id: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  category: string;
  notes: string;
  isActive: boolean;
  quantity: number;
  minQuantity: number;
  avgCostCents: number;
};

type Movement = {
  id: string;
  itemId: string;
  kind: string;
  quantity: number;
  unitCostCents: number;
  totalCents: number;
  movementDate: string;
  reason: string;
  balanceAfter: number;
  byName: string | null;
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
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function StockManager({
  clinicId,
  today,
  canManage,
  canConsume,
  canManageCatalog,
  items,
  movements,
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

  // Item novo
  const [newItem, setNewItem] = useState<{
    name: string;
    unitOfMeasure: string;
    category: string;
  } | null>(null);

  // Mínimo em edição
  const [minFor, setMinFor] = useState<string | null>(null);
  const [minValue, setMinValue] = useState("");

  // Kit em edição
  const [kitProc, setKitProc] = useState<string>("");
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
            i.code.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
        )
      : items;
  }, [items, search]);

  const withAlerts = items.filter((i) => balanceAlerts(i).length > 0);

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
      {withAlerts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="space-y-1 p-4">
            <h2 className="flex items-center gap-1 text-sm font-medium text-amber-900">
              <TriangleAlert className="size-4" />
              {withAlerts.length}{" "}
              {withAlerts.length === 1 ? "item pede" : "itens pedem"} atenção
            </h2>
            <ul className="space-y-0.5 text-xs text-amber-900">
              {withAlerts.slice(0, 8).map((i) => (
                <li key={i.id}>
                  <strong>{i.name}</strong> ({fmtQty(i.quantity)}{" "}
                  {i.unitOfMeasure}) — {ALERT_LABELS[balanceAlerts(i)[0]]}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* -- LANÇAR MOVIMENTO -------------------------------------------- */}
      {canConsume && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="font-medium">Lançar movimento</h2>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="block sm:col-span-2">
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
                        {i.name} ({fmtQty(i.quantity)} {i.unitOfMeasure})
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
                <Label className="text-[11px]">Quantidade</Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={mvQty}
                  onChange={(e) => setMvQty(e.target.value)}
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">
                  Custo unitário (R$)
                  {mvKind !== "entrada" && (
                    <span className="ml-1 text-muted-foreground">—</span>
                  )}
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
              <label className="block">
                <Label className="text-[11px]">Data</Label>
                <Input
                  className="h-8"
                  type="date"
                  value={mvDate}
                  onChange={(e) => setMvDate(e.target.value)}
                />
              </label>
              <label className="block sm:col-span-5">
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
              <div className="flex items-end">
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
                          quantity: mvQty,
                          unitCost: mvKind === "entrada" ? mvCost : "",
                          movementDate: mvDate,
                          reason: mvReason,
                        }),
                      "Movimento lançado.",
                      () => {
                        setMvQty("");
                        setMvCost("");
                        setMvReason("");
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
                  onClick={() =>
                    setNewItem(
                      newItem
                        ? null
                        : { name: "", unitOfMeasure: "un", category: "" }
                    )
                  }
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
                  placeholder="Buscar item"
                />
              </div>
            </div>
          </div>

          {newItem && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
              <label className="block sm:col-span-2">
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
                <Label className="text-[11px]">Unidade de medida</Label>
                <Input
                  className="h-8"
                  value={newItem.unitOfMeasure}
                  onChange={(e) =>
                    setNewItem({ ...newItem, unitOfMeasure: e.target.value })
                  }
                  placeholder="un, caixa, ml"
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
                />
              </label>
              <div className="sm:col-span-4 flex justify-end">
                <Button
                  size="sm"
                  disabled={isPending || !newItem.name.trim()}
                  onClick={() =>
                    run(
                      () =>
                        saveStockItem({
                          id: null,
                          name: newItem.name,
                          unitOfMeasure: newItem.unitOfMeasure,
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
                return (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed py-1 last:border-0"
                  >
                    <span className="min-w-0">
                      {i.name}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {i.code}
                        {i.category && ` · ${i.category}`}
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
                        {fmtQty(i.quantity)} {i.unitOfMeasure}
                      </span>
                      <span className="text-muted-foreground">
                        médio {formatBRL(i.avgCostCents)}
                      </span>
                      {minFor === i.id ? (
                        <span className="flex items-center gap-1">
                          <Input
                            className="h-7 w-20 text-xs"
                            inputMode="decimal"
                            autoFocus
                            value={minValue}
                            onChange={(e) => setMinValue(e.target.value)}
                          />
                          <Button
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () =>
                                  setStockMin({
                                    clinicId,
                                    itemId: i.id,
                                    min: minValue,
                                  }),
                                "Mínimo salvo.",
                                () => setMinFor(null)
                              )
                            }
                          >
                            OK
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => {
                            setMinFor(i.id);
                            setMinValue(fmtQty(i.minQuantity));
                          }}
                          className={cn(
                            "rounded px-1 text-muted-foreground",
                            canManage && "hover:bg-muted"
                          )}
                        >
                          mín. {fmtQty(i.minQuantity)}
                        </button>
                      )}
                    </span>
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
            O que cada procedimento consome. É daqui que sai a{" "}
            <strong>baixa automática</strong> quando a sessão for concluída — e
            é por isso que o kit existe antes dela: sem a lista, alguém teria de
            digitar o consumo no meio do atendimento, que é exatamente como
            controle de estoque de clínica morre. O custo do kit passa a
            alimentar o <strong>preço e a margem</strong> no lugar da
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
              {kitLines.map((line, idx) => (
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
                            {i.name} ({formatBRL(i.avgCostCents)}/
                            {i.unitOfMeasure})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block w-28">
                    <Label className="text-[11px]">Quantidade</Label>
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
              ))}

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
            <ul className="space-y-0.5 text-xs">
              {movements.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed py-1 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {fmtDate(m.movementDate)}
                    </span>{" "}
                    <strong>
                      {MOVEMENT_LABELS[m.kind as MovementKind] ?? m.kind}
                    </strong>{" "}
                    {itemById.get(m.itemId)?.name ?? "item"}
                    {m.reason && (
                      <span className="ml-1 text-muted-foreground">
                        — {m.reason}
                      </span>
                    )}
                    {m.byName && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({m.byName})
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">
                    {fmtQty(m.quantity)} ×{" "}
                    {formatBRL(m.unitCostCents)} ={" "}
                    <strong>{formatBRL(m.totalCents)}</strong>
                    <span className="ml-2 text-muted-foreground">
                      saldo {fmtQty(m.balanceAfter)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
