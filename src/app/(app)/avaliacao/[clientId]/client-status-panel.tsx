import {
  Activity,
  CalendarClock,
  CalendarCheck2,
  Layers,
  ListChecks,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bloco A do cockpit — painel de status do cliente (topo). Um resumo rápido que
 * o Coordenador consulta durante toda a avaliação/reavaliação: andamento do
 * tratamento, procedimentos, atendimentos e planos. A situação financeira/
 * inadimplência depende do módulo financeiro (ASAAS) — ainda placeholder.
 */
export type ClientStatus = {
  treatmentPct: number | null;
  procDone: number;
  procOpen: number;
  lastVisit: string | null;
  nextVisit: string | null;
  upcomingCount: number;
  plansOngoing: number;
};

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}
function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

export function ClientStatusPanel({ status }: { status: ClientStatus }) {
  const pct = status.treatmentPct;
  return (
    <div className="shrink-0 rounded-xl border bg-card p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {/* Andamento do tratamento (%). */}
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Activity className="size-3" /> Andamento
          </p>
          {pct === null ? (
            <p className="text-sm font-semibold text-muted-foreground">—</p>
          ) : (
            <>
              <p className="text-base font-semibold">{pct}%</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct >= 100 ? "bg-emerald-500" : "bg-primary"
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Procedimentos: finalizados × em aberto. */}
        <StatTile
          icon={ListChecks}
          label="Procedimentos"
          value={`${status.procDone} finalizados`}
          hint={`${status.procOpen} em aberto`}
        />

        {/* Último atendimento. */}
        <StatTile
          icon={CalendarCheck2}
          label="Último atend."
          value={status.lastVisit ? fmtDay(status.lastVisit) : "—"}
          hint={status.lastVisit ? "realizado" : "nenhum ainda"}
        />

        {/* Próximos agendados. */}
        <StatTile
          icon={CalendarClock}
          label="Próximos"
          value={
            status.upcomingCount > 0 ? String(status.upcomingCount) : "—"
          }
          hint={
            status.nextVisit
              ? fmtDayTime(status.nextVisit)
              : "sem agendamentos"
          }
          highlight={status.upcomingCount > 0}
        />

        {/* Planos em andamento. */}
        <StatTile
          icon={Layers}
          label="Planos"
          value={String(status.plansOngoing)}
          hint="em andamento"
        />

        {/* Financeiro — placeholder até o módulo ASAAS. */}
        <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Wallet className="size-3" /> Financeiro
          </p>
          <p className="text-sm font-medium text-muted-foreground">Em breve</p>
          <p className="text-[11px] text-muted-foreground">integração ASAAS</p>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  highlight = false,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2",
        highlight ? "border border-primary/30 bg-primary/5" : "bg-muted/40"
      )}
    >
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" /> {label}
      </p>
      <p className="text-base font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
