"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_LABELS,
  PHASE_APPOINTMENT_TYPE,
  TYPE_PROVIDER_ROLES,
  appointmentTypeOptions,
  type AppointmentType,
  type StaffOption,
} from "@/lib/appointments";
import { PHASE_LABELS } from "@/lib/journey";
import { ROLE_LABELS } from "@/lib/roles";
import {
  createAppointment,
  getClientSchedulingInfo,
  updateAppointment,
  type SchedulingInfo,
} from "./actions";

const DURATION_ITEMS = [
  { value: "30", label: "30 minutos" },
  { value: "45", label: "45 minutos" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
];

// Time slots every 5 minutes (the native time picker ignores `step`).
const TIME_ITEMS: { value: string; label: string }[] = [];
for (let hour = 6; hour <= 21; hour++) {
  for (let minute = 0; minute < 60; minute += 5) {
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    TIME_ITEMS.push({ value, label: value });
  }
}

export type AppointmentDefaults = {
  id: string;
  type: AppointmentType;
  starts_at: string;
  ends_at: string;
  provider_user_id: string | null;
  notes: string | null;
  clientName: string;
};

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const minutes = Math.round(d.getMinutes() / 5) * 5;
  const h = minutes === 60 ? d.getHours() + 1 : d.getHours();
  const m = minutes === 60 ? 0 : minutes;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function AppointmentFormDialog({
  clients,
  staff,
  appointment,
  trigger,
}: {
  clients: { id: string; full_name: string }[];
  staff: StaffOption[];
  /** When set, the dialog edits/reschedules this appointment. */
  appointment?: AppointmentDefaults;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const isEdit = Boolean(appointment);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [schedulingInfo, setSchedulingInfo] = useState<SchedulingInfo | null>(
    null
  );
  const [type, setType] = useState<AppointmentType>(
    appointment?.type ?? "evaluation"
  );
  const [providerId, setProviderId] = useState(
    appointment?.provider_user_id ?? ""
  );
  const [time, setTime] = useState(
    appointment ? toLocalTime(appointment.starts_at) : ""
  );
  const [duration, setDuration] = useState(
    appointment
      ? String(
          Math.round(
            (new Date(appointment.ends_at).getTime() -
              new Date(appointment.starts_at).getTime()) /
              60_000
          )
        )
      : "60"
  );

  const clientItems = clients.map((c) => ({ value: c.id, label: c.full_name }));

  // The type follows the journey when creating; editing keeps all options.
  const typeOptions = isEdit
    ? [...APPOINTMENT_TYPES]
    : appointmentTypeOptions(schedulingInfo?.phase ?? null);
  const typeItems = typeOptions.map((t) => ({
    value: t,
    label: APPOINTMENT_TYPE_LABELS[t],
  }));

  const providerItems = useMemo(() => {
    const allowedRoles = TYPE_PROVIDER_ROLES[type];
    return staff
      .filter((s) => s.roles.some((role) => allowedRoles.includes(role)))
      .map((s) => ({ value: s.userId, label: s.name }));
  }, [staff, type]);

  const allowedRoleLabels = TYPE_PROVIDER_ROLES[type]
    .map((role) => ROLE_LABELS[role])
    .join(" ou ");

  const providerValid = providerItems.some((p) => p.value === providerId);
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const lastWasMissed =
    schedulingInfo?.lastAppointment &&
    ["cancelled", "no_show"].includes(schedulingInfo.lastAppointment.status);

  function handleClientChange(id: string) {
    setClientId(id);
    setSchedulingInfo(null);
    startTransition(async () => {
      const info = await getClientSchedulingInfo(id);
      setSchedulingInfo(info);
      if (info) {
        // Scheduling follows the journey.
        setType(PHASE_APPOINTMENT_TYPE[info.phase]);
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (!isEdit) formData.set("client_id", clientId);
    formData.set("type", type);
    formData.set("time", time);
    formData.set("duration", duration);
    formData.set("provider_user_id", providerValid ? providerId : "");

    startTransition(async () => {
      const result = isEdit
        ? await updateAppointment(appointment!.id, formData)
        : await createAppointment(formData);
      if (result.ok) {
        toast.success(isEdit ? "Agendamento alterado." : "Agendamento criado.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Alterar agendamento — ${appointment!.clientName}`
              : "Novo agendamento"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Toda alteração fica registrada no histórico."
              : "O tipo do compromisso segue a fase da Jornada do cliente."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select
                items={clientItems}
                value={clientId || null}
                onValueChange={(v) => v !== null && handleClientChange(v)}
              >
                <SelectTrigger className="w-full">
                  {clientId ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      Escolha o cliente
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {clientItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isEdit && schedulingInfo && (
            <div className="space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
              <p className="flex items-center gap-1">
                <Info className="size-3.5 shrink-0 text-primary" />
                Fase atual:{" "}
                <span className="font-medium">
                  {PHASE_LABELS[schedulingInfo.phase]}
                </span>
                {" → "}será agendado:{" "}
                <span className="font-medium">
                  {
                    APPOINTMENT_TYPE_LABELS[
                      PHASE_APPOINTMENT_TYPE[schedulingInfo.phase]
                    ]
                  }
                </span>
              </p>
              {lastWasMissed && (
                <p className="font-medium text-destructive">
                  O último agendamento foi{" "}
                  {schedulingInfo!.lastAppointment!.status === "cancelled"
                    ? "cancelado"
                    : "uma falta"}{" "}
                  — o cliente continua na fase atual (reagendamento).
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select
              items={typeItems}
              value={typeOptions.includes(type) ? type : null}
              onValueChange={(v) => {
                if (v !== null) setType(v as AppointmentType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(type === "urgency" || type === "emergency") && (
              <p className="text-xs text-muted-foreground">
                {APPOINTMENT_TYPE_LABELS[type]} permite encaixe: pode ser
                marcada mesmo em horário já ocupado.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Profissional responsável *</Label>
            {providerItems.length > 0 ? (
              <Select
                items={providerItems}
                value={providerValid ? providerId : null}
                onValueChange={(v) => v !== null && setProviderId(v)}
              >
                <SelectTrigger className="w-full">
                  {providerValid ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      Escolha o profissional
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {providerItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                Nenhum usuário com a função {allowedRoleLabels} nesta clínica.
                Peça ao Admin Master para cadastrar.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data *</Label>
              <Input
                id="date"
                name="date"
                type="date"
                required
                min={minDate}
                defaultValue={
                  appointment ? toLocalDate(appointment.starts_at) : ""
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Horário *</Label>
              <Select
                items={TIME_ITEMS}
                value={time || null}
                onValueChange={(v) => v !== null && setTime(v)}
              >
                <SelectTrigger className="w-full">
                  {time ? (
                    <SelectValue />
                  ) : (
                    <span className="flex-1 text-left text-muted-foreground">
                      --:--
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent>
                  {TIME_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Duração</Label>
            <Select
              items={DURATION_ITEMS}
              value={duration}
              onValueChange={(v) => v !== null && setDuration(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Input
              id="notes"
              name="notes"
              placeholder="Opcional"
              defaultValue={appointment?.notes ?? ""}
            />
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                isPending || (!isEdit && !clientId) || !providerValid || !time
              }
            >
              {isPending
                ? "Salvando..."
                : isEdit
                  ? "Salvar alterações"
                  : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
