"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { parseBRLToCents } from "@/lib/pricing";
import { validarAcordo } from "@/lib/empresarial/acordo-de-cobranca";
import { naoConseguiConferir } from "@/lib/contagem";

export type ActionResult = { ok: boolean; error?: string };

const COLUNAS =
  "billing_basis, fixed_monthly_cents, contracted_holders, contracted_dependents, excess_mode, excess_fixed_cents, excess_holder_fee_cents, excess_dependent_fee_cents";

/**
 * O ACORDO DE COBRANÇA, editado na empresa (AP19 — dono, 27/09/2026).
 *
 * Empresa cadastrada direto também pode ser de valor fixo e ter regra do
 * excedente; a quantidade contratada vem junto. Quem pode: quem já edita a
 * empresa (gestor do programa).
 *
 * ⚠️ A MUDANÇA FICA REGISTRADA com o antes e o depois (números, nenhum dado de
 * pessoa) — mudar a base de cobrança muda o boleto, e daqui a seis meses
 * alguém vai perguntar quando e quem.
 */
export async function salvarAcordoDeCobranca(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Você não tem permissão para mudar o acordo de cobrança." };
  }

  const texto = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  const dinheiro = (k: string) => {
    const v = texto(k);
    return v == null ? null : parseBRLToCents(v);
  };
  const inteiro = (k: string) => {
    const v = texto(k);
    if (v == null) return null;
    const n = Number(v.replace(/\D/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const r = validarAcordo({
    base: texto("billing_basis"),
    fixoCents: dinheiro("fixed_monthly"),
    titularesContratados: inteiro("contracted_holders"),
    dependentesContratados: inteiro("contracted_dependents"),
    modoDoExcedente: texto("excess_mode"),
    excedenteFixoCents: dinheiro("excess_fixed"),
    excedenteTitularCents: dinheiro("excess_holder_fee"),
    excedenteDependenteCents: dinheiro("excess_dependent_fee"),
  });
  if (!r.ok) return { ok: false, error: r.erro };

  const db = await empresarialDb();
  const { data: antes, error: erroAntes } = await db
    .from("companies")
    .select(COLUNAS)
    .eq("id", companyId)
    .maybeSingle();
  if (erroAntes) return { ok: false, error: naoConseguiConferir("o acordo atual da empresa") };
  if (!antes) return { ok: false, error: "Empresa não encontrada." };

  const { data: depois, error } = await db
    .from("companies")
    .update(r.valores)
    .eq("id", companyId)
    .select(COLUNAS)
    .single();
  if (error) {
    console.error("salvarAcordoDeCobranca failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o acordo de cobrança." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_company",
    entityId: companyId,
    details: { acordo_de_cobranca: { antes, depois } },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}
