"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock, Clock, MoreHorizontal, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";
import {
  checkInAppointment,
  updateAppointmentStatus,
  updateAttendance,
} from "../agenda/actions";

export type PanelAppointment = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  attendance: AttendanceStatus | null;
  clientId: string | null;
  clientName: string;
  providerName: string | null;
  providerUserId: string | null;
  calledBy: string | null;
  /** Set in the Consultor view (clients spread across units). */
  clinicName?: string | null;
  // Attendance timeline (for the per-visit history).
  checkedInAt?: string | null;
  calledAt?: string | null;
  doneAt?: string | null;
  checkedInByName?: string | null;
  calledByName?: string | null;
  doneByName?: string | null;
};

function minutesBetween(aIso: string, bIso: string): number {
  return Math.max(
    0,
    Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000)
  );
}

function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/** Seconds → "M:SS" (under an hour) or "Hh MMmin". */
function fmtElapsed(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

/** Ticks every second so the elapsed time updates in real time. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Live count-up timer from a fixed start (Em espera / Em atendimento).
 * H3.4: acima de `alertAfterSec`, o timer vira vermelho com selo "Espera longa". */
function LiveTimer({
  from,
  label,
  tone,
  alertAfterSec,
}: {
  from: string;
  label: string;
  tone?: string;
  alertAfterSec?: number;
}) {
  const now = useNow();
  const sec = Math.floor((now - new Date(from).getTime()) / 1000);
  const alerting = alertAfterSec !== undefined && sec >= alertAfterSec;
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium tabular-nums ${
        alerting ? "text-red-600" : (tone ?? "")
      }`}
    >
      <AlarmClock className="size-3" />
      {label} {fmtElapsed(sec)}
      {alerting && (
        <span className="animate-pulse rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">
          Espera longa
        </span>
      )}
    </span>
  );
}

/** "A chegar": before the time shows the schedule; after it, a lateness timer. */
function LatenessTimer({ startsAt }: { startsAt: string }) {
  const now = useNow();
  const startMs = new Date(startsAt).getTime();
  const lateSec = Math.floor((now - startMs) / 1000);
  // The lateness timer only turns on once the appointment time has passed.
  if (lateSec < 1) return null;
  return (
    <span className="inline-flex items-center gap-1 font-medium tabular-nums text-red-600">
      <AlarmClock className="size-3" />
      Atrasado há {fmtElapsed(lateSec)}
    </span>
  );
}

/** Arrival note for "Em espera": early/late vs the scheduled time + check-in. */
function arrivalNote(a: PanelAppointment): string | null {
  if (!a.checkedInAt) return null;
  const diffMin = Math.round(
    (new Date(a.starts_at).getTime() - new Date(a.checkedInAt).getTime()) / 60000
  );
  const checkInTime = new Date(a.checkedInAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  let label = "Chegou no horário";
  if (diffMin >= 1) label = `Chegou ${fmtDur(diffMin)} adiantado`;
  else if (diffMin <= -1) label = `Chegou ${fmtDur(-diffMin)} atrasado`;
  return `${label} · check-in ${checkInTime}`;
}

/** Real-time attendance timers + movers, depending on the client's state (Lote H). */
function AttendanceTimers({
  a,
  waitingAlertMinutes,
}: {
  a: PanelAppointment;
  waitingAlertMinutes?: number;
}) {
  const movers = [
    a.checkedInByName && `Chegada: ${a.checkedInByName}`,
    a.calledByName && `Chamou: ${a.calledByName}`,
    a.doneByName && `Concluiu: ${a.doneByName}`,
  ].filter(Boolean) as string[];

  let main: React.ReactNode = null;
  if (a.attendance === "gave_up") {
    main = (
      <span className="font-medium text-red-600">Desistiu da espera</span>
    );
  } else if (a.attendance === "done") {
    const waitingMin =
      a.checkedInAt && a.calledAt
        ? minutesBetween(a.checkedInAt, a.calledAt)
        : null;
    const serviceMin =
      a.calledAt && a.doneAt ? minutesBetween(a.calledAt, a.doneAt) : null;
    main = (
      <span>
        {a.doneAt && (
          <>
            Concluído às{" "}
            {new Date(a.doneAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </>
        )}
        {waitingMin != null && ` · espera ${fmtDur(waitingMin)}`}
        {serviceMin != null && ` · atendimento ${fmtDur(serviceMin)}`}
      </span>
    );
  } else if (a.attendance === "in_service" && a.calledAt) {
    main = (
      <LiveTimer
        from={a.calledAt}
        label="Em atendimento há"
        tone="text-violet-600"
      />
    );
  } else if (a.attendance === "waiting" && a.checkedInAt) {
    const note = arrivalNote(a);
    main = (
      <span className="flex flex-wrap items-center gap-x-2">
        <LiveTimer
          from={a.checkedInAt}
          label="Em espera há"
          tone="text-amber-600"
          alertAfterSec={
            waitingAlertMinutes ? waitingAlertMinutes * 60 : undefined
          }
        />
        {note && <span className="text-muted-foreground">{note}</span>}
      </span>
    );
  } else if (!a.attendance) {
    main = <LatenessTimer startsAt={a.starts_at} />;
  }

  if (!main && movers.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[11px]">
      {main && <p>{main}</p>}
      {movers.length > 0 && (
        <p className="text-muted-foreground">{movers.join(" · ")}</p>
      )}
    </div>
  );
}

export function AttendancePanel({
  appointments,
  canCheckIn,
  canCall,
  currentUserId,
  isAdmin,
  waitingAlertMinutes,
}: {
  appointments: PanelAppointment[];
  canCheckIn: boolean;
  canCall: boolean;
  currentUserId: string;
  isAdmin: boolean;
  /** H3.4: minutos de espera que disparam o destaque "Espera longa". */
  waitingAlertMinutes?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    onSuccess?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(msg);
        if (onSuccess) onSuccess();
        else router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  // Only whoever called the client may conclude (Admin always; the assigned
  // provider as a fallback when nobody is recorded as the caller).
  const canConclude = (a: PanelAppointment) =>
    isAdmin ||
    a.calledBy === currentUserId ||
    (a.calledBy === null && a.providerUserId === currentUserId);

  // H1.4: only the appointment's assigned professional calls the client
  // (Admin always; no assigned professional falls back to the role rule).
  const canCallRow = (a: PanelAppointment) =>
    canCall &&
    (isAdmin ||
      a.providerUserId === currentUserId ||
      a.providerUserId === null);

  const toArrive = appointments.filter(
    (a) =>
      !a.attendance &&
      a.status !== "cancelled" &&
      a.status !== "completed" &&
      a.status !== "no_show"
  );
  const waiting = appointments.filter((a) => a.attendance === "waiting");
  const inService = appointments.filter((a) => a.attendance === "in_service");
  // H3.4: quem desistiu da espera aparece junto dos concluídos (com selo).
  const done = appointments.filter(
    (a) => a.attendance === "done" || a.attendance === "gave_up"
  );

  // H1.3: a client cannot be in two attendances at once — while in service,
  // their other waiting cards lose the "Chamar" button (the DB blocks it too).
  const busyClientIds = new Set(
    inService.map((a) => a.clientId).filter((id): id is string => Boolean(id))
  );

  function time(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function Row({
    a,
    action,
  }: {
    a: PanelAppointment;
    action?: React.ReactNode;
  }) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border bg-card p-3">
        <div className="min-w-0">
          {a.clientId ? (
            <Link
              href={`/prontuarios/${a.clientId}`}
              className="text-sm font-medium hover:underline"
            >
              {a.clientName}
            </Link>
          ) : (
            <span className="text-sm font-medium">{a.clientName}</span>
          )}
          {a.clinicName && (
            <p className="text-[11px] font-medium text-primary">
              {a.clinicName}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {time(a.starts_at)}
            </span>
            <span>{APPOINTMENT_TYPE_LABELS[a.type]}</span>
            {a.providerName && (
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {a.providerName}
              </span>
            )}
          </p>
          <AttendanceTimers a={a} waitingAlertMinutes={waitingAlertMinutes} />
        </div>
        {action}
      </li>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            A chegar{" "}
            <Badge variant="secondary">{toArrive.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {toArrive.map((a) => (
              <Row
                key={a.id}
                a={a}
                action={
                  canCheckIn ? (
                    <span className="flex items-center gap-1">
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () => checkInAppointment(a.id),
                            `Chegada registrada: ${a.clientName}.`
                          )
                        }
                      >
                        Registrar chegada
                      </Button>
                      {/* H3.4: o cliente não veio / cancelou em cima da hora. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              aria-label="Outras opções"
                              className="h-8 px-1.5"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>
                              O cliente não veio?
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                run(
                                  () =>
                                    updateAppointmentStatus(a.id, "no_show"),
                                  `${a.clientName}: falta registrada.`
                                )
                              }
                            >
                              Não compareceu (faltou)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                run(
                                  () =>
                                    updateAppointmentStatus(a.id, "cancelled"),
                                  `${a.clientName}: agendamento cancelado.`
                                )
                              }
                            >
                              Cancelou em cima da hora
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  ) : null
                }
              />
            ))}
            {toArrive.length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Ninguém para chegar.
              </p>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Em espera <Badge variant="secondary">{waiting.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {waiting.map((a) => (
              <Row
                key={a.id}
                a={a}
                action={
                  <span className="flex items-center gap-1">
                    {a.clientId && busyClientIds.has(a.clientId) ? (
                      <span className="max-w-32 text-right text-[11px] text-muted-foreground">
                        Em atendimento com outro profissional
                      </span>
                    ) : canCallRow(a) ? (
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () => updateAttendance(a.id, "in_service"),
                            `${a.clientName} chamado(a).`,
                            () =>
                              a.clientId
                                ? router.push(`/prontuarios/${a.clientId}`)
                                : router.refresh()
                          )
                        }
                      >
                        Chamar
                      </Button>
                    ) : null}
                    {/* H3.4: o cliente desistiu de esperar. */}
                    {(canCheckIn ||
                      isAdmin ||
                      a.providerUserId === currentUserId) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () => updateAttendance(a.id, "gave_up"),
                            `${a.clientName}: desistência registrada.`
                          )
                        }
                      >
                        Desistiu
                      </Button>
                    )}
                  </span>
                }
              />
            ))}
            {waiting.length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Sala de espera vazia.
              </p>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Em atendimento{" "}
            <Badge variant="secondary">{inService.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {inService.map((a) => (
              <Row
                key={a.id}
                a={a}
                action={
                  canConclude(a) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => updateAttendance(a.id, "done"),
                          `Atendimento de ${a.clientName} concluído.`
                        )
                      }
                    >
                      Concluir
                    </Button>
                  ) : null
                }
              />
            ))}
            {inService.length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Ninguém em atendimento.
              </p>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Concluídos <Badge variant="secondary">{done.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {done.map((a) => (
              <Row key={a.id} a={a} />
            ))}
            {done.length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Nenhum atendimento concluído hoje.
              </p>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
