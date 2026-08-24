"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  orderStatusLabel,
  pendingQuantity,
  receiptTotals,
  suggestInstallments,
  type OrderStatus,
  type ReceiptLine,
} from "@/lib/purchases";
import { loadReconciliation, receiveOrder, type ReconciliationRow } from "./actions";

export type OrderCard = {
  id: string;
  code: string;
  status: OrderStatus;
  totalCents: number;
  expectedDelivery: string | null;
  supplierName: string;
  items: {
    orderItemId: string;
    isStockItem: boolean;
    description: string;
    orderedQuantity: number;
    alreadyReceived: number;
    orderedUnitCents: number;
  }[];
};

type Draft = Record<
  string,
  { quantity: string; unit: string; lot: string; expires: string }
>;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function fmtQty(n: number): string {
  return String(Number(n.toFixed(3))).replace(".", ",");
}

export function ReceivingView({
  clinicId,
  orders,
  today,
  canReceive,
}: {
  clinicId: string;
  orders: OrderCard[];
  today: string;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [invoice, setInvoice] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [installmentCount, setInstallmentCount] = useState("1");
  const [firstDue, setFirstDue] = useState(today);
  const [recon, setRecon] = useState<Record<string, ReconciliationRow[]>>({});

  function open(order: OrderCard) {
    if (openId === order.id) {
      setOpenId(null);
      return;
    }
    setOpenId(order.id);
    setInvoice("");
    setIssueDate(today);
    setNotes("");
    setInstallmentCount("1");
    setFirstDue(today);
    // O campo vem preenchido com o que FALTA: é o caso comum, e digitar de novo
    // o que já se sabe é onde o erro entra.
    const d: Draft = {};
    for (const i of order.items) {
      d[i.orderItemId] = {
        quantity: String(pendingQuantity(i)).replace(".", ","),
        unit: (i.orderedUnitCents / 100).toFixed(2).replace(".", ","),
        lot: "",
        expires: "",
      };
    }
    setDraft(d);

    if (order.status !== "aberto" && !recon[order.id]) {
      startTransition(async () => {
        const r = await loadReconciliation({ orderId: order.id });
        if (r.ok && r.rows) setRecon((v) => ({ ...v, [order.id]: r.rows! }));
      });
    }
  }

  function lines(order: OrderCard): ReceiptLine[] {
    return order.items.map((i) => {
      const d = draft[i.orderItemId];
      const qty = Number((d?.quantity ?? "0").replace(",", "."));
      const unit = parseBRLToCents(d?.unit ?? "");
      return {
        orderItemId: i.orderItemId,
        description: i.description,
        orderedQuantity: i.orderedQuantity,
        alreadyReceived: i.alreadyReceived,
        quantity: Number.isFinite(qty) ? qty : 0,
        orderedUnitCents: i.orderedUnitCents,
        invoicedUnitCents: unit ?? null,
      };
    });
  }

  function submit(order: OrderCard) {
    const ls = lines(order);
    const totals = receiptTotals(ls);
    const parcelas = suggestInstallments(
      totals.itemsCents,
      Number(installmentCount) || 1,
      firstDue
    );

    startTransition(async () => {
      const r = await receiveOrder({
        orderId: order.id,
        clinicId,
        invoiceNumber: invoice,
        issueDate,
        items: ls
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            orderItemId: l.orderItemId,
            quantity: l.quantity,
            unitCents: l.invoicedUnitCents,
            lotCode: draft[l.orderItemId]?.lot ?? "",
            expiresAt: draft[l.orderItemId]?.expires ?? "",
          })),
        installments: parcelas,
        notes,
      });
      if (r.ok) {
        toast.success("Entrega registrada — material no estoque e conta gerada.");
        setOpenId(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Nenhum pedido para receber. Os pedidos nascem quando a unidade aprova
          a parte dela de uma rodada de compra.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      {orders.map((order) => {
        const isOpen = openId === order.id;
        const ls = lines(order);
        const totals = receiptTotals(ls);
        const faltando = order.items.reduce((s, i) => s + pendingQuantity(i), 0);

        return (
          <Card key={order.id}>
            <CardContent className="p-4">
              <button
                type="button"
                onClick={() => open(order)}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  <span>
                    <strong>{order.code}</strong> · {order.supplierName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {order.items.length}{" "}
                      {order.items.length === 1 ? "item" : "itens"} · previsto
                      para {fmtDate(order.expectedDelivery)}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-3 text-sm tabular-nums">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px]",
                      order.status === "recebido"
                        ? "bg-emerald-100 text-emerald-800"
                        : order.status === "recebido_parcial"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {orderStatusLabel(order.status)}
                  </span>
                  {formatBRL(order.totalCents)}
                </span>
              </button>

              {isOpen && (
                <div className="mt-3 space-y-3 border-t pt-3">
                  {/* -- CONFERÊNCIA, quando já houve entrega ------------- */}
                  {recon[order.id] && recon[order.id].length > 0 && (
                    <div className="rounded-lg border bg-muted/20 p-2 text-[11px]">
                      <p className="pb-1 font-medium">
                        Pedido × recebido, até agora
                      </p>
                      {recon[order.id].map((r) => (
                        <div
                          key={r.orderItemId}
                          className="flex flex-wrap justify-between gap-2 border-t py-0.5"
                        >
                          <span>{r.description}</span>
                          <span className="flex gap-3 tabular-nums">
                            <span>
                              {fmtQty(r.receivedQuantity)} de{" "}
                              {fmtQty(r.orderedQuantity)}
                            </span>
                            {r.priceDiffCents !== 0 && (
                              <span
                                className={cn(
                                  r.priceDiffCents > 0
                                    ? "text-destructive"
                                    : "text-emerald-700"
                                )}
                              >
                                {r.priceDiffCents > 0 ? "+" : ""}
                                {formatBRL(r.priceDiffCents)} no preço
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {faltando <= 0 ? (
                    <p className="flex items-center gap-2 text-sm text-emerald-800">
                      <Check className="size-4" />
                      Tudo deste pedido já foi recebido.
                    </p>
                  ) : !canReceive ? (
                    <p className="text-[11px] text-muted-foreground">
                      Você não tem permissão para receber nesta unidade.
                    </p>
                  ) : (
                    <>
                      {/* -- O QUE CHEGOU ----------------------------- */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] uppercase text-muted-foreground">
                          <span>Item</span>
                          <span className="flex gap-2">
                            <span className="w-20 text-right">Falta</span>
                            <span className="w-24 text-right">Chegou</span>
                            <span className="w-28 text-right">Preço da nota</span>
                            <span className="w-24 text-right">Lote</span>
                            <span className="w-32 text-right">Validade</span>
                          </span>
                        </div>
                        {order.items.map((i) => {
                          const d = draft[i.orderItemId];
                          const falta = pendingQuantity(i);
                          const line = ls.find(
                            (l) => l.orderItemId === i.orderItemId
                          )!;
                          const diverge =
                            line.quantity > 0 && line.quantity !== falta;
                          return (
                            <div
                              key={i.orderItemId}
                              className="flex flex-wrap items-center justify-between gap-2 border-t py-1 text-xs"
                            >
                              <span className="min-w-0">
                                {i.description}
                                {!i.isStockItem && (
                                  <span className="ml-1 text-[10px] text-muted-foreground">
                                    (não vai para o estoque)
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="w-20 text-right tabular-nums text-muted-foreground">
                                  {fmtQty(falta)}
                                </span>
                                <Input
                                  className={cn(
                                    "h-7 w-24 text-right tabular-nums",
                                    diverge && "border-amber-500"
                                  )}
                                  value={d?.quantity ?? ""}
                                  onChange={(e) =>
                                    setDraft((v) => ({
                                      ...v,
                                      [i.orderItemId]: {
                                        ...v[i.orderItemId],
                                        quantity: e.target.value,
                                      },
                                    }))
                                  }
                                />
                                <Input
                                  className="h-7 w-28 text-right tabular-nums"
                                  value={d?.unit ?? ""}
                                  onChange={(e) =>
                                    setDraft((v) => ({
                                      ...v,
                                      [i.orderItemId]: {
                                        ...v[i.orderItemId],
                                        unit: e.target.value,
                                      },
                                    }))
                                  }
                                />
                                <Input
                                  className="h-7 w-24"
                                  placeholder="—"
                                  disabled={!i.isStockItem}
                                  value={d?.lot ?? ""}
                                  onChange={(e) =>
                                    setDraft((v) => ({
                                      ...v,
                                      [i.orderItemId]: {
                                        ...v[i.orderItemId],
                                        lot: e.target.value,
                                      },
                                    }))
                                  }
                                />
                                <Input
                                  className="h-7 w-32"
                                  type="date"
                                  disabled={!i.isStockItem}
                                  value={d?.expires ?? ""}
                                  onChange={(e) =>
                                    setDraft((v) => ({
                                      ...v,
                                      [i.orderItemId]: {
                                        ...v[i.orderItemId],
                                        expires: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {totals.quantityDivergences > 0 && (
                        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                          <span>
                            {totals.quantityDivergences}{" "}
                            {totals.quantityDivergences === 1
                              ? "item veio"
                              : "itens vieram"}{" "}
                            em quantidade diferente da que faltava. Entra o que
                            chegou de verdade — a diferença fica registrada para
                            cobrança, não corrigida em silêncio.
                          </span>
                        </p>
                      )}

                      {totals.priceDiffCents !== 0 && (
                        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                          <span>
                            A nota está{" "}
                            <strong>
                              {totals.priceDiffCents > 0
                                ? `${formatBRL(totals.priceDiffCents)} mais cara`
                                : `${formatBRL(Math.abs(totals.priceDiffCents))} mais barata`}
                            </strong>{" "}
                            que o negociado. O valor da nota é o que entra —
                            a diferença vai para o acompanhamento do fornecedor.
                          </span>
                        </p>
                      )}

                      {/* -- NOTA E PAGAMENTO ------------------------- */}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <Label className="text-[11px]">Nota fiscal</Label>
                          <Input
                            className="h-8 w-32"
                            value={invoice}
                            onChange={(e) => setInvoice(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">Emissão</Label>
                          <Input
                            className="h-8 w-40"
                            type="date"
                            value={issueDate}
                            onChange={(e) => setIssueDate(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">Parcelas</Label>
                          <Input
                            className="h-8 w-20"
                            value={installmentCount}
                            onChange={(e) => setInstallmentCount(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">1º vencimento</Label>
                          <Input
                            className="h-8 w-40"
                            type="date"
                            value={firstDue}
                            onChange={(e) => setFirstDue(e.target.value)}
                          />
                        </label>
                        <label className="block flex-1">
                          <Label className="text-[11px]">Observação</Label>
                          <Input
                            className="h-8"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                        <p className="text-sm">
                          Total da entrega:{" "}
                          <strong className="tabular-nums">
                            {formatBRL(totals.itemsCents)}
                          </strong>
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            vira conta a pagar em{" "}
                            {Number(installmentCount) || 1}{" "}
                            {(Number(installmentCount) || 1) === 1
                              ? "parcela"
                              : "parcelas"}
                          </span>
                        </p>
                        <Button
                          size="sm"
                          disabled={totals.itemsCents <= 0}
                          onClick={() => submit(order)}
                        >
                          Registrar entrega
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
