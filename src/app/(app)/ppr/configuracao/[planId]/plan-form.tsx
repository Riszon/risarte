"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import {
  PPR_RECURRING_METHODS,
  PPR_RECURRING_METHOD_LABELS,
} from "@/lib/ppr/constants";
import { savePprPlan } from "../actions";

export type PprPlanFull = {
  id: string;
  name: string;
  description: string | null;
  monthly_cents: number;
  allows_dependents: boolean;
  included_dependents: number;
  allows_extra_dependents: boolean;
  extra_dependent_cents: number;
  max_dependents: number | null;
  cash_discount_percent: number;
  max_installments: number;
  min_installment_cents: number;
  allowed_methods: string[] | null;
  recurring_methods: string[] | null;
  grace_period_days: number;
  social_enabled: boolean;
  social_points_per_cents: number;
  is_active: boolean;
  sort_order: number;
};

/** Centavos → "1.234,56" para preencher o campo. */
function brl(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function PprPlanForm({ plan }: { plan: PprPlanFull }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [allowsDependents, setAllowsDependents] = useState(
    plan.allows_dependents
  );
  const [allowsExtra, setAllowsExtra] = useState(plan.allows_extra_dependents);
  const [social, setSocial] = useState(plan.social_enabled);

  function save(form: FormData) {
    startTransition(async () => {
      const r = await savePprPlan(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Plano salvo.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Dados e regras do plano</CardTitle>
        <p className="text-sm text-muted-foreground">
          Mensalidade, dependentes e as condições de pagamento que o beneficiário
          ganha nos tratamentos — elas ficam <strong>acima</strong> da regra
          comercial da rede e da unidade.
        </p>
      </CardHeader>
      <CardContent>
        <form action={save} className="space-y-5">
          <input type="hidden" name="id" value={plan.id} />

          {/* Identificação -------------------------------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do plano">
              <Input name="name" defaultValue={plan.name} required />
            </Field>
            <Field label="Mensalidade (R$)">
              <Input
                name="monthly"
                inputMode="decimal"
                defaultValue={brl(plan.monthly_cents)}
              />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Input name="description" defaultValue={plan.description ?? ""} />
            </Field>
          </div>

          {/* Dependentes ---------------------------------------------------- */}
          <fieldset className="rounded-xl border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dependentes
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowsDependents"
                checked={allowsDependents}
                onChange={(e) => setAllowsDependents(e.target.checked)}
                className="size-4"
              />
              Este plano aceita dependentes
            </label>
            {allowsDependents && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Dependentes incluídos no valor">
                  <Input
                    name="includedDependents"
                    type="number"
                    min={0}
                    defaultValue={plan.included_dependents}
                  />
                </Field>
                <Field label="Limite total (vazio = sem limite)">
                  <Input
                    name="maxDependents"
                    type="number"
                    min={0}
                    defaultValue={plan.max_dependents ?? ""}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    name="allowsExtraDependents"
                    checked={allowsExtra}
                    onChange={(e) => setAllowsExtra(e.target.checked)}
                    className="size-4"
                  />
                  Pode incluir dependentes extras (cobrados à parte)
                </label>
                {allowsExtra && (
                  <Field label="Valor do dependente extra (R$/mês)">
                    <Input
                      name="extraDependent"
                      inputMode="decimal"
                      defaultValue={brl(plan.extra_dependent_cents)}
                    />
                  </Field>
                )}
              </div>
            )}
          </fieldset>

          {/* Condições de pagamento ----------------------------------------- */}
          <fieldset className="rounded-xl border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Condições nos tratamentos
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Desconto à vista (%)">
                <Input
                  name="cashDiscount"
                  inputMode="decimal"
                  defaultValue={plan.cash_discount_percent}
                />
              </Field>
              <Field label="Máximo de parcelas">
                <Input
                  name="maxInstallments"
                  type="number"
                  min={1}
                  defaultValue={plan.max_installments}
                />
              </Field>
              <Field
                label="Valor mínimo da parcela (R$)"
                hint="Nenhuma parcela pode ficar abaixo disso."
              >
                <Input
                  name="minInstallment"
                  inputMode="decimal"
                  defaultValue={brl(plan.min_installment_cents)}
                />
              </Field>
              <Field
                label="Carência do plano (dias)"
                hint="Conta a partir da ativação (contrato + 1ª mensalidade)."
              >
                <Input
                  name="gracePeriodDays"
                  type="number"
                  min={0}
                  defaultValue={plan.grace_period_days}
                />
              </Field>
            </div>

            <p className="mt-3 text-xs font-medium text-muted-foreground">
              Formas de pagamento aceitas no tratamento
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {PAYMENT_METHODS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="allowedMethods"
                    value={m}
                    defaultChecked={plan.allowed_methods?.includes(m) ?? false}
                    className="size-4"
                  />
                  {PAYMENT_METHOD_LABELS[m as PaymentMethod]}
                </label>
              ))}
            </div>

            <p className="mt-3 text-xs font-medium text-muted-foreground">
              Formas de pagamento da mensalidade (recorrentes)
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
              {PPR_RECURRING_METHODS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="recurringMethods"
                    value={m}
                    defaultChecked={plan.recurring_methods?.includes(m) ?? false}
                    className="size-4"
                  />
                  {PPR_RECURRING_METHOD_LABELS[m]}
                </label>
              ))}
            </div>
          </fieldset>

          {/* Riso+ Social + situação ---------------------------------------- */}
          <fieldset className="rounded-xl border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Riso+ Social e situação
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="socialEnabled"
                checked={social}
                onChange={(e) => setSocial(e.target.checked)}
                className="size-4"
              />
              Este plano participa do Riso+ Social
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {social && (
                <Field
                  label="1 ponto a cada (R$)"
                  hint="Pontos proporcionais ao valor pago."
                >
                  <Input
                    name="socialPer"
                    inputMode="decimal"
                    defaultValue={brl(plan.social_points_per_cents)}
                  />
                </Field>
              )}
              <Field label="Ordem na lista">
                <Input
                  name="sortOrder"
                  type="number"
                  defaultValue={plan.sort_order}
                />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={plan.is_active}
                  className="size-4"
                />
                Plano ativo (aparece na venda)
              </label>
            </div>
          </fieldset>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar plano"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
