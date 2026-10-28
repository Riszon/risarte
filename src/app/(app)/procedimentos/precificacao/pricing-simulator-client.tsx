"use client";

import { useState, useTransition } from "react";
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
  FILTROS_DA_MARGEM,
  lerMargem,
  margemDeReferenciaDoMinimo,
  margemMinimaValida,
  margemNoPreco,
  passaNoFiltroDaMargem,
  simulatePrice,
  simulationWarnings,
  type FiltroDaMargem,
  type MargemNoPreco,
} from "@/lib/finance/pricing-simulator";
import {
  OCUPACAO_PADRAO,
  calcularHoraClinica,
  formatarPercentual,
  ocupacaoValida,
  porMesUsado,
  type HoraClinica,
} from "@/lib/finance/hora-clinica";
import { formatarHoras } from "@/lib/horas-da-agenda";
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
  /** Preço mínimo do cadastro (nulo = sem mínimo) — a conta também nele. */
  minPriceCents: number | null;
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
  minMarginReadable,
  suggestedFee,
  levels,
  procedures,
  horaClinica,
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
    /** A margem mínima (a do alerta de margem da negociação); nulo = sem. */
    minMarginPercent: number | null;
  };
  /** Falso = não deu para ler a margem mínima: o campo fica travado. */
  minMarginReadable: boolean;
  suggestedFee: {
    percent: number;
    feeCents: number;
    receivedCents: number;
    fromDate: string;
  } | null;
  levels: Level[];
  procedures: Proc[];
  /**
   * A hora clínica calculada da unidade (0330). Nula na Franqueadora (não há
   * cadeira): lá o campo segue digitado e vale para as unidades sem dados.
   */
  horaClinica: HoraClinica | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [chair, setChair] = useState(
    settings.chairCostPerHourCents
      ? (settings.chairCostPerHourCents / 100).toFixed(2).replace(".", ",")
      : ""
  );
  const [occupancy, setOccupancy] = useState(
    String(horaClinica?.ocupacaoEsperadaPercent ?? OCUPACAO_PADRAO).replace(".", ",")
  );
  const [tax, setTax] = useState(String(settings.taxPercent));
  const [fee, setFee] = useState(String(settings.avgAcquirerFeePercent));
  const [target, setTarget] = useState(String(settings.targetMarginPercent));
  const [minMargin, setMinMargin] = useState(
    settings.minMarginPercent === null ? "" : String(settings.minMarginPercent).replace(".", ",")
  );

  const [search, setSearch] = useState("");
  /** Filtro pela margem (pedido do dono, 27/10/2026). */
  const [filtro, setFiltro] = useState<FiltroDaMargem>("todos");
  const [openId, setOpenId] = useState<string | null>(null);
  const [materials, setMaterials] = useState("");
  const [lab, setLab] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Nível usado no PREÇO SUGERIDO. Começa no cadastro para não mudar sozinho
   *  o que a tela mostrava antes; o comparativo abaixo mostra todos. */
  const [simLevel, setSimLevel] = useState<string>(CATALOG);

  const num = (v: string) => Number(v.replace(",", ".")) || 0;
  const manualChairCents = parseBRLToCents(chair) ?? 0;
  // A HORA CLÍNICA (0330): calculada com a ocupação da tela (antes de salvar);
  // sem dados, o valor provisório digitado (HC3).
  const occupancyValue = num(occupancy);
  const occupancyProblem =
    horaClinica && !ocupacaoValida(occupancyValue) ? "A ocupação esperada vai de 1% a 100%." : null;
  const hora = horaClinica
    ? calcularHoraClinica({
        periodo: horaClinica.periodo,
        meses: horaClinica.meses,
        ocupacaoEsperadaPercent: occupancyValue,
        manualCents: manualChairCents,
        naoLido: horaClinica.naoLido,
      })
    : null;
  const chairCents = hora ? hora.efetivaCents : manualChairCents;
  // A régua do preço mínimo: a margem mínima, ou a desejada quando não há.
  const minMarginValue = minMargin.trim() === "" ? null : num(minMargin);
  const minTarget = margemDeReferenciaDoMinimo(num(target), minMarginValue);
  const minMarginProblem = margemMinimaValida(minMarginValue, num(target));

  /** A margem de um procedimento num preço (o normal ou o mínimo). */
  function margemDe(
    p: Proc,
    precoCents: number | null,
    levelId: string = simLevel,
    meta: number = num(target)
  ): MargemNoPreco | null {
    return margemNoPreco(
      {
        cost: {
          minutes: p.minutes,
          chairCostPerHourCents: chairCents,
          materialsCents: p.materialsCents,
          labCents: p.labCents,
          payoutCents: payoutFor(p, levelId),
        },
        taxPercent: num(tax),
        acquirerFeePercent: num(fee),
        targetMarginPercent: meta,
      },
      precoCents
    );
  }

  const buscados = (() => {
    const q = search.trim().toLowerCase();
    return q
      ? procedures.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.specialty ?? "").toLowerCase().includes(q)
        )
      : procedures;
  })();
  // O filtro olha a margem com o nível escolhido em "Simular com" e os custos e
  // metas da tela (mudou a margem desejada, a lista muda junto).
  const contagem = Object.fromEntries(
    (Object.keys(FILTROS_DA_MARGEM) as FiltroDaMargem[]).map((f) => [
      f,
      buscados.filter((p) =>
        passaNoFiltroDaMargem(f, margemDe(p, p.priceCents), margemDe(p, p.minPriceCents, simLevel, minTarget))
      ).length,
    ])
  ) as Record<FiltroDaMargem, number>;
  const shown = buscados.filter((p) =>
    passaNoFiltroDaMargem(filtro, margemDe(p, p.priceCents), margemDe(p, p.minPriceCents, simLevel, minTarget))
  );

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
        // O valor DIGITADO (o provisório) — a calculada não se grava: ela é
        // refeita a cada leitura, e gravada envelheceria em silêncio.
        chairCostPerHourCents: manualChairCents,
        expectedOccupancyPercent: horaClinica ? occupancyValue : undefined,
        taxPercent: num(tax),
        avgAcquirerFeePercent: num(fee),
        targetMarginPercent: num(target),
        // Sem conseguir ler, não mexe (undefined); vazio = sem margem mínima.
        minMarginPercent: minMarginReadable ? minMarginValue : undefined,
      });
      if (r.ok) {
        if (r.error) toast.info(r.error);
        else toast.success("Configuração salva.");
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
    opts?: { materials?: number; lab?: number; levelId?: string; priceCents?: number; targetPercent?: number }
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
      targetMarginPercent: opts?.targetPercent ?? num(target),
      currentPriceCents: opts?.priceCents ?? p.priceCents,
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
          {hora && (
            <QuadroDaHoraClinica
              hora={hora}
              occupancy={occupancy}
              setOccupancy={setOccupancy}
              occupancyProblem={occupancyProblem}
              chair={chair}
              setChair={setChair}
            />
          )}
          <div className={cn("grid gap-2", hora ? "sm:grid-cols-4" : "sm:grid-cols-5")}>
            {!hora && (
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
            )}
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
            <label className="block">
              <Label className="text-[11px]">Margem mínima (%)</Label>
              <Input
                className="h-8"
                inputMode="decimal"
                value={minMargin}
                disabled={!minMarginReadable}
                placeholder="sem mínima"
                onChange={(e) => setMinMargin(e.target.value)}
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O <strong>preço normal</strong> se mede pela margem <strong>desejada</strong>; o{" "}
            <strong>preço mínimo</strong>, pela margem <strong>mínima</strong> (em branco = pela
            desejada). A margem mínima é a mesma do <strong>alerta de margem</strong> da negociação e
            da venda direta — salvar aqui liga aquele aviso. Lá a conta é a mesma desta tela
            (cadeira, material, repasse e imposto + taxa), então o percentual vale o mesmo.
            {!minMarginReadable && " Não consegui ler a margem mínima agora: o campo fica travado."}
          </p>
          {minMarginProblem && <p className="text-xs text-destructive">{minMarginProblem}</p>}

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
            <Button size="sm" disabled={isPending || Boolean(minMarginProblem)} onClick={saveSettings}>
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
              <label className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">Mostrar</span>
                <select
                  aria-label="Filtrar pela margem"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value as FiltroDaMargem)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {(Object.keys(FILTROS_DA_MARGEM) as FiltroDaMargem[]).map((f) => (
                    <option key={f} value={f}>
                      {FILTROS_DA_MARGEM[f]} ({contagem[f]})
                    </option>
                  ))}
                </select>
              </label>
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
                          {pct(sim.currentMarginPercent)}
                        </span>
                        {(() => {
                          // A mesma conta no preço MÍNIMO, quando há.
                          const m = margemDe(p, p.minPriceCents, simLevel, minTarget);
                          if (!m) return null;
                          return (
                            <span className="text-muted-foreground">
                              mín {formatBRL(m.precoCents)}{" "}
                              <span className={cn("font-medium", corDaMargem(m))}>{pct(m.margemPercent)}</span>
                            </span>
                          );
                        })()}
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

                      {/* Pedido do dono (27/10/2026): a conta no preço normal
                          e no mínimo, lado a lado. */}
                      <NormalEMinimo
                        normal={lerMargem(liveSim, p.priceCents, num(tax) + num(fee))}
                        minimo={
                          p.minPriceCents
                            ? lerMargem(
                                simFor(p, {
                                  materials: !p.fromKit ? (parseBRLToCents(materials) ?? 0) : undefined,
                                  lab: parseBRLToCents(lab) ?? 0,
                                  priceCents: p.minPriceCents,
                                  targetPercent: minTarget,
                                }),
                                p.minPriceCents,
                                num(tax) + num(fee)
                              )
                            : null
                        }
                        temMinimo={p.minPriceCents !== null}
                        directCents={liveSim.breakdown.directCents}
                        metaNormal={num(target)}
                        metaMinimo={minTarget}
                        temMargemMinima={minMarginValue !== null}
                      />

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
                          simulateNoMinimo={
                            p.minPriceCents
                              ? (levelId) =>
                                  simFor(p, {
                                    materials: open
                                      ? (parseBRLToCents(materials) ?? 0)
                                      : undefined,
                                    lab: open ? (parseBRLToCents(lab) ?? 0) : undefined,
                                    levelId,
                                    priceCents: p.minPriceCents ?? undefined,
                                    targetPercent: minTarget,
                                  })
                              : null
                          }
                          minPriceCents={p.minPriceCents}
                          targetPercent={num(target)}
                          minTargetPercent={minTarget}
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
                            {pct(liveSim.currentMarginPercent)} de margem
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
  simulateNoMinimo,
  minPriceCents,
  targetPercent,
  minTargetPercent,
}: {
  proc: Proc;
  levels: Level[];
  currentPriceCents: number;
  simulate: (levelId: string) => ReturnType<typeof simulatePrice>;
  /** A mesma conta no preço mínimo (nulo = sem mínimo). */
  simulateNoMinimo: ((levelId: string) => ReturnType<typeof simulatePrice>) | null;
  minPriceCents: number | null;
  targetPercent: number;
  /** A régua do preço mínimo (a margem mínima, ou a desejada). */
  minTargetPercent: number;
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
        No preço de hoje ({formatBRL(currentPriceCents)})
        {minPriceCents ? ` e no mínimo (${formatBRL(minPriceCents)})` : ""}, por quem executa
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
                {pct(s.currentMarginPercent)}
              </span>
              {simulateNoMinimo && (() => {
                const m = simulateNoMinimo(l.id);
                return (
                  <span className="ml-1 text-muted-foreground">
                    · no mínimo{" "}
                    <span
                      className={cn(
                        "font-medium",
                        m.currentIsLoss
                          ? "text-destructive"
                          : m.currentMarginPercent < minTargetPercent
                            ? "text-amber-700"
                            : "text-emerald-700"
                      )}
                    >
                      {pct(m.currentMarginPercent)}
                    </span>
                  </span>
                );
              })()}
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

/** "33,33%" — o percentual como se lê no Brasil (o número cru sairia "33.33%"). */
function pct(n: number): string {
  return `${String(n).replace(".", ",")}%`;
}

/** Verde na meta, âmbar abaixo dela, vermelho no prejuízo — as cores da lista. */
function corDaMargem(m: { prejuizo: boolean; abaixoDaMeta: boolean }): string {
  return m.prejuizo ? "text-destructive" : m.abaixoDaMeta ? "text-amber-700" : "text-emerald-700";
}

/**
 * Preço normal × preço mínimo, lado a lado (pedido do dono, 27/10/2026): o
 * custo direto é o mesmo; imposto e taxa acompanham o preço; o que sobra é a
 * margem. O mínimo é o pior caso da negociação.
 */
function NormalEMinimo({
  normal,
  minimo,
  temMinimo,
  directCents,
  metaNormal,
  metaMinimo,
  temMargemMinima,
}: {
  normal: MargemNoPreco | null;
  minimo: MargemNoPreco | null;
  temMinimo: boolean;
  directCents: number;
  /** A régua de cada coluna: desejada no normal, mínima no mínimo. */
  metaNormal: number;
  metaMinimo: number;
  temMargemMinima: boolean;
}) {
  if (!normal) return null;
  const colunas = minimo ? [normal, minimo] : [normal];
  return (
    <div className="rounded-lg border bg-muted/20 p-2 text-xs">
      <table className="w-full tabular-nums">
        <thead className="text-[10px] text-muted-foreground">
          <tr>
            <th className="py-0.5 text-left font-medium" />
            <th className="py-0.5 text-right font-medium">Preço normal</th>
            {minimo && <th className="py-0.5 text-right font-medium">Preço mínimo</th>}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-0.5 text-muted-foreground">Preço</td>
            {colunas.map((c, i) => (
              <td key={i} className="py-0.5 text-right">{formatBRL(c.precoCents)}</td>
            ))}
          </tr>
          <tr>
            <td className="py-0.5 text-muted-foreground">− Custo direto</td>
            {colunas.map((_, i) => (
              <td key={i} className="py-0.5 text-right">{formatBRL(directCents)}</td>
            ))}
          </tr>
          <tr>
            <td className="py-0.5 text-muted-foreground">− Imposto + taxa</td>
            {colunas.map((c, i) => (
              <td key={i} className="py-0.5 text-right">{formatBRL(c.impostoETaxaCents)}</td>
            ))}
          </tr>
          <tr className="border-t font-medium">
            <td className="py-0.5">= Margem</td>
            {colunas.map((c, i) => (
              <td key={i} className={cn("py-0.5 text-right", corDaMargem(c))}>
                {formatBRL(c.margemCents)} ({pct(c.margemPercent)})
              </td>
            ))}
          </tr>
          <tr className="text-[10px] text-muted-foreground">
            <td className="py-0.5">Meta</td>
            <td className="py-0.5 text-right">desejada {pct(metaNormal)}</td>
            {minimo && (
              <td className="py-0.5 text-right">
                {temMargemMinima ? `mínima ${pct(metaMinimo)}` : `desejada ${pct(metaMinimo)} (sem mínima)`}
              </td>
            )}
          </tr>
        </tbody>
      </table>
      {!temMinimo && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Sem preço mínimo no cadastro — a conta no mínimo aparece quando ele for definido.
        </p>
      )}
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

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function nomeDoMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_CURTOS[m - 1]}/${y}`;
}

/**
 * A HORA CLÍNICA DA UNIDADE (pedido do dono, 27/10/2026; 0330): o número e a
 * conta inteira à vista — custo fixo ÷ (horas de cadeira × ocupação esperada),
 * dos últimos 3 meses fechados. Sem dados, vale o valor provisório.
 */
function QuadroDaHoraClinica({
  hora,
  occupancy,
  setOccupancy,
  occupancyProblem,
  chair,
  setChair,
}: {
  hora: HoraClinica;
  occupancy: string;
  setOccupancy: (v: string) => void;
  occupancyProblem: string | null;
  chair: string;
  setChair: (v: string) => void;
}) {
  const calculada = hora.origem === "calculada";
  const periodo = `${nomeDoMes(hora.periodo.meses[0])} a ${nomeDoMes(hora.periodo.meses[hora.periodo.meses.length - 1])}`;
  const mensal = (v: number) => Math.round(porMesUsado(v, hora));
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem]">
          <span className="block text-[11px] text-muted-foreground">Hora clínica (hora de cadeira)</span>
          <span className="text-lg font-semibold tabular-nums">
            {hora.efetivaCents > 0 ? `${formatBRL(hora.efetivaCents)}/h` : "—"}
          </span>
          <span
            className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium",
              calculada
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            )}
          >
            {calculada ? "calculada" : hora.origem === "provisoria" ? "provisória (digitada)" : "sem valor"}
          </span>
        </div>
        <label className="block w-36">
          <Label className="text-[11px]">Ocupação esperada (%)</Label>
          <Input
            className="h-8"
            inputMode="decimal"
            value={occupancy}
            onChange={(e) => setOccupancy(e.target.value)}
          />
        </label>
        <label className="block w-40">
          <Label className="text-[11px]">Valor provisório (R$/h)</Label>
          <Input
            className="h-8"
            inputMode="decimal"
            value={chair}
            onChange={(e) => setChair(e.target.value)}
            placeholder="180,00"
          />
        </label>
      </div>
      {occupancyProblem && <p className="text-destructive">{occupancyProblem}</p>}
      {calculada ? (
        <div className="space-y-1">
          <p>
            <strong>Como é calculada</strong> ({periodo}
            {hora.mesesUsados.length < hora.periodo.meses.length &&
              `; ${hora.mesesUsados.length} de ${hora.periodo.meses.length} meses tinham custo e agenda`}
            ):
          </p>
          <p className="tabular-nums">
            Custo fixo {formatBRL(mensal(hora.custoFixoCents))}/mês
            {hora.depreciacaoCents > 0 && ` + depreciação ${formatBRL(mensal(hora.depreciacaoCents))}/mês`}{" "}
            ÷ ({formatarHoras(mensal(hora.minutosCadeira))} de cadeira/mês ×{" "}
            {formatarPercentual(hora.ocupacaoEsperadaPercent)} de ocupação ={" "}
            {formatarHoras(mensal(hora.minutosClinicos))} clínicas/mês) ={" "}
            <strong>{formatBRL(hora.efetivaCents)}/h</strong>
          </p>
          <p className="text-muted-foreground">
            {hora.horaRealCents !== null ? (
              <>
                Na ocupação de verdade ({formatarPercentual(hora.ocupacaoRealPercent)} das horas de
                cadeira, pelos atendimentos concluídos), a hora custou{" "}
                <strong>{formatBRL(hora.horaRealCents)}/h</strong>. É comparação: o preço usa a
                ocupação esperada, para um mês fraco não encarecer tudo.
              </>
            ) : (
              "Sem atendimentos concluídos nesses meses: não há hora real para comparar."
            )}
          </p>
          <p className="text-muted-foreground">
            O custo fixo é o das contas marcadas como <strong>fixo</strong> no Plano de contas (o mesmo
            do Ponto de equilíbrio), mais a depreciação dos bens. Material, laboratório, repasse,
            taxa e imposto ficam de fora — eles já entram em cada procedimento. As horas de cadeira
            são as do Planejamento Anual. O valor provisório só vale se faltar dado.
          </p>
        </div>
      ) : (
        <p className="text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mr-1 inline size-3.5" />
          Ainda não dá para calcular ({periodo}): {hora.motivo}{" "}
          {hora.origem === "provisoria"
            ? "Enquanto isso vale o valor provisório."
            : "Informe um valor provisório — sem ele a conta ignora a estrutura."}
        </p>
      )}
    </div>
  );
}
