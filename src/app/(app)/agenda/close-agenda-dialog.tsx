"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
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
import type { StaffOption } from "@/lib/appointments";
import { ROLE_LABELS } from "@/lib/roles";
import {
  CLOSURE_REASONS,
  CLOSURE_REASON_LABELS,
  CLOSURE_SCOPES,
  CLOSURE_SCOPE_LABELS,
  type AgendaClosure,
  type ClosureScope,
} from "@/lib/closures";
import { createAgendaClosure, updateAgendaClosure } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

// 15-min time options (same style as the scheduling form).
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const m = Math.round(d.getMinutes() / 15) * 15;
  const hh = m === 60 ? d.getHours() + 1 : d.getHours();
  const mm = m === 60 ? 0 : m;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function CloseAgendaDialog({
  clinicId,
  rooms,
  staff,
  closure,
  trigger,
}: {
  clinicId: string;
  rooms: { id: string; name: string }[];
  staff: StaffOption[];
  /** When set, the dialog edits this closure instead of creating one. */
  closure?: AgendaClosure;
  trigger?: React.ReactElement<Record<string, unknown>>;
}) {
  const isEdit = Boolean(closure);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const today = toLocalDate(new Date().toISOString());
  const [startDate, setStartDate] = useState(
    closure ? toLocalDate(closure.startsAt) : today
  );
  const [startTime, setStartTime] = useState(
    closure ? toLocalTime(closure.startsAt) : "08:00"
  );
  const [endDate, setEndDate] = useState(
    closure ? toLocalDate(closure.endsAt) : today
  );
  const [endTime, setEndTime] = useState(
    closure ? toLocalTime(closure.endsAt) : "18:00"
  );
  const [reason, setReason] = useState(closure?.reason ?? "maintenance");
  const [scope, setScope] = useState<ClosureScope>(closure?.scope ?? "unit");
  const [note, setNote] = useState(closure?.note ?? "");
  const [selRooms, setSelRooms] = useState<Set<string>>(
    new Set(closure?.roomIds ?? [])
  );
  const [selProviders, setSelProviders] = useState<Set<string>>(
    new Set(closure?.providerIds ?? [])
  );

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function save() {
    const formData = new FormData();
    formData.set("clinic_id", clinicId);
    formData.set("starts_at", `${startDate}T${startTime}`);
    formData.set("ends_at", `${endDate}T${endTime}`);
    formData.set("reason", reason);
    formData.set("scope", scope);
    formData.set("note", note);
    if (scope === "rooms") {
      for (const id of selRooms) formData.append("room_ids", id);
    }
    if (scope === "providers") {
      for (const id of selProviders) formData.append("provider_ids", id);
    }
    startTransition(async () => {
      const result = isEdit
        ? await updateAgendaClosure(closure!.id, formData)
        : await createAgendaClosure(formData);
      if (result.ok) {
        toast.success(
          isEdit ? "Fechamento alterado." : "Agenda fechada para o período."
        );
        setOpen(false);
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Editing can shift many appointments — confirm first.
    if (isEdit && !confirming) {
      setConfirming(true);
      return;
    }
    save();
  }

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      <Lock className="mr-1 size-3.5" />
      Fechar agenda
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirming(false);
      }}
    >
      <DialogTrigger render={trigger ?? defaultTrigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar fechamento" : "Fechar agenda"}
          </DialogTitle>
          <DialogDescription>
            Bloqueia novos agendamentos no período. Quem já estiver agendado
            recebe um alerta para remarcar.
          </DialogDescription>
        </DialogHeader>

        {isEdit && closure && (
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            <p className="font-medium">Fechamento atual:</p>
            <p className="text-muted-foreground">
              {CLOSURE_REASON_LABELS[closure.reason]} ·{" "}
              {new Date(closure.startsAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              →{" "}
              {new Date(closure.endsAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {CLOSURE_SCOPE_LABELS[closure.scope]}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Início — dia *</Label>
              <Input
                id="startDate"
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startTime">Início — hora *</Label>
              <select
                id="startTime"
                className={selectClass}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">Fim — dia *</Label>
              <Input
                id="endDate"
                type="date"
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endTime">Fim — hora *</Label>
              <select
                id="endTime"
                className={selectClass}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo *</Label>
            <select
              id="reason"
              className={selectClass}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {CLOSURE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CLOSURE_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Abrangência *</Label>
            <div className="space-y-1">
              {CLOSURE_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={scope === s}
                    onChange={() => setScope(s)}
                  />
                  {CLOSURE_SCOPE_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          {scope === "rooms" && (
            <div className="space-y-1.5">
              <Label>Salas que ficam fechadas *</Label>
              {rooms.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma sala cadastrada.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {rooms.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selRooms.has(r.id)}
                        onChange={() => setSelRooms((s) => toggle(s, r.id))}
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {scope === "providers" && (
            <div className="space-y-1.5">
              <Label>Profissionais indisponíveis *</Label>
              {staff.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum profissional cadastrado.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {staff.map((s) => (
                    <label
                      key={s.userId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selProviders.has(s.userId)}
                        onChange={() =>
                          setSelProviders((p) => toggle(p, s.userId))
                        }
                      />
                      {s.name}
                      <span className="text-xs text-muted-foreground">
                        {s.roles.map((role) => ROLE_LABELS[role]).join(", ")}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Observação</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          {confirming && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              Tem certeza? A edição pode alterar vários agendamentos já marcados
              no período. Eles serão sinalizados para remarcar.
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Salvando..."
                : isEdit
                  ? confirming
                    ? "Confirmar alteração"
                    : "Salvar alteração"
                  : "Fechar agenda"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
