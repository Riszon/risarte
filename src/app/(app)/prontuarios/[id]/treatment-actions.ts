"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  resolveAgendaSettings,
  type AgendaSettingRow,
} from "@/lib/agenda-settings";
import { holidayOn } from "@/lib/holidays";

type Result = { ok: boolean; error?: string };

/**
 * Gera (idempotente) as sessões a agendar do tratamento quando o cliente está em
 * Início de Tratamento (Fase 5). Disparado ao abrir a ficha. A própria RPC checa
 * a fase, a opção principal aprovada e se já existem sessões.
 */
export async function ensureTreatmentSessions(clientId: string): Promise<void> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("ensure_treatment_sessions", {
    p_client_id: clientId,
  });
  if (error) {
    console.error("ensure_treatment_sessions failed:", error.message);
  }
}

// --- Datas em "YYYY-MM-DD" (sem fuso) ------------------------------------
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}
/** Avança até um dia em que a unidade atende (dia da semana aberto + não feriado). */
function rollForwardOpen(s: string, weekdays: number[]): string {
  let cur = s;
  for (let i = 0; i < 400; i++) {
    const wd = parseYmd(cur).getDay();
    if (weekdays.includes(wd) && !holidayOn(cur)) return cur;
    cur = addDays(cur, 1);
  }
  return cur;
}

/**
 * H4.3 Lote 2: sugere a data de TODAS as sessões a agendar a partir de uma data
 * inicial, respeitando o intervalo mínimo do protocolo (por sessão, unidade >
 * rede) e pulando dias fechados/feriados. Grava em treatment_sessions.planned_date.
 */
export async function suggestTreatmentSeries(
  clientId: string,
  startDate: string
): Promise<Result> {
  const session = await getSessionContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { ok: false, error: "Data inicial inválida." };
  }
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("clinic_id")
    .eq("id", clientId)
    .single();
  if (!client) return { ok: false, error: "Cliente não encontrado." };
  const clinicId = client.clinic_id as string;
  const canSchedule =
    session.isAdminMaster ||
    hasRoleInClinic(session, clinicId, [
      "receptionist",
      "clinical_coordinator",
      "dentist",
    ]);
  if (!canSchedule) {
    return { ok: false, error: "Sem permissão para sugerir datas." };
  }

  const { data: sessions } = await supabase
    .from("treatment_sessions")
    .select("id, procedure_id, session_index, status, created_at, plan_order")
    .eq("client_id", clientId)
    .neq("status", "done")
    // H4.5: respeita a sequência definida pelo Planner (plan_order); depois a
    // ordem de criação e o índice da sessão.
    .order("plan_order", { nullsFirst: false })
    .order("created_at")
    .order("session_index")
    .returns<
      {
        id: string;
        procedure_id: string | null;
        session_index: number;
        status: string;
        created_at: string;
      }[]
    >();
  if (!sessions || sessions.length === 0) {
    return { ok: false, error: "Não há sessões a agendar." };
  }

  // Intervalo mínimo do protocolo por (procedimento, sessão) — unidade > rede.
  const procIds = [
    ...new Set(sessions.map((s) => s.procedure_id).filter((x): x is string => Boolean(x))),
  ];
  const intervalMap = new Map<string, number>();
  if (procIds.length > 0) {
    const { data: ps } = await supabase
      .from("procedure_sessions")
      .select("procedure_id, clinic_id, session_index, min_interval_days")
      .in("procedure_id", procIds)
      .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`)
      .returns<
        {
          procedure_id: string;
          clinic_id: string | null;
          session_index: number;
          min_interval_days: number | null;
        }[]
      >();
    for (const r of ps ?? []) {
      if (r.min_interval_days == null) continue;
      const key = `${r.procedure_id}:${r.session_index}`;
      // Unidade sempre sobrescreve; rede só preenche se ainda não houver.
      if (r.clinic_id === clinicId || !intervalMap.has(key)) {
        intervalMap.set(key, r.min_interval_days);
      }
    }
  }

  // Dias em que a unidade atende (cascata rede/unidade).
  const { data: agRows } = await supabase
    .from("clinic_agenda_settings")
    .select(
      "clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end, waiting_alert_minutes"
    )
    .or(`clinic_id.is.null,clinic_id.eq.${clinicId}`);
  const weekdays = resolveAgendaSettings(
    (agRows ?? []) as AgendaSettingRow[],
    clinicId
  ).weekdays;

  let prev: string | null = null;
  const updates: { id: string; date: string }[] = [];
  for (const s of sessions) {
    let planned: string;
    if (prev === null) {
      planned = rollForwardOpen(startDate, weekdays);
    } else {
      const raw = s.procedure_id
        ? intervalMap.get(`${s.procedure_id}:${s.session_index}`)
        : undefined;
      const gap = raw && raw > 0 ? raw : 1;
      planned = rollForwardOpen(addDays(prev, gap), weekdays);
    }
    updates.push({ id: s.id, date: planned });
    prev = planned;
  }

  for (const u of updates) {
    const { error } = await supabase
      .from("treatment_sessions")
      .update({ planned_date: u.date })
      .eq("id", u.id);
    if (error) {
      console.error("suggestTreatmentSeries update failed:", error.message);
      return { ok: false, error: "Não foi possível salvar as datas sugeridas." };
    }
  }

  await logAudit({
    action: "update",
    entityType: "treatment_sessions",
    entityId: clientId,
    clinicId,
    details: { suggested: updates.length },
  });
  revalidatePath(`/prontuarios/${clientId}`);
  return { ok: true };
}
