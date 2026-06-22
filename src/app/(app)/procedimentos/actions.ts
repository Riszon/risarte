"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
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
      "name, tuss_code, specialty, pillar, default_price_cents, min_price_cents, max_price_cents, commission_percent, commission_fixed_cents"
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
