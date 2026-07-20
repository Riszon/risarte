"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Clock, Plus, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SlaKey } from "@/lib/sla";
import type { UserRole } from "@/lib/roles";
import {
  JOURNEY_PHASES,
  PHASE_COLORS,
  PHASE_LABELS,
  PHASE_SLA_KEY,
  PILLAR_LABELS,
  STATUS_LABELS,
  allowedNextPhases,
  displayedPillar,
  formatTimeInPhase,
  isSlaExceeded,
  type JourneyPhase,
  type JourneyStatus,
  type MethodologyPillar,
} from "@/lib/journey";
import { moveClientPhase } from "./actions";

export type KanbanClient = {
  id: string;
  full_name: string;
  status: "active" | "inactive" | "anonymized";
  journey_phase: JourneyPhase;
  journey_status: JourneyStatus | null;
  phase_entered_at: string;
  methodology_pillar: MethodologyPillar | null;
  /** Set only in the network (franchisor) view, to show the unit per card. */
  clinic_name: string | null;
};

type Props = {
  clients: KanbanClient[];
  sla: Record<SlaKey, number | null>;
  isAdminMaster: boolean;
  clinicRoles: UserRole[];
  isPlannerAnywhere: boolean;
  canRegister: boolean;
};

// Cores dos sub-status (destaque especial da Fase 5): âmbar = aguardando iniciar,
// verde = em tratamento; os demais ficam neutros (navy).
const STATUS_BADGE: Partial<Record<JourneyStatus, string>> = {
  awaiting_treatment_start:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  in_treatment:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};
function statusBadgeClass(status: JourneyStatus): string {
  return STATUS_BADGE[status] ?? "border-primary/20 bg-primary/10 text-primary";
}

export function KanbanBoard({
  clients,
  sla,
  isAdminMaster,
  clinicRoles,
  isPlannerAnywhere,
  canRegister,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Coordenador (ou Admin) pode abrir o cockpit de avaliação a partir do cartão.
  const canCoordinate =
    isAdminMaster || clinicRoles.includes("clinical_coordinator");

  function move(client: KanbanClient, phase: JourneyPhase) {
    startTransition(async () => {
      const result = await moveClientPhase(client.id, phase);
      if (result.ok) {
        toast.success(
          `${client.full_name} movido(a) para ${PHASE_LABELS[phase]}.`
        );
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="flex h-full min-w-max gap-3">
      {JOURNEY_PHASES.map((phase, phaseIndex) => {
        const phaseClients = clients.filter((c) => c.journey_phase === phase);
        const slaKey = PHASE_SLA_KEY[phase];
        const slaHours = slaKey ? sla[slaKey] : null;
        const exceededCount = phaseClients.filter((c) =>
          isSlaExceeded(c.phase_entered_at, slaHours)
        ).length;
        const nextOptions = allowedNextPhases(phase, {
          isAdminMaster,
          clinicRoles,
          isPlannerAnywhere,
        });
        const color = PHASE_COLORS[phase];

        return (
          <div
            key={phase}
            className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40"
          >
            {/* Acento de cor da fase (padrão do dono). */}
            <div
              className="h-1 w-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <div className="flex items-center justify-between gap-2 border-b bg-background/50 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-bold"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${color} 22%, transparent)`,
                    color: `color-mix(in oklab, ${color} 62%, black)`,
                  }}
                >
                  {phaseIndex + 1}
                </span>
                <h2 className="truncate text-sm font-semibold">
                  {PHASE_LABELS[phase]}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {phase === "acquisition" && canRegister && (
                  <Button
                    variant="ghost"
                    size="icon"
                    nativeButton={false}
                    className="size-6"
                    aria-label="Cadastrar cliente"
                    render={<Link href="/prontuarios/novo" />}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
                {exceededCount > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive"
                    title={`${exceededCount} com SLA estourado`}
                  >
                    {phaseClients.length}
                    <span className="text-[10px]">· {exceededCount} ⚠</span>
                  </span>
                ) : (
                  <Badge variant="secondary">{phaseClients.length}</Badge>
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {phaseClients.map((client) => {
                const exceeded = isSlaExceeded(
                  client.phase_entered_at,
                  slaHours
                );
                const pillar = displayedPillar(
                  client.journey_phase,
                  client.methodology_pillar
                );
                return (
                  <div
                    key={client.id}
                    className={cn(
                      "rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40",
                      exceeded && "border-destructive bg-destructive/5",
                      client.status === "inactive" &&
                        "border-dashed border-muted-foreground/40 bg-muted/60 opacity-75 shadow-none"
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <Link
                        href={`/prontuarios/${client.id}`}
                        className="block text-sm font-medium hover:underline"
                      >
                        {client.full_name}
                      </Link>
                      {client.status === "inactive" && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 gap-1 text-[10px] text-muted-foreground"
                        >
                          <span className="size-1.5 rounded-full bg-muted-foreground" />
                          Inativo
                        </Badge>
                      )}
                    </div>
                    {client.clinic_name && (
                      <p className="text-[10px] text-muted-foreground">
                        {client.clinic_name}
                      </p>
                    )}
                    {client.journey_status && (
                      <span
                        className={cn(
                          "mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          statusBadgeClass(client.journey_status)
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {STATUS_LABELS[client.journey_status]}
                      </span>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs",
                          exceeded
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        )}
                      >
                        <Clock className="size-3" />
                        {formatTimeInPhase(client.phase_entered_at)}
                      </span>
                      {exceeded && (
                        <Badge variant="destructive" className="text-[10px]">
                          SLA estourado
                        </Badge>
                      )}
                      {pillar && (
                        <Badge
                          className="bg-gold text-gold-foreground text-[10px]"
                        >
                          {PILLAR_LABELS[pillar]}
                        </Badge>
                      )}
                    </div>
                    {canCoordinate &&
                      (phase === "clinical_conversion" ||
                        phase === "reevaluation") && (
                        <Link
                          href={`/avaliacao/${client.id}`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Stethoscope className="size-3" />
                          Cockpit de avaliação
                        </Link>
                      )}
                    {nextOptions.length > 0 && (
                      <div className="mt-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isPending}
                                className="h-7 w-full text-xs"
                              >
                                <ArrowRight className="mr-1 size-3" />
                                Mover para...
                              </Button>
                            }
                          />
                          <DropdownMenuContent className="w-56" align="start">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>
                                Próximo passo
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {nextOptions.map((next) => (
                                <DropdownMenuItem
                                  key={next}
                                  onClick={() => move(client, next)}
                                >
                                  {PHASE_LABELS[next]}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                );
              })}
              {phaseClients.length === 0 && (
                <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                  Nenhum cliente nesta fase
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
