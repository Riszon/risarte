"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPOINTMENT_TYPE_LABELS,
  type AppointmentStatus,
  type AppointmentType,
  type AttendanceStatus,
} from "@/lib/appointments";
import { checkInAppointment, updateAttendance } from "../agenda/actions";

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
};

export function AttendancePanel({
  appointments,
  canCheckIn,
  canCall,
  currentUserId,
  isAdmin,
}: {
  appointments: PanelAppointment[];
  canCheckIn: boolean;
  canCall: boolean;
  currentUserId: string;
  isAdmin: boolean;
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

  const toArrive = appointments.filter(
    (a) =>
      !a.attendance &&
      a.status !== "cancelled" &&
      a.status !== "completed" &&
      a.status !== "no_show"
  );
  const waiting = appointments.filter((a) => a.attendance === "waiting");
  const inService = appointments.filter((a) => a.attendance === "in_service");
  const done = appointments.filter((a) => a.attendance === "done");

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
              href={`/clientes/${a.clientId}`}
              className="text-sm font-medium hover:underline"
            >
              {a.clientName}
            </Link>
          ) : (
            <span className="text-sm font-medium">{a.clientName}</span>
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
                  canCall ? (
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => updateAttendance(a.id, "in_service"),
                          `${a.clientName} chamado(a).`,
                          () =>
                            a.clientId
                              ? router.push(`/clientes/${a.clientId}`)
                              : router.refresh()
                        )
                      }
                    >
                      Chamar
                    </Button>
                  ) : null
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
