"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  estimateLabel,
  estimateTrust,
  isEstimateStale,
  requestTotals,
  sendBlock,
  sendBlockMessage,
  statusLabel,
  type EstimateTrust,
  type PurchaseRequest,
  type PurchaseRequestItem,
} from "@/lib/purchases";
import {
  addRequestItem,
  cancelPurchaseRequest,
  generatePurchaseRequest,
  removeRequestItem,
  sendPurchaseRequest,
  updateRequestItem,
} from "./actions";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

const TRUST_CLASS: Record<EstimateTrust, string> = {
  boa: "text-emerald-700",
  razoavel: "text-amber-700",
  fraca: "text-muted-foreground",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function parseNumber(text: string): number {
  const n = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Uma linha da lista. */
function ItemRow({
  item,
  today,
  canEdit,
  onQuantity,
  onRemove,
}: {
  item: PurchaseRequestItem;
  today: string;
  canEdit: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const trust = estimateTrust(item.estimateSource);
  const stale = isEstimateStale(item.estimateDate, today);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1.5 text-xs">
      <span className="min-w-0 flex-1">
        {item.description}
        {item.purchaseUnit && (
          <span className="text-muted-foreground"> · {item.purchaseUnit}</span>
        )}
        <br />
        <span className={cn("text-[10px]", TRUST_CLASS[trust])}>
          {estimateLabel(item.estimateSource)}
          {item.estimateDate && ` · ${fmtDate(item.estimateDate)}`}
          {stale && " · mais de 6 meses"}
        </span>
      </span>
      <span className="flex items-center gap-3 tabular-nums">
        <Input
          key={`${item.id}-${item.quantity}`}
          className="h-7 w-20 text-right"
          disabled={!canEdit}
          defaultValue={String(item.quantity).replace(".", ",")}
          onBlur={(e) => {
            const q = parseNumber(e.target.value);
            if (q > 0 && q !== item.quantity) onQuantity(q);
          }}
        />
        <span className="w-24 text-right text-muted-foreground">
          {item.estimatedUnitCents > 0
            ? formatBRL(item.estimatedUnitCents)
            : "—"}
        </span>
        <span className="w-24 text-right">
          {item.estimatedTotalCents > 0
            ? formatBRL(item.estimatedTotalCents)
            : "—"}
        </span>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={onRemove} title="Remover">
            <Trash2 className="size-3" />
          </Button>
        )}
      </span>
    </div>
  );
}

export function PurchasesView({
  clinicId,
  today,
  requests,
  itemsByRequest,
  stockItems,
  accounts,
  canManage,
}: {
  clinicId: string;
  today: string;
  requests: PurchaseRequest[];
  itemsByRequest: Record<string, PurchaseRequestItem[]>;
  stockItems: { id: string; name: string; brand: string; purchaseUnit: string }[];
  accounts: { code: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(requests[0]?.id ?? null);
  const [adding, setAdding] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);

  // Formulário da linha nova
  const [newItemId, setNewItemId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAccount, setNewAccount] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnitPrice, setNewUnitPrice] = useState("0,00");

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMessage: string
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMessage);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function resetForm() {
    setNewItemId("");
    setNewDescription("");
    setNewAccount("");
    setNewQuantity("1");
    setNewUnitPrice("0,00");
  }

  const chosen = stockItems.find((s) => s.id === newItemId);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- GERAR --------------------------------------------------------- */}
      {canManage && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Button
              size="sm"
              onClick={() =>
                run(
                  () => generatePurchaseRequest({ clinicId, isLocal }),
                  "Lista gerada pelo estoque."
                )
              }
            >
              <Plus className="mr-1 size-3" /> Gerar lista de compras
            </Button>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={isLocal}
                onChange={(e) => setIsLocal(e.target.checked)}
              />
              Compra local (não passa pela Franqueadora)
            </label>
            <p className="ml-auto max-w-md text-[11px] text-muted-foreground">
              Traz tudo que está <strong>abaixo do mínimo</strong>, na
              quantidade de embalagens sugerida pelo Estoque. A{" "}
              <strong>compra local</strong> fica registrada como tal — ela
              continua no sistema, e é assim que a rede sabe quanto se compra
              por fora.
            </p>
          </CardContent>
        </Card>
      )}

      {requests.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma lista ainda. Gere a primeira pelo estoque.
          </CardContent>
        </Card>
      ) : (
        requests.map((r) => {
          const items = itemsByRequest[r.id] ?? [];
          const totals = requestTotals(items);
          const isOpen = open === r.id;
          const block = sendBlock(r, items);
          const blockMsg = sendBlockMessage(block);
          const editable = canManage && r.status === "rascunho";

          return (
            <Card key={r.id}>
              <CardContent className="p-4">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {r.code}
                    <span className="rounded bg-muted px-1 text-[10px] font-normal">
                      {statusLabel(r.status)}
                    </span>
                    {r.isLocal && (
                      <span className="rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-800">
                        compra local
                      </span>
                    )}
                  </span>
                  <span className="flex gap-4 text-xs tabular-nums">
                    <span className="text-muted-foreground">
                      {totals.items} {totals.items === 1 ? "item" : "itens"}
                    </span>
                    <span className="font-medium">
                      {formatBRL(totals.estimatedCents)}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-2">
                    {totals.withoutEstimate > 0 && (
                      <p className="mb-2 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                        <span>
                          {totals.withoutEstimate}{" "}
                          {totals.withoutEstimate === 1
                            ? "item está"
                            : "itens estão"}{" "}
                          sem previsão de preço — nunca foram comprados. Isso{" "}
                          <strong>não impede o envio</strong>: a Franqueadora vai
                          cotar de qualquer forma.
                        </span>
                      </p>
                    )}

                    <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                      <span>Item</span>
                      <span className="flex gap-3">
                        <span className="w-20 text-right">Qtd.</span>
                        <span className="w-24 text-right">Previsto/un.</span>
                        <span className="w-24 text-right">Total</span>
                        {editable && <span className="w-9" />}
                      </span>
                    </div>

                    {items.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        Nenhum item nesta lista.
                      </p>
                    ) : (
                      items.map((it) => (
                        <ItemRow
                          key={it.id}
                          item={it}
                          today={today}
                          canEdit={editable}
                          onQuantity={(q) =>
                            run(
                              () =>
                                updateRequestItem({
                                  itemId: it.id,
                                  clinicId,
                                  quantity: q,
                                  estimatedUnitCents: it.estimatedUnitCents,
                                }),
                              "Quantidade salva."
                            )
                          }
                          onRemove={() =>
                            run(
                              () =>
                                removeRequestItem({
                                  itemId: it.id,
                                  clinicId,
                                }),
                              "Item removido."
                            )
                          }
                        />
                      ))
                    )}

                    <div className="flex justify-between border-t-2 py-1.5 text-sm font-semibold">
                      <span>Previsão total</span>
                      <span className="tabular-nums">
                        {formatBRL(totals.estimatedCents)}
                      </span>
                    </div>

                    {/* -- ACRESCENTAR ------------------------------------- */}
                    {editable && (
                      <div className="mt-2">
                        {adding === r.id ? (
                          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block">
                                <Label className="text-[11px]">
                                  Item do estoque
                                </Label>
                                <select
                                  value={newItemId}
                                  onChange={(e) => {
                                    setNewItemId(e.target.value);
                                    const s = stockItems.find(
                                      (x) => x.id === e.target.value
                                    );
                                    if (s) {
                                      setNewDescription(
                                        s.brand ? `${s.name} — ${s.brand}` : s.name
                                      );
                                    }
                                  }}
                                  className={cn(selectClass, "w-64")}
                                >
                                  <option value="">
                                    Linha livre (não é item de estoque)
                                  </option>
                                  {stockItems.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                      {s.brand ? ` — ${s.brand}` : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="block flex-1">
                                <Label className="text-[11px]">Descrição</Label>
                                <Input
                                  className="h-8"
                                  value={newDescription}
                                  onChange={(e) =>
                                    setNewDescription(e.target.value)
                                  }
                                  placeholder="Ex.: Cadeira odontológica"
                                />
                              </label>
                            </div>

                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block">
                                <Label className="text-[11px]">Quantidade</Label>
                                <Input
                                  className="h-8 w-24"
                                  value={newQuantity}
                                  onChange={(e) =>
                                    setNewQuantity(e.target.value)
                                  }
                                />
                              </label>
                              {!newItemId && (
                                <>
                                  <label className="block">
                                    <Label className="text-[11px]">
                                      Preço estimado (R$)
                                    </Label>
                                    <Input
                                      className="h-8 w-28"
                                      value={newUnitPrice}
                                      onChange={(e) =>
                                        setNewUnitPrice(e.target.value)
                                      }
                                    />
                                  </label>
                                  <label className="block">
                                    <Label className="text-[11px]">
                                      Conta de despesa
                                    </Label>
                                    <select
                                      value={newAccount}
                                      onChange={(e) =>
                                        setNewAccount(e.target.value)
                                      }
                                      className={cn(selectClass, "w-72")}
                                    >
                                      <option value="">Escolha…</option>
                                      {accounts.map((a) => (
                                        <option key={a.code} value={a.code}>
                                          {a.code} {a.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </>
                              )}
                            </div>

                            <p className="text-[10px] text-muted-foreground">
                              {newItemId
                                ? "Item de estoque: o preço vem do histórico (última compra desta unidade, da rede, ou o custo médio) e a tela mostra qual foi usado."
                                : "Linha livre é para o que não se estoca — uma cadeira, um conserto. Por isso ela pede a conta de despesa na hora."}
                            </p>

                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={!newDescription.trim()}
                                onClick={() => {
                                  run(
                                    () =>
                                      addRequestItem({
                                        requestId: r.id,
                                        clinicId,
                                        itemId: newItemId || null,
                                        description: newDescription,
                                        accountCode: newAccount || null,
                                        quantity: parseNumber(newQuantity),
                                        purchaseUnit:
                                          chosen?.purchaseUnit || null,
                                        estimatedUnitCents: Math.round(
                                          parseNumber(newUnitPrice) * 100
                                        ),
                                      }),
                                    "Item acrescentado."
                                  );
                                  resetForm();
                                  setAdding(null);
                                }}
                              >
                                Acrescentar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  resetForm();
                                  setAdding(null);
                                }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAdding(r.id)}
                          >
                            <Plus className="mr-1 size-3" /> Acrescentar item
                          </Button>
                        )}
                      </div>
                    )}

                    {/* -- ENVIAR ------------------------------------------ */}
                    {canManage && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        {blockMsg ? (
                          <p className="text-xs text-muted-foreground">
                            {blockMsg}
                          </p>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              run(
                                () =>
                                  sendPurchaseRequest({
                                    requestId: r.id,
                                    clinicId,
                                  }),
                                "Lista enviada à Franqueadora."
                              )
                            }
                          >
                            <Send className="mr-1 size-3" /> Enviar à
                            Franqueadora
                          </Button>
                        )}
                        {r.status !== "cancelada" &&
                          r.status !== "concluida" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                run(
                                  () =>
                                    cancelPurchaseRequest({
                                      requestId: r.id,
                                      clinicId,
                                    }),
                                  "Lista cancelada."
                                )
                              }
                            >
                              Cancelar lista
                            </Button>
                          )}
                        {r.sentAt && (
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            enviada em {fmtDate(r.sentAt.slice(0, 10))}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <p className="text-[10px] text-muted-foreground">
        <strong>De onde vem cada preço:</strong> primeiro a última compra desta
        unidade, depois a última da rede, e por último o custo médio atual — a
        tela sempre diz qual foi usado, porque um preço de dois anos atrás
        parece tão sólido quanto o de ontem quando aparece sozinho. A previsão
        fica <strong>congelada</strong> na linha: é contra ela que a economia da
        negociação vai ser medida.
      </p>
    </div>
  );
}
