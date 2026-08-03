"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe2, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { computeLateCharges } from "@/lib/finance/late-fees";
import { formatBRL } from "@/lib/pricing";
import { clearFinanceSettings, saveFinanceSettings } from "../actions";

export type SettingsRow = {
  clinic_id: string | null;
  late_fee_percent: number;
  monthly_interest_percent: number;
  grace_days: number;
  rounding_mode: "half_up" | "half_even";
};

type ClinicOption = {
  id: string;
  name: string;
  type: "franchisor" | "franchise_unit";
};

const fieldClass =
  "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const labelClass = "text-[11px] font-medium text-muted-foreground";

/** Um bloco de configuração — o da rede ou o de uma unidade. */
function SettingsBlock({
  title,
  subtitle,
  icon,
  value,
  inherited,
  canEdit,
  onSave,
  onClear,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  value: SettingsRow;
  /** Quando true, a unidade está SEGUINDO a rede (não tem override). */
  inherited: boolean;
  canEdit: boolean;
  onSave: (next: SettingsRow) => void;
  onClear?: () => void;
}) {
  const [lateFee, setLateFee] = useState(String(value.late_fee_percent));
  const [interest, setInterest] = useState(
    String(value.monthly_interest_percent)
  );
  const [grace, setGrace] = useState(String(value.grace_days));
  const [rounding, setRounding] = useState(value.rounding_mode);

  const lateFeeNum = Number(lateFee.replace(",", ".")) || 0;
  const interestNum = Number(interest.replace(",", ".")) || 0;
  const graceNum = Number.parseInt(grace, 10) || 0;
  const overLimit = lateFeeNum > 2;

  // Exemplo ao vivo: R$ 1.000,00 com 30 dias de atraso.
  const example = computeLateCharges({
    principalCents: 100000,
    dueDate: "2026-06-30",
    referenceDate: "2026-07-30",
    terms: {
      lateFeePercent: lateFeeNum,
      monthlyInterestPercent: interestNum,
      graceDays: graceNum,
      roundingMode: rounding,
    },
  });

  return (
    <Card className={cn(inherited && "border-dashed")}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          {inherited ? (
            <Badge variant="outline" className="text-[10px]">
              Seguindo o padrão da rede
            </Badge>
          ) : (
            <Badge className="bg-primary/10 text-[10px] text-primary">
              Configuração própria
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block">
            <span className={labelClass}>Multa (%)</span>
            <input
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
              disabled={!canEdit}
              inputMode="decimal"
              className={cn(fieldClass, overLimit && "border-destructive")}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Juros ao mês (%)</span>
            <input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              disabled={!canEdit}
              inputMode="decimal"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Carência (dias)</span>
            <input
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              disabled={!canEdit}
              inputMode="numeric"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Arredondamento</span>
            <select
              value={rounding}
              onChange={(e) =>
                setRounding(e.target.value as "half_up" | "half_even")
              }
              disabled={!canEdit}
              className={fieldClass}
            >
              <option value="half_up">Meio para cima</option>
              <option value="half_even">Meio par (bancário)</option>
            </select>
          </label>
        </div>

        {overLimit && (
          <p className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              A multa não pode passar de <strong>2%</strong> — é o limite do
              Código de Defesa do Consumidor (art. 52, §1º) para contrato
              parcelado. O sistema recusa o salvamento.
            </span>
          </p>
        )}

        <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
          <strong>Como fica:</strong> uma parcela de {formatBRL(100000)} com{" "}
          <strong>30 dias</strong> de atraso vira{" "}
          <strong>{formatBRL(example.totalCents)}</strong> — multa{" "}
          {formatBRL(example.lateFeeCents)} + juros{" "}
          {formatBRL(example.interestCents)}.
          {graceNum > 0 && (
            <>
              {" "}
              Nos primeiros <strong>{graceNum} dia(s)</strong> após o
              vencimento nada é cobrado.
            </>
          )}
        </p>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={overLimit}
              onClick={() =>
                onSave({
                  clinic_id: value.clinic_id,
                  late_fee_percent: lateFeeNum,
                  monthly_interest_percent: interestNum,
                  grace_days: graceNum,
                  rounding_mode: rounding,
                })
              }
            >
              Salvar
            </Button>
            {onClear && !inherited && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                <RotateCcw className="mr-1 size-3.5" />
                Voltar ao padrão da rede
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FinanceSettingsForm({
  network,
  overrides,
  clinics,
  canEdit,
}: {
  network: SettingsRow;
  overrides: SettingsRow[];
  clinics: ClinicOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const overrideByClinic = new Map(overrides.map((o) => [o.clinic_id, o]));

  function save(next: SettingsRow) {
    startTransition(async () => {
      const r = await saveFinanceSettings({
        clinicId: next.clinic_id,
        lateFeePercent: next.late_fee_percent,
        monthlyInterestPercent: next.monthly_interest_percent,
        graceDays: next.grace_days,
        roundingMode: next.rounding_mode,
      });
      if (r.ok) {
        toast.success("Configuração salva.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function clear(clinicId: string) {
    startTransition(async () => {
      const r = await clearFinanceSettings(clinicId);
      if (r.ok) {
        toast.success("A unidade voltou a seguir o padrão da rede.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className={cn("space-y-4", isPending && "opacity-70")}>
      <SettingsBlock
        title="Padrão da rede"
        subtitle="Vale para toda unidade que não tiver configuração própria."
        icon={<Globe2 className="size-4 text-primary" />}
        value={network}
        inherited={false}
        canEdit={canEdit}
        onSave={save}
      />

      {clinics.map((c) => {
        const own = overrideByClinic.get(c.id);
        return (
          <SettingsBlock
            key={c.id}
            title={c.name}
            subtitle={
              c.type === "franchisor"
                ? "Franqueadora — juros e multa das cobranças próprias."
                : "Unidade — só configure se for diferente da rede."
            }
            icon={<Building2 className="size-4 text-muted-foreground" />}
            value={own ?? { ...network, clinic_id: c.id }}
            inherited={!own}
            canEdit={canEdit}
            onSave={save}
            onClear={() => clear(c.id)}
          />
        );
      })}

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Você está vendo a configuração em modo leitura. Apenas Admin Master e
          Financeiro da Franqueadora alteram estes valores.
        </p>
      )}
    </div>
  );
}
