"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  deliveryRate,
  leakagePercent,
  leakageTotals,
  savingsTotals,
  type LeakageRow,
  type SavingsRow,
  type SupplierRow,
} from "@/lib/purchases";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

export type TopItemRow = {
  description: string;
  orders: number;
  quantity: number;
  totalCents: number;
  avgUnitCents: number | null;
};

function pct(v: number | null, digits = 1): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

function fmtQty(n: number): string {
  return String(Number(n.toFixed(3))).replace(".", ",");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bom" | "ruim";
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "bom" && "text-emerald-700",
          tone === "ruim" && "text-destructive"
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PurchaseDashboard({
  isNetwork,
  from,
  to,
  scopeClinic,
  clinics,
  savings,
  leakage,
  suppliers,
  topItems,
}: {
  isNetwork: boolean;
  from: string;
  to: string;
  scopeClinic: string | null;
  clinics: { id: string; name: string }[];
  savings: SavingsRow[];
  leakage: LeakageRow[];
  suppliers: SupplierRow[];
  topItems: TopItemRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function apply(next: Partial<{ de: string; ate: string; unidade: string }>) {
    const params = new URLSearchParams({
      de: next.de ?? from,
      ate: next.ate ?? to,
      unidade: next.unidade ?? scopeClinic ?? "",
    });
    startTransition(() => router.push(`/compras/painel?${params}`));
  }

  const sav = savingsTotals(savings);
  const leak = leakageTotals(leakage);

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      {/* -- FILTROS ------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <Label className="text-[11px]">De</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={from}
              onChange={(e) => apply({ de: e.target.value })}
            />
          </label>
          <label className="block">
            <Label className="text-[11px]">Até</Label>
            <Input
              className="h-8 w-40"
              type="date"
              value={to}
              onChange={(e) => apply({ ate: e.target.value })}
            />
          </label>
          {isNetwork && clinics.length > 0 && (
            <label className="block">
              <Label className="text-[11px]">Unidade</Label>
              <select
                value={scopeClinic ?? ""}
                onChange={(e) => apply({ unidade: e.target.value })}
                className={cn(selectClass, "w-52")}
              >
                <option value="">A rede inteira</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </CardContent>
      </Card>

      {/* -- OS DOIS NÚMEROS QUE MEDEM A TESE ----------------------------- */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <Metric
            label="Economia da negociação"
            value={formatBRL(sav.savedCents)}
            tone={
              sav.savedCents > 0 ? "bom" : sav.savedCents < 0 ? "ruim" : undefined
            }
            hint={`${pct(sav.percent)} sobre a previsão · ${sav.rounds} rodada${sav.rounds === 1 ? "" : "s"}`}
          />
          <Metric
            label="Comprado pela rede"
            value={formatBRL(leak.networkCents)}
            hint="chegou por pedido"
          />
          <Metric
            label="Comprado por fora"
            value={formatBRL(leak.localCents)}
            tone={leak.localCents > 0 ? "ruim" : undefined}
            hint={`${pct(leak.percent)} do total`}
          />
          <Metric
            label="Unidades comprando por fora"
            value={String(leak.clinicsLeaking)}
            hint={isNetwork ? "no período" : "a sua unidade conta aqui"}
          />
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2 text-[11px]">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <strong>A economia é medida contra a previsão</strong>, não contra o
          que teria sido pago de fato. A previsão vem do histórico de compras; se
          ela estiver velha ou faltando, este número engana para mais. Enquanto
          houver poucas compras registradas, use-o como direção, não como valor.
        </span>
      </p>

      {/* -- POR RODADA --------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <h2 className="pb-1 text-sm font-semibold">
            A economia, rodada a rodada
          </h2>
          {savings.length === 0 ? (
            <p className="py-2 text-muted-foreground">
              Nenhuma rodada fechada no período.
            </p>
          ) : (
            <>
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Rodada</span>
                <span className="flex gap-3">
                  <span className="w-28 text-right">Previsto</span>
                  <span className="w-28 text-right">Negociado</span>
                  <span className="w-28 text-right">Economia</span>
                  <span className="w-14 text-right">%</span>
                </span>
              </div>
              {savings.map((r) => {
                const p =
                  r.estimatedCents > 0 ? r.savedCents / r.estimatedCents : null;
                return (
                  <div
                    key={r.roundId}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                  >
                    <span>
                      <strong>{r.roundCode}</strong>
                      {r.roundName && ` · ${r.roundName}`}
                      <span className="ml-2 text-muted-foreground">
                        {fmtDate(r.closedAt)} · {r.itemsAwarded} negociado
                        {r.itemsAwarded === 1 ? "" : "s"}
                        {r.itemsPending > 0 && (
                          <span className="text-amber-700">
                            {" "}
                            · {r.itemsPending} sem cotação
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex gap-3 tabular-nums">
                      <span className="w-28 text-right text-muted-foreground">
                        {formatBRL(r.estimatedCents)}
                      </span>
                      <span className="w-28 text-right">
                        {formatBRL(r.awardedCents)}
                      </span>
                      <span
                        className={cn(
                          "w-28 text-right",
                          r.savedCents > 0
                            ? "text-emerald-700"
                            : r.savedCents < 0
                              ? "text-destructive"
                              : ""
                        )}
                      >
                        {formatBRL(r.savedCents)}
                      </span>
                      <span className="w-14 text-right text-muted-foreground">
                        {pct(p, 0)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </>
          )}
          {sav.itemsPending > 0 && (
            <p className="pt-2 text-[10px] text-muted-foreground">
              {sav.itemsPending} item{sav.itemsPending === 1 ? "" : "ns"} ficou
              sem cotação e <strong>não entra na conta</strong> — comparar
              previsão contra nada mostraria economia que não existe.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -- O VAZAMENTO -------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <h2 className="text-sm font-semibold">Compras por fora da rede</h2>
          <p className="pb-1 text-[11px] text-muted-foreground">
            Material lançado direto no Estoque, sem passar por um pedido. É o
            vazamento que corrói o poder de negociação — e só some do radar se
            ninguém medir.
          </p>
          {leakage.length === 0 ? (
            <p className="py-2 text-muted-foreground">Sem compras no período.</p>
          ) : (
            <>
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Unidade</span>
                <span className="flex gap-3">
                  <span className="w-28 text-right">Pela rede</span>
                  <span className="w-28 text-right">Por fora</span>
                  <span className="w-16 text-right">% fora</span>
                  <span className="w-24 text-right">Declaradas</span>
                </span>
              </div>
              {leakage.map((r) => (
                <div
                  key={r.clinicId}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>{r.clinicName}</span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-28 text-right text-muted-foreground">
                      {formatBRL(r.networkCents)}
                    </span>
                    <span
                      className={cn(
                        "w-28 text-right",
                        r.localCents > 0 && "text-destructive"
                      )}
                    >
                      {formatBRL(r.localCents)}
                    </span>
                    <span className="w-16 text-right">
                      {pct(leakagePercent(r), 0)}
                    </span>
                    <span className="w-24 text-right text-muted-foreground">
                      {r.declaredLocalRequests > 0
                        ? `${r.declaredLocalRequests} lista${r.declaredLocalRequests === 1 ? "" : "s"}`
                        : "—"}
                    </span>
                  </span>
                </div>
              ))}
              <p className="pt-2 text-[10px] text-muted-foreground">
                <strong>Declaradas</strong> são as listas que a unidade marcou
                como compra local. O que preocupa é a diferença entre esse número
                e a coluna &quot;por fora&quot;: compra local declarada é decisão;
                não declarada é hábito.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* -- FORNECEDORES ------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <h2 className="pb-1 text-sm font-semibold">Fornecedores</h2>
          {suppliers.length === 0 ? (
            <p className="py-2 text-muted-foreground">
              Nenhum pedido no período.
            </p>
          ) : (
            <>
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Fornecedor</span>
                <span className="flex gap-3">
                  <span className="w-16 text-right">Pedidos</span>
                  <span className="w-28 text-right">Pedido</span>
                  <span className="w-16 text-right">Entregue</span>
                  <span className="w-20 text-right">Prazo</span>
                  <span className="w-24 text-right">Preço a mais</span>
                </span>
              </div>
              {suppliers.map((s) => (
                <div
                  key={s.supplierId ?? s.supplierName}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>{s.supplierName}</span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-16 text-right text-muted-foreground">
                      {s.orders}
                    </span>
                    <span className="w-28 text-right">
                      {formatBRL(s.orderedCents)}
                    </span>
                    <span className="w-16 text-right text-muted-foreground">
                      {pct(deliveryRate(s), 0)}
                    </span>
                    <span className="w-20 text-right text-muted-foreground">
                      {s.avgDeliveryDays === null
                        ? "—"
                        : `${String(s.avgDeliveryDays).replace(".", ",")} d`}
                    </span>
                    <span
                      className={cn(
                        "w-24 text-right",
                        s.priceDiffCents > 0
                          ? "text-destructive"
                          : s.priceDiffCents < 0
                            ? "text-emerald-700"
                            : "text-muted-foreground"
                      )}
                    >
                      {s.priceDiffCents === 0
                        ? "—"
                        : formatBRL(s.priceDiffCents)}
                    </span>
                  </span>
                </div>
              ))}
              <p className="pt-2 text-[10px] text-muted-foreground">
                <strong>Prazo</strong> é do pedido até a entrega, contando só o
                que já chegou — pedido em aberto não tem prazo, e contá-lo como
                zero faria o fornecedor lento parecer rápido.{" "}
                <strong>Preço a mais</strong> é o quanto a nota cobrou além do
                negociado.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* -- ITENS -------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <h2 className="pb-1 text-sm font-semibold">O que mais se compra</h2>
          {topItems.length === 0 ? (
            <p className="py-2 text-muted-foreground">Nada no período.</p>
          ) : (
            <>
              <div className="flex justify-between pb-1 text-[10px] uppercase text-muted-foreground">
                <span>Item</span>
                <span className="flex gap-3">
                  <span className="w-20 text-right">Qtd.</span>
                  <span className="w-28 text-right">Valor</span>
                  <span className="w-24 text-right">Preço médio</span>
                </span>
              </div>
              {topItems.map((i) => (
                <div
                  key={i.description}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t py-1 text-xs"
                >
                  <span>{i.description}</span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-20 text-right text-muted-foreground">
                      {fmtQty(i.quantity)}
                    </span>
                    <span className="w-28 text-right">
                      {formatBRL(i.totalCents)}
                    </span>
                    <span className="w-24 text-right text-muted-foreground">
                      {i.avgUnitCents === null
                        ? "—"
                        : formatBRL(i.avgUnitCents)}
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
