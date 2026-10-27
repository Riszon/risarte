"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { applyBenefit } from "@/lib/empresarial/pricing";
import { atendeABusca } from "@/lib/busca";
import { cn } from "@/lib/utils";
import {
  BENEFIT_TYPES,
  BENEFIT_TYPE_LABELS,
  type BenefitType,
} from "@/lib/empresarial/constants";
import { deleteProcedureBenefit, upsertProcedureBenefit } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** O procedimento como a tela de benefícios usa: preço padrão da rede e especialidade. */
export type ProcedimentoDoBeneficio = {
  id: string;
  name: string;
  priceCents: number | null;
  specialty: string | null;
};

/** A margem que a tela mostra ao lado de cada benefício (I2). */
export type MargemDaLinha = {
  precoCheioCents: number;
  precoComBeneficioCents: number;
  margemComBeneficioCents: number;
  margemPercent: number | null;
  custoDoBeneficioCents: number;
  negativa: boolean;
  aviso: string | null;
};

export type BenefitView = {
  id: string;
  procedureId: string;
  procedureName: string;
  benefitType: BenefitType;
  benefitValue: number | null;
  usageLimitCount: number | null;
  usagePeriodMonths: number | null;
  gracePeriodMonths: number;
  maxInstallments: number | null;
};

function describeBenefit(b: BenefitView): string {
  const parts: string[] = [];
  if (b.benefitType === "DISCOUNT_PERCENT") parts.push(`${b.benefitValue ?? 0}% off`);
  else if (b.benefitType === "DISCOUNT_AMOUNT")
    parts.push(`${formatBRL(b.benefitValue ?? 0)} off`);
  else parts.push(BENEFIT_TYPE_LABELS[b.benefitType]);
  if (b.usageLimitCount != null) {
    parts.push(
      `${b.usageLimitCount}x${b.usagePeriodMonths ? ` a cada ${b.usagePeriodMonths}m` : ""}`
    );
  } else if (b.usagePeriodMonths) {
    parts.push(`a cada ${b.usagePeriodMonths}m`);
  }
  if (b.gracePeriodMonths > 0) parts.push(`carência ${b.gracePeriodMonths}m`);
  return parts.join(" · ");
}

/**
 * PREÇO NORMAL × PREÇO COM O BENEFÍCIO (pedido do dono, 27/10/2026). O
 * normal é o preço padrão do cadastro de Procedimentos; o com benefício é a
 * mesma conta que a proposta e a cobrança usam (`applyBenefit`).
 */
function Precos({ b, precoCents }: { b: BenefitView; precoCents: number | null }) {
  if (precoCents == null || precoCents <= 0) {
    return <span className="text-xs text-muted-foreground">sem preço cadastrado</span>;
  }
  const { chargedCents, savedCents } = applyBenefit(
    { benefitType: b.benefitType, benefitValue: b.benefitValue },
    precoCents
  );
  return (
    <span className="block text-xs leading-tight">
      <span className="block text-muted-foreground">Normal: {formatBRL(precoCents)}</span>
      <span className="block font-medium text-foreground">
        Com benefício: {formatBRL(chargedCents)}
      </span>
      {savedCents > 0 && (
        <span className="block text-emerald-700 dark:text-emerald-400">
          economiza {formatBRL(savedCents)}
        </span>
      )}
    </span>
  );
}

function Margem({ m }: { m?: MargemDaLinha }) {
  if (!m) {
    return (
      <span className="text-xs text-muted-foreground">
        sem preço cadastrado
      </span>
    );
  }
  return (
    <span className="block text-xs leading-tight">
      <span
        className={
          m.negativa
            ? "font-medium text-destructive"
            : "font-medium text-foreground"
        }
      >
        {formatBRL(m.margemComBeneficioCents)}
        {m.margemPercent != null && ` (${m.margemPercent}%)`}
      </span>
      {m.custoDoBeneficioCents > 0 && (
        <span className="block text-muted-foreground">
          o benefício custa {formatBRL(m.custoDoBeneficioCents)}
        </span>
      )}
      {/* O aviso inteiro deixava cada linha com cinco linhas de altura. Vira
          um selo; o texto abre no clique (ou toque) e aparece ao passar o
          mouse. Ele continua lá: é o que impede ler "100%" como notícia boa. */}
      {m.aviso && (
        <details className="mt-0.5">
          <summary
            title={m.aviso}
            className="w-fit cursor-pointer list-none rounded border border-amber-600/40 px-1 text-[11px] text-amber-700 dark:text-amber-400"
          >
            custo incompleto
          </summary>
          <span className="mt-0.5 block max-w-64 text-amber-700 dark:text-amber-400">{m.aviso}</span>
        </details>
      )}
    </span>
  );
}

type Filtro = "todos" | "sem_custo" | "desconto" | "sem_preco";

const SEM_ESPECIALIDADE = "Sem especialidade";

export function BenefitsEditor({
  companyId,
  procedures,
  benefits,
  margens,
  scopeLabel,
}: {
  companyId: string | null;
  procedures: ProcedimentoDoBeneficio[];
  benefits: BenefitView[];
  /** Margem por procedimento, na média da rede. Ausente = a coluna não aparece. */
  margens?: Map<string, MargemDaLinha>;
  scopeLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const porId = new Map(procedures.map((p) => [p.id, p]));
  const precoDe = (id: string) => porId.get(id)?.priceCents ?? null;
  // ⚠️ Procedimento que já tem benefício NÃO volta à lista do "Adicionar":
  // mudar o benefício dele é pelo Editar da linha (pedido do dono, 27/10/2026).
  const incluidos = new Set(benefits.map((b) => b.procedureId));
  const disponiveis = procedures.filter((p) => !incluidos.has(p.id));

  // O resumo é também o filtro (pedido do dono, 27/10/2026: "lista muito
  // longa, organizar para ficar mais fácil de navegar e visualizar").
  const semPreco = (b: BenefitView) => !((precoDe(b.procedureId) ?? 0) > 0);
  const atende: Record<Filtro, (b: BenefitView) => boolean> = {
    todos: () => true,
    sem_custo: (b) => b.benefitType === "FREE",
    desconto: (b) => b.benefitType === "DISCOUNT_PERCENT" || b.benefitType === "DISCOUNT_AMOUNT",
    sem_preco: semPreco,
  };
  const resumo: { chave: Filtro; rotulo: string }[] = [
    { chave: "todos", rotulo: `${benefits.length} benefício(s)` },
    { chave: "sem_custo", rotulo: `${benefits.filter(atende.sem_custo).length} sem custo` },
    { chave: "desconto", rotulo: `${benefits.filter(atende.desconto).length} com desconto` },
    { chave: "sem_preco", rotulo: `${benefits.filter(semPreco).length} sem preço cadastrado` },
  ];

  const procurando = busca.trim().length > 0;
  const visiveis = benefits.filter(
    (b) => atende[filtro](b) && (!procurando || atendeABusca(b.procedureName, busca))
  );
  // Blocos por ESPECIALIDADE (a mesma do cadastro de Procedimentos), em ordem
  // alfabética; o que não tem especialidade fica no fim.
  const blocos = new Map<string, BenefitView[]>();
  for (const b of visiveis) {
    const esp = porId.get(b.procedureId)?.specialty?.trim() || SEM_ESPECIALIDADE;
    blocos.set(esp, [...(blocos.get(esp) ?? []), b]);
  }
  const ordem = [...blocos.keys()].sort((x, y) =>
    x === SEM_ESPECIALIDADE ? 1 : y === SEM_ESPECIALIDADE ? -1 : x.localeCompare(y, "pt-BR")
  );
  // Procurando ou filtrando, os blocos com resultado já vêm abertos — senão a
  // pessoa digitaria e não veria nada mudar.
  const estaAberto = (esp: string) => procurando || filtro !== "todos" || abertos.has(esp);
  const alternar = (esp: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(esp)) n.delete(esp);
      else n.add(esp);
      return n;
    });

  function handleDelete(id: string) {
    startTransition(async () => {
      const r = await deleteProcedureBenefit(id, companyId);
      if (r.ok) {
        toast.success("Benefício removido.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Benefícios por procedimento — {scopeLabel}.
        </p>
        {disponiveis.length > 0 ? (
          <BenefitDialog companyId={companyId} procedures={disponiveis} />
        ) : (
          <Button size="sm" disabled title="Todos os procedimentos já têm benefício">
            Todos os procedimentos já têm benefício
          </Button>
        )}
      </div>

      {benefits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum benefício configurado.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar procedimento…"
                aria-label="Procurar procedimento com benefício"
                className="h-8 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar benefícios">
              {resumo.map((r) => (
                <Button
                  key={r.chave}
                  type="button"
                  size="sm"
                  variant={filtro === r.chave ? "default" : "outline"}
                  className="h-8 text-xs"
                  aria-pressed={filtro === r.chave}
                  onClick={() => setFiltro(r.chave)}
                >
                  {r.rotulo}
                </Button>
              ))}
            </div>
          </div>

          {visiveis.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum benefício com esse filtro{procurando ? " e essa busca" : ""}.
            </p>
          ) : (
            <div className="space-y-2">
              {!procurando && filtro === "todos" && (
                <div className="flex justify-end gap-3 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setAbertos(new Set(ordem))}
                  >
                    Abrir todas
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setAbertos(new Set())}
                  >
                    Fechar todas
                  </button>
                </div>
              )}
              {ordem.map((esp) => {
                const lista = blocos.get(esp) ?? [];
                const aberto = estaAberto(esp);
                return (
                  <div key={esp} className="rounded-lg border">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
                      aria-expanded={aberto}
                      onClick={() => alternar(esp)}
                    >
                      <ChevronRight
                        className={cn("size-4 transition-transform", aberto && "rotate-90")}
                      />
                      {esp}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({lista.length})
                      </span>
                    </button>
                    {aberto && (
                      <div className="overflow-x-auto border-t">
                        {/* Larguras fixas: um bloco embaixo do outro, as colunas
                            ficam alinhadas como se fosse uma tabela só. */}
                        <table className="w-full min-w-[720px] table-fixed text-sm">
                          <colgroup>
                            <col className="w-[21%]" />
                            <col className="w-[17%]" />
                            <col className="w-[21%]" />
                            <col className="w-[8%]" />
                            {margens && <col className="w-[21%]" />}
                            <col className="w-[12%]" />
                          </colgroup>
                          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Procedimento</th>
                              <th className="px-3 py-2 font-medium">Benefício</th>
                              <th className="px-3 py-2 font-medium">Preço</th>
                              <th className="px-3 py-2 font-medium">Parcelas</th>
                              {/* ⚠️ A MARGEM ENTRA AQUI porque é aqui que se decide o
                                  benefício. Numa tela separada, ninguém olharia na hora que
                                  importa — e o desconto sai inteiro da margem, porque o
                                  repasse ao dentista é FIXO e não cai junto. */}
                              {margens && <th className="px-3 py-2 font-medium">Margem (rede)</th>}
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {lista.map((b) => (
                              <tr key={b.id} className="border-b last:border-0">
                                <td className="px-3 py-2 font-medium">{b.procedureName}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {describeBenefit(b)}
                                </td>
                                <td className="px-3 py-2">
                                  <Precos b={b} precoCents={precoDe(b.procedureId)} />
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {b.maxInstallments ? `${b.maxInstallments}x` : "—"}
                                </td>
                                {margens && (
                                  <td className="px-3 py-2">
                                    <Margem m={margens.get(b.procedureId)} />
                                  </td>
                                )}
                                <td className="px-3 py-2 text-right">
                                  <span className="flex justify-end gap-1">
                                    <BenefitDialog companyId={companyId} procedures={[]} benefit={b} />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs text-destructive"
                                      disabled={isPending}
                                      aria-label={`Remover o benefício de ${b.procedureName}`}
                                      onClick={() => handleDelete(b.id)}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BenefitDialog({
  companyId,
  procedures,
  benefit,
}: {
  companyId: string | null;
  /** No "Adicionar": só os que ainda não têm benefício. No Editar, não é usada. */
  procedures: ProcedimentoDoBeneficio[];
  benefit?: BenefitView;
}) {
  const router = useRouter();
  const isEdit = Boolean(benefit);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [benefitType, setBenefitType] = useState<string>(
    benefit?.benefitType ?? "DISCOUNT_PERCENT"
  );
  const showValue =
    benefitType === "DISCOUNT_PERCENT" || benefitType === "DISCOUNT_AMOUNT";
  const valueLabel =
    benefitType === "DISCOUNT_AMOUNT" ? "Valor do desconto (R$)" : "Desconto (%)";
  const valueDefault =
    benefit?.benefitValue != null
      ? benefit.benefitType === "DISCOUNT_AMOUNT"
        ? (benefit.benefitValue / 100).toFixed(2).replace(".", ",")
        : String(benefit.benefitValue)
      : "";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await upsertProcedureBenefit(companyId, formData);
      if (r.ok) {
        toast.success("Benefício salvo.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Adicionar benefício
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar benefício" : "Novo benefício"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="procedure_id">Procedimento *</Label>
            {isEdit ? (
              <>
                <input type="hidden" name="procedure_id" value={benefit!.procedureId} />
                <p className="text-sm font-medium">{benefit!.procedureName}</p>
              </>
            ) : (
              <>
                <ListaComBusca
                  id="procedure_id"
                  name="procedure_id"
                  required
                  placeholder="Digite para procurar…"
                  aria-label="Procedimento"
                  options={procedures.map((p) => ({ value: p.id, label: p.name }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {procedures.length} procedimento(s) ainda sem benefício. Os que já
                  têm não aparecem aqui — use o Editar da linha.
                </p>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="benefit_type">Cobertura *</Label>
              <select
                id="benefit_type"
                name="benefit_type"
                value={benefitType}
                onChange={(e) => setBenefitType(e.target.value)}
                className={selectClass}
              >
                {BENEFIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BENEFIT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            {showValue && (
              <div>
                <Label htmlFor="benefit_value">{valueLabel}</Label>
                <Input
                  id="benefit_value"
                  name="benefit_value"
                  defaultValue={valueDefault}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="usage_limit_count">Usos</Label>
              <Input
                id="usage_limit_count"
                name="usage_limit_count"
                type="number"
                min={0}
                placeholder="ilimitado"
                defaultValue={benefit?.usageLimitCount ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="usage_period_months">A cada (meses)</Label>
              <Input
                id="usage_period_months"
                name="usage_period_months"
                type="number"
                min={0}
                placeholder="—"
                defaultValue={benefit?.usagePeriodMonths ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="grace_period_months">Carência (meses)</Label>
              <Input
                id="grace_period_months"
                name="grace_period_months"
                type="number"
                min={0}
                defaultValue={benefit?.gracePeriodMonths ?? 0}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="max_installments">Parcelamento (x) — opcional</Label>
            <Input
              id="max_installments"
              name="max_installments"
              type="number"
              min={1}
              max={24}
              placeholder="usa o da empresa"
              defaultValue={benefit?.maxInstallments ?? ""}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ex.: limpeza grátis a cada 6 meses = Cobertura “Sem custo”, Usos “1”, A
            cada “6”.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
