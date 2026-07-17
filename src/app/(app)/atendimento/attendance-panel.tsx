"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock,
  CircleCheck,
  Clock,
  DoorClosed,
  DoorOpen,
  Hourglass,
  MoreHorizontal,
  Stethoscope,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPOINTMENT_TYPE_LABELS,
  TYPE_PROVIDER_ROLES,
  type AppointmentStatus,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";
import type { UserRole } from "@/lib/roles";
import {
  checkInAppointment,
  concludeAttendancePartial,
  swapAppointmentProvider,
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
  /** Sala/cadeira do atendimento (ou "ONLINE") — confirmação de check-in (H3.5). */
  roomName?: string | null;
  /** H3.4b: dia (YYYY-MM-DD) desde quando está pendente, se veio de dia anterior. */
  pendingSinceIso?: string | null;
  // Attendance timeline (for the per-visit history).
  checkedInAt?: string | null;
  calledAt?: string | null;
  doneAt?: string | null;
  checkedInByName?: string | null;
  calledByName?: string | null;
  doneByName?: string | null;
  /** H4.6 A1: sessões de tratamento em aberto ligadas a este atendimento. */
  sessions?: PanelSession[];
};

/** Uma sessão de tratamento pendente ligada ao atendimento (baixa parcial). */
export type PanelSession = {
  id: string;
  label: string;
  plannedMinutes: number | null;
};

/** Equipe da unidade para a troca de profissional (H3.6). */
export type SwapStaff = {
  userId: string;
  name: string;
  roles: string[];
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

/** Cores/ícone de cada etapa do fluxo (chegar → espera → atendimento → concluído). */
type StageKey = "arrive" | "waiting" | "service" | "done";
const STAGE: Record<
  StageKey,
  {
    label: string;
    icon: LucideIcon;
    border: string;
    tint: string;
    badge: string;
    row: string;
  }
> = {
  arrive: {
    label: "A chegar",
    icon: DoorOpen,
    border: "border-t-sky-400",
    tint: "text-sky-700",
    badge: "bg-sky-100 text-sky-800",
    row: "border-l-sky-300",
  },
  waiting: {
    label: "Em espera",
    icon: Hourglass,
    border: "border-t-amber-400",
    tint: "text-amber-700",
    badge: "bg-amber-100 text-amber-800",
    row: "border-l-amber-300",
  },
  service: {
    label: "Em atendimento",
    icon: Stethoscope,
    border: "border-t-violet-400",
    tint: "text-violet-700",
    badge: "bg-violet-100 text-violet-800",
    row: "border-l-violet-300",
  },
  done: {
    label: "Concluídos",
    icon: CircleCheck,
    border: "border-t-emerald-400",
    tint: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-800",
    row: "border-l-emerald-300",
  },
};

/** Coluna do quadro de fluxo: cartão com acento e contador na cor da etapa. */
function ColumnCard({
  stage,
  count,
  children,
}: {
  stage: StageKey;
  count: number;
  children: React.ReactNode;
}) {
  const s = STAGE[stage];
  const Icon = s.icon;
  return (
    <Card className={cn("border-t-4", s.border)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={cn("size-4 shrink-0", s.tint)} />
          {s.label}
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              s.badge
            )}
          >
            {count}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function AttendancePanel({
  appointments,
  canCheckIn,
  canCall,
  currentUserId,
  isAdmin,
  isDentist,
  waitingAlertMinutes,
  canSwapProvider,
  swapStaff,
}: {
  appointments: PanelAppointment[];
  canCheckIn: boolean;
  canCall: boolean;
  currentUserId: string;
  isAdmin: boolean;
  /** H4.6 A1: usuário atua como Dentista na unidade (confirma a baixa). */
  isDentist?: boolean;
  /** H3.4: minutos de espera que disparam o destaque "Espera longa". */
  waitingAlertMinutes?: number;
  /** H3.6: Recepção/Gerente pode trocar o profissional de última hora. */
  canSwapProvider?: boolean;
  swapStaff?: SwapStaff[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // H3.5: check-in passa por uma confirmação (profissional, horário e sala).
  const [confirmCheckIn, setConfirmCheckIn] = useState<PanelAppointment | null>(
    null
  );
  // H3.6: troca de profissional (qual atendimento + novo profissional + motivo).
  const [swapFor, setSwapFor] = useState<PanelAppointment | null>(null);
  const [swapProviderId, setSwapProviderId] = useState("");
  const [swapReason, setSwapReason] = useState("");
  // H4.6 A1: confirmação "O que foi feito hoje?" (baixa parcial das sessões).
  const [concludeFor, setConcludeFor] = useState<PanelAppointment | null>(null);
  const [doneChecks, setDoneChecks] = useState<Record<string, boolean>>({});
  const [notDoneReasons, setNotDoneReasons] = useState<
    Record<string, string>
  >({});

  function openConclude(a: PanelAppointment) {
    const checks: Record<string, boolean> = {};
    for (const s of a.sessions ?? []) checks[s.id] = true;
    setDoneChecks(checks);
    setNotDoneReasons({});
    setConcludeFor(a);
  }

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

  // H3.6: profissionais elegíveis para assumir o atendimento (pela função que
  // o tipo do compromisso exige), exceto o atual.
  const eligibleProviders = (a: PanelAppointment) => {
    const roles = TYPE_PROVIDER_ROLES[a.type];
    return (swapStaff ?? []).filter(
      (s) =>
        s.userId !== a.providerUserId &&
        s.roles.some((r) => roles.includes(r as UserRole))
    );
  };

  function openSwap(a: PanelAppointment) {
    setSwapFor(a);
    setSwapProviderId("");
    setSwapReason("");
  }

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
    accent,
  }: {
    a: PanelAppointment;
    action?: React.ReactNode;
    accent?: string;
  }) {
    const pendingSince = a.pendingSinceIso
      ? new Date(`${a.pendingSinceIso}T00:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        })
      : null;
    return (
      <li
        className={cn(
          "flex items-center justify-between gap-2 rounded-md border p-3",
          pendingSince
            ? "border-red-300 bg-red-50"
            : accent
              ? cn("border-l-2 bg-card", accent)
              : "bg-card"
        )}
      >
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
          {pendingSince && (
            <Badge
              variant="outline"
              className="ml-1 border-red-300 bg-red-100 text-[10px] text-red-700"
            >
              Pendente desde {pendingSince}
            </Badge>
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
    <>
      {/* H3.5: confirmação da chegada — profissional, horário e sala. */}
      <Dialog
        open={confirmCheckIn !== null}
        onOpenChange={(o) => !o && setConfirmCheckIn(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar chegada</DialogTitle>
            <DialogDescription>
              Confira os dados do atendimento com o cliente antes de registrar a
              chegada.
            </DialogDescription>
          </DialogHeader>
          {confirmCheckIn && (
            <div className="space-y-2 text-sm">
              <p className="text-base font-medium">
                {confirmCheckIn.clientName}
              </p>
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span>
                  {time(confirmCheckIn.starts_at)} ·{" "}
                  {APPOINTMENT_TYPE_LABELS[confirmCheckIn.type]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-muted-foreground" />
                <span>{confirmCheckIn.providerName ?? "Sem profissional"}</span>
              </div>
              <div className="flex items-center gap-2">
                <DoorClosed className="size-4 text-muted-foreground" />
                <span>{confirmCheckIn.roomName ?? "Sala a definir"}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCheckIn(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                const a = confirmCheckIn;
                if (!a) return;
                run(
                  () => checkInAppointment(a.id),
                  `Chegada registrada: ${a.clientName}.`,
                  () => {
                    setConfirmCheckIn(null);
                    router.refresh();
                  }
                );
              }}
            >
              Confirmar chegada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* H3.6: troca de profissional de última hora. */}
      <Dialog open={swapFor !== null} onOpenChange={(o) => !o && setSwapFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Trocar profissional</DialogTitle>
            <DialogDescription>
              Troca de última hora. A alteração fica registrada e todos os
              envolvidos (profissional anterior, novo, coordenador e gerente)
              são avisados.
            </DialogDescription>
          </DialogHeader>
          {swapFor && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">{swapFor.clientName}</span> ·{" "}
                {time(swapFor.starts_at)} ·{" "}
                {APPOINTMENT_TYPE_LABELS[swapFor.type]}
              </p>
              <p className="text-xs text-muted-foreground">
                Profissional atual: {swapFor.providerName ?? "—"}
              </p>
              <div className="space-y-1.5">
                <Label>Novo profissional *</Label>
                {eligibleProviders(swapFor).length > 0 ? (
                  <Select
                    items={eligibleProviders(swapFor).map((s) => ({
                      value: s.userId,
                      label: s.name,
                    }))}
                    value={swapProviderId || null}
                    onValueChange={(v) => v !== null && setSwapProviderId(v)}
                  >
                    <SelectTrigger className="w-full">
                      {swapProviderId ? (
                        <SelectValue />
                      ) : (
                        <span className="flex-1 text-left text-muted-foreground">
                          Escolha o profissional
                        </span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleProviders(swapFor).map((s) => (
                        <SelectItem key={s.userId} value={s.userId}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                    Não há outro profissional com a função necessária nesta
                    unidade.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="swap-reason">Motivo (opcional)</Label>
                <Input
                  id="swap-reason"
                  value={swapReason}
                  onChange={(e) => setSwapReason(e.target.value)}
                  placeholder="Ex.: imprevisto do profissional"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSwapFor(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              disabled={isPending || !swapProviderId}
              onClick={() => {
                const a = swapFor;
                if (!a || !swapProviderId) return;
                run(
                  () =>
                    swapAppointmentProvider(a.id, swapProviderId, swapReason),
                  `Profissional trocado no atendimento de ${a.clientName}.`,
                  () => {
                    setSwapFor(null);
                    router.refresh();
                  }
                );
              }}
            >
              Confirmar troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* H4.6 A1: confirmação do que foi feito (baixa parcial das sessões). */}
      <Dialog
        open={concludeFor !== null}
        onOpenChange={(o) => !o && setConcludeFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>O que foi feito hoje?</DialogTitle>
            <DialogDescription>
              Marque as sessões que você concluiu neste atendimento. As não
              marcadas voltam para “a agendar” e a recepção é avisada para
              reagendar.
            </DialogDescription>
          </DialogHeader>
          {concludeFor && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{concludeFor.clientName}</p>
              <ul className="space-y-2">
                {(concludeFor.sessions ?? []).map((s) => {
                  const done = doneChecks[s.id] ?? true;
                  return (
                    <li key={s.id} className="rounded-md border p-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-primary"
                          checked={done}
                          onChange={(e) =>
                            setDoneChecks((prev) => ({
                              ...prev,
                              [s.id]: e.target.checked,
                            }))
                          }
                        />
                        <span className="flex-1">
                          <span
                            className={
                              done
                                ? ""
                                : "text-muted-foreground line-through"
                            }
                          >
                            {s.label}
                          </span>
                          {s.plannedMinutes ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {s.plannedMinutes} min
                            </span>
                          ) : null}
                        </span>
                      </label>
                      {!done && (
                        <Input
                          className="mt-2"
                          placeholder="Motivo (opcional)"
                          value={notDoneReasons[s.id] ?? ""}
                          onChange={(e) =>
                            setNotDoneReasons((prev) => ({
                              ...prev,
                              [s.id]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              {(concludeFor.sessions ?? []).length > 0 &&
                (concludeFor.sessions ?? []).every(
                  (s) => !(doneChecks[s.id] ?? true)
                ) && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                    Nenhuma sessão marcada como feita — todas voltarão para “a
                    agendar”.
                  </p>
                )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConcludeFor(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                const a = concludeFor;
                if (!a) return;
                const sessions = a.sessions ?? [];
                const doneIds = sessions
                  .filter((s) => doneChecks[s.id] ?? true)
                  .map((s) => s.id);
                const reasons: Record<string, string> = {};
                for (const s of sessions) {
                  const done = doneChecks[s.id] ?? true;
                  const reason = (notDoneReasons[s.id] ?? "").trim();
                  if (!done && reason) reasons[s.id] = reason;
                }
                run(
                  () => concludeAttendancePartial(a.id, doneIds, reasons),
                  `Atendimento de ${a.clientName} concluído.`,
                  () => {
                    setConcludeFor(null);
                    router.refresh();
                  }
                );
              }}
            >
              Concluir atendimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ColumnCard stage="arrive" count={toArrive.length}>
          <ul className="space-y-2">
            {toArrive.map((a) => (
              <Row
                key={a.id}
                a={a}
                accent={STAGE.arrive.row}
                action={
                  canCheckIn ? (
                    <span className="flex items-center gap-1">
                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => setConfirmCheckIn(a)}
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
                            {canSwapProvider && a.providerUserId && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => openSwap(a)}>
                                  Trocar profissional
                                </DropdownMenuItem>
                              </>
                            )}
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
        </ColumnCard>

        <ColumnCard stage="waiting" count={waiting.length}>
          <ul className="space-y-2">
            {waiting.map((a) => (
              <Row
                key={a.id}
                a={a}
                accent={STAGE.waiting.row}
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
                    {/* H3.4/H3.6: desistência da espera / troca de profissional. */}
                    {(canCheckIn ||
                      isAdmin ||
                      a.providerUserId === currentUserId ||
                      (canSwapProvider && Boolean(a.providerUserId))) && (
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
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuGroup>
                            {canSwapProvider && a.providerUserId && (
                              <DropdownMenuItem onClick={() => openSwap(a)}>
                                Trocar profissional
                              </DropdownMenuItem>
                            )}
                            {(canCheckIn ||
                              isAdmin ||
                              a.providerUserId === currentUserId) && (
                              <DropdownMenuItem
                                onClick={() =>
                                  run(
                                    () => updateAttendance(a.id, "gave_up"),
                                    `${a.clientName}: desistência registrada.`
                                  )
                                }
                              >
                                Desistiu da espera
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
        </ColumnCard>

        <ColumnCard stage="service" count={inService.length}>
          <ul className="space-y-2">
            {inService.map((a) => (
              <Row
                key={a.id}
                a={a}
                accent={STAGE.service.row}
                action={
                  a.sessions && a.sessions.length > 0 ? (
                    // H4.6 A1: atendimento com sessões — só o Dentista (ou Admin)
                    // conclui, confirmando o que foi feito.
                    canConclude(a) && (isDentist || isAdmin) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => openConclude(a)}
                      >
                        Concluir
                      </Button>
                    ) : null
                  ) : canConclude(a) ? (
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
        </ColumnCard>

        <ColumnCard stage="done" count={done.length}>
          <ul className="space-y-2">
            {done.map((a) => (
              <Row key={a.id} a={a} accent={STAGE.done.row} />
            ))}
            {done.length === 0 && (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Nenhum atendimento concluído hoje.
              </p>
            )}
          </ul>
        </ColumnCard>
      </div>
    </>
  );
}
