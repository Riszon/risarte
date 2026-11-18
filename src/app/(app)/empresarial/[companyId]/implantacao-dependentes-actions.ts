"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isProgramFinance } from "@/lib/empresarial/access";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  cobertosPorTitular,
  implantacaoDosDependentesNovos,
  type ImplantacaoDoTitular,
} from "@/lib/empresarial/implantacao-dos-dependentes";
import { documentoLegivel, pagadorDaCobranca } from "@/lib/empresarial/pagador-dos-dependentes";
import {
  ADHESION_PRICING_COLUMNS,
  DEFAULT_ADHESION_PRICING,
  escolherPricing,
  pricingFromRow,
  type AdhesionPricingRow,
} from "@/lib/empresarial/pricing";
import { proximoVencimento } from "@/lib/empresarial/vencimento";

/**
 * A IMPLANTAÇÃO DOS DEPENDENTES NOVOS (1050, R7). A conta é
 * `implantacaoDosDependentesNovos` (pura); aqui se lê o banco, agrupa por
 * pagador (a empresa, ou quem paga à parte — 1049) e grava a cobrança com a
 * cobertura de cada titular. Tudo é recalculado no servidor ao gerar: o valor
 * que a tela mostrou nunca é aceito de volta.
 */

export type PreviaDosDependentesNovos =
  | { ok: false; error: string }
  | {
      ok: true;
      titulares: (ImplantacaoDoTitular & { pagadorTexto: string })[];
      totalCents: number;
      dueDate: string;
    };

const NAO_LEU = "Não foi possível conferir os dependentes e o que já foi pago agora. Nada foi gerado; tente de novo em instantes.";

async function calcular(companyId: string): Promise<
  | { ok: false; error: string }
  | { ok: true; lista: ImplantacaoDoTitular[]; empresa: { nome: string; dueDay: number; docId: string | null } }
> {
  const db = await empresarialDb();
  const { data: c } = await db
    .from("companies")
    .select("legal_name, trade_name, due_day, implantation_includes_dependents, implantation_status")
    .eq("id", companyId)
    .maybeSingle<{
      legal_name: string;
      trade_name: string | null;
      due_day: number;
      implantation_includes_dependents: boolean;
      implantation_status: string | null;
    }>();
  if (!c) return { ok: false, error: "Empresa não encontrada." };
  if (!c.implantation_includes_dependents) {
    return {
      ok: false,
      error:
        "Esta empresa não combinou implantação dos dependentes (só dos titulares). Para mudar, use a revisão do contrato na aba Regras combinadas.",
    };
  }
  if (c.implantation_status === "ISENTA") {
    return { ok: false, error: "Esta empresa é isenta de implantação (combinado na revisão do contrato)." };
  }
  const [precos, titulares, dependentes, cobertura, doc] = await Promise.all([
    db
      .from("adhesion_pricing")
      .select(ADHESION_PRICING_COLUMNS)
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .returns<AdhesionPricingRow[]>(),
    db
      .from("employees")
      .select("id, full_name, cpf, dependents_payer, dependents_payer_name, dependents_payer_document")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
      .returns<
        {
          id: string;
          full_name: string;
          cpf: string | null;
          dependents_payer: string | null;
          dependents_payer_name: string | null;
          dependents_payer_document: string | null;
        }[]
      >(),
    db
      .from("dependents")
      .select("employee_id, employees!inner(company_id)")
      .eq("status", "ACTIVE")
      .eq("employees.company_id", companyId)
      .returns<{ employee_id: string }[]>(),
    db
      .from("dependents_implantation_coverage")
      .select("employee_id, dependents_covered, adhesion_billing(status)")
      .eq("company_id", companyId)
      .returns<{ employee_id: string; dependents_covered: number; adhesion_billing: { status: string } | null }[]>(),
    db
      .from("company_documents")
      .select("id")
      .eq("company_id", companyId)
      .eq("is_primary", true)
      .maybeSingle<{ id: string }>(),
  ]);
  if (precos.error || titulares.error || dependentes.error || cobertura.error || !precos.data || !titulares.data || !dependentes.data || !cobertura.data) {
    return { ok: false, error: NAO_LEU };
  }
  const escolhido = escolherPricing(precos.data, companyId);
  const pricing = escolhido ? pricingFromRow(escolhido) : DEFAULT_ADHESION_PRICING;
  const ativos = new Map<string, number>();
  for (const d of dependentes.data) ativos.set(d.employee_id, (ativos.get(d.employee_id) ?? 0) + 1);
  const cobertos = cobertosPorTitular(
    cobertura.data.map((x) => ({
      employee_id: x.employee_id,
      dependents_covered: x.dependents_covered,
      billing_status: x.adhesion_billing?.status ?? null,
    }))
  );
  const lista = implantacaoDosDependentesNovos(
    pricing,
    titulares.data.map((t) => ({
      employeeId: t.id,
      nome: t.full_name,
      ativos: ativos.get(t.id) ?? 0,
      cobertos: cobertos.get(t.id) ?? 0,
      pagador: pagadorDaCobranca(t),
    }))
  );
  return {
    ok: true,
    lista,
    empresa: { nome: c.trade_name || c.legal_name, dueDay: c.due_day, docId: doc.data?.id ?? null },
  };
}

export async function previaDosDependentesNovos(companyId: string): Promise<PreviaDosDependentesNovos> {
  const session = await getSessionContext();
  if (!isProgramFinance(session)) return { ok: false, error: "Sem permissão." };
  const r = await calcular(companyId);
  if (!r.ok) return r;
  const { dueDate } = proximoVencimento(r.empresa.dueDay);
  return {
    ok: true,
    titulares: r.lista.map((t) => ({
      ...t,
      pagadorTexto: t.pagador ? `${t.pagador.nome} (${documentoLegivel(t.pagador.documento)})` : r.empresa.nome,
    })),
    totalCents: r.lista.reduce((s, t) => s + t.cents, 0),
    dueDate,
  };
}

/** Gera a implantação dos titulares escolhidos (uma cobrança por pagador). */
export async function gerarDosDependentesNovos(
  companyId: string,
  employeeIds: string[]
): Promise<{ ok: boolean; error?: string; cobrancas?: number }> {
  const session = await getSessionContext();
  if (!isProgramFinance(session)) return { ok: false, error: "Sem permissão." };
  const r = await calcular(companyId);
  if (!r.ok) return r;
  const escolhidos = r.lista.filter((t) => employeeIds.includes(t.employeeId));
  if (escolhidos.length === 0) return { ok: false, error: "Nenhum titular com dependente novo para cobrar." };

  const { dueDate, referenceMonth } = proximoVencimento(r.empresa.dueDay);
  const db = await empresarialDb();
  // Uma cobrança da empresa (quem ela paga) + uma por pagador à parte.
  const daEmpresa = escolhidos.filter((t) => !t.pagador);
  const aParte = escolhidos.filter((t) => t.pagador);
  const grupos: { employeeId: string | null; nome: string | null; documento: string | null; itens: ImplantacaoDoTitular[] }[] = [];
  if (daEmpresa.length) grupos.push({ employeeId: null, nome: null, documento: null, itens: daEmpresa });
  for (const t of aParte) grupos.push({ employeeId: t.employeeId, nome: t.pagador!.nome, documento: t.pagador!.documento, itens: [t] });

  let geradas = 0;
  for (const g of grupos) {
    const total = g.itens.reduce((s, t) => s + t.cents, 0);
    const novos = g.itens.reduce((s, t) => s + t.novos, 0);
    const { data: cobranca, error } = await db
      .from("adhesion_billing")
      .insert({
        company_id: companyId,
        company_document_id: g.employeeId ? null : r.empresa.docId,
        billing_type: "IMPLANTATION",
        reference_month: referenceMonth,
        total_amount_cents: total,
        status: "PENDING",
        due_date: dueDate,
        description: g.employeeId
          ? `Implantação dos dependentes novos de ${g.itens[0].nome} — Risarte Empresarial (${r.empresa.nome})`
          : `Implantação dos dependentes novos (${novos}) — Risarte Empresarial (${r.empresa.nome})`,
        employee_id: g.employeeId,
        payer_name: g.nome,
        payer_document: g.documento,
        // Não cobre titular nenhum: a implantação dos titulares não desconta esta.
        holders_covered: 0,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !cobranca) {
      console.error("implantação dos dependentes novos:", error?.message);
      return {
        ok: false,
        error: geradas
          ? `Foram geradas ${geradas} cobrança(s), e a seguinte falhou. Atualize a página antes de tentar de novo.`
          : "Não foi possível gerar a cobrança.",
      };
    }
    const { error: erroDaCobertura } = await db.from("dependents_implantation_coverage").insert(
      g.itens.map((t) => ({
        company_id: companyId,
        employee_id: t.employeeId,
        dependents_covered: t.dependentes,
        package_cents: t.cents,
        billing_id: cobranca.id,
        created_by: session.userId,
      }))
    );
    if (erroDaCobertura) {
      // A cobrança sem a cobertura deixaria o mesmo dependente ser cobrado de
      // novo: desfaz a cobrança.
      await db.from("adhesion_billing").delete().eq("id", cobranca.id);
      console.error("cobertura dos dependentes novos:", erroDaCobertura.message);
      return { ok: false, error: "Não foi possível registrar quem a cobrança cobre. Nada foi gerado nesta etapa." };
    }
    geradas++;
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: "IMPLANTATION_DEPENDENTS", count: geradas },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, cobrancas: geradas };
}

/**
 * Marca os dependentes de hoje de um titular como já cobertos, sem cobrança
 * (pagos antes, cobertos pela estimativa do fechamento, ou dispensados).
 * O motivo é obrigatório e fica na trilha.
 */
export async function marcarDependentesCobertos(
  companyId: string,
  employeeId: string,
  motivo: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionContext();
  if (!isProgramFinance(session)) return { ok: false, error: "Sem permissão." };
  if (motivo.trim().length < 10) return { ok: false, error: "Escreva o motivo (pelo menos 10 letras)." };
  const r = await calcular(companyId);
  if (!r.ok) return r;
  const t = r.lista.find((x) => x.employeeId === employeeId);
  if (!t) return { ok: false, error: "Este titular não tem dependente novo para cobrar." };
  const db = await empresarialDb();
  const { error } = await db.from("dependents_implantation_coverage").insert({
    company_id: companyId,
    employee_id: employeeId,
    dependents_covered: t.dependentes,
    reason: motivo.trim(),
    created_by: session.userId,
  });
  if (error) {
    console.error("marcarDependentesCobertos:", error.message);
    return { ok: false, error: "Não foi possível registrar." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_billing",
    entityId: companyId,
    details: { type: "IMPLANTATION_DEPENDENTS_COVERED", employee: employeeId },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}
