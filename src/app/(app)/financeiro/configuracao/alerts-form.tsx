"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { checkFinanceAlertsNow, saveAlertSettings } from "./actions";

export type AlertSettings = {
  enabled: boolean;
  budgetPercent: number;
  cashDays: number;
  breakevenDays: number;
  overdueCents: number;
};

/**
 * FIN7.3 — os limites dos alertas, ajustáveis pela própria unidade.
 *
 * Multa e juros continuam sendo regra da rede; estes quatro números não. Limite
 * que a unidade não consegue ajustar vira alerta desligado no dedo — e alerta
 * desligado é pior que alerta nenhum, porque ninguém lembra que existia.
 */
export function AlertSettingsForm({
  clinicId,
  clinicName,
  initial,
  canEdit,
}: {
  clinicId: string;
  clinicName: string;
  initial: AlertSettings;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [budget, setBudget] = useState(String(initial.budgetPercent));
  const [cashDays, setCashDays] = useState(String(initial.cashDays));
  const [beDays, setBeDays] = useState(String(initial.breakevenDays));
  const [overdue, setOverdue] = useState(
    (initial.overdueCents / 100).toFixed(2).replace(".", ",")
  );

  function save() {
    startTransition(async () => {
      const r = await saveAlertSettings({
        clinicId,
        enabled,
        budgetPercent: Number(budget.replace(",", ".")) || 90,
        cashDays: Number(cashDays) || 15,
        breakevenDays: Number(beDays) || 7,
        overdueCents: Math.round(
          (Number(overdue.replace(/\./g, "").replace(",", ".")) || 0) * 100
        ),
      });
      if (r.ok) toast.success("Limites salvos.");
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function runNow() {
    startTransition(async () => {
      const r = await checkFinanceAlertsNow({ clinicId });
      if (r.ok) {
        toast.success(
          r.count
            ? `${r.count} ${r.count === 1 ? "alerta enviado" : "alertas enviados"}.`
            : "Nada a avisar agora."
        );
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <Card className={cn(isPending && "opacity-70")}>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-2">
          <BellRing className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">
              Alertas do Financeiro — {clinicName}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Verificados uma vez por dia, às 9h. Cada aviso é enviado{" "}
              <strong>uma vez</strong> e só volta se a situação sumir e
              reaparecer — alerta que repete todo dia é alerta que ninguém lê.
              Quem recebe: gerente e franqueado da unidade.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Alertas ligados
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Label className="text-[11px]">
              Avisar quando a despesa passar de (% da meta)
            </Label>
            <Input
              className="h-8 w-28"
              disabled={!canEdit}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Só vale para despesa: estar com 90% da meta de receita no meio do
              mês é notícia boa.
            </p>
          </label>

          <label className="block">
            <Label className="text-[11px]">
              Antecedência do caixa negativo (dias)
            </Label>
            <Input
              className="h-8 w-28"
              disabled={!canEdit}
              value={cashDays}
              onChange={(e) => setCashDays(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Quantos dias à frente olhar na projeção.
            </p>
          </label>

          <label className="block">
            <Label className="text-[11px]">
              Ponto de equilíbrio: avisar faltando (dias)
            </Label>
            <Input
              className="h-8 w-28"
              disabled={!canEdit}
              value={beDays}
              onChange={(e) => setBeDays(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Perto demais do fim do mês, não dá mais para reagir.
            </p>
          </label>

          <label className="block">
            <Label className="text-[11px]">Atraso a receber acima de (R$)</Label>
            <Input
              className="h-8 w-32"
              disabled={!canEdit}
              value={overdue}
              onChange={(e) => setOverdue(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              O vencido não entra na projeção de caixa — precisa ser cobrado.
            </p>
          </label>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save}>
              Salvar limites
            </Button>
            <Button size="sm" variant="outline" onClick={runNow}>
              Verificar agora
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
