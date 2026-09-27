"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { contaDoExcedente } from "@/lib/empresarial/excedente";
import { naoConseguiConferir } from "@/lib/contagem";
import { ehValorFixo, mensalidadeDoFixo } from "@/lib/empresarial/mensalidade";
import {
  computeMonthlyBreakdown,
  precoPorTitularDaImplantacao,
} from "@/lib/empresarial/cobranca-servidor";

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
      "excess_mode, excess_fixed_cents, excess_holder_fee_cents, excess_dependent_fee_cents, billing_basis, fixed_monthly_cents"
    )
    .eq("id", companyId)
    .maybeSingle<{
      excess_mode: "NEW_FIXED" | "PER_ADHESION" | null;
      excess_fixed_cents: number | null;
      excess_holder_fee_cents: number | null;
      excess_dependent_fee_cents: number | null;
      billing_basis: string | null;
      fixed_monthly_cents: number | null;
    }>();
  if (!empresa) return { ok: false, error: "Empresa não encontrada." };

  // ⚠️ AP18 — A MENSALIDADE DE HOJE É O QUE A EMPRESA PAGA DE VERDADE (dono,
  // 27/09/2026). Ela é a base da diferença no modo "novo valor fixo".
  //
  // Antes era titulares ativos × preço PRÓPRIO da empresa: sem preço próprio
  // dava ZERO (o termo cobrava o pacote novo inteiro), e ignorava dependentes,
  // faixas — e, no acordo de valor fixo, o próprio fixo.
  //   * valor fixo  → o fixo + os termos já aceitos;
  //   * por titular → a MESMA conta da cobrança do mês (cobranca-servidor).
  // AP13: sem conseguir ler, não gera — o termo é documento com valor.
  const fixo = ehValorFixo(empresa.billing_basis);
  let mensalidadeAtualCents: number;
  if (fixo) {
    const { data: aceitos, error: erroDosTermos } = await db
      .from("company_inclusion_terms")
      .select("monthly_delta_cents")
      .eq("company_id", companyId)
      .eq("status", "ACEITO")
      .returns<{ monthly_delta_cents: number }[]>();
    if (erroDosTermos || !aceitos) {
      return { ok: false, error: naoConseguiConferir("os termos de inclusão já aceitos") };
    }
    const m = mensalidadeDoFixo(empresa.fixed_monthly_cents, aceitos.map((t) => t.monthly_delta_cents));
    if (m === null) {
      return { ok: false, error: "Esta empresa é de valor fixo, mas o valor fixo mensal não está cadastrado." };
    }
    mensalidadeAtualCents = m;
  } else {
    const hoje = await computeMonthlyBreakdown(db, companyId);
    if (!hoje) {
      return { ok: false, error: naoConseguiConferir("o preço e os titulares da empresa") };
    }
    mensalidadeAtualCents = hoje.totalCents;
  }

  // ⚠️ A IMPLANTAÇÃO DOS NOVOS É O 1º PAGAMENTO DELES (dono, 27/09/2026 — os
  // campos de implantação da proposta deixaram de valer). O termo mostra o
  // MESMO número que "Gerar implantação" vai cobrar:
  //   * valor fixo  → o acréscimo mensal do termo (calculado logo abaixo);
  //   * por titular → cada titular novo pelo preço da faixa da empresa já com
  //     eles (a faixa é a do tamanho TOTAL, como na implantação — AP12).
  let implantacaoPorAdesaoCents = 0;
  if (!fixo && titulares > 0) {
    const { data: limiteRow, error: erroDoLimite } = await db.rpc("limite_de_titulares", {
      p_company_id: companyId,
    });
    const { count: ativosAgora, error: erroDosAtivos } = await db
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (erroDoLimite || erroDosAtivos || typeof ativosAgora !== "number") {
      return { ok: false, error: naoConseguiConferir("o tamanho atual da empresa") };
    }
    const limite = typeof limiteRow === "number" ? limiteRow : null;
    const baseDepois = Math.max(limite ?? ativosAgora, ativosAgora) + titulares;
    const porTitular = await precoPorTitularDaImplantacao(db, companyId, baseDepois);
    if (porTitular === null) {
      return { ok: false, error: naoConseguiConferir("o preço da adesão") };
    }
    implantacaoPorAdesaoCents = porTitular;
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
  // Valor fixo: o 1º pagamento do acréscimo É o acréscimo mensal.
  const implantacaoCents = fixo ? conta.mensalDeltaCents : conta.implantacaoCents;

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
      implantation_cents: implantacaoCents,
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
