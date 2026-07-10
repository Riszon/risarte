"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, CalendarRange, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinutes } from "@/lib/pricing";
import { AppointmentFormDialog } from "../../agenda/appointment-form-dialog";
import { AppointmentInfoDialog } from "../../agenda/appointment-info-dialog";
import type { AgendaAppointment } from "../../agenda/week-grid";
import type { AgendaFormConfig } from "../../agenda/actions";
import type { StaffOption } from "@/lib/appointments";
import { suggestTreatmentSeries } from "./treatment-actions";

export type TreatmentSession = {
  id: string;
  procedureId: string | null;
  procedureName: string;
  sessionIndex: number;
  sessionTotal: number;
  name: string | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  status: "pending" | "scheduled" | "done";
  /** H4.3 Lote 2: data sugerida ("YYYY-MM-DD"), ou null. */
  plannedDate: string | null;
  /** H4.5: etapa do tratamento (denormalizada), ou null. */
  stageName: string | null;
  stageOrder: number | null;
  /** H4.5 Pedido 1: profissional indicado pelo Planner para o procedimento. */
  plannerProviderId: string | null;
  /** H4.5 Lote 3: profissional sugerido para esta sessão (pré-seleciona ao
   * agendar) + o motivo da sugestão. */
  suggestedProviderId: string | null;
  suggestedProviderName: string | null;
  suggestionReason: string | null;
  /** H3.14: agendamento vinculado (quando/quem) — permite abrir os detalhes. */
  appointment: AgendaAppointment | null;
};

/** "YYYY-MM-DD" → "DD/MM/AAAA". */
function formatPlanned(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "YYYY-MM-DD" → "DD/MM". */
function formatShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** H3.14: "DD/MM às HH:MM" a partir do horário do agendamento. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} às ${time}`;
}

/** Data efetiva da sessão ("YYYY-MM-DD"): agendamento > data prevista. */
function effectiveDateIso(s: TreatmentSession): string | null {
  if (s.appointment) return s.appointment.starts_at.slice(0, 10);
  if (s.plannedDate) return s.plannedDate;
  return null;
}

function parseYmd(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Dias inteiros entre duas datas "YYYY-MM-DD". */
function daysBetween(aIso: string, bIso: string): number {
  return Math.round(
    (parseYmd(bIso).getTime() - parseYmd(aIso).getTime()) / 86_400_000
  );
}

/** Duração humana: "5 dias" | "3 semanas" | "4 meses". */
function humanSpan(days: number): string {
  if (days < 14) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} semanas`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "mês" : "meses"}`;
}

const STATUS_LABEL: Record<TreatmentSession["status"], string> = {
  pending: "A agendar",
  scheduled: "Agendado",
  done: "Concluído",
};

const STATUS_DOT: Record<TreatmentSession["status"], string> = {
  pending: "bg-muted-foreground/40",
  scheduled: "bg-primary",
  done: "bg-emerald-500",
};

export function TreatmentSessionsPanel({
  clientId,
  clientName,
  clientInactive,
  sessions,
  canSchedule,
  staff,
  config,
  clinicId,
}: {
  clientId: string;
  clientName: string;
  clientInactive: boolean;
  sessions: TreatmentSession[];
  canSchedule: boolean;
  staff: StaffOption[];
  config?: AgendaFormConfig;
  clinicId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(todayIso());

  // H4.5 Lote 4: selecionar 2+ sessões pendentes e agendá-las juntas.
  const [joinSel, setJoinSel] = useState<Set<string>>(new Set());
  const [joinOpen, setJoinOpen] = useState(false);
  function toggleJoin(id: string) {
    setJoinSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // H4.5 Lote 2: agrupa por ETAPA (na ordem stage_order); dentro da etapa, as
  // sessões formam uma linha do tempo (ordenadas pela data efetiva).
  type StageGroup = {
    key: string;
    label: string | null;
    order: number;
    sessions: TreatmentSession[];
  };
  const stageMap = new Map<string, StageGroup>();
  for (const s of sessions) {
    const key = s.stageName ?? "__none__";
    let sg = stageMap.get(key);
    if (!sg) {
      sg = { key, label: s.stageName, order: s.stageOrder ?? 9999, sessions: [] };
      stageMap.set(key, sg);
    }
    sg.sessions.push(s);
  }
  const stageGroups = [...stageMap.values()].sort((a, b) => a.order - b.order);
  for (const sg of stageGroups) {
    sg.sessions.sort((a, b) => {
      const da = effectiveDateIso(a) ?? "9999-99-99";
      const db = effectiveDateIso(b) ?? "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      if (a.procedureName !== b.procedureName)
        return a.procedureName.localeCompare(b.procedureName);
      return a.sessionIndex - b.sessionIndex;
    });
  }
  const hasStages = sessions.some((s) => s.stageName);

  const pending = sessions.filter((s) => s.status === "pending").length;
  const done = sessions.filter((s) => s.status === "done").length;
  const hasSuggestions = sessions.some((s) => s.plannedDate);
  const totalChairMinutes = sessions.reduce(
    (sum, s) => sum + (s.plannedMinutes ?? 0),
    0
  );

  // H4.5 Lote 4: sessões pendentes marcadas para agendar juntas.
  const joinList = sessions.filter(
    (s) => s.status === "pending" && joinSel.has(s.id)
  );
  const joinIds = joinList.map((s) => s.id);
  const joinSumMin = joinList.reduce((a, s) => a + (s.plannedMinutes ?? 0), 0);
  const joinMinutes =
    joinSumMin > 0 ? Math.max(15, Math.round(joinSumMin / 15) * 15) : undefined;
  const joinProviderId =
    joinList.find((s) => s.suggestedProviderId)?.suggestedProviderId ?? undefined;
  const joinDate =
    joinList
      .map((s) => s.plannedDate)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? undefined;

  // Intervalo (dias) entre cada sessão datada e a anterior, na ordem do calendário.
  const dated = sessions
    .map((s) => ({ s, date: effectiveDateIso(s) }))
    .filter((x): x is { s: TreatmentSession; date: string } => x.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const intervalById = new Map<string, number>();
  for (let i = 1; i < dated.length; i++) {
    intervalById.set(dated[i].s.id, daysBetween(dated[i - 1].date, dated[i].date));
  }
  const firstDate = dated.length ? dated[0].date : null;
  const lastDate = dated.length ? dated[dated.length - 1].date : null;
  const spanDays =
    firstDate && lastDate && firstDate !== lastDate
      ? daysBetween(firstDate, lastDate)
      : null;

  // Realizado: tempo de cadeira efetivo (sessões feitas) e duração já decorrida
  // (da 1ª à última sessão concluída).
  const realChairMinutes = sessions
    .filter((s) => s.status === "done")
    .reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0);
  const doneDates = sessions
    .filter((s) => s.status === "done")
    .map(effectiveDateIso)
    .filter((d): d is string => d !== null)
    .sort();
  const doneSpanDays =
    doneDates.length >= 2
      ? daysBetween(doneDates[0], doneDates[doneDates.length - 1])
      : null;

  // H4.3 Lote 3: intervalo médio REAL entre as sessões já feitas (deste paciente).
  const doneTimes = sessions
    .filter((s) => s.status === "done" && s.appointment)
    .map((s) => new Date(s.appointment!.starts_at).getTime())
    .sort((a, b) => a - b);
  let realAvgDays: number | null = null;
  if (doneTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < doneTimes.length; i++) {
      sum += (doneTimes[i] - doneTimes[i - 1]) / 86_400_000;
    }
    realAvgDays = Math.round(sum / (doneTimes.length - 1));
  }

  // Previsão de conclusão: a última data entre as sessões ainda não concluídas
  // (agendadas usam o agendamento; pendentes usam a data prevista).
  const futureDates: string[] = [];
  for (const s of sessions) {
    if (s.status === "done") continue;
    if (s.appointment) futureDates.push(s.appointment.starts_at.slice(0, 10));
    else if (s.plannedDate) futureDates.push(s.plannedDate);
  }
  futureDates.sort();
  const forecast = futureDates.length ? futureDates[futureDates.length - 1] : null;
  const forecastPartial = sessions.some(
    (s) => s.status !== "done" && !s.appointment && !s.plannedDate
  );

  function suggest() {
    startTransition(async () => {
      const result = await suggestTreatmentSeries(clientId, startDate);
      if (result.ok) {
        toast.success("Datas sugeridas para toda a série.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Linha do tempo do tratamento{" "}
          {pending > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({pending} a agendar)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Resumo do tratamento (H4.5 Lote 2) — previsto × realizado. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatPair
            label="Sessões"
            planned={String(sessions.length)}
            actual={`${done} ${done === 1 ? "feita" : "feitas"}`}
          />
          <StatPair
            label="Tempo de cadeira"
            planned={formatMinutes(totalChairMinutes)}
            actual={realChairMinutes > 0 ? formatMinutes(realChairMinutes) : "—"}
          />
          <StatPair
            label="Duração"
            planned={
              spanDays !== null
                ? humanSpan(spanDays)
                : firstDate
                  ? "—"
                  : "sugira as datas"
            }
            actual={doneSpanDays !== null ? humanSpan(doneSpanDays) : "—"}
            plannedHint={
              firstDate && lastDate && spanDays !== null
                ? `${formatShort(firstDate)} → ${formatShort(lastDate)}`
                : undefined
            }
          />
          <Stat
            label="Intervalo médio real"
            value={realAvgDays !== null ? `${realAvgDays} dias` : "—"}
            hint={
              realAvgDays !== null ? "entre as feitas" : "após 2 sessões feitas"
            }
          />
          <Stat
            label="Previsão de conclusão"
            value={forecast ? formatPlanned(forecast) : "—"}
            hint={
              forecast
                ? forecastPartial
                  ? "parcial — sugira as demais"
                  : "última sessão prevista"
                : "sugira as datas"
            }
          />
        </div>

        {canSchedule && pending > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm">
            <CalendarRange className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Sugerir datas da série a partir de:
            </span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 w-40"
            />
            <Button size="sm" variant="outline" disabled={isPending} onClick={suggest}>
              {isPending
                ? "Calculando..."
                : hasSuggestions
                  ? "Recalcular"
                  : "Sugerir datas"}
            </Button>
            <span className="text-xs text-muted-foreground">
              respeita o intervalo mínimo do protocolo e pula dias fechados.
            </span>
          </div>
        )}

        {/* H4.5 Lote 4: agendar as sessões marcadas juntas no mesmo horário. */}
        {canSchedule && joinList.length >= 1 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-sm">
            <span className="font-medium">
              {joinList.length}{" "}
              {joinList.length === 1
                ? "sessão selecionada"
                : "sessões selecionadas"}
              {joinMinutes ? ` · ${formatMinutes(joinMinutes)}` : ""}
            </span>
            <Button size="sm" onClick={() => setJoinOpen(true)}>
              <CalendarPlus className="mr-1 size-3.5" />
              {joinList.length > 1
                ? "Agendar juntas no mesmo horário"
                : "Agendar sessão"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setJoinSel(new Set())}
            >
              Limpar
            </Button>
          </div>
        )}

        {stageGroups.map((sg) => {
          const stageMinutes = sg.sessions.reduce(
            (sum, s) => sum + (s.plannedMinutes ?? 0),
            0
          );
          const stageDates = sg.sessions
            .map(effectiveDateIso)
            .filter((d): d is string => d !== null)
            .sort();
          const stageWindow =
            stageDates.length > 0
              ? stageDates.length > 1 &&
                stageDates[0] !== stageDates[stageDates.length - 1]
                ? `${formatShort(stageDates[0])} → ${formatShort(
                    stageDates[stageDates.length - 1]
                  )}`
                : formatShort(stageDates[0])
              : null;
          return (
            <div key={sg.key} className="space-y-1.5">
              {hasStages && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <p className="flex items-center gap-1 text-sm font-semibold">
                    <Layers className="size-3.5 text-muted-foreground" />
                    {sg.label ?? "Sem etapa"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sg.sessions.length}{" "}
                    {sg.sessions.length === 1 ? "sessão" : "sessões"} ·{" "}
                    {formatMinutes(stageMinutes)}
                    {stageWindow ? ` · ${stageWindow}` : ""}
                  </p>
                </div>
              )}
              <ul className={hasStages ? "space-y-0" : "space-y-0"}>
                {sg.sessions.map((s) => {
                  const interval = intervalById.get(s.id) ?? null;
                  return (
                    <li key={s.id} className="relative flex gap-3">
                      {canSchedule && (
                        <span className="flex w-4 shrink-0 items-start pt-1.5">
                          {s.status === "pending" && (
                            <input
                              type="checkbox"
                              checked={joinSel.has(s.id)}
                              onChange={() => toggleJoin(s.id)}
                              aria-label="Selecionar esta sessão para agendar junto"
                            />
                          )}
                        </span>
                      )}
                      {/* Marcador + linha da timeline. */}
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1.5 size-2.5 shrink-0 rounded-full ${STATUS_DOT[s.status]}`}
                        />
                        <span className="w-px flex-1 bg-border" />
                      </div>
                      <div className="flex flex-1 flex-wrap items-center justify-between gap-2 pb-3 text-sm">
                        <span className="min-w-0">
                          <span className="block">
                            <span className="font-medium">{s.procedureName}</span>{" "}
                            <span className="text-xs text-muted-foreground">
                              {s.name ??
                                `Sessão ${s.sessionIndex} de ${s.sessionTotal}`}
                              {s.plannedMinutes ? ` · ${s.plannedMinutes} min` : ""}
                            </span>
                          </span>
                          {interval !== null && (
                            <span className="block text-[11px] text-muted-foreground">
                              {interval} {interval === 1 ? "dia" : "dias"} após a
                              anterior
                            </span>
                          )}
                          {s.status === "pending" && s.suggestedProviderName && (
                            <span className="block text-[11px] text-primary">
                              Sugestão: {s.suggestedProviderName}
                              {s.suggestionReason
                                ? ` — ${s.suggestionReason}`
                                : ""}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          {s.status === "scheduled" && s.appointment ? (
                            <AppointmentInfoDialog
                              appointment={s.appointment}
                              trigger={
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-auto max-w-[16rem] justify-start whitespace-normal py-1 text-left"
                                >
                                  <CalendarCheck className="mr-1 size-3.5 shrink-0" />
                                  <span>
                                    {formatWhen(s.appointment.starts_at)}
                                    {s.appointment.provider?.full_name
                                      ? ` · ${s.appointment.provider.full_name}`
                                      : ""}
                                  </span>
                                </Button>
                              }
                            />
                          ) : (
                            <span className="flex items-center gap-2">
                              <Badge
                                variant={
                                  s.status === "pending" ? "outline" : "secondary"
                                }
                              >
                                {STATUS_LABEL[s.status]}
                                {s.status === "done" && s.actualMinutes
                                  ? ` · durou ${s.actualMinutes} min`
                                  : ""}
                              </Badge>
                              {s.status === "pending" && s.plannedDate && (
                                <span className="text-xs text-muted-foreground">
                                  prevista {formatPlanned(s.plannedDate)}
                                </span>
                              )}
                            </span>
                          )}
                          {canSchedule && s.status === "pending" && (
                            <AppointmentFormDialog
                              clients={[
                                {
                                  id: clientId,
                                  full_name: clientName,
                                  inactive: clientInactive,
                                },
                              ]}
                              staff={staff}
                              config={config}
                              initialClientId={clientId}
                              initialDate={s.plannedDate ?? undefined}
                              initialDuration={
                                s.plannedMinutes
                                  ? Math.max(
                                      15,
                                      Math.round(s.plannedMinutes / 15) * 15
                                    )
                                  : undefined
                              }
                              initialProviderId={
                                s.suggestedProviderId ?? undefined
                              }
                              treatmentSessionId={s.id}
                              fixedClinicId={clinicId}
                              trigger={
                                <Button size="sm" variant="outline">
                                  <CalendarPlus className="mr-1 size-3.5" />
                                  Agendar
                                </Button>
                              }
                            />
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {/* H4.5 Lote 4: formulário para agendar as sessões marcadas juntas. */}
        {canSchedule && joinOpen && (
          <AppointmentFormDialog
            open={joinOpen}
            onOpenChange={(o) => {
              if (!o) {
                setJoinOpen(false);
                setJoinSel(new Set());
              }
            }}
            clients={[
              {
                id: clientId,
                full_name: clientName,
                inactive: clientInactive,
              },
            ]}
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
      </CardContent>
    </Card>
  );
}

/** Um indicador do resumo do tratamento (valor único). */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Indicador com Previsto × Realizado. */
function StatPair({
  label,
  planned,
  actual,
  plannedHint,
}: {
  label: string;
  planned: string;
  actual: string;
  plannedHint?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">Previsto </span>
        <span className="font-semibold">{planned}</span>
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">Realizado </span>
        <span className="font-semibold">{actual}</span>
      </p>
      {plannedHint && (
        <p className="text-[11px] text-muted-foreground">{plannedHint}</p>
      )}
    </div>
  );
}
