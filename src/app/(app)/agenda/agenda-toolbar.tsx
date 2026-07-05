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
  salas,
}: {
  view: AgendaView;
  range: AgendaRange;
  unidade?: string;
  /** Room filter (?salas=), preserved when switching view / navigating. */
  salas?: string;
}) {
  const todayIso = toIsoDate(new Date());
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border p-0.5">
        {/* H2.5/H2.6: trocar de visão sempre parte de HOJE (Dia abre o dia de
            hoje; Mês abre o mês atual), não do início do período anterior. */}
        {AGENDA_VIEWS.map((v) => (
          <Link
            key={v.key}
            href={agendaHref(v.key, todayIso, unidade, salas)}
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
        render={
          <Link href={agendaHref(view, toIsoDate(range.prev), unidade, salas)} />
        }
      >
        ← Anterior
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={agendaHref(view, todayIso, unidade, salas)} />}
      >
        Hoje
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <Link href={agendaHref(view, toIsoDate(range.next), unidade, salas)} />
        }
      >
        Próximo →
      </Button>
    </div>
  );
}
