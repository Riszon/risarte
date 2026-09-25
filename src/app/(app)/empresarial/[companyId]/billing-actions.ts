"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { empresarialDb } from "@/lib/empresarial/db";
import { isProgramManager } from "@/lib/empresarial/access";
import { carregarFaixasDaEmpresa } from "@/lib/empresarial/faixas-da-empresa";
import {
  computeMonthlyCents,
  precoDoTitularComFaixa,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "@/lib/empresarial/pricing";
import type { DependentPlan } from "@/lib/empresarial/constants";
import { proximoVencimento, rotuloDoMes } from "@/lib/empresarial/vencimento";

export type ActionResult = { ok: boolean; error?: string };

export type BillingPreview = {
  ok: boolean;
  error?: string;
  /** Uma linha por boleto que será gerado (mais de uma no modelo por documento). */
  items?: {
    documentId: string | null;
    payerName: string;
    payerDoc: string;
    employees: number;
    totalCents: number;
  }[];
  dueDate?: string;
  referenceMonth?: string;
  description?: string;
  beneficiary?: string;
  billingModel?: string;
  /** Implantação: o cálculo usou a quantidade contratada, não os cadastrados. */
  baseContratada?: number;
  /** Quantos titulares estão cadastrados agora (para a tela explicar a conta). */
  titularesCadastrados?: number;
  /** Nem titulares nem quantidade contratada: a tela precisa pedir o valor. */
  precisaValor?: boolean;
};

/**
 * Prévia do que será cobrado — o dono confirma antes de gerar (valor, vencimento,
 * pagador, beneficiário e a que se refere).
 */
export async function previewBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY"
): Promise<BillingPreview> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: company } = await db
    .from("companies")
    .select(
      "legal_name, trade_name, cnpj, due_day, billing_model, contracted_holders"
    )
    .eq("id", companyId)
    .maybeSingle<{
      legal_name: string;
      trade_name: string | null;
      cnpj: string;
      due_day: number;
      billing_model: string;
      contracted_holders: number | null;
    }>();
  if (!company) return { ok: false, error: "Empresa não encontrada." };
  const contratado = company.contracted_holders;

  const { data: docs } = await db
    .from("company_documents")
    .select("id, doc_type, doc_formatted, nickname, is_primary")
    .eq("company_id", companyId)
    .returns<
      {
        id: string;
        doc_type: string;
        doc_formatted: string;
        nickname: string | null;
        is_primary: boolean;
      }[]
    >();
  const perDocument = company.billing_model === "por_cnpj" && (docs?.length ?? 0) > 1;

  const breakdown = await computeMonthlyBreakdown(db, companyId);
  const companyName = company.trade_name || company.legal_name;
  const primary = (docs ?? []).find((d) => d.is_primary);

  const { dueDate, referenceMonth } = proximoVencimento(company.due_day);
  // O rótulo vem do NÚMERO do mês, sem instante no meio (ver rotuloDoMes).
  const monthLabel = rotuloDoMes(referenceMonth);
  const description =
    billingType === "IMPLANTATION"
      ? `Adesão e implantação — Risarte Empresarial (${companyName})`
      : `Mensalidade do Risarte Empresarial — ${monthLabel}`;

  let items: NonNullable<BillingPreview["items"]>;
  if (perDocument) {
    items = (docs ?? []).map((d) => {
      const part = breakdown.byDocument.get(d.id) ?? { employees: 0, cents: 0 };
      return {
        documentId: d.id,
        payerName: d.nickname ? `${companyName} — ${d.nickname}` : companyName,
        payerDoc: `${d.doc_type} ${d.doc_formatted}`,
        employees: part.employees,
        totalCents: part.cents,
      };
    });
    // Titulares sem documento definido entram no principal.
    const orphan = breakdown.byDocument.get("__none__");
    if (orphan && orphan.cents > 0 && items.length > 0) {
      const target =
        items.find((i) => i.documentId === primary?.id) ?? items[0];
      target.employees += orphan.employees;
      target.totalCents += orphan.cents;
    }
    items = items.filter((i) => i.totalCents > 0);
  } else {
    items = [
      {
        documentId: null,
        payerName: companyName,
        payerDoc: primary
          ? `${primary.doc_type} ${primary.doc_formatted}`
          : company.cnpj,
        employees: breakdown.totalEmployees,
        totalCents: breakdown.totalCents,
      },
    ];
  }

  // ⚠️ A IMPLANTAÇÃO NÃO ESPERA OS CADASTROS (relatos OC-00055 e OC-00057,
  // decisão do dono em 24/09/2026).
  //
  // Antes, sem nenhum titular ativo a geração era recusada — e a empresa que
  // aderiu hoje e só manda os nomes no mês que vem ficava sem como ser
  // cobrada. Pior: quando havia 2 de 7 cadastrados, a cobrança saía pelos 2,
  // e só não saía errada se alguém lembrasse de corrigir o valor na mão.
  //
  // Agora a base é a QUANTIDADE CONTRATADA, que veio da proposta no
  // fechamento (I4). Sem ela, a tela pede o valor — é o caso das empresas
  // cadastradas direto, sem passar pelo funil.
  if (billingType === "IMPLANTATION") {
    const semTitulares = breakdown.totalEmployees === 0;
    const menosQueOContratado =
      contratado != null && breakdown.totalEmployees < contratado;

    if (semTitulares || menosQueOContratado) {
      if (contratado != null && contratado > 0) {
        const cents = await implantacaoPeloContratado(db, companyId, contratado);
        return {
          ok: true,
          items: [
            {
              documentId: null,
              payerName: companyName,
              payerDoc: primary
                ? `${primary.doc_type} ${primary.doc_formatted}`
                : company.cnpj,
              employees: contratado,
              totalCents: cents,
            },
          ],
          dueDate,
          referenceMonth,
          description,
          beneficiary: "Risarte / RisLife",
          billingModel: company.billing_model,
          baseContratada: contratado,
          titularesCadastrados: breakdown.totalEmployees,
        };
      }
      if (semTitulares) {
        // Sem titulares E sem quantidade contratada: ninguém tem como saber o
        // valor. A tela pergunta — inventar um número aqui seria pior.
        return {
          ok: true,
          items: [
            {
              documentId: null,
              payerName: companyName,
              payerDoc: primary
                ? `${primary.doc_type} ${primary.doc_formatted}`
                : company.cnpj,
              employees: 0,
              totalCents: 0,
            },
          ],
          dueDate,
          referenceMonth,
          description,
          beneficiary: "Risarte / RisLife",
          billingModel: company.billing_model,
          precisaValor: true,
          titularesCadastrados: 0,
        };
      }
    }
  }

  if (items.length === 0 || items.every((i) => i.totalCents <= 0)) {
    return {
      ok: false,
      error:
        billingType === "MONTHLY"
          ? "Sem titulares ativos para cobrar a mensalidade. Complete os cadastros antes."
          : "Sem titulares ativos e sem quantidade contratada. Informe o valor da implantação.",
    };
  }

  return {
    ok: true,
    items,
    dueDate,
    referenceMonth,
    description,
    beneficiary: "Risarte / RisLife",
    billingModel: perDocument ? "por_cnpj" : "unico",
  };
}

/** Vencimento: próximo dia configurado que ainda não passou. */
// ⚠️ A CONTA DO VENCIMENTO SAIU DAQUI (achado AP1, corrigido em 25/09/2026).
//
// Ela vivia nesta função privada e lia o calendário do SERVIDOR — que na
// Vercel é UTC. Entre 21h e meia-noite de Brasília o servidor já está no dia
// seguinte, e uma cobrança gerada às 22h do dia 30 gravava o mês de
// referência do mês seguinte. E `new Date(2026, 1, 31)` é 3 de MARÇO: a
// empresa com vencimento no dia 31 recebia, em fevereiro, um boleto para
// março.
//
// Agora mora em `@/lib/empresarial/vencimento`, pura e com teste — porque
// decide data e dinheiro, e os dois defeitos eram invisíveis para quem olha a
// tela num computador brasileiro.

/**
 * O valor da implantação pela QUANTIDADE CONTRATADA.
 *
 * ⚠️ SÓ TITULARES, e isso é a mesma lei que vale na proposta (decisão do dono
 * em 24/09/2026, bloco I1): ninguém sabe quantos dependentes entram nem como
 * se distribuem entre as famílias antes dos cadastros. Somá-los aqui seria
 * cobrar por gente que talvez não exista.
 *
 * A faixa é escolhida pela quantidade CONTRATADA — é ela que a empresa
 * negociou. Usar a faixa de "1" porque ainda não há ninguém cadastrado
 * cobraria o preço mais caro justamente de quem fechou volume.
 */
async function implantacaoPeloContratado(
  db: Awaited<ReturnType<typeof empresarialDb>>,
  companyId: string,
  contratado: number
): Promise<number> {
  const { data: pricingRows } = await db
    .from("adhesion_pricing")
    .select("company_id, holder_fee_cents")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const rows = (pricingRows ?? []) as {
    company_id: string | null;
    holder_fee_cents: number;
  }[];
  const escolhido =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const base = escolhido?.holder_fee_cents ?? DEFAULT_ADHESION_PRICING.holderFeeCents;

  const faixas = await carregarFaixasDaEmpresa(db, companyId);
  const porTitular = precoDoTitularComFaixa(
    { ...DEFAULT_ADHESION_PRICING, holderFeeCents: base },
    faixas,
    contratado
  );
  return porTitular * contratado;
}

/** Mensalidade total e por documento (para o modelo "um boleto por CNPJ"). */
async function computeMonthlyBreakdown(
  db: Awaited<ReturnType<typeof empresarialDb>>,
  companyId: string
): Promise<{
  totalCents: number;
  totalEmployees: number;
  byDocument: Map<string, { employees: number; cents: number }>;
}> {
  const [{ data: pricingRows }, { data: emps }, { data: deps }] =
    await Promise.all([
      db
        .from("adhesion_pricing")
        .select(
          "company_id, holder_fee_cents, dependent_individual_fee_cents, dependent_family_fee_cents, dependent_family_extra_fee_cents, max_installments, dependent_family_size"
        )
        .or(`company_id.eq.${companyId},company_id.is.null`),
      db
        .from("employees")
        .select("id, dependent_plan, status, company_document_id")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .returns<
          {
            id: string;
            dependent_plan: DependentPlan;
            status: "ACTIVE";
            company_document_id: string | null;
          }[]
        >(),
      db.from("dependents").select("employee_id, status").eq("status", "ACTIVE"),
    ]);

  const rows = (pricingRows ?? []) as {
    company_id: string | null;
    holder_fee_cents: number;
    dependent_individual_fee_cents: number;
    dependent_family_fee_cents: number;
    dependent_family_extra_fee_cents: number;
    max_installments: number;
  }[];
  const chosen =
    rows.find((r) => r.company_id === companyId) ??
    rows.find((r) => r.company_id === null);
  const pricing: AdhesionPricing = chosen
    ? {
        holderFeeCents: chosen.holder_fee_cents,
        dependentIndividualFeeCents: chosen.dependent_individual_fee_cents,
        dependentFamilyFeeCents: chosen.dependent_family_fee_cents,
        dependentFamilyExtraFeeCents: chosen.dependent_family_extra_fee_cents,
        maxInstallments: chosen.max_installments,
      }
    : DEFAULT_ADHESION_PRICING;

  const depCount = new Map<string, number>();
  for (const d of (deps ?? []) as { employee_id: string }[])
    depCount.set(d.employee_id, (depCount.get(d.employee_id) ?? 0) + 1);

  // ⚠️ A FAIXA É ESCOLHIDA PELO TOTAL, e a soma abaixo é feita um titular por
  // vez (para repartir por CNPJ). Calcular a faixa dentro do laço faria cada
  // chamada ver "1 titular ativo" e cobrar sempre a faixa de 1 — o preço mais
  // caro, em toda empresa que negociou volume.
  const faixas = await carregarFaixasDaEmpresa(db, companyId);
  const ativos = (emps ?? []).filter((e) => e.status === "ACTIVE").length;
  const precoComFaixa = {
    ...pricing,
    holderFeeCents: precoDoTitularComFaixa(pricing, faixas, ativos),
  };

  const byDocument = new Map<string, { employees: number; cents: number }>();
  let totalCents = 0;
  for (const e of emps ?? []) {
    const one = computeMonthlyCents(precoComFaixa, [
      {
        status: "ACTIVE",
        dependentPlan: e.dependent_plan,
        activeDependentCount: depCount.get(e.id) ?? 0,
      },
    ]).totalCents;
    totalCents += one;
    const key = e.company_document_id ?? "__none__";
    const cur = byDocument.get(key) ?? { employees: 0, cents: 0 };
    cur.employees++;
    cur.cents += one;
    byDocument.set(key, cur);
  }

  return { totalCents, totalEmployees: (emps ?? []).length, byDocument };
}

/** Gera a cobrança (implantação ou mensal). Cria o registro local (PENDING). */
export async function generateBilling(
  companyId: string,
  billingType: "IMPLANTATION" | "MONTHLY",
  /**
   * Valor informado à mão, em centavos. Só vale para a IMPLANTAÇÃO e só quando
   * a prévia disse que não há como calcular (`precisaValor`) — a empresa não
   * tem titulares nem quantidade contratada. Aceitá-lo em qualquer caso abriria
   * a porta para alguém digitar um valor por cima da conta sem ninguém ver.
   */
  valorInformadoCents?: number
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  // A prévia é a mesma que o usuário confirmou na tela (um ou vários boletos).
  const preview = await previewBilling(companyId, billingType);
  if (!preview.ok || !preview.items) {
    return { ok: false, error: preview.error ?? "Não foi possível gerar." };
  }

  if (preview.precisaValor) {
    if (!valorInformadoCents || valorInformadoCents <= 0) {
      return { ok: false, error: "Informe o valor da implantação." };
    }
    preview.items = preview.items.map((i) => ({
      ...i,
      totalCents: valorInformadoCents,
    }));
  }

  const db = await empresarialDb();
  const rows = preview.items.map((i) => ({
    company_id: companyId,
    company_document_id: i.documentId,
    billing_type: billingType,
    reference_month: preview.referenceMonth,
    total_amount_cents: i.totalCents,
    status: "PENDING",
    due_date: preview.dueDate,
    description: preview.description,
  }));

  const { error } = await db.from("adhesion_billing").insert(rows);
  if (error) {
    console.error("generateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível gerar a cobrança." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: billingType, count: rows.length },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Edita uma cobrança ainda não paga (valor, vencimento e descrição). */
export async function updateBilling(
  companyId: string,
  billingId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };

  const db = await empresarialDb();
  const { data: current } = await db
    .from("adhesion_billing")
    .select("status")
    .eq("id", billingId)
    .maybeSingle<{ status: string }>();
  if (!current) return { ok: false, error: "Cobrança não encontrada." };
  if (current.status === "PAID") {
    return { ok: false, error: "Cobrança já paga não pode ser editada." };
  }

  const rawValue = String(formData.get("total") ?? "").trim();
  const cents = Math.round(
    Number.parseFloat(
      rawValue.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
    ) * 100
  );
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: "Informe um valor válido." };
  }
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!dueDate) return { ok: false, error: "Informe o vencimento." };

  const { error } = await db
    .from("adhesion_billing")
    .update({
      total_amount_cents: cents,
      due_date: dueDate,
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .eq("id", billingId);
  if (error) {
    console.error("updateBilling failed:", error.message);
    return { ok: false, error: "Não foi possível salvar a cobrança." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { total: cents, due_date: dueDate },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Cancela a cobrança — o motivo é obrigatório (validado também no banco). */
export async function cancelBilling(
  companyId: string,
  billingId: string,
  reason: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  if (!reason.trim()) {
    return { ok: false, error: "Informe o motivo do cancelamento." };
  }

  const db = await empresarialDb();
  const { error } = await db.rpc("cancel_billing", {
    p_billing_id: billingId,
    p_reason: reason.trim(),
  });
  if (error) {
    console.error("cancelBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível cancelar a cobrança.",
    };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { cancelled: true },
  });
  // A empresa pode sair da suspensão ao acabar o atraso — a lista mostra isso.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/**
 * Baixa manual (simula o webhook do ASAAS) — liquida a cobrança e grava o split.
 * Quando o ASAAS estiver ligado, a Edge Function chama a mesma RPC settle_billing.
 */
export async function markBillingPaid(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("settle_billing", {
    p_billing_id: billingId,
    p_paid_at: new Date().toISOString(),
  });
  if (error) {
    console.error("markBillingPaid failed:", error.message);
    return { ok: false, error: "Não foi possível registrar o pagamento." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_billing",
    entityId: billingId,
    details: { paid: true },
  });
  // Pagar pode tirar a empresa da suspensão por inadimplência.
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/**
 * Exclui a cobrança de vez (Admin Master). Diferente de cancelar, que fica no
 * histórico: aqui a linha é apagada — serve para limpar cobranças de TESTE
 * antes de a empresa receber um relatório. O banco registra em audit_logs antes
 * de apagar e reavalia a suspensão da empresa.
 */
export async function deleteBilling(
  companyId: string,
  billingId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!session.isAdminMaster) {
    return { ok: false, error: "Só o Admin Master pode excluir uma cobrança." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("delete_billing", {
    p_billing_id: billingId,
  });
  if (error) {
    console.error("deleteBilling failed:", error.message);
    return {
      ok: false,
      error: error.hint ?? "Não foi possível excluir a cobrança.",
    };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}

/** Roda a checagem de inadimplência (suspende empresas com atraso > 5 dias). */
export async function runOverdueCheck(companyId: string): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!isProgramManager(session)) return { ok: false, error: "Sem permissão." };
  const db = await empresarialDb();
  const { error } = await db.rpc("mark_overdue_and_suspend", {});
  if (error) {
    console.error("runOverdueCheck failed:", error.message);
    return { ok: false, error: "Não foi possível checar a inadimplência." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/empresarial");
  return { ok: true };
}
