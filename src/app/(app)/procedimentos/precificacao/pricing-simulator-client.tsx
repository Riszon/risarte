"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Search, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  simulatePrice,
  simulationWarnings,
} from "@/lib/finance/pricing-simulator";
import { CommissionPanel, ReadjustPanel } from "../bulk-panels";
import {
  applySuggestedPrice,
  saveCostSettings,
  saveProcedureCost,
} from "./actions";

type Proc = {
  id: string;
  name: string;
  specialty: string | null;
  priceCents: number;
  minutes: number;
  /** Repasse do cadastro do procedimento (degrau 3/4). */
  payoutCents: number;
  /** 0212: repasse vigente por nível de carreira. */
  payoutByLevel: Record<string, { amountCents: number; source: string }>;
  materialsCents: number;
  labCents: number;
  notes: string;
  /** 0216: material vindo dos KITS (calculado), não do valor digitado. */
  fromKit: boolean;
  kitCount: number;
  itemsWithoutCost: number;
};

type Level = { id: string; name: string };

/** Chave do seletor quando se simula sem nível (só o cadastro). */
const CATALOG = "__catalogo__";

function fmtCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function PricingSimulator({
  clinicId,
  clinicName,
  canManageCatalog,
  specialties,
  settings,
  suggestedFee,
  levels,
  procedures,
}: {
  clinicId: string | null;
  clinicName: string | null;
  canManageCatalog: boolean;
  specialties: string[];
  settings: {
    chairCostPerHourCents: number;
    taxPercent: number;
    avgAcquirerFeePercent: number;
    targetMarginPercent: number;
  };
  suggestedFee: {
    percent: number;
    feeCents: number;
    receivedCents: number;
    fromDate: string;
  } | null;
  levels: Level[];
  procedures: Proc[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [chair, setChair] = useState(
    settings.chairCostPerHourCents
      ? (settings.chairCostPerHourCents / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [tax, setTax] = useState(String(settings.taxPercent));
  const [fee, setFee] = useState(String(settings.avgAcquirerFeePercent));
  const [target, setTarget] = useState(String(settings.targetMarginPercent));

  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [materials, setMaterials] = useState("");
  const [lab, setLab] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Nível usado no PREÇO SUGERIDO. Começa no cadastro para não mudar sozinho
   *  o que a tela mostrava antes; o comparativo abaixo mostra todos. */
  const [simLevel, setSimLevel] = useState<string>(CATALOG);

  const num = (v: string) => Number(v.replace(",", ".")) || 0;
  const chairCents = parseBRLToCents(chair) ?? 0;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? procedures.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.specialty ?? "").toLowerCase().includes(q)
        )
      : procedures;
  }, [procedures, search]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openProcedure(p: Proc) {
    setOpenId(p.id === openId ? null : p.id);
    setMaterials(
      p.materialsCents ? (p.materialsCents / 100).toFixed(2).replace(".", ",") : ""
    );
    setLab(p.labCents ? (p.labCents / 100).toFixed(2).replace(".", ",") : "");
    setNotes(p.notes);
  }

  /** Repasse a usar para este procedimento, no nível escolhido. */
  function payoutFor(p: Proc, levelId: string): number {
    if (levelId === CATALOG) return p.payoutCents;
    return p.payoutByLevel[levelId]?.amountCents ?? p.payoutCents;
  }

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

  function saveSettings() {
    startTransition(async () => {
      const r = await saveCostSettings({
        clinicId,
        chairCostPerHourCents: chairCents,
        taxPercent: num(tax),
        avgAcquirerFeePercent: num(fee),
        targetMarginPercent: num(target),
      });
      if (r.ok) {
        toast.success("Configuração salva.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function saveCost(p: Proc) {
    startTransition(async () => {
      const r = await saveProcedureCost({
        clinicId,
        procedureId: p.id,
        materialsCents: parseBRLToCents(materials) ?? 0,
        labCents: parseBRLToCents(lab) ?? 0,
        notes,
      });
      if (r.ok) {
        toast.success("Custo salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function applyPrice(p: Proc, priceCents: number) {
    startTransition(async () => {
      const r = await applySuggestedPrice({
        procedureId: p.id,
        priceCents,
      });
      if (r.ok) {
        toast.success(`Preço de ${p.name} atualizado para ${formatBRL(priceCents)}.`);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function simFor(
    p: Proc,
    opts?: { materials?: number; lab?: number; levelId?: string }
  ) {
    return simulatePrice({
      cost: {
        minutes: p.minutes,
        chairCostPerHourCents: chairCents,
        materialsCents: opts?.materials ?? p.materialsCents,
        labCents: opts?.lab ?? p.labCents,
        payoutCents: payoutFor(p, opts?.levelId ?? simLevel),
      },
      taxPercent: num(tax),
      acquirerFeePercent: num(fee),
      targetMarginPercent: num(target),
      currentPriceCents: p.priceCents,
    });
  }

  const feeIsSuggestion =
    suggestedFee !== null && Math.abs(num(fee) - suggestedFee.percent) > 0.005;

  return (
    <div className={cn("space-y-5", isPending && "opacity-70")}>
      {/* -- CUSTOS DA UNIDADE ------------------------------------------ */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="font-medium">
              Custos e metas {clinicName ? `— ${clinicName}` : "da rede"}
            </h2>
            <p className="text-xs text-muted-foreground">
              A hora de cadeira dilui o que a clínica gasta para existir —
              aluguel, luz, equipe indireta. Sem ela, todo procedimento parece
              mais lucrativo do que é.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block">
              <Label className="text-[11px]">Hora de cadeira (R$)</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={chair}
                onChange={(e) => setChair(e.target.value)}
                placeholder="180,00"
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Imposto (%)</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Taxa média do pagamento (%)</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            </label>
            <label className="block">
              <Label className="text-[11px]">Margem desejada (%)</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
          </div>

          {/* 0212 — a taxa média não precisa ser chutada: o razão já sabe. */}
          <div className="rounded-lg border bg-muted/30 p-2 text-xs">
            {suggestedFee ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>Taxa média dos últimos 90 dias: </strong>
                  {suggestedFee.percent.toFixed(2).replace(".", ",")}%
                  <span className="ml-1 text-muted-foreground">
                    ({formatBRL(suggestedFee.feeCents)} de taxa sobre{" "}
                    {formatBRL(suggestedFee.receivedCents)} recebidos)
                  </span>
                </span>
                {feeIsSuggestion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      setFee(
                        suggestedFee.percent.toFixed(2).replace(".", ",")
                      )
                    }
                  >
                    <Sparkles className="mr-1 size-3.5" />
                    Usar esta taxa
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">
                Ainda não dá para sugerir a taxa média: não há taxa de
                adquirente lançada nos últimos 90 dias nesta unidade. Enquanto
                isso, informe à mão — um &quot;0%&quot; aqui seria lido como
                &quot;não pago taxa&quot;.
              </span>
            )}
          </div>

          {num(tax) + num(fee) + num(target) >= 100 && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              Imposto + taxa + margem somam {num(tax) + num(fee) + num(target)}%
              — nenhum preço fecha essa conta. Tudo o que entrasse já estaria
              comprometido.
            </p>
          )}
          <div className="flex justify-end">
            <Button size="sm" disabled={isPending} onClick={saveSettings}>
              Salvar configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* -- AJUSTES EM MASSA (vieram do catálogo, 0212) ----------------- */}
      {canManageCatalog && (
        <>
          <ReadjustPanel
            specialties={specialties}
            selectedCount={selected.size}
            isPending={isPending}
            run={run}
            getSelectedIds={() => [...selected]}
            onDone={() => setSelected(new Set())}
          />
          <CommissionPanel
            specialties={specialties}
            selectedCount={selected.size}
            isPending={isPending}
            run={run}
            getSelectedIds={() => [...selected]}
            onDone={() => setSelected(new Set())}
          />
        </>
      )}

      {/* -- PROCEDIMENTOS ---------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Procedimentos ({shown.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              {levels.length > 0 && (
                <label className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground">Simular com</span>
                  <select
                    value={simLevel}
                    onChange={(e) => setSimLevel(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value={CATALOG}>Repasse do cadastro</option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-56 pl-7"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar procedimento"
                />
              </div>
            </div>
          </div>

          <ul className="space-y-1">
            {shown.map((p) => {
              const sim = simFor(p);
              const open = openId === p.id;
              // Com kit, o material não é editável aqui: mexer no número sem
              // mexer no kit criaria de novo a divergência que a 0216 tirou.
              const liveSim =
                open && !p.fromKit
                  ? simFor(p, {
                      materials: parseBRLToCents(materials) ?? 0,
                      lab: parseBRLToCents(lab) ?? 0,
                    })
                  : open
                    ? simFor(p, { lab: parseBRLToCents(lab) ?? 0 })
                    : sim;
              const warnings = simulationWarnings({
                cost: {
                  minutes: p.minutes,
                  chairCostPerHourCents: chairCents,
                  materialsCents: p.materialsCents,
                  labCents: p.labCents,
                  payoutCents: payoutFor(p, simLevel),
                },
                taxPercent: num(tax),
                acquirerFeePercent: num(fee),
                targetMarginPercent: num(target),
                currentPriceCents: p.priceCents,
              });

              return (
                <li key={p.id} className="rounded-lg border">
                  <div className="flex items-center gap-2 pl-2.5">
                    {canManageCatalog && (
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Selecionar ${p.name}`}
                        className="size-4 shrink-0 accent-primary"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => openProcedure(p)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 p-2.5 pl-1 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="min-w-0">
                        {p.name}
                        {p.specialty && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {p.specialty}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-xs tabular-nums">
                        <span className="text-muted-foreground">
                          custo {formatBRL(sim.breakdown.directCents)}
                        </span>
                        <span>preço {formatBRL(p.priceCents)}</span>
                        <span
                          className={cn(
                            "font-medium",
                            sim.currentIsLoss
                              ? "text-destructive"
                              : sim.belowTarget
                                ? "text-amber-700"
                                : "text-emerald-700"
                          )}
                        >
                          {sim.currentMarginPercent}%
                        </span>
                      </span>
                    </button>
                  </div>

                  {open && (
                    <div className="space-y-3 border-t p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="block">
                          <Label className="text-[11px]">
                            Material (R$)
                            {p.fromKit && (
                              <span className="ml-1 text-muted-foreground">
                                — do kit
                              </span>
                            )}
                          </Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={p.fromKit ? fmtCents(p.materialsCents) : materials}
                            disabled={p.fromKit}
                            onChange={(e) => setMaterials(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">Laboratório (R$)</Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={lab}
                            onChange={(e) => setLab(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <Label className="text-[11px]">Observação</Label>
                          <Input
                            className="h-8"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                          />
                        </label>
                      </div>

                      <dl className="space-y-0.5 rounded-lg border bg-muted/30 p-2 text-xs">
                        <Row
                          label={`Cadeira (${p.minutes} min)`}
                          cents={liveSim.breakdown.chairCents}
                        />
                        <Row
                          label={
                            p.fromKit
                              ? `Material (${p.kitCount} kit${p.kitCount === 1 ? "" : "s"})`
                              : "Material"
                          }
                          cents={liveSim.breakdown.materialsCents}
                        />
                        <Row
                          label="Laboratório"
                          cents={liveSim.breakdown.labCents}
                        />
                        <Row
                          label="Repasse do dentista"
                          cents={liveSim.breakdown.payoutCents}
                        />
                        <div className="flex justify-between border-t pt-1 font-medium">
                          <dt>Custo direto</dt>
                          <dd className="tabular-nums">
                            {formatBRL(liveSim.breakdown.directCents)}
                          </dd>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <dt>
                            Imposto + taxa + margem ({liveSim.proportionalPercent}
                            %)
                          </dt>
                          <dd>sobre o preço</dd>
                        </div>
                      </dl>

                      {/* 0212 — o resultado muda com QUEM executa. Como o
                          repasse é fixo, trocar o dentista mexe na margem sem
                          mexer no preço; sem esta linha ninguém enxerga isso. */}
                      {levels.length > 0 && (
                        <LevelComparison
                          proc={p}
                          levels={levels}
                          currentPriceCents={p.priceCents}
                          simulate={(levelId) =>
                            simFor(p, {
                              materials: open
                                ? (parseBRLToCents(materials) ?? 0)
                                : undefined,
                              lab: open ? (parseBRLToCents(lab) ?? 0) : undefined,
                              levelId,
                            })
                          }
                          targetPercent={num(target)}
                        />
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-sm">
                        <span>
                          Preço sugerido:{" "}
                          <strong className="text-base">
                            {liveSim.suggestedPriceCents !== null
                              ? formatBRL(liveSim.suggestedPriceCents)
                              : "—"}
                          </strong>
                          <span className="ml-2 text-xs text-muted-foreground">
                            hoje {formatBRL(p.priceCents)} ·{" "}
                            {liveSim.currentMarginPercent}% de margem
                          </span>
                        </span>
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => saveCost(p)}
                          >
                            Salvar custo
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={
                              isPending || liveSim.suggestedPriceCents === null
                            }
                            onClick={() =>
                              applyPrice(p, liveSim.suggestedPriceCents ?? 0)
                            }
                          >
                            <Check className="mr-1 size-3.5" />
                            Aplicar preço
                          </Button>
                        </span>
                      </div>

                      {p.fromKit && (
                        <p className="rounded-lg border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                          O material vem dos <strong>kits</strong> deste
                          procedimento, ao custo médio da unidade, e é calculado
                          na hora — não há valor guardado para envelhecer. Para
                          mudá-lo, mude o kit em <strong>Estoque</strong>.
                          {p.itemsWithoutCost > 0 && (
                            <>
                              {" "}
                              <span className="text-amber-800">
                                {p.itemsWithoutCost}{" "}
                                {p.itemsWithoutCost === 1
                                  ? "item do kit está sem custo"
                                  : "itens do kit estão sem custo"}{" "}
                                (nunca houve entrada com valor) — o custo real é
                                maior que este.
                              </span>
                            </>
                          )}
                        </p>
                      )}

                      {warnings.length > 0 && (
                        <ul className="space-y-0.5 text-[11px] text-amber-800">
                          {warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Júnior × sênior no MESMO preço.
 *
 * O repasse é fixo por procedimento, então quem executa não muda o que o
 * cliente paga — muda o que sobra. Um procedimento saudável na mão do júnior
 * pode dar prejuízo na mão do sênior, e essa conta nunca esteve em lugar
 * nenhum do sistema.
 */
function LevelComparison({
  proc,
  levels,
  currentPriceCents,
  simulate,
  targetPercent,
}: {
  proc: Proc;
  levels: Level[];
  currentPriceCents: number;
  simulate: (levelId: string) => ReturnType<typeof simulatePrice>;
  targetPercent: number;
}) {
  if (currentPriceCents <= 0) {
    return (
      <p className="rounded-lg border bg-muted/20 p-2 text-[11px] text-muted-foreground">
        Sem preço cadastrado — não há margem para comparar entre os níveis.
      </p>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-2 text-xs">
      <p className="mb-1 font-medium">
        No preço de hoje ({formatBRL(currentPriceCents)}), por quem executa
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {levels.map((l) => {
          const s = simulate(l.id);
          const own = proc.payoutByLevel[l.id]?.source === "nivel";
          return (
            <li key={l.id} className="tabular-nums">
              <span className="text-muted-foreground">{l.name}:</span>{" "}
              <span
                className={cn(
                  "font-medium",
                  s.currentIsLoss
                    ? "text-destructive"
                    : s.currentMarginPercent < targetPercent
                      ? "text-amber-700"
                      : "text-emerald-700"
                )}
              >
                {s.currentMarginPercent}%
              </span>
              <span className="ml-1 text-muted-foreground">
                (repasse {formatBRL(s.breakdown.payoutCents)}
                {!own && ", do cadastro"})
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-muted-foreground">
        &quot;do cadastro&quot; = este nível não tem valor próprio na tabela de
        repasse e está herdando a comissão do procedimento — todos custam igual
        até alguém cadastrar.
      </p>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatBRL(cents)}</dd>
    </div>
  );
}
