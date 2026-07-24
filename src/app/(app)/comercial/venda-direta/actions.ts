"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import {
  resolveCommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import { directSaleViolations } from "@/lib/direct-sale";

export type DirectSaleResult = { ok: boolean; error?: string; closed?: boolean };

const CLOSE_ROLES = ["receptionist", "unit_manager", "sdr"] as const;

async function saleClinic(saleId: string): Promise<{
  clinicId: string;
  subtotalCents: number;
  programDiscountCents: number;
  isProgramMember: boolean;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("direct_sales")
    .select(
      "clinic_id, subtotal_cents, program_discount_cents, client:clients!direct_sales_client_id_fkey ( empresarial_company_id, empresarial_active )"
    )
    .eq("id", saleId)
    .single();
  if (!data) return null;
  const client = Array.isArray(data.client) ? data.client[0] : data.client;
  return {
    clinicId: data.clinic_id as string,
    subtotalCents: data.subtotal_cents as number,
    // Desconto de PROGRAMA (Empresarial/riso+) tem coluna própria a partir da
    // 0159; o desconto manual é validado sobre (subtotal − programa).
    programDiscountCents: data.program_discount_cents as number,
    isProgramMember: Boolean(
      client?.empresarial_company_id && client?.empresarial_active !== false
    ),
  };
}

/** Define as condições de pagamento (só quem FECHA). Bloqueia fora da regra. */
export async function setDirectSaleConditions(
  saleId: string,
  input: {
    paymentMethod: string;
    installments: number;
    discountReais: string;
    surchargeReais: string;
  }
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  const isManager =
    session.isAdminMaster ||
    hasRoleInClinic(session, info.clinicId, ["unit_manager"]);
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, [...CLOSE_ROLES])
  ) {
    return { ok: false, error: "Você não pode fechar esta venda direta." };
  }

  const discountCents = input.discountReais.trim()
    ? (parseBRLToCents(input.discountReais) ?? 0)
    : 0;
  const surchargeCents = input.surchargeReais.trim()
    ? (parseBRLToCents(input.surchargeReais) ?? 0)
    : 0;
  const installments = Math.max(1, Math.floor(input.installments) || 1);

  // Cliente de programa (desconto automático) não recebe desconto manual.
  if (info.isProgramMember && discountCents > 0) {
    return {
      ok: false,
      error:
        "Cliente de programa (desconto automático) — não é permitido desconto manual.",
    };
  }

  const supabase = await createClient();
  const { data: ruleRows } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent, max_installments, allowed_methods")
    .returns<CommercialRuleRow[]>();
  const rule = resolveCommercialRule(ruleRows ?? [], info.clinicId);

  // A regra comercial BLOQUEIA o fechamento fora do padrão (§7.5).
  const violations = directSaleViolations(
    {
      subtotalCents: info.subtotalCents,
      programDiscountCents: info.programDiscountCents,
      discountCents,
      surchargeCents,
      installments,
      paymentMethod: input.paymentMethod
        ? (input.paymentMethod as never)
        : null,
    },
    rule,
    { isManager }
  );
  if (violations.length > 0) {
    return { ok: false, error: violations.join("; ") };
  }

  const { error } = await supabase.rpc("direct_sale_set_conditions", {
    p_sale_id: saleId,
    p_payment_method: input.paymentMethod || null,
    p_installments: installments,
    p_discount_cents: discountCents,
    p_surcharge_cents: surchargeCents,
  });
  if (error) {
    const m = error.message;
    if (m.includes("SURCHARGE_MANAGER_ONLY"))
      return { ok: false, error: "Só o Gerente pode aplicar acréscimo." };
    if (m.includes("PROGRAM_NO_DISCOUNT"))
      return {
        ok: false,
        error:
          "Cliente de programa (desconto automático) — não é permitido desconto manual.",
      };
    if (m.includes("ALREADY_CLOSED"))
      return { ok: false, error: "Venda já concluída." };
    console.error("direct_sale_set_conditions failed:", m);
    return { ok: false, error: "Não foi possível salvar as condições." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_conditions",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}

/** Passo do fechamento: contrato / cobrança emitida / pagamento confirmado. */
export async function closeDirectSaleStep(
  saleId: string,
  step: "contract" | "payment_issued" | "payment_confirmed",
  value: boolean
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, [...CLOSE_ROLES])
  ) {
    return { ok: false, error: "Você não pode fechar esta venda direta." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("direct_sale_close_step", {
    p_sale_id: saleId,
    p_step: step,
    p_value: value,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_CLOSED"))
      return { ok: false, error: "Venda já concluída." };
    console.error("direct_sale_close_step failed:", m);
    return { ok: false, error: "Não foi possível atualizar o fechamento." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_close",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  revalidatePath("/comercial");
  return { ok: true, closed: Boolean((data as { closed?: boolean } | null)?.closed) };
}

/** Cancela a venda direta (recepção/gerente/admin). */
export async function cancelDirectSale(
  saleId: string
): Promise<DirectSaleResult> {
  const session = await getSessionContext();
  const info = await saleClinic(saleId);
  if (!info) return { ok: false, error: "Venda não encontrada." };
  if (
    !session.isAdminMaster &&
    !hasRoleInClinic(session, info.clinicId, ["receptionist", "unit_manager"])
  ) {
    return { ok: false, error: "Você não pode cancelar esta venda direta." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("direct_sales")
    .update({ cancelled: true, status: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", saleId)
    .is("closed_at", null);
  if (error) {
    console.error("cancelDirectSale failed:", error.message);
    return { ok: false, error: "Não foi possível cancelar a venda." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_cancel",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  return { ok: true };
}
