"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
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
import {
  BENEFIT_TYPES,
  BENEFIT_TYPE_LABELS,
  type BenefitType,
} from "@/lib/empresarial/constants";
import { deleteProcedureBenefit, upsertProcedureBenefit } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

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

export function BenefitsEditor({
  companyId,
  procedures,
  benefits,
  scopeLabel,
}: {
  companyId: string | null;
  procedures: { id: string; name: string }[];
  benefits: BenefitView[];
  scopeLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Benefícios por procedimento — {scopeLabel}.
        </p>
        <BenefitDialog companyId={companyId} procedures={procedures} />
      </div>

      {benefits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum benefício configurado.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Procedimento</th>
                <th className="px-3 py-2 font-medium">Benefício</th>
                <th className="px-3 py-2 font-medium">Parcelas</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {benefits.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{b.procedureName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {describeBenefit(b)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.maxInstallments ? `${b.maxInstallments}x` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex justify-end gap-1">
                      <BenefitDialog
                        companyId={companyId}
                        procedures={procedures}
                        benefit={b}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={isPending}
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
}

function BenefitDialog({
  companyId,
  procedures,
  benefit,
}: {
  companyId: string | null;
  procedures: { id: string; name: string }[];
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
              <select id="procedure_id" name="procedure_id" required className={selectClass} defaultValue="">
                <option value="">Selecione...</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
