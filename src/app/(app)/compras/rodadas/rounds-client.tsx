"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Lock, Plus, Trophy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { roundSavings, roundStatusLabel } from "@/lib/purchases";
import {
  awardItem,
  closeRound,
  openRound,
  saveQuote,
  saveQuotePrice,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

export type RoundRow = {
  id: string;
  code: string;
  name: string;
  status: "aberta" | "cotando" | "fechada" | "cancelada";
  closedAt: string | null;
  createdAt: string;
};

export type RoundItemRow = {
  id: string;
  description: string;
  purchaseUnit: string;
  requestedQuantity: number;
  adjustedQuantity: number | null;
  adjustReason: string;
  clinics: number;
  estimatedTotalCents: number;
  quotes: number;
  bestSupplierId: string | null;
  bestUnitCents: number | null;
  awardedSupplierId: string | null;
  awardedSupplierName: string;
  awardedUnitCents: number | null;
  awardedTotalCents: number;
};

type QuoteRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  deliveryDays: number | null;
  paymentTerms: string;
  prices: Record<string, number | null>;
};

function parseCents(text: string): number | null {
  const clean = text.trim();
  if (clean === "") return null; // em branco = NÃO COTOU, e não zero
  const n = Number(clean.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
}

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(".", ",");
}

export function RoundsView({
  rounds,
  currentId,
  pending,
  suppliers,
  items,
  quotes,
  allocation,
}: {
  rounds: RoundRow[];
  currentId: string | null;
  pending: { id: string; code: string; clinicName: string; sentAt: string | null }[];
  suppliers: { id: string; name: string }[];
  items: RoundItemRow[];
  quotes: QuoteRow[];
  allocation: {
    clinicName: string;
    description: string;
    supplierName: string;
    requested: number;
    allocated: number;
    unitCents: number;
    totalCents: number;
  }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [roundName, setRoundName] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const round = rounds.find((r) => r.id === currentId) ?? null;
  const editable = round?.status === "aberta" || round?.status === "cotando";
  const savings = roundSavings(
    items.map((i) => ({
      estimatedTotalCents: i.estimatedTotalCents,
      awardedTotalCents: i.awardedTotalCents,
      awarded: !!i.awardedSupplierId,
    }))
  );

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; count?: number }>,
    ok: (n?: number) => string
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok(r.count));
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- ABRIR RODADA ------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Listas esperando negociação
            </h2>
            {rounds.length > 0 && (
              <select
                value={currentId ?? ""}
                onChange={(e) =>
                  startTransition(() =>
                    router.push(`/compras/rodadas?rodada=${e.target.value}`)
                  )
                }
                className={cn(selectClass, "w-64")}
              >
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} {r.name ? `· ${r.name}` : ""} ·{" "}
                    {roundStatusLabel(r.status)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma lista enviada esperando. As unidades montam a lista em
              Compras, e ela aparece aqui quando é enviada.
            </p>
          ) : (
            <>
              {pending.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 border-t py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(p.id)}
                    onChange={(e) =>
                      setPicked((v) =>
                        e.target.checked
                          ? [...v, p.id]
                          : v.filter((x) => x !== p.id)
                      )
                    }
                  />
                  <span className="text-muted-foreground">{p.code}</span>
                  {p.clinicName}
                </label>
              ))}
              <div className="flex flex-wrap items-end gap-2 pt-2">
                <label className="block">
                  <Label className="text-[11px]">Nome da rodada</Label>
                  <Input
                    className="h-8 w-56"
                    value={roundName}
                    onChange={(e) => setRoundName(e.target.value)}
                    placeholder="Ex.: Compra de setembro"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={picked.length === 0}
                  onClick={() =>
                    run(
                      () => openRound({ requestIds: picked, name: roundName }),
                      () => "Rodada aberta."
                    )
                  }
                >
                  <Plus className="mr-1 size-3" />
                  Abrir rodada com {picked.length}{" "}
                  {picked.length === 1 ? "lista" : "listas"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {round && (
        <>
          {/* -- RESUMO -------------------------------------------------- */}
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">Rodada</p>
                <p className="text-lg font-semibold">
                  {round.code}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {roundStatusLabel(round.status)}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Previsto (itens negociados)
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(savings.estimatedCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Negociado</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatBRL(savings.awardedCents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">
                  Economia da rodada
                </p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    savings.savedCents < 0
                      ? "text-destructive"
                      : "text-emerald-700"
                  )}
                >
                  {formatBRL(savings.savedCents)}
                  {savings.percent !== null && (
                    <span className="ml-1 text-xs font-normal">
                      ({(savings.percent * 100).toFixed(1).replace(".", ",")}%)
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {savings.itemsPending > 0
                    ? `${savings.itemsPending} item(ns) ainda sem cotação`
                    : "todos os itens negociados"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* -- COTAÇÕES ------------------------------------------------ */}
          {editable && (
            <Card>
              <CardContent className="flex flex-wrap items-end gap-2 p-4">
                <label className="block">
                  <Label className="text-[11px]">Cotar com o fornecedor</Label>
                  <select
                    value={newSupplier}
                    onChange={(e) => setNewSupplier(e.target.value)}
                    className={cn(selectClass, "w-56")}
                  >
                    <option value="">Escolha…</option>
                    {suppliers
                      .filter((s) => !quotes.some((q) => q.supplierId === s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newSupplier}
                  onClick={() =>
                    run(
                      () =>
                        saveQuote({
                          roundId: round.id,
                          supplierId: newSupplier,
                          deliveryDays: null,
                          paymentTerms: "",
                          notes: "",
                        }),
                      () => "Fornecedor incluído na rodada."
                    )
                  }
                >
                  Incluir na cotação
                </Button>
                <p className="ml-auto max-w-md text-[11px] text-muted-foreground">
                  Deixe <strong>em branco</strong> o item que o fornecedor não
                  cotou. Em branco não é zero: zero é um preço, e ganharia a
                  comparação de quem não respondeu.
                </p>
              </CardContent>
            </Card>
          )}

          {/* -- A MESA -------------------------------------------------- */}
          <Card>
            <CardContent className="p-4">
              <h2 className="pb-1 text-sm font-semibold">
                Consolidado por item
              </h2>
              {items.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  Nenhum item nesta rodada.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase text-muted-foreground">
                        <th className="py-1 pr-2">Item</th>
                        <th className="py-1 pr-2 text-right">Qtd.</th>
                        <th className="py-1 pr-2 text-right">Previsto</th>
                        {quotes.map((q) => (
                          <th key={q.id} className="py-1 pr-2 text-right">
                            {q.supplierName}
                          </th>
                        ))}
                        <th className="py-1 text-right">Escolhido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => {
                        const comprar = i.adjustedQuantity ?? i.requestedQuantity;
                        return (
                          <tr key={i.id} className="border-t align-top">
                            <td className="py-1.5 pr-2">
                              {i.description}
                              <div className="text-[10px] text-muted-foreground">
                                {i.clinics}{" "}
                                {i.clinics === 1 ? "unidade" : "unidades"}
                                {i.purchaseUnit && ` · ${i.purchaseUnit}`}
                                {i.quotes === 0 && (
                                  <span className="ml-1 text-amber-700">
                                    · sem cotação
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {qty(comprar)}
                              {i.adjustedQuantity !== null && (
                                <div
                                  className="text-[10px] text-amber-700"
                                  title={i.adjustReason || undefined}
                                >
                                  pedido: {qty(i.requestedQuantity)}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                              {formatBRL(i.estimatedTotalCents)}
                            </td>

                            {quotes.map((q) => {
                              const price = q.prices[i.id] ?? null;
                              const isBest =
                                i.bestUnitCents !== null &&
                                price === i.bestUnitCents;
                              return (
                                <td
                                  key={q.id}
                                  className="py-1.5 pr-2 text-right"
                                >
                                  {editable ? (
                                    <Input
                                      className={cn(
                                        "h-7 w-24 text-right tabular-nums",
                                        isBest && "border-emerald-600"
                                      )}
                                      defaultValue={
                                        price === null
                                          ? ""
                                          : (price / 100)
                                              .toFixed(2)
                                              .replace(".", ",")
                                      }
                                      placeholder="—"
                                      onBlur={(e) =>
                                        run(
                                          () =>
                                            saveQuotePrice({
                                              quoteId: q.id,
                                              roundItemId: i.id,
                                              unitCents: parseCents(
                                                e.target.value
                                              ),
                                            }),
                                          () => "Preço salvo."
                                        )
                                      }
                                    />
                                  ) : (
                                    <span className="tabular-nums">
                                      {price === null
                                        ? "—"
                                        : formatBRL(price)}
                                    </span>
                                  )}
                                  {isBest && (
                                    <Trophy className="ml-1 inline size-3 text-emerald-600" />
                                  )}
                                </td>
                              );
                            })}

                            <td className="py-1.5 text-right">
                              {editable ? (
                                <select
                                  value={i.awardedSupplierId ?? ""}
                                  onChange={(e) =>
                                    run(
                                      () =>
                                        awardItem({
                                          roundItemId: i.id,
                                          supplierId: e.target.value || null,
                                          adjustedQuantity: i.adjustedQuantity,
                                          adjustReason: i.adjustReason,
                                        }),
                                      () => "Fornecedor escolhido."
                                    )
                                  }
                                  className={cn(selectClass, "w-36")}
                                >
                                  <option value="">—</option>
                                  {quotes
                                    .filter(
                                      (q) => (q.prices[i.id] ?? null) !== null
                                    )
                                    .map((q) => (
                                      <option key={q.id} value={q.supplierId}>
                                        {q.supplierName}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <span>{i.awardedSupplierName || "—"}</span>
                              )}
                              {i.awardedUnitCents !== null && (
                                <div className="text-[10px] tabular-nums text-muted-foreground">
                                  {formatBRL(i.awardedUnitCents)} ·{" "}
                                  {formatBRL(i.awardedTotalCents)}
                                </div>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  className="text-[10px] underline"
                                  onClick={() => {
                                    setAdjusting(i.id);
                                    setAdjustQty(String(comprar));
                                    setAdjustReason(i.adjustReason);
                                  }}
                                >
                                  mudar quantidade
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {adjusting && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2">
                  <label className="block">
                    <Label className="text-[11px]">Comprar quantidade</Label>
                    <Input
                      className="h-8 w-28"
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(e.target.value)}
                    />
                  </label>
                  <label className="block flex-1">
                    <Label className="text-[11px]">
                      Motivo (a unidade vai ver ao aprovar)
                    </Label>
                    <Input
                      className="h-8"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="Ex.: fornecedor só vende caixa fechada"
                    />
                  </label>
                  <Button
                    size="sm"
                    onClick={() => {
                      const item = items.find((x) => x.id === adjusting);
                      run(
                        () =>
                          awardItem({
                            roundItemId: adjusting,
                            supplierId: item?.awardedSupplierId ?? null,
                            adjustedQuantity:
                              Number(adjustQty.replace(",", ".")) || 0,
                            adjustReason,
                          }),
                        () => "Quantidade alterada."
                      );
                      setAdjusting(null);
                    }}
                  >
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAdjusting(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              <p className="pt-2 text-[10px] text-muted-foreground">
                O troféu marca o melhor preço, mas quem decide é você: prazo e
                condição às vezes valem mais que centavos. Item{" "}
                <strong>sem cotação nenhuma</strong> não trava a rodada — ele
                volta para a unidade como não negociado, e ela resolve local.
              </p>
            </CardContent>
          </Card>

          {/* -- A PARTE DE CADA UNIDADE --------------------------------- */}
          {allocation.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="pb-1 text-sm font-semibold">
                  A parte de cada unidade
                </h2>
                <p className="pb-2 text-[11px] text-muted-foreground">
                  Rateio proporcional ao que cada uma pediu; a sobra dos
                  arredondamentos vai para quem mais pediu, para a soma das
                  partes bater com o total comprado.
                </p>
                {allocation.map((a, idx) => (
                  <div
                    key={`${a.clinicName}-${a.description}-${idx}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                  >
                    <span>
                      <strong>{a.clinicName}</strong> · {a.description}
                      <span className="ml-1 text-muted-foreground">
                        ({a.supplierName})
                      </span>
                    </span>
                    <span className="flex gap-3 tabular-nums">
                      <span className="w-24 text-right text-muted-foreground">
                        pediu {qty(a.requested)}
                      </span>
                      <span className="w-20 text-right">
                        {qty(a.allocated)}
                      </span>
                      <span className="w-24 text-right">
                        {formatBRL(a.totalCents)}
                      </span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {editable && (
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  run(
                    () => closeRound({ roundId: round.id }),
                    (n) => `Rodada fechada com ${n ?? 0} item(ns) negociado(s).`
                  )
                }
              >
                <Lock className="mr-1 size-3" />
                Fechar rodada
              </Button>
            </div>
          )}

          {round.status === "fechada" && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-50 p-2 text-xs text-emerald-900">
              <Check className="size-3.5" />
              Rodada fechada. No C3 cada unidade aprova a parte dela e o pedido
              nasce — por unidade e por fornecedor.
            </p>
          )}
        </>
      )}
    </div>
  );
}
