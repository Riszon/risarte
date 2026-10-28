import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayInBrazil } from "@/lib/dates";
import type { OrthoKind, OrthoStatus } from "./constants";
import { nextMaintenance, type MaintenanceLike } from "./regras";

export type OrthoClientBadge = {
  caseId: string;
  code: string;
  status: OrthoStatus;
  kind: OrthoKind;
  orthodontistName: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  /**
   * R13 (0332): o banco só devolve o dinheiro a quem vê dinheiro; para o
   * dentista vem falso, `monthlyCents` é zero e `lateCharges` é zero — e o
   * selo não fala de valor nem de atraso.
   */
  moneyVisible: boolean;
  monthlyCents: number;
  /** A próxima manutenção (agendada futura, senão a prevista mais próxima). */
  next: { date: string; status: string } | null;
  doneCount: number;
  missedCount: number;
  lateCharges: number;
};

/**
 * O que o prontuário precisa saber sobre a ortodontia deste paciente: o caso
 * aberto (ou o último), a próxima manutenção e se há mensalidade atrasada.
 * Sem a 0329 no banco a consulta falha e a ficha não mostra nada — nunca
 * um selo errado.
 */
export async function loadOrthoClientBadge(clientId: string): Promise<OrthoClientBadge | null> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("ortho_cases")
    .select(
      "id, code, status, treatment_kind, start_date, planned_end_date, created_at, terms:ortho_case_terms!ortho_case_terms_case_id_fkey ( monthly_fee_cents ), orthodontist:profiles!ortho_cases_orthodontist_id_fkey ( full_name )"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !rows || rows.length === 0) return null;

  type Row = (typeof rows)[number];
  const open = rows.find((r: Row) =>
    ["aguardando_inicio", "em_tratamento", "contencao"].includes(r.status as string)
  );
  const c = open ?? rows[0];
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

  const [{ data: maint }, { data: charges }] = await Promise.all([
    supabase
      .from("ortho_maintenances")
      .select("status, planned_date, done_at, appointment:appointments ( starts_at )")
      .eq("case_id", c.id as string),
    supabase
      .from("ortho_charges")
      .select("status, due_date")
      .eq("case_id", c.id as string)
      .in("status", ["em_aberto", "atrasada"]),
  ]);

  const today = todayInBrazil();
  const ms: MaintenanceLike[] = (maint ?? []).map((m) => {
    const appt = one(m.appointment as { starts_at: string } | { starts_at: string }[] | null);
    return {
      status: m.status as MaintenanceLike["status"],
      planned_date: (m.planned_date as string | null) ?? null,
      done_at: (m.done_at as string | null) ?? null,
      appointment_date: appt?.starts_at ? appt.starts_at.slice(0, 10) : null,
    };
  });
  const next = nextMaintenance(ms, today);
  const terms = one(c.terms as { monthly_fee_cents: number | null } | { monthly_fee_cents: number | null }[] | null);

  return {
    caseId: c.id as string,
    code: c.code as string,
    status: c.status as OrthoStatus,
    kind: c.treatment_kind as OrthoKind,
    orthodontistName: one(c.orthodontist as { full_name: string } | { full_name: string }[] | null)?.full_name ?? null,
    startDate: (c.start_date as string | null) ?? null,
    plannedEndDate: (c.planned_end_date as string | null) ?? null,
    moneyVisible: terms !== null,
    monthlyCents: Number(terms?.monthly_fee_cents ?? 0),
    next: next
      ? { date: (next.appointment_date ?? next.planned_date ?? "").slice(0, 10), status: next.status }
      : null,
    doneCount: ms.filter((m) => m.status === "realizada").length,
    missedCount: ms.filter((m) => m.status === "faltou").length,
    lateCharges: (charges ?? []).filter(
      (ch) => ch.status === "atrasada" || (ch.status === "em_aberto" && String(ch.due_date) < today)
    ).length,
  };
}
