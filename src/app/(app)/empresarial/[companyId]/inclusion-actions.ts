"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { contaDoExcedente } from "@/lib/empresarial/excedente";

export type ActionResult = { ok: boolean; error?: string; code?: string };

/**
 * O TERMO DE INCLUSÃO (OC-00083, I4 / 1020).
 *
 * A empresa contratou 100 e mandou 120 nomes: os 20 a mais não entram até que
 * um termo seja gerado e **aceito**. O termo é curto de propósito — decisão do
 * dono: *"um documento mais simples que a proposta inicial, mas lembrando a
 * empresa que o titular está sendo cadastrado no programa e é referente ao
 * acordo que já existe"*. Ele não renegocia benefício, carência nem unidade.
 *
 * ⚠️ OS VALORES SÃO CONGELADOS NO TERMO. Mudar a regra da empresa depois não
 * pode reescrever o que ela aceitou — mesma lei do repasse (0209), da alçada
 * (0194) e do percentual do split (0232).
 */
export async function criarTermoDeInclusao(
  companyId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) {
    return { ok: false, error: "Só o gestor do programa gera termo de inclusão." };
  }

  const inteiro = (k: string) => {
    const v = String(formData.get(k) ?? "").replace(/\D/g, "");
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const titulares = inteiro("holders");
  const dependentes = inteiro("dependents");
  if (titulares <= 0 && dependentes <= 0) {
    return { ok: false, error: "Diga quantos titulares ou dependentes entram." };
  }

  const db = await empresarialDb();
  const { data: empresa } = await db
    .from("companies")
    .select(
      "excess_mode, excess_fixed_cents, excess_holder_fee_cents, excess_dependent_fee_cents"
    )
    .eq("id", companyId)
    .maybeSingle<{
      excess_mode: "NEW_FIXED" | "PER_ADHESION" | null;
      excess_fixed_cents: number | null;
      excess_holder_fee_cents: number | null;
      excess_dependent_fee_cents: number | null;
    }>();
  if (!empresa) return { ok: false, error: "Empresa não encontrada." };

  // A mensalidade de HOJE é a base da diferença no acordo de valor fixo.
  const { data: precos } = await db
    .from("adhesion_pricing")
    .select("holder_fee_cents")
    .eq("company_id", companyId)
    .maybeSingle<{ holder_fee_cents: number }>();
  const { count: ativos } = await db
    .from("employees")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "ACTIVE");
  const mensalidadeAtualCents = (ativos ?? 0) * (precos?.holder_fee_cents ?? 0);

  const { data: empresaImpl } = await db
    .from("companies")
    .select("origin_lead_id")
    .eq("id", companyId)
    .maybeSingle<{ origin_lead_id: string | null }>();
  let implantacaoPorAdesaoCents = 0;
  if (empresaImpl?.origin_lead_id) {
    const { data: q } = await db
      .from("lead_qualification")
      .select("implantation_per_employee_cents, implantation_mode")
      .eq("lead_id", empresaImpl.origin_lead_id)
      .maybeSingle<{
        implantation_per_employee_cents: number | null;
        implantation_mode: "PER_ADHESION" | "FIXED" | null;
      }>();
    // ⚠️ Implantação FIXA não se cobra de novo: ela foi paga uma vez, pela
    // empresa. Só a implantação POR ADESÃO acompanha gente nova.
    if (q?.implantation_mode !== "FIXED") {
      implantacaoPorAdesaoCents = q?.implantation_per_employee_cents ?? 0;
    }
  }

  const conta = contaDoExcedente(
    {
      modo: empresa.excess_mode,
      fixoCents: empresa.excess_fixed_cents,
      titularCents: empresa.excess_holder_fee_cents,
      dependenteCents: empresa.excess_dependent_fee_cents,
      mensalidadeAtualCents,
      implantacaoPorAdesaoCents,
    },
    titulares,
    dependentes
  );

  const { data: termo, error } = await db
    .from("company_inclusion_terms")
    .insert({
      company_id: companyId,
      holders: conta.titulares,
      dependents: conta.dependentes,
      holder_fee_cents: conta.titularCents,
      dependent_fee_cents: conta.dependenteCents,
      fixed_cents: conta.fixoCents,
      monthly_delta_cents: conta.mensalDeltaCents,
      implantation_cents: conta.implantacaoCents,
      notes: String(formData.get("notes") ?? "").trim() || null,
      created_by: session.userId,
    })
    .select("id, code")
    .single();
  if (error) {
    console.error("criarTermoDeInclusao failed:", error.message);
    return { ok: false, error: "Não foi possível gerar o termo." };
  }

  await logAudit({
    action: "create",
    entityType: "empresarial_inclusion_term",
    entityId: termo.id,
  });
  revalidatePath(`/empresarial/${companyId}`);

  // ⚠️ O QUE FALTOU COMBINAR VOLTA JUNTO COM O SUCESSO. O termo existe (é
  // verdade) e nasceu sem valor (também é): dizer só a primeira metade faria
  // alguém mandá-lo para a empresa com R$ 0,00.
  return {
    ok: true,
    code: termo.code,
    error:
      conta.faltaCombinar.length > 0
        ? `O termo ${termo.code} foi gerado SEM valor: falta combinar ${conta.faltaCombinar.join(" e ")}. Ajuste na proposta antes de enviar.`
        : undefined,
  };
}

/**
 * Aceitar o termo é o que LIBERA os cadastros.
 *
 * Enquanto está em rascunho, o limite continua sendo o contratado — é o aceite
 * que autoriza, e é ele que a empresa vai reconhecer quando a diferença for
 * cobrada.
 */
export async function aceitarTermoDeInclusao(
  companyId: string,
  termId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: termo } = await db
    .from("company_inclusion_terms")
    .select("status, monthly_delta_cents")
    .eq("id", termId)
    .maybeSingle<{ status: string; monthly_delta_cents: number }>();
  if (!termo) return { ok: false, error: "Termo não encontrado." };
  if (termo.status === "ACEITO") return { ok: false, error: "Este termo já foi aceito." };
  if (termo.status === "CANCELADO") {
    return { ok: false, error: "Este termo foi cancelado — gere outro." };
  }
  // Termo sem valor é termo que ninguém combinou. Aceitar liberaria cadastro
  // sem cobrança, que é o contrário do que ele existe para fazer.
  if (termo.monthly_delta_cents <= 0) {
    return {
      ok: false,
      error:
        "Este termo está sem valor. Combine a regra do excedente na proposta e gere outro antes de aceitar.",
    };
  }

  const { error } = await db
    .from("company_inclusion_terms")
    .update({ status: "ACEITO", accepted_at: new Date().toISOString() })
    .eq("id", termId);
  if (error) {
    console.error("aceitarTermoDeInclusao failed:", error.message);
    return { ok: false, error: "Não foi possível aceitar o termo." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_inclusion_term",
    entityId: termId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Cancelar deixa rastro: o termo some da conta do limite, mas não do histórico. */
export async function cancelarTermoDeInclusao(
  companyId: string,
  termId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { error } = await db
    .from("company_inclusion_terms")
    .update({ status: "CANCELADO" })
    .eq("id", termId);
  if (error) {
    console.error("cancelarTermoDeInclusao failed:", error.message);
    return { ok: false, error: "Não foi possível cancelar o termo." };
  }

  await logAudit({
    action: "update",
    entityType: "empresarial_inclusion_term",
    entityId: termId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
