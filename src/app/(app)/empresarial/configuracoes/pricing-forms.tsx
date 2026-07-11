"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdhesionPricing, SplitRules } from "@/lib/empresarial/pricing";
import { saveAdhesionPricing, saveSplitRules } from "./actions";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function AdhesionPricingForm({
  companyId,
  pricing,
}: {
  companyId: string | null;
  pricing: AdhesionPricing;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveAdhesionPricing(companyId, formData);
      if (r.ok) {
        toast.success("Preços de adesão salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="holder_fee">Titular (R$)</Label>
          <Input
            id="holder_fee"
            name="holder_fee"
            defaultValue={centsToInput(pricing.holderFeeCents)}
          />
        </div>
        <div>
          <Label htmlFor="dependent_individual_fee">
            Dependente individual (R$)
          </Label>
          <Input
            id="dependent_individual_fee"
            name="dependent_individual_fee"
            defaultValue={centsToInput(pricing.dependentIndividualFeeCents)}
          />
        </div>
        <div>
          <Label htmlFor="dependent_family_fee">
            Dependente familiar (1–3) (R$)
          </Label>
          <Input
            id="dependent_family_fee"
            name="dependent_family_fee"
            defaultValue={centsToInput(pricing.dependentFamilyFeeCents)}
          />
        </div>
        <div>
          <Label htmlFor="dependent_family_extra_fee">
            Familiar extra (cada além de 3) (R$)
          </Label>
          <Input
            id="dependent_family_extra_fee"
            name="dependent_family_extra_fee"
            defaultValue={centsToInput(pricing.dependentFamilyExtraFeeCents)}
          />
        </div>
        <div>
          <Label htmlFor="max_installments">Parcelamento máximo (x)</Label>
          <Input
            id="max_installments"
            name="max_installments"
            type="number"
            min={1}
            max={24}
            defaultValue={pricing.maxInstallments}
          />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Salvando..." : "Salvar preços"}
      </Button>
    </form>
  );
}

export function SplitRulesForm({
  companyId,
  split,
}: {
  companyId: string | null;
  split: SplitRules;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstRisarte, setFirstRisarte] = useState(split.firstPaymentRisartePct);
  const [recRisarte, setRecRisarte] = useState(split.recurringRisartePct);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveSplitRules(companyId, formData);
      if (r.ok) {
        toast.success("Regras de split salvas.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">
          1º pagamento (adesão + implantação)
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="first_payment_risarte_pct">Risarte (%)</Label>
            <Input
              id="first_payment_risarte_pct"
              name="first_payment_risarte_pct"
              type="number"
              min={0}
              max={100}
              value={firstRisarte}
              onChange={(e) => setFirstRisarte(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>RisLife (%)</Label>
            <p className="flex h-9 items-center text-sm text-muted-foreground">
              {100 - (firstRisarte || 0)}%
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">Mensalidades</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="recurring_risarte_pct">Risarte (%)</Label>
            <Input
              id="recurring_risarte_pct"
              name="recurring_risarte_pct"
              type="number"
              min={0}
              max={100}
              value={recRisarte}
              onChange={(e) => setRecRisarte(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>RisLife (%)</Label>
            <p className="flex h-9 items-center text-sm text-muted-foreground">
              {100 - (recRisarte || 0)}%
            </p>
          </div>
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Salvando..." : "Salvar split"}
      </Button>
    </form>
  );
}
