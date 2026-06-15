"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { UserRole } from "@/lib/roles";
import {
  PHASE_LABELS,
  PILLAR_LABELS,
  TREATMENT_PILLARS,
  allowedNextPhases,
  displayedPillar,
  formatTimeInPhase,
  type JourneyPhase,
  type MethodologyPillar,
  type TreatmentPillar,
} from "@/lib/journey";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/lib/appointments";
import { moveClientPhase, setTreatmentPillar } from "../../jornada/actions";

export type HistoryEntry = {
  id: string;
  phase: JourneyPhase;
  entered_at: string;
  exited_at: string | null;
  moved_by_name: string | null;
};

export type ClientAppointment = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
};

function formatStay(enteredAt: string, exitedAt: string | null): string {
  const end = exitedAt ? new Date(exitedAt).getTime() : Date.now();
  const hours = Math.floor((end - new Date(enteredAt).getTime()) / 36e5);
  if (hours < 1) return "menos de 1h";
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days === 0) return `${hours}h`;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

export function JourneySection({
  clientId,
  clientName,
  phase,
  phaseEnteredAt,
  pillar,
  history,
  appointments,
  isAdminMaster,
  clinicRoles,
  isPlannerAnywhere,
}: {
  clientId: string;
  clientName: string;
  phase: JourneyPhase;
  phaseEnteredAt: string;
  pillar: MethodologyPillar | null;
  history: HistoryEntry[];
  appointments: ClientAppointment[];
  isAdminMaster: boolean;
  clinicRoles: UserRole[];
  isPlannerAnywhere: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const nextOptions = allowedNextPhases(phase, {
    isAdminMaster,
    clinicRoles,
    isPlannerAnywhere,
  });

  function move(next: JourneyPhase) {
    startTransition(async () => {
      const result = await moveClientPhase(clientId, next);
      if (result.ok) {
        toast.success(`${clientName} movido(a) para ${PHASE_LABELS[next]}.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  const shownPillar = displayedPillar(phase, pillar);
  const canSetPillar = isAdminMaster || isPlannerAnywhere;

  function setPillar(value: TreatmentPillar) {
    startTransition(async () => {
      const result = await setTreatmentPillar(clientId, value);
      if (result.ok) {
        toast.success(`Pilar de tratamento: ${PILLAR_LABELS[value]}.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  const now = new Date();
  const futureAppointments = appointments.filter(
    (a) => new Date(a.starts_at) >= now
  );
  const pastAppointments = appointments
    .filter((a) => new Date(a.starts_at) < now)
    .reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Jornada Risarte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{PHASE_LABELS[phase]}</Badge>
          <span className="text-xs text-muted-foreground">
            há {formatTimeInPhase(phaseEnteredAt)}
          </span>
          <Badge
            className={cn(
              shownPillar
                ? "bg-gold text-gold-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {shownPillar
              ? `Pilar: ${PILLAR_LABELS[shownPillar]}`
              : "Pilar a definir"}
          </Badge>
          {canSetPillar && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending}>
                    <Sparkles className="mr-1 size-3.5" />
                    {pillar ? "Alterar pilar de tratamento" : "Definir pilar de tratamento"}
                  </Button>
                }
              />
              <DropdownMenuContent className="w-52" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Pilar de tratamento</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {TREATMENT_PILLARS.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => setPillar(p)}>
                      {PILLAR_LABELS[p]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {nextOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" disabled={isPending}>
                    <ArrowRight className="mr-1 size-3.5" />
                    Mover de fase
                  </Button>
                }
              />
              <DropdownMenuContent className="w-56" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Próximo passo</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {nextOptions.map((next) => (
                    <DropdownMenuItem key={next} onClick={() => move(next)}>
                      {PHASE_LABELS[next]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Linha do tempo</h3>
          <ol className="space-y-1.5 border-l pl-4">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm">
                <span className="font-medium">{PHASE_LABELS[entry.phase]}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  —{" "}
                  {new Date(entry.entered_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {entry.exited_at
                    ? `ficou ${formatStay(entry.entered_at, entry.exited_at)}`
                    : `há ${formatStay(entry.entered_at, null)} (atual)`}
                  {entry.moved_by_name ? ` · por ${entry.moved_by_name}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">Próximos compromissos</h3>
            {futureAppointments.length > 0 ? (
              <ul className="space-y-1">
                {futureAppointments.map((a) => (
                  <li key={a.id} className="text-sm">
                    {new Date(a.starts_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    — {APPOINTMENT_TYPE_LABELS[a.type]}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({APPOINTMENT_STATUS_LABELS[a.status]})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum agendado.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Compromissos passados</h3>
            {pastAppointments.length > 0 ? (
              <ul className="space-y-1">
                {pastAppointments.slice(0, 5).map((a) => (
                  <li key={a.id} className="text-sm">
                    {new Date(a.starts_at).toLocaleDateString("pt-BR")} —{" "}
                    {APPOINTMENT_TYPE_LABELS[a.type]}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({APPOINTMENT_STATUS_LABELS[a.status]})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum ainda.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
