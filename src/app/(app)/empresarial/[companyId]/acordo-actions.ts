"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramFinance, isProgramManager } from "@/lib/empresarial/access";
import { parseBRLToCents } from "@/lib/pricing";
import { validarAcordo } from "@/lib/empresarial/acordo-de-cobranca";
import { naoConseguiConferir } from "@/lib/contagem";

export type ActionResult = { ok: boolean; error?: string };

/** A função da 1029 ainda não existe neste banco (a API não a encontra). */
function semAPorta(e: { code?: string; message: string }): boolean {
  return e.code === "PGRST202" || /could not find the function|schema cache/i.test(e.message);
}

const COLUNAS =
  "billing_basis, fixed_monthly_cents, contracted_holders, contracted_dependents, excess_mode, excess_fixed_cents, excess_holder_fee_cents, excess_dependent_fee_cents";

/**
 * O ACORDO DE COBRANÇA, editado na empresa (AP19 — dono, 27/09/2026).
 *
 * Empresa cadastrada direto também pode ser de valor fixo e ter regra do
 * excedente; a quantidade contratada vem junto. Quem pode: o financeiro do
 * programa — gestor do programa ou Financeiro da Franqueadora (OC-00105).
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
  if (!isProgramFinance(session)) {
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

  // OC-00105: grava pela PORTA ESTREITA do banco (1029), que mexe só nas
  // colunas do acordo — é ela que deixa o Financeiro da Franqueadora salvar
  // sem poder alterar a empresa inteira. Na janela em que o banco ainda não
  // recebeu a 1029, o gestor do programa grava pelo caminho antigo.
  const { error: erroPorta } = await db.rpc("salvar_acordo_de_cobranca", {
    p_company_id: companyId,
    p_acordo: r.valores,
  });
  let error = erroPorta;
  if (erroPorta && semAPorta(erroPorta) && isProgramManager(session)) {
    ({ error } = await db.from("companies").update(r.valores).eq("id", companyId));
  }
  if (error) {
    console.error("salvarAcordoDeCobranca failed:", error.message);
    return {
      ok: false,
      error: semAPorta(error)
        ? "O banco ainda não recebeu a atualização 1029: o acordo não foi salvo."
        : "Não foi possível salvar o acordo de cobrança.",
    };
  }
  const { data: depois } = await db
    .from("companies")
    .select(COLUNAS)
    .eq("id", companyId)
    .maybeSingle();

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
