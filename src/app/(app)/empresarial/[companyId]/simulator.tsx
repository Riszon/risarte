"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatBRL } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdhesionPricing } from "@/lib/empresarial/pricing";
import { removeOverride } from "../configuracoes/actions";

/** Simulador de mensalidade — usa os preços efetivos da empresa. */
export function MonthlySimulator({ pricing }: { pricing: AdhesionPricing }) {
  const [holders, setHolders] = useState(1);
  const [individual, setIndividual] = useState(0);
  const [family, setFamily] = useState(0);
  const [extra, setExtra] = useState(0);
  const [extraDeps, setExtraDeps] = useState(0);

  const total =
    holders * pricing.holderFeeCents +
    individual * pricing.dependentIndividualFeeCents +
    family * pricing.dependentFamilyFeeCents +
    extra *
      (pricing.dependentFamilyFeeCents +
        extraDeps * pricing.dependentFamilyExtraFeeCents);

  const inputCls = "w-20";
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Simulador de mensalidade</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          Titulares
          <Input
            type="number"
            min={0}
            className={inputCls}
            value={holders}
            onChange={(e) => setHolders(Math.max(0, Number(e.target.value)))}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Plano individual
          <Input
            type="number"
            min={0}
            className={inputCls}
            value={individual}
            onChange={(e) => setIndividual(Math.max(0, Number(e.target.value)))}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Plano familiar (1–3)
          <Input
            type="number"
            min={0}
            className={inputCls}
            value={family}
            onChange={(e) => setFamily(Math.max(0, Number(e.target.value)))}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Familiar + extras
          <Input
            type="number"
            min={0}
            className={inputCls}
            value={extra}
            onChange={(e) => setExtra(Math.max(0, Number(e.target.value)))}
          />
        </label>
        {extra > 0 && (
          <label className="flex items-center justify-between gap-2 text-sm">
            Extras além de 3 (por colaborador)
            <Input
              type="number"
              min={0}
              className={inputCls}
              value={extraDeps}
              onChange={(e) => setExtraDeps(Math.max(0, Number(e.target.value)))}
            />
          </label>
        )}
      </div>
      <div className="flex items-baseline justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">Mensalidade estimada</span>
        <span className="text-2xl font-semibold text-gold">{formatBRL(total)}</span>
      </div>
    </div>
  );
}

export function RemoveOverrideButton({
  table,
  companyId,
  label,
}: {
  table: "adhesion_pricing" | "split_rules";
  companyId: string;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await removeOverride(table, companyId);
          if (r.ok) {
            toast.success("Voltou ao padrão da rede.");
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      {label}
    </Button>
  );
}
