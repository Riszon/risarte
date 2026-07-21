"use client";

import { useMemo, useState } from "react";
import { CircleCheckBig } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AgendaFormConfig } from "../../agenda/actions";
import type { StaffOption } from "@/lib/appointments";
import {
  TreatmentSessionsPanel,
  type TreatmentSession,
} from "./treatment-sessions-panel";
import {
  ClientProceduresSection,
  type ProcedureRow,
} from "./client-procedures-section";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * Bloco único "Sessões & Procedimentos" — junta a linha do tempo do tratamento
 * (agendamento) e a lista de procedimentos (com controle de qualidade) num só
 * cartão, com filtros compartilhados (plano / procedimento / dentista) e uma
 * chave para alternar entre as duas visões. Antes eram dois blocos separados.
 */
export function TreatmentSection({
  clientId,
  clientName,
  clientInactive,
  canSchedule,
  staff,
  config,
  clinicId,
  canRequest,
  sessions,
  rows,
  finished,
}: {
  clientId: string;
  clientName: string;
  clientInactive: boolean;
  canSchedule: boolean;
  staff: StaffOption[];
  config?: AgendaFormConfig;
  clinicId: string;
  canRequest: boolean;
  sessions: TreatmentSession[];
  rows: ProcedureRow[];
  finished: { label: string; at: string | null; count: number }[];
}) {
  const hasTimeline = sessions.length > 0;
  const [view, setView] = useState<"timeline" | "procedures">(
    hasTimeline ? "timeline" : "procedures"
  );
  const [planFilter, setPlanFilter] = useState("");
  const [procFilter, setProcFilter] = useState("");
  const [dentistFilter, setDentistFilter] = useState("");
  const filter = { planId: planFilter, proc: procFilter, dentist: dentistFilter };

  // Opções de filtro (a partir dos procedimentos aprovados).
  const plans = useMemo(
    () => [...new Map(rows.map((r) => [r.planId, r.planLabel])).entries()],
    [rows]
  );
  const dentists = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.executorName) set.add(r.executorName);
      for (const s of r.sessions) if (s.providerName) set.add(s.providerName);
    }
    for (const s of sessions) {
      const p = s.appointment?.provider?.full_name ?? s.suggestedProviderName;
      if (p) set.add(p);
    }
    return [...set].sort();
  }, [rows, sessions]);

  // Mapa sessão → plano (para o selo do plano e o filtro na linha do tempo).
  const { planLabelById, planIdById } = useMemo(() => {
    const label = new Map<string, string>();
    const id = new Map<string, string>();
    for (const r of rows) {
      for (const s of r.sessions) {
        label.set(s.id, r.planLabel);
        id.set(s.id, r.planId);
      }
    }
    return { planLabelById: label, planIdById: id };
  }, [rows]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Sessões &amp; Procedimentos</CardTitle>
          {hasTimeline && (
            <div className="flex rounded-lg border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView("timeline")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium",
                  view === "timeline"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
              >
                Linha do tempo
              </button>
              <button
                type="button"
                onClick={() => setView("procedures")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium",
                  view === "procedures"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
              >
                Procedimentos
              </button>
            </div>
          )}
        </div>

        {/* Filtros compartilhados: plano / procedimento / dentista. */}
        <div className="flex flex-wrap items-center gap-2">
          {plans.length > 1 && (
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">Todos os planos</option>
              {plans.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <input
            value={procFilter}
            onChange={(e) => setProcFilter(e.target.value)}
            placeholder="Filtrar procedimento..."
            className={`${selectClass} min-w-[180px]`}
          />
          {dentists.length > 0 && (
            <select
              value={dentistFilter}
              onChange={(e) => setDentistFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">Todos os dentistas</option>
              {dentists.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {view === "timeline" && hasTimeline ? (
          <TreatmentSessionsPanel
            bare
            clientId={clientId}
            clientName={clientName}
            clientInactive={clientInactive}
            sessions={sessions}
            canSchedule={canSchedule}
            staff={staff}
            config={config}
            clinicId={clinicId}
            filter={filter}
            planLabelById={planLabelById}
            planIdById={planIdById}
          />
        ) : (
          <ClientProceduresSection
            bare
            clientId={clientId}
            canRequest={canRequest}
            rows={rows}
            filter={filter}
          />
        )}

        {finished.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
              <CircleCheckBig className="size-4" />
              Tratamentos finalizados
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Planos 100% concluídos e aprovados no controle de qualidade.
            </p>
            <ul className="space-y-1.5">
              {finished.map((t, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm"
                >
                  <span className="font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.count} procedimento(s)
                    {t.at
                      ? ` · aprovado em ${new Date(t.at).toLocaleDateString("pt-BR")}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
