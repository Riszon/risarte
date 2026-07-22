"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/commercial";
import { deleteCommercialRule, saveCommercialRule } from "./actions";

export type RuleRowUi = {
  id: string;
  clinic_id: string | null;
  max_discount_percent: number | null;
  max_installments: number | null;
  allowed_methods: string[] | null;
};

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function CommercialRulesEditor({
  rows,
  clinics,
}: {
  rows: RuleRowUi[];
  clinics: { id: string; name: string }[];
}) {
  const networkRule = rows.find((r) => r.clinic_id === null) ?? null;
  const unitRules = rows.filter((r) => r.clinic_id !== null);
  const [addUnitId, setAddUnitId] = useState("");

  const clinicName = (id: string | null) =>
    clinics.find((c) => c.id === id)?.name ?? "Unidade";
  const unitsWithoutRule = clinics.filter(
    (c) => !unitRules.some((r) => r.clinic_id === c.id)
  );

  return (
    <div className="space-y-4">
      <RuleForm
        title="Padrão da rede"
        subtitle="Vale para todas as unidades que não tiverem ajuste próprio."
        clinicId={null}
        rule={networkRule}
      />

      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Ajustes por unidade
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada campo preenchido aqui vence o padrão da rede naquela unidade;
          campos vazios continuam herdando o padrão.
        </p>
      </div>

      {unitRules.map((r) => (
        <RuleForm
          key={r.id}
          title={clinicName(r.clinic_id)}
          clinicId={r.clinic_id}
          rule={r}
          removableId={r.id}
        />
      ))}

      {unitsWithoutRule.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">
            Adicionar ajuste para a unidade:
          </span>
          <select
            value={addUnitId}
            onChange={(e) => setAddUnitId(e.target.value)}
            className={selectClass}
          >
            <option value="">Escolha a unidade</option>
            {unitsWithoutRule.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {addUnitId && !unitRules.some((r) => r.clinic_id === addUnitId) && (
        <RuleForm
          title={clinicName(addUnitId)}
          subtitle="Novo ajuste — salve para valer."
          clinicId={addUnitId}
          rule={null}
        />
      )}
    </div>
  );
}

function RuleForm({
  title,
  subtitle,
  clinicId,
  rule,
  removableId,
}: {
  title: string;
  subtitle?: string;
  clinicId: string | null;
  rule: RuleRowUi | null;
  removableId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const r = await saveCommercialRule(formData);
      if (r.ok) {
        toast.success("Regra comercial salva.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function remove() {
    if (!removableId) return;
    startTransition(async () => {
      const r = await deleteCommercialRule(removableId);
      if (r.ok) {
        toast.success("Ajuste removido — vale o padrão da rede.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {removableId && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={remove}
            aria-label="Remover ajuste da unidade"
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-3">
          <input type="hidden" name="clinicId" value={clinicId ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Desconto máximo (%)
              </span>
              <Input
                name="maxDiscountPercent"
                inputMode="decimal"
                placeholder={clinicId ? "herda da rede" : "sem limite"}
                defaultValue={
                  rule?.max_discount_percent != null
                    ? String(rule.max_discount_percent)
                    : ""
                }
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">
                Parcelas (máximo)
              </span>
              <Input
                name="maxInstallments"
                inputMode="numeric"
                placeholder={clinicId ? "herda da rede" : "sem limite"}
                defaultValue={
                  rule?.max_installments != null
                    ? String(rule.max_installments)
                    : ""
                }
              />
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Meios de pagamento permitidos (nenhum marcado = todos liberados)
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {PAYMENT_METHODS.map((m: PaymentMethod) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="methods"
                    value={m}
                    defaultChecked={rule?.allowed_methods?.includes(m) ?? false}
                  />
                  {PAYMENT_METHOD_LABELS[m]}
                </label>
              ))}
            </div>
          </div>
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
