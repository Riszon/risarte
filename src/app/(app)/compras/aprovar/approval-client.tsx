"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, PackageCheck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { decideItem, generateOrders } from "./actions";

export type AllocationRow = {
  id: string;
  roundId: string;
  roundCode: string;
  roundName: string;
  description: string;
  supplierName: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unitCents: number;
  totalCents: number;
  estimatedTotalCents: number;
  status: "pendente" | "aprovado" | "recusado";
  refuseReason: string;
  ordered: boolean;
};

export type OrderRow = {
  id: string;
  code: string;
  supplierName: string;
  status: string;
  totalCents: number;
  createdAt: string;
  items: {
    description: string;
    quantity: number;
    unitCents: number;
    totalCents: number;
  }[];
};

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(".", ",");
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const ORDER_STATUS: Record<string, string> = {
  aberto: "Aberto",
  recebido_parcial: "Recebido em parte",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

export function ApprovalView({
  clinicId,
  allocations,
  orders,
  canDecide,
}: {
  clinicId: string;
  allocations: AllocationRow[];
  orders: OrderRow[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");

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

  // Uma rodada por bloco: cada uma vira um conjunto próprio de pedidos.
  const rounds = [...new Set(allocations.map((a) => a.roundId))];
  const openRounds = rounds.filter((id) =>
    allocations.some((a) => a.roundId === id && !a.ordered)
  );

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {openRounds.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Nada esperando a sua decisão. Quando a Franqueadora fechar uma
            rodada de negociação, a parte da sua unidade aparece aqui.
          </CardContent>
        </Card>
      )}

      {openRounds.map((roundId) => {
        const items = allocations.filter((a) => a.roundId === roundId);
        const first = items[0];
        const pending = items.filter((a) => a.status === "pendente");
        const approved = items.filter(
          (a) => a.status === "aprovado" && !a.ordered
        );
        const approvedCents = approved.reduce((s, a) => s + a.totalCents, 0);
        const estimatedCents = approved.reduce(
          (s, a) => s + a.estimatedTotalCents,
          0
        );
        const saved = estimatedCents - approvedCents;

        return (
          <Card key={roundId}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  {first.roundCode}
                  {first.roundName && ` · ${first.roundName}`}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {pending.length > 0
                    ? `${pending.length} item(ns) esperando sua decisão`
                    : "tudo decidido"}
                </span>
              </div>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-muted-foreground">
                      <th className="py-1 pr-2">Item</th>
                      <th className="py-1 pr-2 text-right">Qtd.</th>
                      <th className="py-1 pr-2 text-right">Previsto</th>
                      <th className="py-1 pr-2 text-right">Negociado</th>
                      <th className="py-1 pr-2 text-right">Economia</th>
                      <th className="py-1 text-right">Decisão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => {
                      const economia = a.estimatedTotalCents - a.totalCents;
                      return (
                        <tr key={a.id} className="border-t align-top">
                          <td className="py-1.5 pr-2">
                            {a.description}
                            <div className="text-[10px] text-muted-foreground">
                              {a.supplierName}
                              {a.allocatedQuantity !== a.requestedQuantity && (
                                <span className="ml-1 text-amber-700">
                                  · você pediu {qty(a.requestedQuantity)}
                                </span>
                              )}
                            </div>
                            {a.refuseReason && (
                              <div className="text-[10px] text-destructive">
                                recusado: {a.refuseReason}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {qty(a.allocatedQuantity)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {a.estimatedTotalCents > 0
                              ? formatBRL(a.estimatedTotalCents)
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {formatBRL(a.totalCents)}
                          </td>
                          <td
                            className={cn(
                              "py-1.5 pr-2 text-right tabular-nums",
                              a.estimatedTotalCents === 0
                                ? "text-muted-foreground"
                                : economia < 0
                                  ? "text-destructive"
                                  : "text-emerald-700"
                            )}
                          >
                            {a.estimatedTotalCents > 0
                              ? formatBRL(economia)
                              : "—"}
                          </td>
                          <td className="py-1.5 text-right">
                            {a.ordered ? (
                              <span className="text-muted-foreground">
                                em pedido
                              </span>
                            ) : a.status === "aprovado" ? (
                              <span className="flex items-center justify-end gap-1 text-emerald-700">
                                <Check className="size-3" /> aprovado
                              </span>
                            ) : a.status === "recusado" ? (
                              <span className="flex items-center justify-end gap-1 text-destructive">
                                <X className="size-3" /> recusado
                              </span>
                            ) : canDecide ? (
                              <span className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    run(
                                      () =>
                                        decideItem({
                                          allocationId: a.id,
                                          clinicId,
                                          approved: true,
                                          reason: "",
                                        }),
                                      () => "Item aprovado."
                                    )
                                  }
                                >
                                  Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setRefusing(a.id);
                                    setReason("");
                                  }}
                                >
                                  Recusar
                                </Button>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {refusing && items.some((a) => a.id === refusing) && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                  <label className="block flex-1">
                    <Label className="text-[11px]">
                      Motivo da recusa (a Franqueadora vê)
                    </Label>
                    <Input
                      className="h-8"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Ex.: ainda tenho estoque deste item"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      run(
                        () =>
                          decideItem({
                            allocationId: refusing,
                            clinicId,
                            approved: false,
                            reason,
                          }),
                        () => "Item recusado."
                      );
                      setRefusing(null);
                    }}
                  >
                    Recusar item
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRefusing(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              {approved.length > 0 && canDecide && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs">
                    <strong>{approved.length}</strong> item(ns) aprovado(s) ·{" "}
                    <strong className="tabular-nums">
                      {formatBRL(approvedCents)}
                    </strong>
                    {estimatedCents > 0 && (
                      <span
                        className={cn(
                          "ml-1",
                          saved < 0 ? "text-destructive" : "text-emerald-700"
                        )}
                      >
                        ({saved >= 0 ? "economia de " : "acima do previsto em "}
                        {formatBRL(Math.abs(saved))})
                      </span>
                    )}
                  </p>
                  <Button
                    size="sm"
                    onClick={() =>
                      run(
                        () => generateOrders({ roundId, clinicId }),
                        (n) =>
                          `${n ?? 0} pedido(s) gerado(s) — um por fornecedor.`
                      )
                    }
                  >
                    <PackageCheck className="mr-1 size-3" />
                    Gerar pedidos
                  </Button>
                </div>
              )}

              {pending.length > 0 && (
                <p className="pt-2 text-[10px] text-muted-foreground">
                  Item sem decisão <strong>não vira pedido</strong> — silêncio
                  não é aprovação, porque o dinheiro é seu. A Franqueadora
                  enxerga o que ainda não foi respondido.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* -- OS PEDIDOS --------------------------------------------------- */}
      {orders.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="pb-1 text-sm font-semibold">Pedidos da unidade</h2>
            <p className="pb-2 text-[11px] text-muted-foreground">
              Um por fornecedor: cada um é faturado, pago e entregue
              separadamente.
            </p>
            {orders.map((o) => (
              <details key={o.id} className="border-t py-1.5 text-xs">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong>{o.code}</strong> · {o.supplierName}
                    <span className="ml-1 text-muted-foreground">
                      {fmtDate(o.createdAt)} ·{" "}
                      {ORDER_STATUS[o.status] ?? o.status}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {formatBRL(o.totalCents)}
                  </span>
                </summary>
                <ul className="ml-4 mt-1 space-y-0.5 text-[11px]">
                  {o.items.map((i, idx) => (
                    <li
                      key={`${o.id}-${idx}`}
                      className="flex justify-between gap-2"
                    >
                      <span>
                        {i.description}{" "}
                        <span className="text-muted-foreground">
                          × {qty(i.quantity)}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatBRL(i.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <p className="pt-2 text-[10px] text-muted-foreground">
              Quando o material chegar, a nota se amarra ao pedido e a entrada
              no estoque sai daí — é a próxima etapa.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
