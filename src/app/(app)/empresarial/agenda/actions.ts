"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import {
  MEETING_MODES,
  MEETING_STATUSES,
  type MeetingStatus,
} from "@/lib/empresarial/constants";
import {
  nextMeetingStatuses,
  requiresStatusNote,
} from "@/lib/empresarial/agenda";
import { instantFromInputValue } from "@/lib/dates";

export type ActionResult = { ok: boolean; error?: string };

function canUseFunnel(session: SessionContext): boolean {
  return isProgramManager(session) || isRislifeConsultant(session);
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

function refresh() {
  revalidatePath("/empresarial/agenda");
  revalidatePath("/empresarial/funil");
}

/** Início + duração viram os dois instantes que a reunião ocupa. */
function periodo(
  formData: FormData
): { startsAt: string; endsAt: string } | { erro: string } {
  const bruto = field(formData, "starts_at");
  if (!bruto) return { erro: "Informe a data e a hora." };
  const inicio = instantFromInputValue(bruto);
  if (!inicio) return { erro: "Data ou hora inválida." };

  const minutos = Number.parseInt(field(formData, "duration") ?? "60", 10);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    return { erro: "Informe a duração em minutos." };
  }
  return {
    startsAt: inicio.toISOString(),
    endsAt: new Date(inicio.getTime() + minutos * 60_000).toISOString(),
  };
}

/**
 * Marca a reunião. O cartão anda sozinho para "Reunião agendada" — quem faz
 * isso é o GATILHO da migração 1008, não esta função: a regra vale por
 * qualquer caminho que crie a reunião, inclusive um futuro.
 */
export async function scheduleMeeting(
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const p = periodo(formData);
  if ("erro" in p) return { ok: false, error: p.erro };

  const modo = field(formData, "mode");
  const mode =
    modo && (MEETING_MODES as readonly string[]).includes(modo) ? modo : "ONLINE";

  const db = await empresarialDb();
  const { data, error } = await db
    .from("lead_meetings")
    .insert({
      lead_id: leadId,
      title: field(formData, "title"),
      mode,
      location: field(formData, "location"),
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      status: "SCHEDULED",
      owner_id: session.userId,
      created_by: session.userId,
      rescheduled_from: field(formData, "rescheduled_from"),
    })
    .select("id")
    .single();
  if (error) {
    console.error("scheduleMeeting failed:", error.message);
    return { ok: false, error: "Não foi possível marcar a reunião." };
  }

  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: session.userId,
    kind: "MEETING",
    note: "Reunião marcada.",
  });
  await logAudit({
    action: "create",
    entityType: "empresarial_lead_meeting",
    entityId: data.id,
  });
  refresh();
  return { ok: true };
}

/**
 * Muda a situação da reunião.
 *
 * Só aceita destino que a situação atual permite — reunião realizada não
 * "desrealiza", e o cartão já andou por causa dela. E cancelar, remarcar ou
 * faltar exigem motivo escrito: sem ele, ninguém sabe depois por que a
 * apresentação não aconteceu.
 */
export async function changeMeetingStatus(
  meetingId: string,
  status: MeetingStatus,
  note?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };
  if (!(MEETING_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Situação inválida." };
  }

  const db = await empresarialDb();
  const { data: atual } = await db
    .from("lead_meetings")
    .select("id, lead_id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!atual) return { ok: false, error: "Reunião não encontrada." };

  if (!nextMeetingStatuses(atual.status as MeetingStatus).includes(status)) {
    return { ok: false, error: "Esta reunião já foi encerrada." };
  }
  if (requiresStatusNote(status) && !note?.trim()) {
    return { ok: false, error: "Escreva o motivo." };
  }

  const { error } = await db
    .from("lead_meetings")
    .update({ status, status_note: note?.trim() ?? null })
    .eq("id", meetingId);
  if (error) {
    console.error("changeMeetingStatus failed:", error.message);
    return { ok: false, error: "Não foi possível mudar a situação." };
  }
  refresh();
  return { ok: true };
}

/**
 * Remarca: encerra a atual como REMARCADA e cria a nova apontando para ela.
 *
 * Duas linhas, não uma com a data trocada — é a corrente que revela a empresa
 * que já adiou três vezes. Sobrescrever a data apagaria exatamente esse sinal.
 */
export async function rescheduleMeeting(
  meetingId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canUseFunnel(session)) return { ok: false, error: "Sem permissão." };

  const motivo = field(formData, "status_note");
  if (!motivo) return { ok: false, error: "Escreva o motivo da remarcação." };

  const db = await empresarialDb();
  const { data: atual } = await db
    .from("lead_meetings")
    .select("id, lead_id, title, mode, location, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!atual) return { ok: false, error: "Reunião não encontrada." };
  if (!nextMeetingStatuses(atual.status as MeetingStatus).includes("RESCHEDULED")) {
    return { ok: false, error: "Esta reunião já foi encerrada." };
  }

  const p = periodo(formData);
  if ("erro" in p) return { ok: false, error: p.erro };

  const { error: upErr } = await db
    .from("lead_meetings")
    .update({ status: "RESCHEDULED", status_note: motivo })
    .eq("id", meetingId);
  if (upErr) {
    console.error("rescheduleMeeting (encerrar) failed:", upErr.message);
    return { ok: false, error: "Não foi possível remarcar." };
  }

  const { error: insErr } = await db.from("lead_meetings").insert({
    lead_id: atual.lead_id,
    title: atual.title,
    mode: atual.mode,
    location: atual.location,
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    status: "SCHEDULED",
    owner_id: session.userId,
    created_by: session.userId,
    rescheduled_from: meetingId,
  });
  if (insErr) {
    // A antiga já foi encerrada. Desfazer aqui seria pior: o motivo escrito
    // pela pessoa se perderia. A tela manda marcar a nova data de novo.
    console.error("rescheduleMeeting (criar) failed:", insErr.message);
    return {
      ok: false,
      error:
        "A reunião foi encerrada como remarcada, mas a nova não foi criada. Marque a nova data.",
    };
  }

  await db.from("commercial_lead_activities").insert({
    lead_id: atual.lead_id,
    author_id: session.userId,
    kind: "MEETING",
    note: `Reunião remarcada — motivo: ${motivo}`,
  });
  refresh();
  return { ok: true };
}
