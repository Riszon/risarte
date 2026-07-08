"use server";

import { revalidatePath } from "next/cache";
import {
  getSessionContext,
  hasRoleInClinic,
  type SessionContext,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { formatSessions, parseBRLToCents } from "@/lib/pricing";
import { METHODOLOGY_PILLARS, type MethodologyPillar } from "@/lib/journey";

export type ProcedureResult = { ok: boolean; error?: string };

export type ProcedureInput = {
  name: string;
  tussCode: string;
  specialty: string;
  pillar: string;
  defaultPrice: string;
  minPrice: string;
  maxPrice: string;
  commissionPercent: string;
  commissionFixed: string;
  estimatedMinutes: string;
};

/** Admin Master and Dentista Planner may manage the procedures catalog. */
function canEdit(session: SessionContext): boolean {
  return (
    session.isAdminMaster ||
    Object.values(session.rolesByClinic).some((roles) =>
      roles.includes("planner_dentist")
    )
  );
}

function centsOrNull(value: string): number | null | "invalid" {
  if (value.trim() === "") return null;
  const cents = parseBRLToCents(value);
  return cents === null ? "invalid" : cents;
}

function parsePillar(value: string): MethodologyPillar | null {
  return METHODOLOGY_PILLARS.includes(value as MethodologyPillar)
    ? (value as MethodologyPillar)
    : null;
}

type ParsedProcedure = {
  name: string;
  tuss_code: string | null;
  specialty: string | null;
  pillar: MethodologyPillar | null;
  default_price_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  commission_percent: number;
  commission_fixed_cents: number;
  estimated_minutes: number | null;
};

function parseProcedure(
  input: ProcedureInput
): { error: string } | { values: ParsedProcedure } {
  const name = input.name.trim();
  if (!name) return { error: "Informe o nome do procedimento." };

  const def = input.defaultPrice.trim() ? parseBRLToCents(input.defaultPrice) : 0;
  if (def === null) return { error: "Preço padrão inválido." };
  const min = centsOrNull(input.minPrice);
  if (min === "invalid") return { error: "Preço mínimo inválido." };
  const max = centsOrNull(input.maxPrice);
  if (max === "invalid") return { error: "Preço máximo inválido." };
  if (min !== null && max !== null && min > max) {
    return { error: "O preço mínimo não pode ser maior que o máximo." };
  }
  const fixed = input.commissionFixed.trim()
    ? parseBRLToCents(input.commissionFixed)
    : 0;
  if (fixed === null) return { error: "Comissão (R$) inválida." };
  const percent = input.commissionPercent.trim()
    ? Number(input.commissionPercent.replace(",", "."))
    : 0;
  if (!Number.isFinite(percent) || percent < 0) {
    return { error: "Comissão (%) inválida." };
  }

  let estimated_minutes: number | null = null;
  const estStr = input.estimatedMinutes.trim();
  if (estStr) {
    const n = Number(estStr.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Tempo estimado inválido (use minutos, ex.: 30)." };
    }
    estimated_minutes = Math.round(n);
  }

  return {
    values: {
      name,
      tuss_code: input.tussCode.trim() || null,
      specialty: input.specialty.trim() || null,
      pillar: parsePillar(input.pillar),
      default_price_cents: def,
      min_price_cents: min,
      max_price_cents: max,
      commission_percent: percent,
      commission_fixed_cents: fixed,
      estimated_minutes,
    },
  };
}

async function logChange(
  procedureId: string,
  userId: string,
  description: string
) {
  const supabase = await createClient();
  await supabase.from("procedure_changes").insert({
    procedure_id: procedureId,
    changed_by: userId,
    description,
  });
}

export async function addProcedure(
  input: ProcedureInput
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const parsed = parseProcedure(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("procedures")
    .insert(parsed.values)
    .select("id")
    .single();
  if (error || !data) {
    console.error("addProcedure failed:", error?.message);
    return { ok: false, error: "Não foi possível adicionar o procedimento." };
  }
  await logChange(data.id, session.userId, "Procedimento criado.");
  await logAudit({
    action: "create",
    entityType: "procedure",
    entityId: data.id,
  });
  revalidatePath("/procedimentos");
  return { ok: true };
}

const FIELD_LABELS: Record<keyof ParsedProcedure, string> = {
  name: "Nome",
  tuss_code: "Código TUSS",
  specialty: "Especialidade",
  pillar: "Pilar",
  default_price_cents: "Preço padrão",
  min_price_cents: "Preço mínimo",
  max_price_cents: "Preço máximo",
  commission_percent: "Comissão (%)",
  commission_fixed_cents: "Comissão (R$)",
  estimated_minutes: "Tempo estimado (min)",
};

export async function editProcedure(
  id: string,
  input: ProcedureInput
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const parsed = parseProcedure(input);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: old } = await supabase
    .from("procedures")
    .select(
      "name, tuss_code, specialty, pillar, default_price_cents, min_price_cents, max_price_cents, commission_percent, commission_fixed_cents, estimated_minutes"
    )
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("procedures")
    .update({ ...parsed.values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("editProcedure failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o procedimento." };
  }

  // History: which labelled fields changed (no need to record values).
  const changed: string[] = [];
  if (old) {
    for (const key of Object.keys(parsed.values) as (keyof ParsedProcedure)[]) {
      if (String(old[key] ?? "") !== String(parsed.values[key] ?? "")) {
        changed.push(FIELD_LABELS[key]);
      }
    }
  }
  await logChange(
    id,
    session.userId,
    changed.length > 0
      ? `Alterou: ${changed.join(", ")}.`
      : "Procedimento salvo (sem mudanças)."
  );
  await logAudit({ action: "update", entityType: "procedure", entityId: id });
  revalidatePath("/procedimentos");
  return { ok: true };
}

export async function setProcedureActive(
  id: string,
  active: boolean
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("procedures")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("setProcedureActive failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar o procedimento." };
  }
  await logChange(
    id,
    session.userId,
    active ? "Reativado." : "Desativado."
  );
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: id,
    details: { is_active: active },
  });
  revalidatePath("/procedimentos");
  return { ok: true };
}

/**
 * "Excluir" = deactivate so it can't be used in future plans. A procedure that
 * was already used in any budget is NEVER hard-deleted (history is kept); it is
 * only deactivated. An unused procedure is removed.
 */
export async function deleteProcedure(id: string): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();
  const { count } = await supabase
    .from("treatment_plan_option_items")
    .select("id", { count: "exact", head: true })
    .eq("procedure_id", id);

  if ((count ?? 0) > 0) {
    const { error } = await supabase
      .from("procedures")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("deleteProcedure (deactivate) failed:", error.message);
      return { ok: false, error: "Não foi possível desativar o procedimento." };
    }
    await logChange(
      id,
      session.userId,
      "Desativado (já usado em orçamentos — não pode ser excluído)."
    );
    revalidatePath("/procedimentos");
    return {
      ok: true,
      error:
        "Procedimento já usado em orçamentos: foi DESATIVADO (não é mais oferecido), preservando o histórico.",
    };
  }

  const { error } = await supabase.from("procedures").delete().eq("id", id);
  if (error) {
    console.error("deleteProcedure failed:", error.message);
    return { ok: false, error: "Não foi possível excluir o procedimento." };
  }
  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: id,
    details: { removed: true },
  });
  revalidatePath("/procedimentos");
  return { ok: true };
}

/** Bulk import from a spreadsheet (rows already mapped to ProcedureInput on the
 * client). Matches existing procedures by name (case-insensitive): updates them,
 * inserts the rest. Returns how many were inserted/updated and any errors. */
export async function importProcedures(
  rows: ProcedureInput[]
): Promise<ProcedureResult & { inserted?: number; updated?: number; errors?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  if (rows.length === 0) return { ok: false, error: "A planilha está vazia." };
  if (rows.length > 2000) {
    return { ok: false, error: "Limite de 2000 procedimentos por importação." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("procedures")
    .select("id, name")
    .returns<{ id: string; name: string }[]>();
  const idByName = new Map(
    (existing ?? []).map((p) => [p.name.trim().toLowerCase(), p.id])
  );

  const toInsert: ParsedProcedure[] = [];
  const toUpdate: { id: string; values: ParsedProcedure }[] = [];
  let errors = 0;

  for (const row of rows) {
    const parsed = parseProcedure(row);
    if ("error" in parsed) {
      errors += 1;
      continue;
    }
    const id = idByName.get(parsed.values.name.trim().toLowerCase());
    if (id) toUpdate.push({ id, values: parsed.values });
    else toInsert.push(parsed.values);
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("procedures")
      .insert(toInsert)
      .select("id");
    if (error) {
      console.error("importProcedures insert failed:", error.message);
      return { ok: false, error: "Não foi possível importar (inserção)." };
    }
    inserted = data?.length ?? 0;
    if (data && data.length > 0) {
      await supabase.from("procedure_changes").insert(
        data.map((p) => ({
          procedure_id: p.id,
          changed_by: session.userId,
          description: "Criado (importação de planilha).",
        }))
      );
    }
  }

  let updated = 0;
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("procedures")
      .update({ ...u.values, updated_at: new Date().toISOString() })
      .eq("id", u.id);
    if (!error) {
      updated += 1;
      await logChange(u.id, session.userId, "Atualizado (importação de planilha).");
    }
  }

  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: "import",
    details: { inserted, updated, errors },
  });
  revalidatePath("/procedimentos");
  return { ok: true, inserted, updated, errors };
}

/** Apply a percentage readjustment to procedure prices, by scope. */
export async function readjustPrices(input: {
  percent: string;
  scope: "all" | "specialty" | "pillar" | "selected";
  specialty?: string;
  pillar?: string;
  ids?: string[];
  applyToBand: boolean;
}): Promise<ProcedureResult & { adjusted?: number }> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const percent = Number(input.percent.replace(",", "."));
  if (!Number.isFinite(percent) || percent === 0) {
    return { ok: false, error: "Informe um percentual válido (ex.: 10 ou -5)." };
  }
  const factor = 1 + percent / 100;
  if (factor <= 0) {
    return { ok: false, error: "Percentual reduz o preço a zero ou menos." };
  }

  const supabase = await createClient();
  let query = supabase
    .from("procedures")
    .select("id, default_price_cents, min_price_cents, max_price_cents");

  if (input.scope === "specialty") {
    if (!input.specialty) return { ok: false, error: "Escolha a especialidade." };
    query = query.eq("specialty", input.specialty);
  } else if (input.scope === "pillar") {
    if (!input.pillar) return { ok: false, error: "Escolha o pilar." };
    query = query.eq("pillar", input.pillar);
  } else if (input.scope === "selected") {
    if (!input.ids || input.ids.length === 0) {
      return { ok: false, error: "Selecione ao menos um procedimento." };
    }
    query = query.in("id", input.ids);
  }

  const { data: procs } = await query.returns<
    {
      id: string;
      default_price_cents: number;
      min_price_cents: number | null;
      max_price_cents: number | null;
    }[]
  >();
  if (!procs || procs.length === 0) {
    return { ok: false, error: "Nenhum procedimento no escopo selecionado." };
  }

  const adj = (cents: number | null) =>
    cents == null ? null : Math.max(0, Math.round(cents * factor));
  const label = `Reajuste de ${percent > 0 ? "+" : ""}${input.percent}%.`;

  let adjusted = 0;
  for (const p of procs) {
    const patch: Record<string, number | null | string> = {
      default_price_cents: adj(p.default_price_cents) ?? p.default_price_cents,
      updated_at: new Date().toISOString(),
    };
    if (input.applyToBand) {
      patch.min_price_cents = adj(p.min_price_cents);
      patch.max_price_cents = adj(p.max_price_cents);
    }
    const { error } = await supabase
      .from("procedures")
      .update(patch)
      .eq("id", p.id);
    if (!error) {
      adjusted += 1;
      await logChange(p.id, session.userId, label);
    }
  }

  await logAudit({
    action: "update",
    entityType: "procedure",
    entityId: "readjust",
    details: { percent, scope: input.scope, adjusted },
  });
  revalidatePath("/procedimentos");
  return { ok: true, adjusted };
}

// ---------------------------------------------------------------------------
// Protocolo de sessões (E1 rede / E2 unidade). Substitui o protocolo do escopo
// (rede = clinicId null; unidade = clinicId) e, na rede, recalcula o total
// (procedures.estimated_minutes).
// ---------------------------------------------------------------------------
export type SessionInput = {
  name: string;
  minutes: number;
  /** Dias mínimos após a sessão anterior (ignorado na 1ª sessão). */
  intervalDays?: number | null;
};

export async function setProcedureSessions(
  procedureId: string,
  clinicId: string | null,
  sessions: SessionInput[]
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const isNetwork = clinicId === null;
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const allowed = isNetwork
    ? session.isAdminMaster || isPlanner
    : session.isAdminMaster ||
      isPlanner ||
      hasRoleInClinic(session, clinicId!, ["clinical_coordinator"]);
  if (!allowed) {
    return { ok: false, error: "Sem permissão para configurar as sessões." };
  }

  const clean = sessions
    .slice(0, 30)
    .map((s, i) => ({
      name: s.name.trim() || `Sessão ${i + 1}`,
      minutes: Math.max(0, Math.round(Number(s.minutes) || 0)),
      intervalDays:
        s.intervalDays != null && Number.isFinite(Number(s.intervalDays))
          ? Math.max(0, Math.round(Number(s.intervalDays)))
          : null,
    }));
  if (clean.length === 0) {
    return { ok: false, error: "Defina ao menos uma sessão." };
  }

  const supabase = await createClient();
  let del = supabase
    .from("procedure_sessions")
    .delete()
    .eq("procedure_id", procedureId);
  del = isNetwork ? del.is("clinic_id", null) : del.eq("clinic_id", clinicId);
  await del;

  const rows = clean.map((s, i) => ({
    procedure_id: procedureId,
    clinic_id: clinicId,
    session_index: i + 1,
    name: s.name,
    estimated_minutes: s.minutes,
    // A 1ª sessão não tem intervalo (não há sessão anterior).
    min_interval_days: i === 0 ? null : s.intervalDays,
    created_by: session.userId,
  }));
  const { error } = await supabase.from("procedure_sessions").insert(rows);
  if (error) {
    console.error("setProcedureSessions failed:", error.message);
    return { ok: false, error: "Não foi possível salvar as sessões." };
  }

  const total = clean.reduce((sum, s) => sum + s.minutes, 0);
  if (isNetwork) {
    await supabase
      .from("procedures")
      .update({
        estimated_minutes: total > 0 ? total : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", procedureId);
  }
  await logChange(
    procedureId,
    session.userId,
    `${isNetwork ? "Protocolo da rede" : "Protocolo da unidade"}: ${formatSessions(clean.length)}, ${total} min.`
  );
  await logAudit({
    action: "update",
    entityType: "procedure_sessions",
    entityId: procedureId,
    details: { network: isNetwork, sessions: clean.length, total },
  });
  revalidatePath("/procedimentos");
  return { ok: true };
}

/** Remove a unit's customized protocol (reverts to the network default). */
export async function clearProcedureSessions(
  procedureId: string,
  clinicId: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  const isPlanner = Object.values(session.rolesByClinic).some((roles) =>
    roles.includes("planner_dentist")
  );
  const allowed =
    session.isAdminMaster ||
    isPlanner ||
    hasRoleInClinic(session, clinicId, ["clinical_coordinator"]);
  if (!allowed) return { ok: false, error: "Sem permissão." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("procedure_sessions")
    .delete()
    .eq("procedure_id", procedureId)
    .eq("clinic_id", clinicId);
  if (error) {
    console.error("clearProcedureSessions failed:", error.message);
    return { ok: false, error: "Não foi possível remover a personalização." };
  }
  await logChange(
    procedureId,
    session.userId,
    "Removeu o protocolo personalizado da unidade (voltou ao padrão da Rede)."
  );
  await logAudit({
    action: "update",
    entityType: "procedure_sessions",
    entityId: procedureId,
    details: { cleared_unit: clinicId },
  });
  revalidatePath("/procedimentos");
  return { ok: true };
}

/** Set (or clear, when blank) a unit's price override for a procedure. */
export async function setUnitPrice(
  clinicId: string,
  procedureId: string,
  price: string
): Promise<ProcedureResult> {
  const session = await getSessionContext();
  if (!canEdit(session)) {
    return { ok: false, error: "Sem permissão para editar procedimentos." };
  }
  const supabase = await createClient();

  if (price.trim() === "") {
    const { error } = await supabase
      .from("clinic_procedure_prices")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("procedure_id", procedureId);
    if (error) {
      console.error("setUnitPrice (clear) failed:", error.message);
      return { ok: false, error: "Não foi possível remover o preço da unidade." };
    }
    revalidatePath("/procedimentos");
    return { ok: true };
  }

  const priceCents = parseBRLToCents(price);
  if (priceCents === null) return { ok: false, error: "Preço inválido." };

  const { error } = await supabase.from("clinic_procedure_prices").upsert(
    {
      clinic_id: clinicId,
      procedure_id: procedureId,
      price_cents: priceCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,procedure_id" }
  );
  if (error) {
    console.error("setUnitPrice failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o preço da unidade." };
  }
  revalidatePath("/procedimentos");
  return { ok: true };
}
