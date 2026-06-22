import Link from "next/link";
import { cn } from "@/lib/utils";
import { agendaHref, startOfWeek, toIsoDate } from "@/lib/agenda-view";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointments";
import type { AgendaAppointment } from "./week-grid";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Month calendar (B1): one cell per day with the day's appointments; clicking
 * a day opens that day's view. Read-only — scheduling/editing is done in the
 * day/week views. */
export function MonthView({
  monthStartIso,
  appointments,
  unidade,
}: {
  monthStartIso: string;
  appointments: AgendaAppointment[];
  unidade?: string;
}) {
  const monthStart = new Date(monthStartIso);
  const month = monthStart.getMonth();
  const gridStart = startOfWeek(monthStart);
  const today = new Date();

  const byDay = new Map<string, AgendaAppointment[]>();
  for (const a of appointments) {
    const key = new Date(a.starts_at).toDateString();
    const list = byDay.get(key);
    if (list) list.push(a);
    else byDay.set(key, [a]);
  }

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="space-y-1" style={{ minWidth: 700 }}>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = d.toDateString() === today.toDateString();
          const dayAppts = (byDay.get(d.toDateString()) ?? []).sort((a, b) =>
            a.starts_at.localeCompare(b.starts_at)
          );
          return (
            <Link
              key={i}
              href={agendaHref("dia", toIsoDate(d), unidade)}
              className={cn(
                "flex min-h-24 flex-col gap-0.5 rounded-md border p-1 text-xs transition-colors hover:border-primary",
                !inMonth && "opacity-40",
                isToday && "border-primary bg-primary/5"
              )}
            >
              <span className={cn("font-medium", isToday && "text-primary")}>
                {d.getDate()}
              </span>
              {dayAppts.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className="truncate rounded bg-muted px-1 py-0.5 text-[10px]"
                  title={`${APPOINTMENT_TYPE_LABELS[a.type]} — ${a.clients?.full_name ?? ""}`}
                >
                  {new Date(a.starts_at).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  {a.clients?.full_name ?? "—"}
                </span>
              ))}
              {dayAppts.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{dayAppts.length - 3} mais
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
