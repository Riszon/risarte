"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { firstDepreciationMonth } from "@/lib/finance/assets";
import { disposeAsset, runDepreciation, saveAsset } from "./actions";

type Asset = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  inServiceDate: string;
  costCents: number;
  monthlyCents: number;
  accumulatedCents: number;
  bookValueCents: number;
  monthsDone: number;
  usefulLifeMonths: number;
  status: string;
  disposalDate: string;
};

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function fmtMonth(m: string): string {
  const [y, mm] = m.split("-");
  return `${mm}/${y}`;
}

export function AssetsManager({
  clinicId,
  today,
  canEdit,
  assets,
  categories,
  suppliers,
  depreciationByMonth,
}: {
  clinicId: string;
  today: string;
  canEdit: boolean;
  assets: Asset[];
  categories: {
    id: string;
    name: string;
    defaultMonths: number;
    isNetwork: boolean;
  }[];
  suppliers: { id: string; name: string }[];
  depreciationByMonth: { month: string; cents: number }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const emptyForm = {
    categoryId: categories[0]?.id ?? "",
    name: "",
    description: "",
    supplierId: "",
    invoiceNumber: "",
    acquisitionDate: today,
    inServiceDate: today,
    cost: "",
    usefulLifeMonths: String(categories[0]?.defaultMonths ?? 120),
    notes: "",
  };
  const [form, setForm] = useState<typeof emptyForm | null>(null);

  const [month, setMonth] = useState(today.slice(0, 7));
  const [disposing, setDisposing] = useState<string | null>(null);
  const [disposalDate, setDisposalDate] = useState(today);
  const [disposalReason, setDisposalReason] = useState("");

  const active = assets.filter((a) => a.status === "ativo");
  const totalCost = active.reduce((s, a) => s + a.costCents, 0);
  const totalBook = active.reduce((s, a) => s + a.bookValueCents, 0);
  const monthlyLoad = active
    .filter((a) => a.accumulatedCents < a.costCents)
    .reduce((s, a) => s + a.monthlyCents, 0);

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        if (r.error) toast.info(r.error);
        else toast.success(msg);
        after?.();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      {/* -- O PESO MENSAL ------------------------------------------------ */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Bens em uso</p>
            <p className="text-lg font-semibold">{active.length}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Valor de compra</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(totalCost)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">
              Valor contábil hoje
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatBRL(totalBook)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">
              Depreciação por mês
            </p>
            <p className="text-lg font-semibold tabular-nums text-primary">
              {formatBRL(monthlyLoad)}
            </p>
          </div>
          <p className="sm:col-span-4 text-[11px] text-muted-foreground">
            A <strong>depreciação por mês</strong> é o custo fixo que a DRE
            carrega todo mês só por a clínica ter os equipamentos que tem — mesmo
            que você não gaste um centavo naquele mês. Ela entra no{" "}
            <strong>ponto de equilíbrio</strong>.
          </p>
        </CardContent>
      </Card>

      {/* -- RODAR A DEPRECIAÇÃO ------------------------------------------ */}
      {canEdit && (
        <Card>
          <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
            <div>
              <h2 className="flex items-center gap-1 font-medium">
                <TrendingDown className="size-4 text-primary" />
                Depreciação do mês
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Rodar duas vezes é seguro — o sistema não deprecia o mesmo bem
                duas vezes no mesmo mês. A competência é o último dia do mês.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <Label className="text-[11px]">Mês</Label>
                <Input
                  className="h-8 w-36"
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => runDepreciation({ clinicId, month }),
                    "Depreciação lançada."
                  )
                }
              >
                Rodar depreciação
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* -- HISTÓRICO POR MÊS -------------------------------------------- */}
      {depreciationByMonth.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-4">
            <h2 className="font-medium">Depreciação lançada</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {depreciationByMonth.map((m) => (
                <li key={m.month} className="tabular-nums">
                  <span className="text-muted-foreground">
                    {fmtMonth(m.month)}
                  </span>{" "}
                  <strong>{formatBRL(m.cents)}</strong>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* -- OS BENS ------------------------------------------------------ */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Bens ({assets.length})</h2>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setForm(form ? null : { ...emptyForm })}
              >
                <Plus className="mr-1 size-4" />
                Novo bem
              </Button>
            )}
          </div>

          {form && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Nome</Label>
                <Input
                  className="h-8"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex.: Cadeira odontológica sala 2"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Categoria</Label>
                <select
                  value={form.categoryId}
                  onChange={(e) => {
                    const cat = categories.find((c) => c.id === e.target.value);
                    setForm({
                      ...form,
                      categoryId: e.target.value,
                      // A vida útil da categoria é PONTO DE PARTIDA: quem
                      // cadastra pode ajustar para o bem específico.
                      usefulLifeMonths: String(cat?.defaultMonths ?? 120),
                    });
                  }}
                  className={selectClass}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.defaultMonths} meses)
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <Label className="text-[11px]">Valor de aquisição (R$)</Label>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  placeholder="30.000,00"
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Vida útil (meses)</Label>
                <Input
                  className="h-8"
                  type="number"
                  min={1}
                  value={form.usefulLifeMonths}
                  onChange={(e) =>
                    setForm({ ...form, usefulLifeMonths: e.target.value })
                  }
                />
              </label>
              <div className="flex items-end pb-1">
                <p className="text-[11px] text-muted-foreground">
                  ={" "}
                  <strong>
                    {formatBRL(
                      Math.round(
                        (parseBRLToCents(form.cost) ?? 0) /
                          Math.max(1, Number(form.usefulLifeMonths) || 1)
                      )
                    )}
                  </strong>{" "}
                  por mês
                </p>
              </div>

              <label className="block">
                <Label className="text-[11px]">Data da compra</Label>
                <Input
                  className="h-8"
                  type="date"
                  value={form.acquisitionDate}
                  onChange={(e) =>
                    setForm({ ...form, acquisitionDate: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Entrada em uso</Label>
                <Input
                  className="h-8"
                  type="date"
                  value={form.inServiceDate}
                  onChange={(e) =>
                    setForm({ ...form, inServiceDate: e.target.value })
                  }
                />
              </label>
              <div className="flex items-end pb-1">
                <p className="text-[11px] text-muted-foreground">
                  deprecia a partir de{" "}
                  <strong>
                    {fmtMonth(firstDepreciationMonth(form.inServiceDate))}
                  </strong>
                </p>
              </div>

              <label className="block">
                <Label className="text-[11px]">Fornecedor</Label>
                <select
                  value={form.supplierId}
                  onChange={(e) =>
                    setForm({ ...form, supplierId: e.target.value })
                  }
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
                  value={form.invoiceNumber}
                  onChange={(e) =>
                    setForm({ ...form, invoiceNumber: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <Label className="text-[11px]">Observação</Label>
                <Input
                  className="h-8"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>

              <p className="sm:col-span-3 rounded-md bg-background p-2 text-[11px] text-muted-foreground">
                A <strong>entrada em uso</strong> é diferente da data da compra
                de propósito: equipamento comprado em dezembro e instalado em
                fevereiro só começa a depreciar em março. E a depreciação começa
                no <strong>mês seguinte</strong> à entrada em uso — depreciar
                meio mês exigiria uma conta proporcional que ninguém confere.
              </p>

              <div className="sm:col-span-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={isPending || !form.name.trim()}
                  onClick={() =>
                    run(
                      () => saveAsset({ clinicId, ...form }),
                      "Bem cadastrado.",
                      () => setForm(null)
                    )
                  }
                >
                  Salvar bem
                </Button>
              </div>
            </div>
          )}

          {assets.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum bem cadastrado.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {assets.map((a) => {
                const done = a.accumulatedCents >= a.costCents;
                return (
                  <li
                    key={a.id}
                    className="border-b border-dashed py-1 last:border-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        {a.name}
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {a.code}
                          {a.categoryName && ` · ${a.categoryName}`} · em uso
                          desde {fmtDate(a.inServiceDate)}
                        </span>
                        {a.status === "baixado" && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Baixado {fmtDate(a.disposalDate)}
                          </Badge>
                        )}
                        {done && a.status === "ativo" && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Totalmente depreciado
                          </Badge>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-xs tabular-nums">
                        <span className="text-muted-foreground">
                          {formatBRL(a.costCents)}
                        </span>
                        <span>
                          {a.monthsDone}/{a.usefulLifeMonths} meses
                        </span>
                        <span>
                          resta <strong>{formatBRL(a.bookValueCents)}</strong>
                        </span>
                        {canEdit && a.status === "ativo" && (
                          <button
                            type="button"
                            onClick={() => {
                              setDisposing(disposing === a.id ? null : a.id);
                              setDisposalReason("");
                            }}
                            className="rounded px-1 text-muted-foreground hover:bg-muted"
                          >
                            baixar
                          </button>
                        )}
                      </span>
                    </div>

                    {disposing === a.id && (
                      <div className="mt-1 grid gap-2 rounded-lg border bg-muted/30 p-2 sm:grid-cols-4">
                        <p className="sm:col-span-4 text-[11px] text-muted-foreground">
                          A baixa para a depreciação e joga o valor que ainda
                          resta ({formatBRL(a.bookValueCents)}) no resultado
                          deste mês. Sem ela, o sistema depreciaria para sempre
                          um equipamento que já não existe.
                        </p>
                        <label className="block">
                          <Label className="text-[11px]">Data</Label>
                          <Input
                            className="h-8"
                            type="date"
                            value={disposalDate}
                            onChange={(e) => setDisposalDate(e.target.value)}
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <Label className="text-[11px]">Motivo</Label>
                          <Input
                            className="h-8"
                            value={disposalReason}
                            onChange={(e) => setDisposalReason(e.target.value)}
                            placeholder="Ex.: quebrou, vendida, substituída"
                          />
                        </label>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 text-xs"
                            disabled={isPending || !disposalReason.trim()}
                            onClick={() =>
                              run(
                                () =>
                                  disposeAsset({
                                    clinicId,
                                    assetId: a.id,
                                    date: disposalDate,
                                    reason: disposalReason,
                                  }),
                                "Bem baixado.",
                                () => setDisposing(null)
                              )
                            }
                          >
                            Confirmar baixa
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
