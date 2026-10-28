import Link from "next/link";
import { CalendarCheck, ChevronRight, SmilePlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { TOM, type Tom } from "@/lib/tons";
import {
  ORTHO_KIND_LABELS,
  ORTHO_MAINTENANCE_STATUS_LABELS,
  ORTHO_STATUS_LABELS,
  type OrthoMaintenanceStatus,
  type OrthoStatus,
} from "@/lib/ortodontia/constants";
import type { OrthoClientBadge } from "@/lib/ortodontia/client-badge-loader";
import { MiniCartao } from "@/components/prontuario/mini-cartao";

/** O tom de cada situação do caso — com o modo escuro (`src/lib/tons.ts`). */
export const ORTHO_STATUS_TOM: Record<OrthoStatus, Tom> = {
  aguardando_inicio: "ambar",
  em_tratamento: "verde",
  contencao: "azul",
  finalizado: "neutro",
  interrompido: "vermelho",
  suspenso: "laranja",
};

/** As classes prontas, para as telas da ortodontia que pintam o selo à mão. */
export const ORTHO_STATUS_TONE: Record<OrthoStatus, string> = Object.fromEntries(
  (Object.keys(ORTHO_STATUS_TOM) as OrthoStatus[]).map((s) => [s, TOM[ORTHO_STATUS_TOM[s]]])
) as Record<OrthoStatus, string>;

/** Selo curto para listas. */
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
 * A ortodontia no prontuário, como mini-cartão da faixa "Programas e
 * tratamentos" (28/10/2026): situação, ortodontista, próxima manutenção, a
 * mensalidade atrasada (só para quem vê dinheiro) e o atalho para a ficha.
 */
export function OrthoClientCard({ badge }: { badge: OrthoClientBadge | null }) {
  if (!badge) return null;
  const closed =
    badge.status === "finalizado" || badge.status === "interrompido" || badge.status === "suspenso";
  const inTreatment = badge.status === "em_tratamento";

  return (
    <MiniCartao
      icone={SmilePlus}
      titulo={`Ortodontia · ${ORTHO_KIND_LABELS[badge.kind]}`}
      situacao={{ rotulo: ORTHO_STATUS_LABELS[badge.status], tom: ORTHO_STATUS_TOM[badge.status] }}
      linha={
        <>
          <span className="font-mono">{badge.code}</span>
          {badge.orthodontistName && ` · ${badge.orthodontistName}`}
          {badge.startDate && ` · início ${formatIsoDateBr(badge.startDate)}`}
          {badge.plannedEndDate && inTreatment && ` · término previsto ${formatIsoDateBr(badge.plannedEndDate)}`}
          {badge.moneyVisible && badge.monthlyCents > 0 && inTreatment && ` · ${formatBRL(badge.monthlyCents)}/mês`}
          {badge.status === "contencao" && " · contenções entregues, sem mensalidade"}
        </>
      }
      acoes={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/ortodontia/casos/${badge.caseId}`} />}
        >
          Abrir o caso
          <ChevronRight className="ml-1 size-3.5" />
        </Button>
      }
    >
      {!closed && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <CalendarCheck className="size-3.5 text-muted-foreground" />
            {badge.next ? (
              <>
                Próxima manutenção <strong>{formatIsoDateBr(badge.next.date)}</strong>
                <span className="text-muted-foreground">
                  ({ORTHO_MAINTENANCE_STATUS_LABELS[badge.next.status as OrthoMaintenanceStatus] ?? badge.next.status})
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Sem próxima manutenção prevista.</span>
            )}
          </span>
          <span className="text-muted-foreground">
            {badge.doneCount} realizada{badge.doneCount === 1 ? "" : "s"}
            {badge.missedCount > 0 && ` · ${badge.missedCount} falta${badge.missedCount === 1 ? "" : "s"}`}
          </span>
        </p>
      )}
      {badge.moneyVisible && badge.lateCharges > 0 && (
        <p className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", TOM.vermelho)}>
          <TriangleAlert className="size-3.5" />
          {badge.lateCharges} mensalidade{badge.lateCharges === 1 ? "" : "s"} em atraso.
        </p>
      )}
    </MiniCartao>
  );
}
