"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseBRLToCents } from "@/lib/pricing";
import {
  automaticDiscountPercent,
  resolveCommercialRule,
  ruleFreeingMethods,
  type CommercialRule,
  type CommercialRuleRow,
} from "@/lib/commercial";
import { directSaleViolations } from "@/lib/direct-sale";
import { effectiveRuleWithPpr } from "@/lib/ppr/rules";
import { loadPprConditionsForClients } from "@/lib/ppr/benefits";

export type DirectSaleResult = { ok: boolean; error?: string; closed?: boolean };

const CLOSE_ROLES = ["receptionist", "unit_manager", "sdr"] as const;

async function saleClinic(saleId: string): Promise<{
  clinicId: string;
  clientId: string | null;
  subtotalCents: number;
  programDiscountCents: number;
  isProgramMember: boolean;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("direct_sales")
    .select(
      "clinic_id, client_id, subtotal_cents, program_discount_cents, client:clients!direct_sales_client_id_fkey ( empresarial_company_id, empresarial_active )"
    )
    .eq("id", saleId)
    .single();
  if (!data) return null;
  const client = Array.isArray(data.client) ? data.client[0] : data.client;
  return {
    clinicId: data.clinic_id as string,
    clientId: (data.client_id as string | null) ?? null,
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

  let discountCents = input.discountReais.trim()
    ? (parseBRLToCents(input.discountReais) ?? 0)
    : 0;
  const surchargeCents = input.surchargeReais.trim()
    ? (parseBRLToCents(input.surchargeReais) ?? 0)
    : 0;
  const installments = Math.max(1, Math.floor(input.installments) || 1);

  // À VISTA (1×) só é liberado em PIX ou depósito (regra do dono, 26/07/2026).
  if (
    installments === 1 &&
    input.paymentMethod &&
    input.paymentMethod !== "pix" &&
    input.paymentMethod !== "deposito_avista"
  ) {
    return {
      ok: false,
      error: "À vista (1×) o pagamento é só por PIX ou depósito à vista.",
    };
  }

  const supabase = await createClient();
  const { data: ruleRows } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent, max_installments, allowed_methods, cash_discount_percent, min_installment_cents_by_method")
    .returns<CommercialRuleRow[]>();
  // O plano do cliente (PPR+) é SUPERIOR à regra da rede/unidade: amplia
  // parcelas e formas de pagamento (decisão do dono, 25/07/2026).
  const pprConditions = info.clientId
    ? (await loadPprConditionsForClients([info.clientId])).get(info.clientId) ??
      null
    : null;
  const rule = ruleFreeingMethods(
    effectiveRuleWithPpr(
      resolveCommercialRule(ruleRows ?? [], info.clinicId),
      pprConditions
    ) as CommercialRule,
    // J4a: Empresarial libera todas as formas de pagamento (inclui boleto).
    info.isProgramMember
  );

  if (pprConditions) {
    // PPR+: o desconto da faixa é do SISTEMA, não da tela — recalculado AQUI a
    // cada salvamento pelo parcelamento escolhido (18× sem faixa = 0%). O valor
    // vindo do cliente é ignorado de propósito, para nunca ficar congelado um
    // desconto de uma escolha anterior de parcelas.
    const pct =
      installments <= 1
        ? pprConditions.cashDiscountPercent
        : ([...pprConditions.tiers]
            .sort((a, b) => a.upToInstallments - b.upToInstallments)
            .find((t) => installments <= t.upToInstallments)?.discountPercent ??
          0);
    const { data: itemRows } = await supabase
      .from("direct_sale_items")
      .select("final_cents, program_discount_cents")
      .eq("sale_id", saleId);
    // Procedimento já coberto pelo plano não recebe desconto de novo.
    const coveredCents = (
      (itemRows ?? []) as { final_cents: number; program_discount_cents: number }[]
    )
      .filter((i) => (i.program_discount_cents ?? 0) > 0)
      .reduce((s, i) => s + (i.final_cents ?? 0), 0);
    const base = Math.max(
      0,
      info.subtotalCents - info.programDiscountCents - coveredCents
    );
    discountCents = Math.round((base * Math.max(0, pct)) / 100);
  } else if (!info.isProgramMember && installments <= 1) {
    // I8: cliente SEM programa — à vista ganha o desconto automático da regra
    // comercial (ex.: 5%). No parcelado não há automático: vale só o manual.
    const auto = automaticDiscountPercent(rule, installments);
    if (auto > 0) {
      const base = Math.max(0, info.subtotalCents - info.programDiscountCents);
      const autoCents = Math.round((base * auto) / 100);
      // O manual maior que o automático prevalece (o teto ainda é validado).
      discountCents = Math.max(discountCents, autoCents);
    }
  }

  if (info.isProgramMember && !pprConditions && discountCents > 0) {
    // Empresarial (desconto automático) não recebe desconto manual.
    return {
      ok: false,
      error:
        "Cliente de programa (desconto automático) — não é permitido desconto manual.",
    };
  }

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
    if (m.includes("CONDITIONS_REQUIRED"))
      return {
        ok: false,
        error:
          "Defina a forma de pagamento e o parcelamento antes de assinar o contrato ou emitir a cobrança.",
      };
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
  // J4a: uma função só no banco cancela a venda E os procedimentos dela. Antes
  // a tela cancelava a venda e as sessões ficavam "Concluído" no prontuário
  // (bug relatado pelo dono). A função também devolve o benefício do programa
  // e cancela as cobranças em aberto.
  const { error } = await supabase.rpc("cancel_direct_sale", {
    p_sale_id: saleId,
  });
  if (error) {
    const m = error.message;
    if (m.includes("ALREADY_CLOSED")) {
      return { ok: false, error: "Venda já concluída — não pode ser cancelada." };
    }
    if (m.includes("NOT_ALLOWED")) {
      return { ok: false, error: "Você não pode cancelar esta venda direta." };
    }
    console.error("cancel_direct_sale failed:", m);
    return { ok: false, error: "Não foi possível cancelar a venda." };
  }
  await logAudit({
    action: "update",
    entityType: "direct_sale_cancel",
    entityId: saleId,
    clinicId: info.clinicId,
  });
  revalidatePath("/comercial/venda-direta");
  revalidatePath(`/prontuarios/${info.clientId ?? ""}`);
  return { ok: true };
}
