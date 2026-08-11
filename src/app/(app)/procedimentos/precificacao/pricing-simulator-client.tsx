"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Search, TriangleAlert } from "lucide-react";
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
  payoutCents: number;
  materialsCents: number;
  labCents: number;
  notes: string;
};

export function PricingSimulator({
  clinicId,
  clinicName,
  settings,
  procedures,
}: {
  clinicId: string | null;
  clinicName: string | null;
  settings: {
    chairCostPerHourCents: number;
    taxPercent: number;
    avgAcquirerFeePercent: number;
    targetMarginPercent: number;
  };
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

  function openProcedure(p: Proc) {
    setOpenId(p.id === openId ? null : p.id);
    setMaterials(
      p.materialsCents ? (p.materialsCents / 100).toFixed(2).replace(".", ",") : ""
    );
    setLab(p.labCents ? (p.labCents / 100).toFixed(2).replace(".", ",") : "");
    setNotes(p.notes);
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

  function simFor(p: Proc, override?: { materials: number; lab: number }) {
    return simulatePrice({
      cost: {
        minutes: p.minutes,
        chairCostPerHourCents: chairCents,
        materialsCents: override?.materials ?? p.materialsCents,
        labCents: override?.lab ?? p.labCents,
        payoutCents: p.payoutCents,
      },
      taxPercent: num(tax),
      acquirerFeePercent: num(fee),
      targetMarginPercent: num(target),
      currentPriceCents: p.priceCents,
    });
  }

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

      {/* -- PROCEDIMENTOS ---------------------------------------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Procedimentos ({shown.length})</h2>
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

          <ul className="space-y-1">
            {shown.map((p) => {
              const sim = simFor(p);
              const open = openId === p.id;
              const liveSim = open
                ? simFor(p, {
                    materials: parseBRLToCents(materials) ?? 0,
                    lab: parseBRLToCents(lab) ?? 0,
                  })
                : sim;
              const warnings = simulationWarnings({
                cost: {
                  minutes: p.minutes,
                  chairCostPerHourCents: chairCents,
                  materialsCents: p.materialsCents,
                  labCents: p.labCents,
                  payoutCents: p.payoutCents,
                },
                taxPercent: num(tax),
                acquirerFeePercent: num(fee),
                targetMarginPercent: num(target),
                currentPriceCents: p.priceCents,
              });

              return (
                <li key={p.id} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() => openProcedure(p)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 p-2.5 text-left text-sm hover:bg-muted/40"
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

                  {open && (
                    <div className="space-y-3 border-t p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="block">
                          <Label className="text-[11px]">Material (R$)</Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            value={materials}
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
                          label="Material"
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

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatBRL(cents)}</dd>
    </div>
  );
}
