import Link from "next/link";
import { CalendarCheck, ChevronRight, SmilePlus, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  ORTHO_KIND_LABELS,
  ORTHO_MAINTENANCE_STATUS_LABELS,
  ORTHO_STATUS_LABELS,
  type OrthoMaintenanceStatus,
  type OrthoStatus,
} from "@/lib/ortodontia/constants";
import type { OrthoClientBadge } from "@/lib/ortodontia/client-badge-loader";

export const ORTHO_STATUS_TONE: Record<OrthoStatus, string> = {
  aguardando_inicio: "border-amber-300 bg-amber-50 text-amber-800",
  em_tratamento: "border-emerald-300 bg-emerald-50 text-emerald-800",
  contencao: "border-sky-300 bg-sky-50 text-sky-800",
  finalizado: "border-border bg-muted text-muted-foreground",
  interrompido: "border-rose-300 bg-rose-50 text-rose-800",
  suspenso: "border-orange-300 bg-orange-50 text-orange-800",
};

/** Selo curto para a linha de pílulas do prontuário. */
export function OrthoBadge({ badge }: { badge: OrthoClientBadge }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        ORTHO_STATUS_TONE[badge.status]
      )}
      title={`Ortodontia — ${ORTHO_STATUS_LABELS[badge.status]}`}
    >
      <SmilePlus className="size-3" />
      Ortodontia · {ORTHO_STATUS_LABELS[badge.status]}
    </span>
  );
}

/**
 * Bloco da ortodontia no prontuário: situação do caso, ortodontista, próxima
 * manutenção, alerta de mensalidade atrasada e o atalho para a ficha do caso.
 */
export function OrthoClientCard({ badge }: { badge: OrthoClientBadge | null }) {
  if (!badge) return null;
  const closed = badge.status === "finalizado" || badge.status === "interrompido" || badge.status === "suspenso";
  const inTreatment = badge.status === "em_tratamento";

  return (
    <Card className="overflow-hidden">
      <span className="block h-1 bg-gold" aria-hidden />
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <SmilePlus className="size-4 text-gold-foreground" />
            Ortodontia · {ORTHO_KIND_LABELS[badge.kind]}
          </CardTitle>
          <span className={cn("rounded-full border px-2 py-0.5 text-xs", ORTHO_STATUS_TONE[badge.status])}>
            {ORTHO_STATUS_LABELS[badge.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {badge.code}
          {badge.orthodontistName && ` · ${badge.orthodontistName}`}
          {badge.startDate && ` · início ${formatIsoDateBr(badge.startDate)}`}
          {badge.plannedEndDate && inTreatment && ` · término previsto ${formatIsoDateBr(badge.plannedEndDate)}`}
          {badge.moneyVisible && badge.monthlyCents > 0 && inTreatment && ` · ${formatBRL(badge.monthlyCents)}/mês`}
          {badge.status === "contencao" && " · contenções entregues, sem mensalidade"}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!closed && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1">
              <CalendarCheck className="size-3.5 text-muted-foreground" />
              {badge.next ? (
                <>
                  Próxima manutenção: <strong>{formatIsoDateBr(badge.next.date)}</strong>{" "}
                  <span className="text-xs text-muted-foreground">
                    ({ORTHO_MAINTENANCE_STATUS_LABELS[badge.next.status as OrthoMaintenanceStatus] ?? badge.next.status})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Sem próxima manutenção prevista.</span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {badge.doneCount} realizada{badge.doneCount === 1 ? "" : "s"}
              {badge.missedCount > 0 && ` · ${badge.missedCount} falta${badge.missedCount === 1 ? "" : "s"}`}
            </span>
          </div>
        )}
        {badge.moneyVisible && badge.lateCharges > 0 && (
          <p className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
            <TriangleAlert className="size-3.5" />
            {badge.lateCharges} mensalidade{badge.lateCharges === 1 ? "" : "s"} em atraso.
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/ortodontia/casos/${badge.caseId}`} />}
        >
          Abrir o caso ortodôntico
          <ChevronRight className="ml-1 size-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
