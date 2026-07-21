"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  Clock,
  Link2,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMinutes } from "@/lib/pricing";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import { AppointmentInfoDialog } from "../../agenda/appointment-info-dialog";
import type { AgendaFormConfig } from "../../agenda/actions";
import type { StaffOption } from "@/lib/appointments";
import {
  requestSessionScheduling,
  suggestTreatmentSeries,
} from "./treatment-actions";
import {
  type TreatmentSession,
} from "./treatment-sessions-panel";
import { type ProcedureRow } from "./client-procedures-section";

// -- Helpers de data --------------------------------------------------------
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtYmd(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// -- Estado do procedimento (sessões) ---------------------------------------
const STATE_META: Record<
  ProcedureRow["state"],
  { label: string; dot: string; pill: string; icon: typeof CircleDashed }
> = {
  none: {
    label: "A agendar",
    dot: "bg-muted-foreground/40",
    pill: "border-border bg-muted text-muted-foreground",
    icon: CircleDashed,
  },
  open: {
    label: "Em aberto",
    dot: "bg-amber-500",
    pill: "border-amber-300 bg-amber-50 text-amber-800",
    icon: CircleDashed,
  },
  scheduled: {
    label: "Agendado",
    dot: "bg-primary",
    pill: "border-primary/30 bg-primary/10 text-primary",
    icon: CalendarCheck,
  },
  done: {
    label: "Concluído",
    dot: "bg-emerald-500",
    pill: "border-emerald-300 bg-emerald-50 text-emerald-800",
    icon: CircleCheck,
  },
};

// -- Controle de qualidade --------------------------------------------------
const QC_META: Record<
  "aprovado" | "revisao" | "reprovado",
  { label: string; pill: string; dot: string }
> = {
  aprovado: {
    label: "Aprovado",
    pill: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  revisao: {
    label: "Em revisão",
    pill: "border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  reprovado: {
    label: "Reprovado",
    pill: "border-rose-300 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
};

// -- Filtro por status (chips) ----------------------------------------------
type StatusKey =
  | "open"
  | "scheduled"
  | "done"
  | "none"
  | "revisao"
  | "reprovado"
  | "aprovado";

const STATUS_DEFS: { key: StatusKey; label: string; match: (r: ProcedureRow) => boolean }[] = [
  { key: "open", label: "Em aberto", match: (r) => r.state === "open" },
  { key: "scheduled", label: "Agendados", match: (r) => r.state === "scheduled" },
  { key: "none", label: "Sem agendamento", match: (r) => r.state === "none" },
  { key: "done", label: "Concluídos", match: (r) => r.state === "done" },
  { key: "aprovado", label: "Aprovados", match: (r) => r.qualityStatus === "aprovado" },
  { key: "revisao", label: "Em revisão", match: (r) => r.qualityStatus === "revisao" },
  { key: "reprovado", label: "Reprovados", match: (r) => r.qualityStatus === "reprovado" },
];

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Filtros.
  const [statusFilter, setStatusFilter] = useState<StatusKey | "">("");
  const [planFilter, setPlanFilter] = useState("");
  const [procFilter, setProcFilter] = useState("");
  const [dentistFilter, setDentistFilter] = useState("");

  // Sessões abertas por procedimento (expandir/recolher).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpanded(itemId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // Agendar várias sessões juntas (mesmo horário).
  const [joinSel, setJoinSel] = useState<Set<string>>(new Set());
  const [joinOpen, setJoinOpen] = useState(false);
  const [suggestDate, setSuggestDate] = useState(todayIso());

  // Dados ricos das sessões (agendamento) por id.
  const richById = useMemo(() => {
    const m = new Map<string, TreatmentSession>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  // Opções de filtro.
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
    return [...set].sort();
  }, [rows]);

  // Contagem por status (para os chips).
  const statusCounts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      open: 0, scheduled: 0, done: 0, none: 0,
      revisao: 0, reprovado: 0, aprovado: 0,
    };
    for (const r of rows) for (const d of STATUS_DEFS) if (d.match(r)) c[d.key]++;
    return c;
  }, [rows]);

  // Aplica os filtros.
  const filtered = rows.filter((r) => {
    if (statusFilter) {
      const def = STATUS_DEFS.find((d) => d.key === statusFilter);
      if (def && !def.match(r)) return false;
    }
    if (planFilter && r.planId !== planFilter) return false;
    if (procFilter && !r.procedureName.toLowerCase().includes(procFilter.toLowerCase()))
      return false;
    if (dentistFilter) {
      const has =
        r.executorName === dentistFilter ||
        r.sessions.some((s) => s.providerName === dentistFilter);
      if (!has) return false;
    }
    return true;
  });

  // Resumo do tratamento.
  const summary = useMemo(() => {
    const procTotal = rows.length;
    const procDone = rows.filter((r) => r.state === "done").length;
    const allSess = rows.flatMap((r) => r.sessions);
    const sessTotal = allSess.length;
    const sessDone = allSess.filter((s) => s.state === "done").length;
    const withQc = rows.filter((r) => r.qualityStatus);
    const qcApproved = rows.filter((r) => r.qualityStatus === "aprovado").length;
    const qcPending = rows.filter(
      (r) => r.qualityStatus === "revisao" || r.qualityStatus === "reprovado"
    ).length;
    // Tempo de cadeira / previsão a partir das sessões ricas (Fase 5).
    const plannedMin = sessions.reduce((a, s) => a + (s.plannedMinutes ?? 0), 0);
    const realMin = sessions
      .filter((s) => s.status === "done")
      .reduce((a, s) => a + (s.actualMinutes ?? 0), 0);
    const future: string[] = [];
    for (const s of sessions) {
      if (s.status === "done") continue;
      if (s.appointment) future.push(s.appointment.starts_at.slice(0, 10));
      else if (s.plannedDate) future.push(s.plannedDate);
    }
    future.sort();
    const forecast = future.length ? future[future.length - 1] : null;
    return {
      procTotal, procDone, sessTotal, sessDone,
      withQc: withQc.length, qcApproved, qcPending,
      plannedMin, realMin, forecast,
    };
  }, [rows, sessions]);

  const pendingRich = sessions.filter((s) => s.status === "pending");
  const joinList = pendingRich.filter((s) => joinSel.has(s.id));
  const joinIds = joinList.map((s) => s.id);
  const joinSumMin = joinList.reduce((a, s) => a + (s.plannedMinutes ?? 0), 0);
  const joinMinutes =
    joinSumMin > 0 ? Math.max(15, Math.round(joinSumMin / 15) * 15) : undefined;
  const joinProviderId =
    joinList.find((s) => s.suggestedProviderId)?.suggestedProviderId ?? undefined;
  const joinDate =
    joinList.map((s) => s.plannedDate).filter((d): d is string => Boolean(d)).sort()[0] ??
    undefined;

  const anyOpen = rows.some((r) => r.state === "open" || r.state === "none");
  const hasRichPending = canSchedule && pendingRich.length > 0;

  function toggleJoin(id: string) {
    setJoinSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function suggest() {
    startTransition(async () => {
      const r = await suggestTreatmentSeries(clientId, suggestDate);
      if (r.ok) {
        toast.success("Datas sugeridas para a série.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }
  function requestScheduling() {
    startTransition(async () => {
      const r = await requestSessionScheduling(clientId);
      if (r.ok) {
        toast.success("Solicitação enviada à Recepção.");
        router.refresh();
      } else toast.error(r.error ?? "Não foi possível enviar a solicitação.");
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Sessões &amp; Procedimentos</CardTitle>
          {canRequest && anyOpen && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={requestScheduling}>
              <Send className="mr-1 size-3.5" />
              Solicitar agendamento à Recepção
            </Button>
          )}
        </div>

        {/* Resumo compacto do tratamento. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile
            label="Procedimentos"
            value={`${summary.procDone}/${summary.procTotal}`}
            hint="concluídos"
          />
          <SummaryTile
            label="Sessões"
            value={
              summary.sessTotal > 0
                ? `${summary.sessDone}/${summary.sessTotal}`
                : "—"
            }
            hint={summary.sessTotal > 0 ? "realizadas" : "sem sessões"}
          />
          <SummaryTile
            label="Qualidade"
            value={
              summary.withQc > 0
                ? `${summary.qcApproved}/${summary.withQc}`
                : "—"
            }
            hint={
              summary.qcPending > 0
                ? `${summary.qcPending} p/ resolver`
                : summary.withQc > 0
                  ? "aprovados"
                  : "não avaliado"
            }
            alert={summary.qcPending > 0}
          />
          {summary.plannedMin > 0 ? (
            <SummaryTile
              label="Tempo de cadeira"
              value={formatMinutes(summary.plannedMin)}
              hint={
                summary.realMin > 0
                  ? `${formatMinutes(summary.realMin)} feitos`
                  : "previsto"
              }
            />
          ) : (
            <SummaryTile
              label="Previsão"
              value={summary.forecast ? fmtYmd(summary.forecast) : "—"}
              hint={summary.forecast ? "última sessão" : "sugira as datas"}
            />
          )}
        </div>

        {/* Chips de status (filtro). */}
        <div className="flex flex-wrap gap-1.5">
          <StatusChip
            label="Todos"
            count={rows.length}
            active={statusFilter === ""}
            onClick={() => setStatusFilter("")}
          />
          {STATUS_DEFS.filter((d) => statusCounts[d.key] > 0).map((d) => (
            <StatusChip
              key={d.key}
              label={d.label}
              count={statusCounts[d.key]}
              active={statusFilter === d.key}
              onClick={() =>
                setStatusFilter((cur) => (cur === d.key ? "" : d.key))
              }
            />
          ))}
        </div>

        {/* Filtros secundários (plano / procedimento / dentista). */}
        {(plans.length > 1 || dentists.length > 0 || rows.length > 3) && (
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
              placeholder="Buscar procedimento..."
              className={`${selectClass} min-w-[160px] flex-1`}
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
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Ações da série (Fase 5). */}
        {hasRichPending && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm">
            <CalendarRange className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Sugerir datas a partir de:</span>
            <Input
              type="date"
              value={suggestDate}
              onChange={(e) => setSuggestDate(e.target.value)}
              className="h-8 w-40"
            />
            <Button size="sm" variant="outline" disabled={isPending} onClick={suggest}>
              Sugerir datas
            </Button>
          </div>
        )}
        {canSchedule && joinList.length >= 1 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-sm">
            <span className="font-medium">
              {joinList.length}{" "}
              {joinList.length === 1 ? "sessão selecionada" : "sessões selecionadas"}
              {joinMinutes ? ` · ${formatMinutes(joinMinutes)}` : ""}
            </span>
            <Button size="sm" onClick={() => setJoinOpen(true)}>
              <CalendarPlus className="mr-1 size-3.5" />
              {joinList.length > 1 ? "Agendar juntas" : "Agendar sessão"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setJoinSel(new Set())}>
              Limpar
            </Button>
          </div>
        )}

        {/* Lista de procedimentos. */}
        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
            Nenhum procedimento com esse filtro.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => (
              <ProcedureCard
                key={r.itemId}
                row={r}
                open={expanded.has(r.itemId)}
                onToggle={() => toggleExpanded(r.itemId)}
                richById={richById}
                canSchedule={canSchedule}
                joinSel={joinSel}
                onToggleJoin={toggleJoin}
                clientId={clientId}
                clientName={clientName}
                clientInactive={clientInactive}
                staff={staff}
                config={config}
                clinicId={clinicId}
              />
            ))}
          </ul>
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

      {/* Formulário para agendar as sessões marcadas juntas. */}
      {canSchedule && joinOpen && (
        <AppointmentFormDialog
          open={joinOpen}
          onOpenChange={(o) => {
            if (!o) {
              setJoinOpen(false);
              setJoinSel(new Set());
            }
          }}
          clients={[{ id: clientId, full_name: clientName, inactive: clientInactive }]}
          staff={staff}
          config={config}
          initialClientId={clientId}
          initialSessionIds={joinIds}
          initialDuration={joinMinutes}
          initialProviderId={joinProviderId}
          initialDate={joinDate}
          fixedClinicId={clinicId}
        />
      )}
    </Card>
  );
}

// -- Cartão de um procedimento ----------------------------------------------
function ProcedureCard({
  row,
  open,
  onToggle,
  richById,
  canSchedule,
  joinSel,
  onToggleJoin,
  clientId,
  clientName,
  clientInactive,
  staff,
  config,
  clinicId,
}: {
  row: ProcedureRow;
  open: boolean;
  onToggle: () => void;
  richById: Map<string, TreatmentSession>;
  canSchedule: boolean;
  joinSel: Set<string>;
  onToggleJoin: (id: string) => void;
  clientId: string;
  clientName: string;
  clientInactive: boolean;
  staff: StaffOption[];
  config?: AgendaFormConfig;
  clinicId: string;
}) {
  const meta = STATE_META[row.state];
  const qc = row.qualityStatus ? QC_META[row.qualityStatus] : null;
  // A "bolinha" prioriza atenção do controle de qualidade.
  const dot =
    row.qualityStatus === "revisao" || row.qualityStatus === "reprovado"
      ? QC_META[row.qualityStatus].dot
      : meta.dot;
  const doneCount = row.sessions.filter((s) => s.state === "done").length;
  const hasSessions = row.sessions.length > 0;

  return (
    <li className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasSessions}
        className={cn(
          "flex w-full items-start gap-2.5 p-3 text-left",
          hasSessions && "hover:bg-muted/40"
        )}
      >
        <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", dot)} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{row.procedureName}</span>
            <Badge variant="secondary" className="text-[10px]">
              {row.planLabel}
            </Badge>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                meta.pill
              )}
            >
              <meta.icon className="size-3" />
              {meta.label}
            </span>
            {qc && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  qc.pill
                )}
              >
                {row.qualityStatus === "aprovado" ? (
                  <CircleCheck className="size-3" />
                ) : row.qualityStatus === "reprovado" ? (
                  <XCircle className="size-3" />
                ) : (
                  <RotateCcw className="size-3" />
                )}
                {qc.label}
              </span>
            )}
            {hasSessions && (
              <span className="text-[11px] text-muted-foreground">
                {doneCount}/{row.sessions.length} sessões
              </span>
            )}
            {row.executorName && (
              <span className="text-[11px] text-muted-foreground">
                · {row.executorName}
              </span>
            )}
          </span>
          {qc &&
            (row.qualityStatus === "revisao" || row.qualityStatus === "reprovado") &&
            row.qualityNote && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Motivo: {row.qualityNote}
              </span>
            )}
        </span>
        {hasSessions && (
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90"
            )}
          />
        )}
      </button>

      {/* Sessões do procedimento. */}
      {open && hasSessions && (
        <ul className="space-y-1.5 border-t bg-muted/20 px-3 py-2.5">
          {row.sessions.map((s, i) => {
            const rich = richById.get(s.id);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                {canSchedule && s.state === "open" && rich && (
                  <input
                    type="checkbox"
                    checked={joinSel.has(s.id)}
                    onChange={() => onToggleJoin(s.id)}
                    aria-label="Selecionar sessão para agendar junto"
                  />
                )}
                <Clock className="size-3 text-muted-foreground" />
                <span className="font-medium">Sessão {i + 1}</span>
                {s.state === "done" ? (
                  <span className="text-emerald-700">
                    concluída{s.doneAt ? ` em ${fmtDate(s.doneAt)}` : ""}
                    {s.executorName ? ` · ${s.executorName}` : ""}
                  </span>
                ) : s.state === "scheduled" && rich?.appointment ? (
                  <AppointmentInfoDialog
                    appointment={rich.appointment}
                    trigger={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20"
                      >
                        <CalendarCheck className="size-3" />
                        {s.appointmentAt ? fmtDateTime(s.appointmentAt) : "agendada"}
                        {s.providerName ? ` · ${s.providerName}` : ""}
                      </button>
                    }
                  />
                ) : s.state === "scheduled" ? (
                  <span className="text-primary">
                    {s.appointmentAt ? fmtDateTime(s.appointmentAt) : "agendada"}
                    {s.providerName ? ` · ${s.providerName}` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {s.plannedDate
                      ? `prevista ${fmtYmd(s.plannedDate)}`
                      : "aguardando agendamento"}
                  </span>
                )}
                {rich?.joinKey && s.state === "open" && (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <Link2 className="size-3" /> conjunto
                  </span>
                )}
                {canSchedule && s.state === "open" && rich && (
                  <AppointmentFormDialog
                    clients={[
                      { id: clientId, full_name: clientName, inactive: clientInactive },
                    ]}
                    staff={staff}
                    config={config}
                    initialClientId={clientId}
                    initialDate={rich.plannedDate ?? undefined}
                    initialDuration={
                      rich.plannedMinutes
                        ? Math.max(15, Math.round(rich.plannedMinutes / 15) * 15)
                        : undefined
                    }
                    initialProviderId={rich.suggestedProviderId ?? undefined}
                    treatmentSessionId={rich.id}
                    fixedClinicId={clinicId}
                    trigger={
                      <Button size="sm" variant="outline" className="ml-auto h-7">
                        <CalendarPlus className="mr-1 size-3" />
                        Agendar
                      </Button>
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// -- Tile do resumo ---------------------------------------------------------
function SummaryTile({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        alert ? "border-rose-300 bg-rose-50" : "bg-muted/40"
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-base font-semibold", alert && "text-rose-700")}>
        {value}
      </p>
      {hint && (
        <p
          className={cn(
            "text-[11px]",
            alert ? "text-rose-600" : "text-muted-foreground"
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

// -- Chip de status ---------------------------------------------------------
function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-muted"
        )}
      >
        {count}
      </span>
    </button>
  );
}
