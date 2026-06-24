"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { startOfWeek, toIsoDate } from "@/lib/agenda-view";
import { getMonthDayCounts } from "./actions";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/**
 * "Ver agenda" picker (GR1): a pop-up month calendar showing how busy each day
 * is; clicking a day feeds that date back to the scheduling form.
 */
export function AgendaPeekDialog({
  clinicId,
  onPickDate,
}: {
  clinicId: string;
  onPickDate: (dateIso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(() => new Date());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isPending, startTransition] = useTransition();

  const todayIso = toIsoDate(new Date());

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const data = await getMonthDayCounts(clinicId, ref.toISOString());
      setCounts(data);
    });
  }, [open, ref, clinicId]);

  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  function shiftMonth(delta: number) {
    setRef(new Date(ref.getFullYear(), ref.getMonth() + delta, 1));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <CalendarDays className="mr-1 size-3.5" />
            Ver agenda
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ver agenda</DialogTitle>
          <DialogDescription>
            Clique num dia para agendar nele. O número mostra quantos
            agendamentos o dia já tem.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => shiftMonth(-1)}>
            ← Anterior
          </Button>
          <span className="text-sm font-medium capitalize">
            {monthStart.toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => shiftMonth(1)}>
            Próximo →
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className={cn("grid grid-cols-7 gap-1", isPending && "opacity-60")}>
          {cells.map((d, i) => {
            const iso = toIsoDate(d);
            const inMonth = d.getMonth() === monthStart.getMonth();
            const isPast = iso < todayIso;
            const count = counts[iso] ?? 0;
            return (
              <button
                key={i}
                type="button"
                disabled={isPast}
                onClick={() => {
                  onPickDate(iso);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-12 flex-col items-center rounded-md border p-1 text-xs transition-colors",
                  !inMonth && "opacity-40",
                  isPast
                    ? "cursor-not-allowed text-muted-foreground"
                    : "hover:border-primary hover:bg-primary/5",
                  iso === todayIso && "border-primary"
                )}
              >
                <span className="font-medium">{d.getDate()}</span>
                {count > 0 && (
                  <span className="mt-0.5 rounded-full bg-muted px-1 text-[10px]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
