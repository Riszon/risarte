"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Clock } from "lucide-react";
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
  PHASE_LABELS,
  PHASE_SLA_KEY,
  PILLAR_LABELS,
  allowedNextPhases,
  formatTimeInPhase,
  isSlaExceeded,
  type JourneyPhase,
  type MethodologyPillar,
} from "@/lib/journey";
import { moveClientPhase } from "./actions";

export type KanbanClient = {
  id: string;
  full_name: string;
  journey_phase: JourneyPhase;
  phase_entered_at: string;
  methodology_pillar: MethodologyPillar | null;
};

type Props = {
  clients: KanbanClient[];
  sla: Record<SlaKey, number | null>;
  isAdminMaster: boolean;
  clinicRoles: UserRole[];
  isPlannerAnywhere: boolean;
};

export function KanbanBoard({
  clients,
  sla,
  isAdminMaster,
  clinicRoles,
  isPlannerAnywhere,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
    <div className="flex min-w-max gap-3">
      {JOURNEY_PHASES.map((phase) => {
        const phaseClients = clients.filter((c) => c.journey_phase === phase);
        const slaKey = PHASE_SLA_KEY[phase];
        const slaHours = slaKey ? sla[slaKey] : null;
        const nextOptions = allowedNextPhases(phase, {
          isAdminMaster,
          clinicRoles,
          isPlannerAnywhere,
        });

        return (
          <div
            key={phase}
            className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40"
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-medium">{PHASE_LABELS[phase]}</h2>
              <Badge variant="secondary">{phaseClients.length}</Badge>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {phaseClients.map((client) => {
                const exceeded = isSlaExceeded(
                  client.phase_entered_at,
                  slaHours
                );
                return (
                  <div
                    key={client.id}
                    className={cn(
                      "rounded-md border bg-card p-3 shadow-sm",
                      exceeded && "border-destructive"
                    )}
                  >
                    <Link
                      href={`/clientes/${client.id}`}
                      className="block text-sm font-medium hover:underline"
                    >
                      {client.full_name}
                    </Link>
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
                      {client.methodology_pillar && (
                        <Badge
                          className="bg-gold text-gold-foreground text-[10px]"
                        >
                          {PILLAR_LABELS[client.methodology_pillar]}
                        </Badge>
                      )}
                    </div>
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
