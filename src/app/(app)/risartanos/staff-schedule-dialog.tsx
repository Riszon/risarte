"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveStaffSchedule } from "./actions";

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type StaffScheduleUnit = { clinicId: string; clinicName: string };
export type StaffScheduleData = {
  weekdays: number[];
  dates: string[];
  note: string;
};

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function UnitScheduleEditor({
  staffMemberId,
  unit,
  initial,
}: {
  staffMemberId: string;
  unit: StaffScheduleUnit;
  initial: StaffScheduleData;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [weekdays, setWeekdays] = useState<number[]>(initial.weekdays);
  const [dates, setDates] = useState<string[]>(initial.dates);
  const [newDate, setNewDate] = useState("");
  const [note, setNote] = useState(initial.note);

  function toggleDay(d: number) {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  }
  function addDate() {
    if (/^\d{4}-\d{2}-\d{2}$/.test(newDate) && !dates.includes(newDate)) {
      setDates((prev) => [...prev, newDate].sort());
      setNewDate("");
    }
  }
  function save() {
    startSaving(async () => {
      const res = await saveStaffSchedule({
        staffMemberId,
        clinicId: unit.clinicId,
        weekdays,
        dates,
        note,
      });
      if (res.ok) {
        toast.success(`Dias salvos — ${unit.clinicName}.`);
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{unit.clinicName}</p>

      <div className="space-y-1.5">
        <Label>Dias da semana</Label>
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_LABELS.map((label, d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm transition-colors",
                weekdays.includes(d)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Datas específicas</Label>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="h-9 w-44"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addDate}
            disabled={!newDate}
          >
            Adicionar
          </Button>
        </div>
        {dates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {dates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs"
              >
                {fmtDate(d)}
                <button
                  type="button"
                  onClick={() => setDates((prev) => prev.filter((x) => x !== d))}
                  aria-label="Remover data"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`note-${unit.clinicId}`}>Observação (opcional)</Label>
        <Input
          id={`note-${unit.clinicId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: quinzenal (semanas pares)"
        />
      </div>

      <Button size="sm" onClick={save} disabled={saving}>
        Salvar {unit.clinicName}
      </Button>
    </div>
  );
}

export function StaffScheduleDialog({
  staffMemberId,
  staffName,
  units,
  schedules,
}: {
  staffMemberId: string;
  staffName: string;
  units: StaffScheduleUnit[];
  schedules: Record<string, StaffScheduleData>;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <CalendarDays className="mr-1 size-4" /> Dias
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dias de atendimento — {staffName}</DialogTitle>
          <DialogDescription>
            Defina, em cada unidade, os dias em que este dentista atende. Ajuda a
            evitar agendar em unidades diferentes no mesmo dia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma unidade sob sua gestão para este colaborador.
            </p>
          ) : (
            units.map((u) => (
              <UnitScheduleEditor
                key={u.clinicId}
                staffMemberId={staffMemberId}
                unit={u}
                initial={
                  schedules[u.clinicId] ?? { weekdays: [], dates: [], note: "" }
                }
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
