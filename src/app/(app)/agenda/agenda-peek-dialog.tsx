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
import { getMonthAgendaPeek, type PeekDay } from "./actions";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// H3.2: cor de fundo por estado do dia.
const STATE_CELL: Record<PeekDay["state"], string> = {
  normal: "",
  closed: "bg-muted/60 text-muted-foreground",
  holiday_closed: "bg-red-50 text-red-700",
  holiday_pending: "bg-amber-50 text-amber-800",
  holiday_open: "bg-emerald-50/60",
  open_day: "bg-gold/10 border-gold/50",
  plan_block: "bg-red-50 text-red-700",
};

const STATE_TAG: Partial<Record<PeekDay["state"], string>> = {
  closed: "Fechado",
  holiday_closed: "Feriado",
  holiday_pending: "Feriado?",
  holiday_open: "Feriado ✓",
  open_day: "Avulso",
  plan_block: "Bloqueado",
};

/**
 * "Ver agenda" (GR1 + H3.2): calendário do mês com a situação de cada dia —
 * agendamentos, horários LIVRES para o contexto escolhido (profissional/sala/
 * duração), feriados, fechamentos, dias avulsos e bloqueios do planejamento
 * anual. Clicar num dia disponível devolve a data ao formulário (que então já
 * lista os horários livres daquele dia).
 */
export function AgendaPeekDialog({
  clinicId,
  providerUserId,
  roomId,
  isOnline,
  durationMin,
  onPickDate,
}: {
  clinicId: string;
  /** Contexto do formulário — os horários livres são calculados para ele. */
  providerUserId?: string | null;
  roomId?: string | null;
  isOnline?: boolean;
  durationMin?: number;
  onPickDate: (dateIso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(() => new Date());
  const [days, setDays] = useState<Record<string, PeekDay>>({});
  const [isPending, startTransition] = useTransition();

  const todayIso = toIsoDate(new Date());

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const data = await getMonthAgendaPeek({
        clinicId,
        monthRefIso: ref.toISOString(),
        providerUserId: providerUserId || null,
        roomId: roomId || null,
        isOnline: Boolean(isOnline),
        durationMin: durationMin || 60,
      });
      setDays(data);
    });
  }, [open, ref, clinicId, providerUserId, roomId, isOnline, durationMin]);

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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ver agenda</DialogTitle>
          <DialogDescription>
            Cada dia mostra os agendamentos e os horários livres
            {providerUserId ? " do profissional escolhido" : " da unidade"}.
            Clique num dia disponível para agendar nele.
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
            const info = days[iso];
            const state = info?.state ?? "normal";
            const blocked =
              state === "closed" ||
              state === "holiday_closed" ||
              state === "plan_block";
            const tag = STATE_TAG[state];
            return (
              <button
                key={i}
                type="button"
                disabled={isPast || blocked}
                title={info?.note ?? undefined}
                onClick={() => {
                  onPickDate(iso);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-16 flex-col items-center gap-0.5 rounded-md border p-1 text-xs transition-colors",
                  STATE_CELL[state],
                  !inMonth && "opacity-40",
                  isPast || blocked
                    ? "cursor-not-allowed"
                    : "hover:border-primary hover:bg-primary/5",
                  isPast && "text-muted-foreground",
                  iso === todayIso && "border-primary"
                )}
              >
                <span className="font-medium">{d.getDate()}</span>
                {tag && (
                  <span className="rounded bg-background/70 px-1 text-[9px] font-medium leading-tight">
                    {tag}
                  </span>
                )}
                {info && !isPast && (
                  <span className="space-x-1 text-[10px] leading-tight">
                    {info.count > 0 && (
                      <span className="rounded-full bg-muted px-1">
                        {info.count} ag.
                      </span>
                    )}
                    {info.free !== null && !blocked && (
                      <span
                        className={cn(
                          "font-medium",
                          info.free > 0 ? "text-emerald-700" : "text-red-600"
                        )}
                      >
                        {info.free} livre{info.free === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-muted" /> Fechado
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-red-200" /> Feriado/Bloqueio
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-amber-200" /> Feriado a confirmar
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-gold/40" /> Dia avulso
          </span>
          <span className="text-emerald-700">N livres = horários disponíveis</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
