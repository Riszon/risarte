"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { contaDoExcedente, contaPelaTabela } from "@/lib/empresarial/excedente";
import { naoConseguiConferir } from "@/lib/contagem";
import { ehValorFixo, mensalidadeDoFixo } from "@/lib/empresarial/mensalidade";
import { precoPorTitularDaImplantacao } from "@/lib/empresarial/cobranca-servidor";

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

  const fixo = ehValorFixo(empresa.billing_basis);

  // O que vai para o termo — congelado nele (é o que a empresa aceita).
  let valores: {
    holders: number;
    dependents: number;
    holder_fee_cents: number | null;
    dependent_fee_cents: number | null;
    fixed_cents: number | null;
    monthly_delta_cents: number;
    implantation_cents: number;
    base_holders: number | null;
    base_holder_fee_cents: number | null;
  };
  let faltaCombinar: string[] = [];

  if (fixo) {
    // ⚠️ AP18 — VALOR FIXO: a mensalidade de hoje é o fixo + os termos já
    // aceitos, e é a base da diferença no "novo valor fixo". A implantação dos
    // que entram é o 1º pagamento do acréscimo (= o acréscimo mensal).
    // AP13: sem conseguir ler, não gera — o termo é documento com valor.
    const { data: aceitos, error: erroDosTermos } = await db
      .from("company_inclusion_terms")
      .select("monthly_delta_cents")
      .eq("company_id", companyId)
      .eq("status", "ACEITO")
      // AP19: só termos do VALOR FIXO somam ao fixo — o termo "pela tabela"
      // (de quando a empresa era por titular) já está coberto pelo valor fixo.
      .is("base_holders", null)
      .returns<{ monthly_delta_cents: number }[]>();
    if (erroDosTermos || !aceitos) {
      return { ok: false, error: naoConseguiConferir("os termos de inclusão já aceitos") };
    }
    const hoje = mensalidadeDoFixo(empresa.fixed_monthly_cents, aceitos.map((t) => t.monthly_delta_cents));
    if (hoje === null) {
      return { ok: false, error: "Esta empresa é de valor fixo, mas o valor fixo mensal não está cadastrado." };
    }
    const conta = contaDoExcedente(
      {
        modo: empresa.excess_mode,
        fixoCents: empresa.excess_fixed_cents,
        titularCents: empresa.excess_holder_fee_cents,
        dependenteCents: empresa.excess_dependent_fee_cents,
        mensalidadeAtualCents: hoje,
        implantacaoPorAdesaoCents: 0,
      },
      titulares,
      dependentes
    );
    faltaCombinar = conta.faltaCombinar;
    valores = {
      holders: conta.titulares,
      dependents: conta.dependentes,
      holder_fee_cents: conta.titularCents,
      dependent_fee_cents: conta.dependenteCents,
      fixed_cents: conta.fixoCents,
      monthly_delta_cents: conta.mensalDeltaCents,
      implantation_cents: conta.mensalDeltaCents,
      base_holders: null,
      base_holder_fee_cents: null,
    };
  } else {
    // ⚠️ AP19 — POR TITULAR: QUEM PASSA DO CONTRATADO PAGA O PREÇO DA TABELA
    // (dono, 27/09/2026), com a faixa — a mesma conta do boleto. A regra do
    // excedente gravada na empresa (se houver) NÃO vale aqui: ela é do acordo
    // de valor fixo. Fica no banco, sem uso.
    //
    // O "antes" é o contrato cheio (o maior entre o limite e os ativos), a
    // mesma base da implantação (AP12). A faixa vale para o total, então o
    // preço de todos pode mudar — e a diferença pode ser negativa.
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
    const antes = Math.max(limite ?? ativosAgora, ativosAgora);
    const precoAntes = await precoPorTitularDaImplantacao(db, companyId, antes);
    const precoDepois = await precoPorTitularDaImplantacao(db, companyId, antes + titulares);
    if (precoAntes === null || precoDepois === null) {
      return { ok: false, error: naoConseguiConferir("o preço da adesão") };
    }
    const conta = contaPelaTabela(antes, precoAntes, precoDepois, titulares, dependentes);
    valores = {
      holders: conta.titulares,
      dependents: conta.dependentes,
      holder_fee_cents: conta.titulares > 0 ? conta.depoisPrecoCents : null,
      dependent_fee_cents: null,
      fixed_cents: null,
      monthly_delta_cents: conta.mensalDeltaCents,
      implantation_cents: conta.implantacaoCents,
      base_holders: conta.antesTitulares,
      base_holder_fee_cents: conta.antesPrecoCents,
    };
  }

  const { data: termo, error } = await db
    .from("company_inclusion_terms")
    .insert({
      company_id: companyId,
      ...valores,
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
      faltaCombinar.length > 0
        ? `O termo ${termo.code} foi gerado SEM valor: falta combinar ${faltaCombinar.join(" e ")}. Ajuste a regra do excedente antes de enviar.`
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
    .select("status, monthly_delta_cents, base_holders")
    .eq("id", termId)
    .maybeSingle<{ status: string; monthly_delta_cents: number; base_holders: number | null }>();
  if (!termo) return { ok: false, error: "Termo não encontrado." };
  if (termo.status === "ACEITO") return { ok: false, error: "Este termo já foi aceito." };
  if (termo.status === "CANCELADO") {
    return { ok: false, error: "Este termo foi cancelado — gere outro." };
  }
  // Termo sem valor é termo que ninguém combinou. Aceitar liberaria cadastro
  // sem cobrança, que é o contrário do que ele existe para fazer.
  // AP19: o termo "pela tabela" (empresa por titular, base_holders preenchido)
  // tem valor por definição — pode ser zero (só dependentes) ou negativo (a
  // faixa baixou para todos). A trava vale para o valor fixo, onde a regra do
  // excedente pode não ter sido combinada.
  if (termo.base_holders == null && termo.monthly_delta_cents <= 0) {
    return {
      ok: false,
      error:
        "Este termo está sem valor. Combine a regra do excedente (na proposta ou em Dados Gerais) e gere outro antes de aceitar.",
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
