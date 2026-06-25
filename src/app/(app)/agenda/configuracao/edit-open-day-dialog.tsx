"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
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
import { updateSpecialDay } from "../actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

export function EditOpenDayDialog({
  openDay,
  staff,
}: {
  openDay: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    note: string | null;
    staffIds: string[];
  };
  staff: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(openDay.date);
  const [startTime, setStartTime] = useState(openDay.startTime);
  const [endTime, setEndTime] = useState(openDay.endTime);
  const [note, setNote] = useState(openDay.note ?? "");
  const [sel, setSel] = useState<Set<string>>(new Set(openDay.staffIds));

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await updateSpecialDay(
        openDay.id,
        date,
        startTime,
        endTime,
        [...sel],
        note
      );
      if (result.ok) {
        toast.success("Dia avulso atualizado. Os envolvidos foram notificados.");
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-0.5 px-2 text-xs"
          >
            <Pencil className="size-3" />
            Editar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar dia avulso</DialogTitle>
          <DialogDescription>
            Ao salvar, os profissionais escalados recebem uma notificação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="od-date">Dia</Label>
              <Input
                id="od-date"
                type="date"
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="od-start">Início</Label>
              <select
                id="od-start"
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
            <div>
              <Label htmlFor="od-end">Fim</Label>
              <select
                id="od-end"
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

          <div>
            <Label>Quem estará disponível</Label>
            {staff.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum profissional cadastrado.
              </p>
            ) : (
              <div className="mt-1 flex flex-col gap-1">
                {staff.map((s) => (
                  <label key={s.userId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={sel.has(s.userId)}
                      onChange={() => toggle(s.userId)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="od-note">Observação</Label>
            <Input
              id="od-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <DialogFooter>
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
