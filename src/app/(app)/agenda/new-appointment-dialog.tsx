"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  type AppointmentType,
} from "@/lib/appointments";
import { createAppointment } from "./actions";

const TYPE_ITEMS = APPOINTMENT_TYPES.map((t) => ({
  value: t,
  label: APPOINTMENT_TYPE_LABELS[t],
}));

const DURATION_ITEMS = [
  { value: "30", label: "30 minutos" },
  { value: "45", label: "45 minutos" },
  { value: "60", label: "1 hora" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2 horas" },
];

export function NewAppointmentDialog({
  clients,
}: {
  clients: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [type, setType] = useState<AppointmentType>("evaluation");
  const [duration, setDuration] = useState("60");

  const clientItems = clients.map((c) => ({
    value: c.id,
    label: c.full_name,
  }));

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("client_id", clientId);
    formData.set("type", type);
    formData.set("duration", duration);

    startTransition(async () => {
      const result = await createAppointment(formData);
      if (result.ok) {
        toast.success("Agendamento criado.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Novo agendamento</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>
            Compromisso na clínica ativa. O cliente precisa estar cadastrado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
            <Select
              items={clientItems}
              value={clientId || null}
              onValueChange={(v) => v !== null && setClientId(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o cliente" />
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
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select
              items={TYPE_ITEMS}
              value={type}
              onValueChange={(v) => v !== null && setType(v as AppointmentType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Data *</Label>
              <Input id="date" name="date" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Horário *</Label>
              <Input id="time" name="time" type="time" required />
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
            <Input id="notes" name="notes" placeholder="Opcional" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !clientId}>
              {isPending ? "Agendando..." : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
