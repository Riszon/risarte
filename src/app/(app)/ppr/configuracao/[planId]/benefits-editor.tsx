"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Gift, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  PPR_BENEFIT_TYPES,
  PPR_BENEFIT_TYPE_LABELS,
  type PprBenefitType,
} from "@/lib/ppr/constants";
import { removePprBenefit, savePprBenefit } from "../actions";

export type PprBenefitRow = {
  id: string;
  procedure_id: string | null;
  specialty: string | null;
  benefit_type: PprBenefitType;
  benefit_value: number | null;
  grace_period_days: number;
  frequency_months: number | null;
  usage_limit_count: number | null;
  usage_period_months: number | null;
  gift_label: string | null;
};

const selectClass =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * Benefício por procedimento: cobertura (isento/%), carência, de quanto em
 * quanto tempo libera de novo e o brinde entregue (escova a cada limpeza).
 */
export function PprBenefitsEditor({
  planId,
  benefits,
  procedures,
  specialties,
}: {
  planId: string;
  benefits: PprBenefitRow[];
  procedures: { id: string; name: string; specialty: string | null }[];
  specialties: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const procName = (id: string | null) =>
    procedures.find((p) => p.id === id)?.name ?? "Procedimento";

  function save(form: FormData) {
    startTransition(async () => {
      const r = await savePprBenefit(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Benefício salvo.");
        setAdding(false);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await removePprBenefit(id, planId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível remover.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Benefícios por procedimento</CardTitle>
          <p className="text-sm text-muted-foreground">
            O que o beneficiário ganha em cada procedimento — sem custo ou com
            desconto —, a carência e de quanto em quanto tempo pode repetir.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1 size-3.5" />
          Novo benefício
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <BenefitForm
            planId={planId}
            benefit={null}
            procedures={procedures}
            specialties={specialties}
            onSave={save}
            onCancel={() => setAdding(false)}
            isPending={isPending}
          />
        )}

        {benefits.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">
            Nenhum benefício configurado — o plano ainda não dá cobertura em
            procedimentos.
          </p>
        ) : (
          <ul className="space-y-2">
            {benefits.map((b) => (
              <li key={b.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {b.procedure_id
                        ? procName(b.procedure_id)
                        : `Especialidade: ${b.specialty}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.benefit_type === "free"
                        ? "Sem custo (isento)"
                        : b.benefit_type === "percent"
                          ? `${b.benefit_value ?? 0}% de desconto`
                          : "Sem benefício"}
                      {b.grace_period_days > 0 &&
                        ` · carência ${b.grace_period_days} dia(s)`}
                      {b.frequency_months && ` · a cada ${b.frequency_months} meses`}
                      {b.usage_limit_count &&
                        ` · até ${b.usage_limit_count}× a cada ${b.usage_period_months ?? 12} meses`}
                    </p>
                    {b.gift_label && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-gold-foreground">
                        <Gift className="size-3" />
                        {b.gift_label}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => remove(b.id)}
                    title="Remover benefício"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary">
                    Editar
                  </summary>
                  <div className="pt-2">
                    <BenefitForm
                      planId={planId}
                      benefit={b}
                      procedures={procedures}
                      specialties={specialties}
                      onSave={save}
                      isPending={isPending}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BenefitForm({
  planId,
  benefit,
  procedures,
  specialties,
  onSave,
  onCancel,
  isPending,
}: {
  planId: string;
  benefit: PprBenefitRow | null;
  procedures: { id: string; name: string; specialty: string | null }[];
  specialties: string[];
  onSave: (form: FormData) => void;
  onCancel?: () => void;
  isPending: boolean;
}) {
  const [type, setType] = useState<PprBenefitType>(
    benefit?.benefit_type ?? "free"
  );
  const [scope, setScope] = useState<"procedure" | "specialty">(
    benefit?.specialty && !benefit?.procedure_id ? "specialty" : "procedure"
  );

  return (
    <form action={onSave} className="grid gap-3 rounded-xl border border-dashed p-3">
      <input type="hidden" name="planId" value={planId} />
      {benefit && <input type="hidden" name="id" value={benefit.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="text-muted-foreground">Aplicar a</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "procedure" | "specialty")}
            className={selectClass}
          >
            <option value="procedure">Um procedimento</option>
            <option value="specialty">Uma especialidade inteira</option>
          </select>
        </label>

        {scope === "procedure" ? (
          <label className="text-xs">
            <span className="text-muted-foreground">Procedimento</span>
            <select
              name="procedureId"
              defaultValue={benefit?.procedure_id ?? ""}
              className={selectClass}
            >
              <option value="">Escolha o procedimento</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-xs">
            <span className="text-muted-foreground">Especialidade</span>
            <select
              name="specialty"
              defaultValue={benefit?.specialty ?? ""}
              className={selectClass}
            >
              <option value="">Escolha a especialidade</option>
              {specialties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs">
          <span className="text-muted-foreground">Cobertura</span>
          <select
            name="benefitType"
            value={type}
            onChange={(e) => setType(e.target.value as PprBenefitType)}
            className={selectClass}
          >
            {PPR_BENEFIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PPR_BENEFIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        {type === "percent" && (
          <label className="text-xs">
            <span className="text-muted-foreground">Desconto (%)</span>
            <Input
              name="benefitValue"
              inputMode="decimal"
              defaultValue={benefit?.benefit_value ?? ""}
            />
          </label>
        )}

        <label className="text-xs">
          <span className="text-muted-foreground">Carência (dias)</span>
          <Input
            name="grace"
            type="number"
            min={0}
            defaultValue={benefit?.grace_period_days ?? 0}
          />
        </label>

        <label className="text-xs">
          <span className="text-muted-foreground">
            Libera de novo a cada (meses)
          </span>
          <Input
            name="frequency"
            type="number"
            min={0}
            placeholder="ex.: 4 (limpeza)"
            defaultValue={benefit?.frequency_months ?? ""}
          />
        </label>

        <label className="text-xs">
          <span className="text-muted-foreground">Limite de usos</span>
          <Input
            name="limitCount"
            type="number"
            min={0}
            placeholder="opcional"
            defaultValue={benefit?.usage_limit_count ?? ""}
          />
        </label>

        <label className="text-xs">
          <span className="text-muted-foreground">A cada (meses)</span>
          <Input
            name="limitPeriod"
            type="number"
            min={0}
            placeholder="opcional"
            defaultValue={benefit?.usage_period_months ?? ""}
          />
        </label>

        <label className="text-xs sm:col-span-2">
          <span className="text-muted-foreground">
            Brinde entregue junto (opcional)
          </span>
          <Input
            name="gift"
            placeholder="Ex.: Escova nova"
            defaultValue={benefit?.gift_label ?? ""}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          Salvar benefício
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
