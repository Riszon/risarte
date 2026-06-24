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
  type ClosureScope,
} from "@/lib/closures";
import { createAgendaClosure } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function CloseAgendaDialog({
  clinicId,
  rooms,
  staff,
}: {
  clinicId: string;
  rooms: { id: string; name: string }[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [scope, setScope] = useState<ClosureScope>("unit");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("clinic_id", clinicId);
    formData.set("scope", scope);
    startTransition(async () => {
      const result = await createAgendaClosure(formData);
      if (result.ok) {
        toast.success("Agenda fechada para o período.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Lock className="mr-1 size-3.5" />
            Fechar agenda
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fechar agenda</DialogTitle>
          <DialogDescription>
            Bloqueia novos agendamentos no período. Quem já estiver agendado
            recebe um alerta para remarcar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="starts_at">Início *</Label>
              <Input
                id="starts_at"
                name="starts_at"
                type="datetime-local"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ends_at">Fim *</Label>
              <Input id="ends_at" name="ends_at" type="datetime-local" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Motivo *</Label>
            <select id="reason" name="reason" className={selectClass}>
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
                      <input type="checkbox" name="room_ids" value={r.id} />
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
                        name="provider_ids"
                        value={s.userId}
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
            <Input id="note" name="note" placeholder="Opcional" />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Fechando..." : "Fechar agenda"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
