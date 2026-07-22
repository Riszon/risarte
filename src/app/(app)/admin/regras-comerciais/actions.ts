"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PAYMENT_METHODS } from "@/lib/commercial";

export type RuleResult = { ok: boolean; error?: string };

/** Salva a regra comercial de um escopo (rede = clinicId vazio; ou unidade). */
export async function saveCommercialRule(
  formData: FormData
): Promise<RuleResult> {
  await requireAdminMaster();
  const supabase = await createClient();

  const clinicIdRaw = String(formData.get("clinicId") ?? "").trim();
  const clinicId = clinicIdRaw === "" ? null : clinicIdRaw;

  const discountRaw = String(formData.get("maxDiscountPercent") ?? "").trim();
  const maxDiscountPercent =
    discountRaw === "" ? null : Number(discountRaw.replace(",", "."));
  if (
    maxDiscountPercent !== null &&
    (!Number.isFinite(maxDiscountPercent) || maxDiscountPercent < 0)
  ) {
    return { ok: false, error: "Desconto máximo inválido." };
  }

  const installmentsRaw = String(formData.get("maxInstallments") ?? "").trim();
  const maxInstallments =
    installmentsRaw === "" ? null : Number.parseInt(installmentsRaw, 10);
  if (
    maxInstallments !== null &&
    (!Number.isFinite(maxInstallments) || maxInstallments < 1)
  ) {
    return { ok: false, error: "Nº máximo de parcelas inválido." };
  }

  const methods = formData
    .getAll("methods")
    .map(String)
    .filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
  // Nenhum meio marcado = sem restrição (null). Marcados = só os permitidos.
  const allowedMethods = methods.length > 0 ? methods : null;

  const { error } = await supabase.from("commercial_rules").upsert(
    {
      clinic_id: clinicId,
      max_discount_percent: maxDiscountPercent,
      max_installments: maxInstallments,
      allowed_methods: allowedMethods,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" }
  );
  if (error) {
    console.error("saveCommercialRule failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a regra comercial." };
  }

  await logAudit({
    action: "update",
    entityType: "commercial_rule",
    entityId: clinicId ?? "network",
    clinicId: clinicId ?? undefined,
  });
  revalidatePath("/admin/regras-comerciais");
  return { ok: true };
}

/** Remove o ajuste de uma unidade (volta a valer o padrão da rede). */
export async function deleteCommercialRule(ruleId: string): Promise<RuleResult> {
  await requireAdminMaster();
  const supabase = await createClient();

  const { error } = await supabase
    .from("commercial_rules")
    .delete()
    .eq("id", ruleId)
    .not("clinic_id", "is", null); // o padrão da rede nunca é apagado por aqui
  if (error) {
    console.error("deleteCommercialRule failed:", error.message);
    return { ok: false, error: "Não foi possível remover o ajuste." };
  }

  await logAudit({
    action: "update",
    entityType: "commercial_rule_removed",
    entityId: ruleId,
  });
  revalidatePath("/admin/regras-comerciais");
  return { ok: true };
}
