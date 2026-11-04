"use server";

import { revalidatePath } from "next/cache";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatCpf, formatPhone } from "@/lib/masks";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import { naoConseguiConferir } from "@/lib/contagem";
import { recusaDoDependente, vagasDisponiveis } from "@/lib/empresarial/excedente";
import { vagasParaTitulares } from "@/lib/empresarial/vagas";
import {
  conferirPlanilha,
  resumoDaRecusa,
  type DependenteDaPlanilha,
  type LinhaComErro,
  type LinhaDaPlanilha,
} from "@/lib/empresarial/importacao";
import { lerPorLotes } from "@/lib/paginar";
import { canWorkOnCompanies, isProgramManager } from "@/lib/empresarial/access";
import { LEFT_REASONS, RELATIONSHIPS } from "@/lib/empresarial/constants";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Pode mexer nos titulares: gestor do programa, Consultor RisLife (só nas
 * empresas dele — a RLS confere, 1039), SDR, recepção ou gestão da unidade.
 * Levar à unidade ("completar cadastro", "vincular") passa também por
 * `canUseClinic`, que o consultor não tem.
 */
function canManageEmployees(session: SessionContext): boolean {
  if (canWorkOnCompanies(session)) return true;
  return Object.values(session.rolesByClinic)
    .flat()
    .some((r) =>
      ["sdr", "receptionist", "unit_manager", "franchisee"].includes(r)
    );
}

function field(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v || null;
}

/**
 * Valida a unidade escolhida na "ponte". Admin, gestor do programa e SDR podem
 * registrar em qualquer unidade (regra do SDR — cliente pertence à unidade
 * escolhida); os demais só nas unidades do seu escopo.
 */
async function canUseClinic(
  session: SessionContext,
  clinicId: string
): Promise<boolean> {
  if (session.isAdminMaster || isProgramManager(session)) return true;
  const isSdr = Object.values(session.rolesByClinic).flat().includes("sdr");
  if (isSdr) return true;
  const scope = await fullAccessClinicIds();
  return scope.includes(clinicId);
}

export async function createEmployee(
  companyId: string,
  formData: FormData
): Promise<ActionResult & { employeeId?: string }> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão para cadastrar titulares." };
  }
  const cpf = (field(formData, "cpf") ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false, error: "Informe o CPF completo." };
  const fullName = field(formData, "full_name");
  if (!fullName) return { ok: false, error: "Informe o nome do titular." };
  const phone = field(formData, "phone");
  if (!phone) return { ok: false, error: "Informe o telefone." };

  const db = await empresarialDb();

  // ⚠️ A TRAVA É PELA QUANTIDADE FECHADA NO CONTRATO (1020, I4). Decisão do
  // dono: "a empresa tem 100 colaboradores, e quando foi fazer o cadastro
  // enviou 120 nomes — o sistema não pode permitir cadastrar os 120".
  //
  // A conta mora em UM lugar (`vagasParaTitulares`, AP97): o limite é o
  // contratado MAIS os termos de inclusão aceitos (somado pelo banco), o
  // máximo da proposta é um teto separado, e leitura que falha é RECUSA
  // (AP11), nunca "sem trava". A importação de planilha pergunta à mesma
  // função — antes ela dizia que perguntava e não perguntava.
  const vagas = await vagasParaTitulares(db, companyId, 1);
  if (!vagas.ok) return { ok: false, error: vagas.motivo };

  const { data, error } = await db
    .from("employees")
    .insert({
      company_id: companyId,
      cpf: formatCpf(cpf),
      full_name: fullName,
      phone: formatPhone(phone),
      email: field(formData, "email"),
      // Plano de dependentes é CALCULADO pelo banco (gatilho da 1002).
      dependent_plan: "NONE",
      grace_period_days: field(formData, "grace_period_days")
        ? Number.parseInt(field(formData, "grace_period_days")!, 10)
        : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este CPF já está cadastrado nesta empresa." };
    }
    console.error("createEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível cadastrar o titular." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_employee",
    entityId: data.id,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true, employeeId: data.id };
}

export async function updateEmployee(
  companyId: string,
  employeeId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const fullName = field(formData, "full_name");
  if (!fullName) return { ok: false, error: "Informe o nome." };
  const phone = field(formData, "phone");

  const db = await empresarialDb();
  const { error } = await db
    .from("employees")
    .update({
      full_name: fullName,
      phone: phone ? formatPhone(phone) : null,
      email: field(formData, "email"),
      // dependent_plan não entra: o banco calcula pelos dependentes (1002).
      grace_period_days: field(formData, "grace_period_days")
        ? Number.parseInt(field(formData, "grace_period_days")!, 10)
        : null,
    })
    .eq("id", employeeId);
  if (error) {
    console.error("updateEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível salvar." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Ponte: cria/vincula o cliente do riSZon e completa o cadastro. */
export async function completeEmployee(
  companyId: string,
  employeeId: string,
  clinicId: string
): Promise<ActionResult & { clientId?: string }> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (!clinicId) return { ok: false, error: "Escolha a unidade do titular." };
  if (!(await canUseClinic(session, clinicId))) {
    return { ok: false, error: "Você não pode registrar nesta unidade." };
  }

  const db = await empresarialDb();
  const { data, error } = await db.rpc("complete_employee", {
    p_employee_id: employeeId,
    p_clinic_id: clinicId,
  });
  if (error) {
    console.error("completeEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível completar o cadastro." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    clinicId,
    details: { linked_client: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true, clientId: (data as string) ?? undefined };
}

export async function setEmployeeStatus(
  companyId: string,
  employeeId: string,
  active: boolean,
  reason?: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const validReason =
    reason && (LEFT_REASONS as readonly string[]).includes(reason)
      ? reason
      : null;
  const db = await empresarialDb();
  const { error } = await db.rpc("set_employee_active", {
    p_employee_id: employeeId,
    p_active: active,
    p_reason: validReason,
  });
  if (error) {
    console.error("setEmployeeStatus failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar a situação." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    details: { active },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true };
}

/**
 * Exclusão LÓGICA do titular: some das listas, mas o registro fica para
 * preservar o histórico (uso de benefício, período no programa, cobranças).
 * Dependentes saem junto e o selo do cliente é recalculado.
 */
export async function deleteEmployee(
  companyId: string,
  employeeId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("delete_employee", {
    p_employee_id: employeeId,
  });
  if (error) {
    console.error("deleteEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível excluir o titular." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    details: { deleted: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true };
}

/** Desfaz a exclusão — volta como INATIVO (reativar é decisão à parte). */
export async function restoreEmployee(
  companyId: string,
  employeeId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("restore_employee", {
    p_employee_id: employeeId,
  });
  if (error) {
    console.error("restoreEmployee failed:", error.message);
    return { ok: false, error: "Não foi possível restaurar." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_employee",
    entityId: employeeId,
    details: { restored: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function addDependent(
  companyId: string,
  employeeId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const cpf = (field(formData, "cpf") ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false, error: "Informe o CPF do dependente." };
  const relationship = field(formData, "relationship") ?? "";
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
    return { ok: false, error: "Selecione o grau de parentesco." };
  }

  const db = await empresarialDb();

  // ⚠️ O TETO DE DEPENDENTES (1021, I4). A 1020 travou os TITULARES e deixou
  // esta metade de fora: o campo era gravado no fechamento e ninguém o lia —
  // o acordo dizia "até 50 dependentes" e o sistema aceitava 500, calado.
  //
  // Quem soma o limite é o BANCO (contratado + termos de inclusão aceitos),
  // como nos titulares: duas contas para a mesma pergunta divergem.
  // ⚠️ AP11: nulo aqui significa "sem trava" de propósito — por isso o ERRO
  // precisa ser lido antes, senão a falha vira "sem trava" (ver titulares).
  const { data: limiteRow, error: erroDoLimite } = await db.rpc("limite_de_dependentes", {
    p_company_id: companyId,
  });
  if (erroDoLimite) {
    return { ok: false, error: naoConseguiConferir("a quantidade de dependentes contratada") };
  }
  const limiteContratado =
    typeof limiteRow === "number" ? limiteRow : (limiteRow?.[0] ?? null);

  const { data: teto, error: erroDoTeto } = await db
    .from("companies")
    .select("max_adhesions, adhesion_limit_target")
    .eq("id", companyId)
    .maybeSingle<{
      max_adhesions: number | null;
      adhesion_limit_target: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
    }>();
  if (erroDoTeto) {
    return { ok: false, error: naoConseguiConferir("o limite combinado na proposta") };
  }
  // O máximo da proposta só vale para dependentes quando foi combinado para
  // eles. Marcado como "só titulares", ele não diz nada sobre dependentes.
  const tetoDaProposta =
    teto?.max_adhesions != null && teto.adhesion_limit_target !== "HOLDERS"
      ? teto.max_adhesions
      : null;

  if (limiteContratado != null || tetoDaProposta != null) {
    const { data: ativosRow, error: erroDosAtivos } = await db.rpc("dependentes_ativos", {
      p_company_id: companyId,
    });
    // ⚠️ AP11 — ESTE DEFEITO FOI ESCRITO JUNTO COM A 1021 (25/09), e a busca
    // do AP11 não o pegou porque procurava a forma `count ?? 0`. Aqui era
    // `?.[0] ?? 0`: a falha virava "zero dependentes ativos" e o teto deixava
    // passar. `dependentes_ativos` é uma contagem — sempre devolve um número —
    // então vazio aqui é sinal de problema, nunca zero.
    const atuais = erroDosAtivos
      ? null
      : typeof ativosRow === "number"
        ? ativosRow
        : (ativosRow?.[0] ?? null);
    if (atuais === null) {
      return { ok: false, error: naoConseguiConferir("quantos dependentes a empresa já tem ativos") };
    }

    const { semTrava, vagas } = vagasDisponiveis(limiteContratado, atuais);
    if (!semTrava && vagas <= 0) {
      return { ok: false, error: recusaDoDependente(limiteContratado!, atuais) };
    }
    if (tetoDaProposta != null && atuais >= tetoDaProposta) {
      return {
        ok: false,
        error: `Esta empresa já tem ${atuais} dependente(s) ativos, e o máximo combinado na proposta é ${tetoDaProposta}. Renegocie o limite antes de incluir mais.`,
      };
    }
  }

  const { error } = await db.from("dependents").insert({
    employee_id: employeeId,
    cpf: formatCpf(cpf),
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone") ? formatPhone(field(formData, "phone")!) : null,
    relationship,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este CPF já é dependente deste titular." };
    }
    console.error("addDependent failed:", error.message);
    return { ok: false, error: "Não foi possível adicionar o dependente." };
  }
  await logAudit({
    action: "create",
    entityType: "empresarial_dependent",
    entityId: employeeId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function updateDependent(
  companyId: string,
  dependentId: string,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const relationship = field(formData, "relationship") ?? "";
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
    return { ok: false, error: "Selecione o grau de parentesco." };
  }
  const cpf = (field(formData, "cpf") ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return { ok: false, error: "Informe o CPF completo." };

  const db = await empresarialDb();
  const { error } = await db
    .from("dependents")
    .update({
      cpf: formatCpf(cpf),
      full_name: field(formData, "full_name"),
      phone: field(formData, "phone")
        ? formatPhone(field(formData, "phone")!)
        : null,
      relationship,
    })
    .eq("id", dependentId);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este CPF já é dependente deste titular." };
    }
    console.error("updateDependent failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o dependente." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_dependent",
    entityId: dependentId,
  });
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

/** Ativa/inativa o dependente (o plano do titular recalcula sozinho). */
export async function setDependentStatus(
  companyId: string,
  dependentId: string,
  active: boolean
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db
    .from("dependents")
    .update({ status: active ? "ACTIVE" : "INACTIVE" })
    .eq("id", dependentId);
  if (error) {
    console.error("setDependentStatus failed:", error.message);
    return { ok: false, error: "Não foi possível atualizar." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export async function linkDependent(
  companyId: string,
  dependentId: string,
  clinicId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (!clinicId) return { ok: false, error: "Escolha a unidade." };
  if (!(await canUseClinic(session, clinicId))) {
    return { ok: false, error: "Você não pode registrar nesta unidade." };
  }
  const db = await empresarialDb();
  const { error } = await db.rpc("link_dependent", {
    p_dependent_id: dependentId,
    p_clinic_id: clinicId,
  });
  if (error) {
    console.error("linkDependent failed:", error.message);
    return { ok: false, error: "Não foi possível vincular o dependente." };
  }
  await logAudit({
    action: "update",
    entityType: "empresarial_dependent",
    entityId: dependentId,
    clinicId,
    details: { linked_client: true },
  });
  revalidatePath(`/empresarial/${companyId}`);
  revalidatePath("/prontuarios");
  return { ok: true };
}

export async function removeDependent(
  companyId: string,
  dependentId: string
): Promise<ActionResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  const db = await empresarialDb();
  const { error } = await db.from("dependents").delete().eq("id", dependentId);
  if (error) {
    console.error("removeDependent failed:", error.message);
    return { ok: false, error: "Não foi possível remover." };
  }
  revalidatePath(`/empresarial/${companyId}`);
  return { ok: true };
}

export type EmployeeImportRow = LinhaDaPlanilha;

/** I5b: dependentes vêm na 2ª aba da planilha, ligados pelo CPF do titular. */
export type DependentImportRow = DependenteDaPlanilha;

export type ImportResult = ActionResult & {
  inserted?: number;
  dependentsInserted?: number;
  /** Titulares da planilha que já estavam na empresa (não gravam, não ocupam vaga). */
  jaCadastrados?: number;
  /** Quando a planilha foi recusada: cada linha com problema e o motivo. */
  linhasComErro?: LinhaComErro[];
};

/**
 * IMPORTAÇÃO TUDO OU NADA (AP97, item 6 do plano da Rita, 03/11/2026).
 *
 * A ordem é: conferir cada linha → conferir as VAGAS do contrato para os CPFs
 * novos → só então gravar. Qualquer linha inválida (CPF incompleto, sem nome,
 * SEM TELEFONE, CPF repetido, dependente sem titular ou com parentesco
 * desconhecido) recusa a planilha inteira e devolve a lista de erros para a
 * tela. Nada é gravado antes de a conferência passar limpa.
 *
 * ⚠️ POR QUE NÃO IMPORTAR "ATÉ A VAGA" E LISTAR QUEM SOBROU: a lista some com
 * a tela, e o RH fica sem saber quem ficou de fora. Recusar inteiro é menos
 * cômodo e muito mais seguro (decisão do dono, 03/11/2026).
 *
 * Limite declarado: titulares e dependentes são DUAS gravações. A conferência
 * acontece toda antes da primeira; se a segunda falhar por erro do banco, a
 * resposta diz exatamente isso (os titulares entraram, os dependentes não) em
 * vez de "importado com sucesso".
 */
export async function importEmployees(
  companyId: string,
  rows: EmployeeImportRow[],
  dependents: DependentImportRow[] = []
): Promise<ImportResult> {
  const session = await getSessionContext();
  if (!canManageEmployees(session)) {
    return { ok: false, error: "Sem permissão." };
  }
  if (rows.length === 0) {
    return { ok: false, error: "Nenhuma linha na planilha." };
  }
  const db = await empresarialDb();

  // Quem já está na empresa (qualquer situação: o upsert por (company_id,
  // cpf) não grava de novo) — lido em lotes, porque a lista de CPFs vai no
  // endereço e a API corta em 1.000 linhas (AP47).
  const cpfsDaPlanilha = [
    ...new Set(
      rows
        .map((r) => String(r.cpf ?? "").replace(/\D/g, ""))
        .filter((c) => c.length === 11)
        .map((c) => formatCpf(c))
    ),
  ];
  const existentes = await lerPorLotes<{ cpf: string }>(cpfsDaPlanilha, (lote, de, ate) =>
    db
      .from("employees")
      .select("cpf")
      .eq("company_id", companyId)
      .in("cpf", lote)
      .range(de, ate)
  );
  // ⚠️ AP11: sem conseguir ler quem já está, a conta de vagas sairia errada
  // (todo mundo pareceria novo) — recusa, nada gravado.
  if (!existentes.ok) {
    return {
      ok: false,
      error: naoConseguiConferir("quais titulares da planilha já estão na empresa"),
    };
  }
  const cpfsJaNaEmpresa = new Set(existentes.linhas.map((e) => e.cpf.replace(/\D/g, "")));

  const conferida = conferirPlanilha(rows, dependents, cpfsJaNaEmpresa);
  if (conferida.erros.length > 0) {
    return {
      ok: false,
      error: resumoDaRecusa(conferida.erros),
      linhasComErro: conferida.erros,
    };
  }

  // As VAGAS do contrato, pela mesma conta do cadastro um a um — para os CPFs
  // NOVOS: quem já está não ocupa vaga de novo.
  if (conferida.cpfsNovos.length > 0) {
    const vagas = await vagasParaTitulares(db, companyId, conferida.cpfsNovos.length);
    if (!vagas.ok) return { ok: false, error: vagas.motivo };
  }

  const payload = conferida.titulares.map((t) => ({
    company_id: companyId,
    cpf: t.cpfFormatado,
    full_name: t.fullName,
    phone: t.phone,
    email: t.email,
    // O plano vem dos dependentes importados (gatilho da 1002), não da coluna.
    dependent_plan: "NONE",
  }));

  // upsert por (company_id, cpf) — reimportar não duplica.
  const { error } = await db
    .from("employees")
    .upsert(payload, { onConflict: "company_id,cpf", ignoreDuplicates: true });
  if (error) {
    console.error("importEmployees failed:", error.message);
    return { ok: false, error: "Não foi possível importar a planilha. Nada foi gravado." };
  }
  const inserted = conferida.cpfsNovos.length;

  // I5b: dependentes da 2ª aba — ligados ao titular pelo CPF dele. Todos já
  // conferidos: o titular está na planilha (acabou de entrar) ou na empresa.
  let dependentsInserted = 0;
  if (conferida.dependentes.length > 0) {
    const holderCpfs = [...new Set(conferida.dependentes.map((d) => formatCpf(d.holderCpf)))];
    const holders = await lerPorLotes<{ id: string; cpf: string }>(
      holderCpfs,
      (lote, de, ate) =>
        db
          .from("employees")
          .select("id, cpf")
          .eq("company_id", companyId)
          .in("cpf", lote)
          .range(de, ate)
    );
    if (!holders.ok) {
      console.error("importEmployees holders failed:", holders.error.message);
      return {
        ok: false,
        error: `Os ${inserted} titular(es) novo(s) foram gravados, mas não foi possível ler os titulares para ligar os dependentes. Importe de novo só a aba Dependentes.`,
        inserted,
        jaCadastrados: conferida.jaCadastrados,
      };
    }
    const idByCpf = new Map(holders.linhas.map((h) => [h.cpf.replace(/\D/g, ""), h.id]));
    const depPayload = conferida.dependentes.map((d) => ({
      employee_id: idByCpf.get(d.holderCpf) ?? null,
      cpf: d.cpfFormatado,
      full_name: d.fullName,
      phone: d.phone,
      relationship: d.relationship,
    }));
    // Conferido antes; se um titular sumiu entre a conferência e a gravação,
    // a resposta diz, em vez de gravar dependente sem titular.
    const semTitular = depPayload.filter((d) => d.employee_id === null).length;
    if (semTitular > 0) {
      return {
        ok: false,
        error: `Os ${inserted} titular(es) novo(s) foram gravados, mas ${semTitular} dependente(s) ficaram sem titular na empresa. Importe de novo só a aba Dependentes.`,
        inserted,
        jaCadastrados: conferida.jaCadastrados,
      };
    }
    const { error: depErr } = await db
      .from("dependents")
      .upsert(depPayload, { onConflict: "employee_id,cpf", ignoreDuplicates: true });
    if (depErr) {
      console.error("importEmployees dependents failed:", depErr.message);
      return {
        ok: false,
        error: `Os ${inserted} titular(es) novo(s) foram gravados, mas os dependentes não. Importe de novo só a aba Dependentes.`,
        inserted,
        jaCadastrados: conferida.jaCadastrados,
      };
    }
    dependentsInserted = depPayload.length;
  }

  await logAudit({
    action: "create",
    entityType: "empresarial_employee_import",
    entityId: companyId,
    details: {
      rows: payload.length,
      inserted,
      already: conferida.jaCadastrados,
      dependents: dependentsInserted,
    },
  });
  revalidatePath(`/empresarial/${companyId}`);
  return {
    ok: true,
    inserted,
    dependentsInserted,
    jaCadastrados: conferida.jaCadastrados,
  };
}

/**
 * I5b: busca do cliente pelo CPF para AUTOPREENCHER o cadastro do titular
 * ou do dependente. Mesma ideia do cadastro do prontuário (H1.9) e do PPR+:
 * quem já é cliente da Risarte não é digitado de novo.
 */
export type EmpresarialCandidate = {
  found: boolean;
  clientId?: string;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  clinicName?: string | null;
  code?: string | null;
};

export async function lookupClientByCpf(
  cpf: string
): Promise<EmpresarialCandidate> {
  await getSessionContext();
  const formatted = formatCpf(cpf ?? "");
  if (formatted.replace(/\D/g, "").length !== 11) return { found: false };

  const supabase = await createClient();
  const { data: dup } = await supabase.rpc("find_duplicate_client", {
    p_cpf: formatted,
    p_full_name: "",
    p_birth_date: null,
  });
  const hit = (dup ?? [])[0] as
    | { client_id: string; clinic_name?: string }
    | undefined;
  if (!hit) return { found: false };

  const { data: client } = await supabase
    .from("clients")
    .select("id, code, full_name, phone, email, birth_date")
    .eq("id", hit.client_id)
    .maybeSingle<{
      id: string;
      code: string | null;
      full_name: string;
      phone: string | null;
      email: string | null;
      birth_date: string | null;
    }>();
  if (!client) return { found: false };

  return {
    found: true,
    clientId: client.id,
    code: client.code,
    fullName: client.full_name,
    phone: client.phone,
    email: client.email,
    birthDate: client.birth_date,
    clinicName: hit.clinic_name ?? null,
  };
}
