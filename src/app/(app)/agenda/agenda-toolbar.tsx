import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AGENDA_VIEWS,
  agendaHref,
  toIsoDate,
  type AgendaRange,
  type AgendaView,
} from "@/lib/agenda-view";

/** View switcher (Dia/Semana/Mês) + previous/today/next navigation. */
export function AgendaToolbar({
  view,
  range,
  unidade,
}: {
  view: AgendaView;
  range: AgendaRange;
  unidade?: string;
}) {
  const todayIso = toIsoDate(new Date());
  const refIso = toIsoDate(range.start);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border p-0.5">
        {AGENDA_VIEWS.map((v) => (
          <Link
            key={v.key}
            href={agendaHref(v.key, refIso, unidade)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm",
              view === v.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={agendaHref(view, toIsoDate(range.prev), unidade)} />}
      >
        ← Anterior
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={agendaHref(view, todayIso, unidade)} />}
      >
        Hoje
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={agendaHref(view, toIsoDate(range.next), unidade)} />}
      >
        Próximo →
      </Button>
    </div>
  );
}
