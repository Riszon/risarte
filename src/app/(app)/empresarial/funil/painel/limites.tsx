"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LEAD_STAGE_LABELS,
  type LeadStage,
} from "@/lib/empresarial/constants";
import { refreshFunnelAlerts, saveFunnelLimits } from "./actions";

export function LimitesDoFunil({
  limites,
  inatividadeDias,
  podeEditar,
}: {
  limites: { stage: LeadStage; maxDays: number }[];
  inatividadeDias: number;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveFunnelLimits(formData);
      if (r.ok) {
        toast.success("Limites salvos.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function apurar() {
    startTransition(async () => {
      const r = await refreshFunnelAlerts();
      if (r.ok) {
        toast.success(
          r.abertos != null
            ? `Apurado. ${r.abertos} aviso(s) em aberto.`
            : "Apurado."
        );
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Limites dos alertas</p>
            <p className="text-xs text-muted-foreground">
              Três dias tentando contato é normal; três dias com a proposta na
              mesa sem retorno já não é. Por isso o limite é{" "}
              <strong>por fase</strong>.
            </p>
          </div>
          {podeEditar && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={isPending}
              onClick={apurar}
            >
              <RefreshCw className="mr-1 size-3.5" />
              Apurar agora
            </Button>
          )}
        </div>

        {!podeEditar ? (
          <ul className="space-y-1 text-sm">
            {limites.map((l) => (
              <li
                key={l.stage}
                className="flex items-center justify-between gap-2 border-b py-1 last:border-0"
              >
                <span>{LEAD_STAGE_LABELS[l.stage]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {l.maxDays} dias
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 py-1">
              <span>Sem nenhum registro</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {inatividadeDias} dias
              </span>
            </li>
          </ul>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {limites.map((l) => (
                <div key={l.stage} className="flex items-center gap-2">
                  <Label
                    htmlFor={`limite_${l.stage}`}
                    className="flex-1 text-sm font-normal"
                  >
                    {LEAD_STAGE_LABELS[l.stage]}
                  </Label>
                  <Input
                    id={`limite_${l.stage}`}
                    name={`limite_${l.stage}`}
                    type="number"
                    min={1}
                    defaultValue={l.maxDays}
                    className="h-8 w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">dias</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="inactivity_days"
                  className="flex-1 text-sm font-normal"
                >
                  Sem nenhum registro
                </Label>
                <Input
                  id="inactivity_days"
                  name="inactivity_days"
                  type="number"
                  min={1}
                  defaultValue={inatividadeDias}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            </div>
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar limites
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
