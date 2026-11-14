import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ratear, valorDevido } from "@/lib/finance/dividas";
import type { DebtListRow, DebtOrigin, DebtStatus, ManualStage, Priority, PriorityReason, DebtType, ContactKind } from "@/lib/finance/dividas";

// LEVANTAMENTO DE DÍVIDAS (0404) — o que as telas leem. Tudo passa pela RLS:
// quem não tem o módulo lê vazio (o banco decide, não esta função).

export type Opcao = { id: string; nome: string };
export type Devedor = { id: string; nome: string; razaoSocial: string | null; cnpj: string | null; franqueadora: boolean; implantacao: string | null };
export type Credor = { id: string; nome: string; razaoSocial: string | null; documento: string | null; tipo: string | null; ativo: boolean };
export type Categoria = {
  id: string;
  parentId: string | null;
  nome: string;
  natureza: string | null;
  contaAbertura: string | null;
  contaDespesa: string | null;
  ordem: number;
  ativa: boolean;
  sistema: boolean;
};
export type Natureza = { code: string; label: string; ordem: number; ativa: boolean; sistema: boolean };
export type Etiqueta = { id: string; nome: string; cor: string | null; ativa: boolean };
export type Contato = {
  id: string;
  supplierId: string;
  kind: ContactKind;
  organization: string | null;
  personName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
};
export type Grupo = { id: string; code: string; clinicId: string; supplierId: string; label: string; contractNumber: string | null };
export type Cartorio = {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  notas: string | null;
  ativo: boolean;
};

export type Regra = {
  clinicId: string | null;
  daysToDefault: number | null;
  aboutToDefaultDays: number | null;
  proposalAlertDays: number[] | null;
  negativationRemovalBdays: number | null;
  closingStaleDays: number | null;
  agreementBrokenToleranceBdays: number | null;
  agreementApprovalThresholdCents: number | null;
  discountRecognition: string | null;
  surchargeRecognition: string | null;
  staleCheckDays: number | null;
};

export type BaseDasDividas = {
  semMigracao: boolean;
  devedores: Devedor[];
  credores: Credor[];
  tiposDeCredor: { code: string; label: string; active: boolean }[];
  categorias: Categoria[];
  naturezas: Natureza[];
  etiquetas: Etiqueta[];
  contatos: Contato[];
  grupos: Grupo[];
  contas: { code: string; name: string }[];
  responsaveis: Opcao[];
  regras: Regra[];
  prazosPorTipo: { supplierKind: string; days: number }[];
  cartorios: Cartorio[];
};

type Linha = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function carregarBase(): Promise<BaseDasDividas> {
  const supabase = await createClient();
  const [cl, su, ki, ca, na, ta, co, gr, ac, se, dr, fr] = await Promise.all([
    supabase.from("clinics").select("id, name, legal_name, cnpj, type, is_active, go_live_on").order("type").order("name"),
    supabase.from("suppliers").select("id, name, legal_name, document, kind, active").order("name"),
    supabase.from("supplier_kinds").select("code, label, sort_order, active").order("sort_order"),
    supabase.from("debt_categories").select("id, parent_id, name, nature_code, opening_account_code, expense_account_code, sort_order, active, system").order("sort_order").order("name"),
    supabase.from("debt_natures").select("code, label, sort_order, active, system").order("sort_order"),
    supabase.from("debt_tags").select("id, name, color, active").order("name"),
    supabase.from("debt_creditor_contacts").select("id, supplier_id, kind, organization, person_name, phone, whatsapp, email, notes, active").order("person_name"),
    supabase.from("debt_groups").select("id, code, clinic_id, supplier_id, label, contract_number").order("code"),
    supabase.from("chart_of_accounts").select("code, name").eq("active", true).eq("is_analytic", true).order("code"),
    supabase.from("debt_settings").select("*"),
    supabase.from("debt_default_rules").select("supplier_kind, days_to_default"),
    supabase.from("user_clinic_roles").select("user_id").eq("role", "finance_franchisor"),
  ]);
  // Fase 2 (0405). Sem a migração, vem vazio (a tela de cartórios avisa).
  const { data: cartRows } = await supabase
    .from("debt_notary_offices")
    .select("id, name, city, state, phone, email, notes, active")
    .order("name");

  // Sem a 0404 no banco, as tabelas não existem: a tela avisa em vez de
  // fingir que está vazia.
  const semMigracao = ca.error !== null || se.error !== null;

  // Responsável pela dívida: quem trabalha nela (o Financeiro da Franqueadora).
  const idsDoFinanceiro = [...new Set(((fr.data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  const { data: perfis } = idsDoFinanceiro.length
    ? await supabase.from("profiles").select("id, full_name").in("id", idsDoFinanceiro)
    : { data: [] as { id: string; full_name: string }[] };
  const responsaveis = new Map<string, string>();
  for (const p of (perfis ?? []) as { id: string; full_name: string }[]) {
    if (p.full_name) responsaveis.set(p.id, p.full_name);
  }

  return {
    semMigracao,
    devedores: ((cl.data ?? []) as Linha[])
      .filter((c) => c.is_active !== false)
      .map((c) => ({
        id: c.id as string,
        nome: c.name as string,
        razaoSocial: s(c.legal_name),
        cnpj: s(c.cnpj),
        franqueadora: c.type === "franchisor",
        implantacao: s(c.go_live_on),
      })),
    credores: ((su.data ?? []) as Linha[]).map((c) => ({
      id: c.id as string,
      nome: c.name as string,
      razaoSocial: s(c.legal_name),
      documento: s(c.document),
      tipo: s(c.kind),
      ativo: c.active !== false,
    })),
    tiposDeCredor: ((ki.data ?? []) as Linha[]).map((k) => ({ code: k.code as string, label: k.label as string, active: k.active !== false })),
    categorias: ((ca.data ?? []) as Linha[]).map((c) => ({
      id: c.id as string,
      parentId: s(c.parent_id),
      nome: c.name as string,
      natureza: s(c.nature_code),
      contaAbertura: s(c.opening_account_code),
      contaDespesa: s(c.expense_account_code),
      ordem: Number(c.sort_order ?? 0),
      ativa: c.active !== false,
      sistema: c.system === true,
    })),
    naturezas: ((na.data ?? []) as Linha[]).map((x) => ({
      code: x.code as string,
      label: x.label as string,
      ordem: Number(x.sort_order ?? 0),
      ativa: x.active !== false,
      sistema: x.system === true,
    })),
    etiquetas: ((ta.data ?? []) as Linha[]).map((t) => ({ id: t.id as string, nome: t.name as string, cor: s(t.color), ativa: t.active !== false })),
    contatos: ((co.data ?? []) as Linha[]).map((c) => ({
      id: c.id as string,
      supplierId: c.supplier_id as string,
      kind: c.kind as ContactKind,
      organization: s(c.organization),
      personName: s(c.person_name),
      phone: s(c.phone),
      whatsapp: s(c.whatsapp),
      email: s(c.email),
      notes: s(c.notes),
      active: c.active !== false,
    })),
    grupos: ((gr.data ?? []) as Linha[]).map((g) => ({
      id: g.id as string,
      code: g.code as string,
      clinicId: g.clinic_id as string,
      supplierId: g.supplier_id as string,
      label: g.label as string,
      contractNumber: s(g.contract_number),
    })),
    contas: ((ac.data ?? []) as { code: string; name: string }[]),
    responsaveis: [...responsaveis].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    regras: ((se.data ?? []) as Linha[]).map((r) => ({
      clinicId: s(r.clinic_id),
      daysToDefault: n(r.days_to_default),
      aboutToDefaultDays: n(r.about_to_default_days),
      proposalAlertDays: Array.isArray(r.proposal_alert_days) ? (r.proposal_alert_days as number[]) : null,
      negativationRemovalBdays: n(r.negativation_removal_bdays),
      closingStaleDays: n(r.closing_stale_days),
      agreementBrokenToleranceBdays: n(r.agreement_broken_tolerance_bdays),
      agreementApprovalThresholdCents: n(r.agreement_approval_threshold_cents),
      discountRecognition: s(r.discount_recognition),
      surchargeRecognition: s(r.surcharge_recognition),
      staleCheckDays: n(r.stale_check_days),
    })),
    prazosPorTipo: ((dr.data ?? []) as Linha[]).map((r) => ({ supplierKind: r.supplier_kind as string, days: Number(r.days_to_default) })),
    cartorios: ((cartRows ?? []) as Linha[]).map((c) => ({
      id: c.id as string,
      nome: c.name as string,
      cidade: s(c.city),
      uf: s(c.state),
      telefone: s(c.phone),
      email: s(c.email),
      notas: s(c.notes),
      ativo: c.active !== false,
    })),
  };
}

export const COLUNAS_DA_DIVIDA =
  "id, code, clinic_id, supplier_id, group_id, collection_contact_id, debt_type, contract_number, installment_label, description, bundled_count, needs_split, has_guarantor, guarantor_name, real_guarantee, receivables_assignment, guarantee_notes, category_id, subcategory_id, nature_code, account_code, tax_active_debt, original_cents, updated_cents, updated_ref_date, interest_cents, fine_cents, charges_cents, contract_rate_percent, accrual_month, issue_date, due_date, origin, origin_suggested, origin_override_reason, finance_synced_at, status, status_changed_at, manual_stage, stage_reason, priority, priority_reasons, owner_user_id, next_action, next_action_on, notes, created_by, created_at, updated_by, updated_at, last_checked_on, debt_tag_links(tag_id)";

export type Divida = {
  id: string;
  code: string;
  clinicId: string;
  supplierId: string;
  groupId: string | null;
  collectionContactId: string | null;
  debtType: DebtType;
  contractNumber: string | null;
  installmentLabel: string | null;
  description: string | null;
  bundledCount: number;
  needsSplit: boolean;
  hasGuarantor: boolean;
  guarantorName: string | null;
  realGuarantee: string | null;
  receivablesAssignment: boolean;
  guaranteeNotes: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  natureCode: string | null;
  accountCode: string | null;
  taxActiveDebt: boolean;
  originalCents: number | null;
  updatedCents: number | null;
  updatedRefDate: string | null;
  interestCents: number | null;
  fineCents: number | null;
  chargesCents: number | null;
  contractRatePercent: number | null;
  accrualMonth: string | null;
  issueDate: string | null;
  dueDate: string;
  origin: DebtOrigin;
  originSuggested: "A" | "B" | null;
  originOverrideReason: string | null;
  financeSyncedAt: string | null;
  status: DebtStatus;
  statusChangedAt: string;
  manualStage: ManualStage | null;
  stageReason: string | null;
  priority: Priority | null;
  priorityReasons: PriorityReason[];
  ownerUserId: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  tagIds: string[];
  lastCheckedOn: string | null;
};

export function dividaDaLinha(r: Linha): Divida {
  return {
    id: r.id as string,
    code: r.code as string,
    clinicId: r.clinic_id as string,
    supplierId: r.supplier_id as string,
    groupId: s(r.group_id),
    collectionContactId: s(r.collection_contact_id),
    debtType: r.debt_type as DebtType,
    contractNumber: s(r.contract_number),
    installmentLabel: s(r.installment_label),
    description: s(r.description),
    bundledCount: Number(r.bundled_count ?? 1),
    needsSplit: r.needs_split === true,
    hasGuarantor: r.has_guarantor === true,
    guarantorName: s(r.guarantor_name),
    realGuarantee: s(r.real_guarantee),
    receivablesAssignment: r.receivables_assignment === true,
    guaranteeNotes: s(r.guarantee_notes),
    categoryId: s(r.category_id),
    subcategoryId: s(r.subcategory_id),
    natureCode: s(r.nature_code),
    accountCode: s(r.account_code),
    taxActiveDebt: r.tax_active_debt === true,
    originalCents: n(r.original_cents),
    updatedCents: n(r.updated_cents),
    updatedRefDate: s(r.updated_ref_date),
    interestCents: n(r.interest_cents),
    fineCents: n(r.fine_cents),
    chargesCents: n(r.charges_cents),
    contractRatePercent: n(r.contract_rate_percent),
    accrualMonth: s(r.accrual_month),
    issueDate: s(r.issue_date),
    dueDate: r.due_date as string,
    origin: r.origin as DebtOrigin,
    originSuggested: (s(r.origin_suggested) as "A" | "B" | null) ?? null,
    originOverrideReason: s(r.origin_override_reason),
    financeSyncedAt: s(r.finance_synced_at),
    status: r.status as DebtStatus,
    statusChangedAt: r.status_changed_at as string,
    manualStage: (s(r.manual_stage) as ManualStage | null) ?? null,
    stageReason: s(r.stage_reason),
    priority: (s(r.priority) as Priority | null) ?? null,
    priorityReasons: (Array.isArray(r.priority_reasons) ? r.priority_reasons : []) as PriorityReason[],
    ownerUserId: s(r.owner_user_id),
    nextAction: s(r.next_action),
    nextActionOn: s(r.next_action_on),
    notes: s(r.notes),
    createdBy: s(r.created_by),
    createdAt: r.created_at as string,
    updatedBy: s(r.updated_by),
    updatedAt: r.updated_at as string,
    tagIds: ((r.debt_tag_links as { tag_id: string }[] | null) ?? []).map((t) => t.tag_id),
    lastCheckedOn: s(r.last_checked_on),
  };
}

export async function carregarDividas(): Promise<{ ok: boolean; dividas: Divida[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("debts")
    .select(COLUNAS_DA_DIVIDA)
    .is("deleted_at", null)
    .order("due_date");
  if (error) {
    console.error("carregarDividas failed:", error.message);
    return { ok: false, dividas: [] };
  }
  return { ok: true, dividas: ((data ?? []) as unknown as Linha[]).map(dividaDaLinha) };
}

// ---------------------------------------------------------------- fase 2 (0405)

/** O que a LISTA precisa saber das restrições e propostas (só o ativo). */
export type ResumoDaFase2 = {
  ok: boolean;
  negativadas: Set<string>;
  judiciais: Set<string>;
  /** Protestos ativos: de dívida ou de grupo, com as custas. */
  protestos: { debtId: string | null; groupId: string | null; custasCents: number }[];
  /** Propostas ativas: de dívida ou de grupo. */
  propostas: { debtId: string | null; groupId: string | null; amountCents: number; validUntil: string | null }[];
};

export async function carregarResumoDaFase2(): Promise<ResumoDaFase2> {
  const supabase = await createClient();
  const [ng, pt, lw, pp] = await Promise.all([
    supabase.from("debt_negativations").select("debt_id").is("removed_at", null).is("removal_confirmed_on", null),
    supabase.from("debt_protests").select("debt_id, group_id, cancel_cost_cents").is("removed_at", null).neq("cancel_status", "cancelado"),
    supabase.from("debt_lawsuits").select("debt_id").is("removed_at", null).is("closed_on", null),
    supabase.from("debt_proposals").select("debt_id, group_id, amount_cents, valid_until").eq("status", "ativa"),
  ]);
  const ok = !ng.error && !pt.error && !lw.error && !pp.error;
  return {
    ok,
    negativadas: new Set(((ng.data ?? []) as Linha[]).map((r) => r.debt_id as string)),
    judiciais: new Set(((lw.data ?? []) as Linha[]).map((r) => r.debt_id as string)),
    protestos: ((pt.data ?? []) as Linha[]).map((r) => ({
      debtId: s(r.debt_id),
      groupId: s(r.group_id),
      custasCents: Number(r.cancel_cost_cents ?? 0),
    })),
    propostas: ((pp.data ?? []) as Linha[]).map((r) => ({
      debtId: s(r.debt_id),
      groupId: s(r.group_id),
      amountCents: Number(r.amount_cents),
      validUntil: s(r.valid_until),
    })),
  };
}

/**
 * As linhas da lista, com os nomes resolvidos e a fase 2 aplicada.
 *
 * ⚠️ PROPOSTA E CUSTAS DE GRUPO SÃO RATEADAS entre as dívidas do grupo, pelo
 * valor devido de cada uma (`ratear`, a última absorve o resíduo). Assim a
 * soma do rodapé respeita os filtros: filtrar uma dívida do grupo traz só a
 * parte dela, nunca a proposta inteira. Proposta da própria dívida ganha da
 * do grupo.
 */
export function linhasDaLista(
  dividas: Divida[],
  base: BaseDasDividas,
  f2: ResumoDaFase2,
  titulos: Map<string, TituloDaDivida[]> = new Map()
): DebtListRow[] {
  const propostaDaDivida = new Map<string, { amountCents: number; validUntil: string | null }>();
  const propostaDoGrupo = new Map<string, { amountCents: number; validUntil: string | null }>();
  for (const p of f2.propostas) {
    if (p.debtId) propostaDaDivida.set(p.debtId, p);
    else if (p.groupId) propostaDoGrupo.set(p.groupId, p);
  }
  const custasDaDivida = new Map<string, number>();
  const custasDoGrupo = new Map<string, number>();
  const protestadaDivida = new Set<string>();
  const protestadoGrupo = new Set<string>();
  for (const p of f2.protestos) {
    if (p.debtId) {
      protestadaDivida.add(p.debtId);
      custasDaDivida.set(p.debtId, (custasDaDivida.get(p.debtId) ?? 0) + p.custasCents);
    } else if (p.groupId) {
      protestadoGrupo.add(p.groupId);
      custasDoGrupo.set(p.groupId, (custasDoGrupo.get(p.groupId) ?? 0) + p.custasCents);
    }
  }

  // Rateio por grupo (só entre as dívidas que estão na lista, isto é, não excluídas).
  const parteDaProposta = new Map<string, number>();
  const parteDasCustas = new Map<string, number>();
  const porGrupo = new Map<string, Divida[]>();
  for (const d of dividas) if (d.groupId) porGrupo.set(d.groupId, [...(porGrupo.get(d.groupId) ?? []), d]);
  for (const [g, membros] of porGrupo) {
    const ordem = [...membros].sort((a, b) => a.code.localeCompare(b.code));
    const pesos = ordem.map((d) => valorDevido(d));
    const prop = propostaDoGrupo.get(g);
    // Quem tem proposta própria não entra no rateio da proposta do grupo.
    if (prop) {
      const semPropria = ordem.filter((d) => !propostaDaDivida.has(d.id));
      ratear(prop.amountCents, semPropria.map((d) => valorDevido(d))).forEach((v, i) => parteDaProposta.set(semPropria[i].id, v));
    }
    const custas = custasDoGrupo.get(g);
    if (custas) ratear(custas, pesos).forEach((v, i) => parteDasCustas.set(ordem[i].id, v));
  }

  return dividas.map((d) => {
    const credor = base.credores.find((c) => c.id === d.supplierId);
    const propria = propostaDaDivida.get(d.id);
    const doGrupo = d.groupId ? propostaDoGrupo.get(d.groupId) : undefined;
    const proposta = propria
      ? { cents: propria.amountCents, validade: propria.validUntil }
      : doGrupo && parteDaProposta.has(d.id)
        ? { cents: parteDaProposta.get(d.id)!, validade: doGrupo.validUntil }
        : null;
    return {
      id: d.id,
      code: d.code,
      clinicId: d.clinicId,
      clinicName: base.devedores.find((c) => c.id === d.clinicId)?.nome ?? "—",
      supplierId: d.supplierId,
      supplierName: credor?.nome ?? "—",
      supplierKind: credor?.tipo ?? null,
      categoryId: d.categoryId,
      subcategoryId: d.subcategoryId,
      natureCode: d.natureCode,
      tagIds: d.tagIds,
      status: d.status,
      dueDate: d.dueDate,
      originalCents: d.originalCents,
      updatedCents: d.updatedCents,
      priority: d.priority,
      ownerUserId: d.ownerUserId,
      origin: d.origin,
      contractNumber: d.contractNumber,
      description: d.description,
      installmentLabel: d.installmentLabel,
      needsSplit: d.needsSplit,
      bundledCount: d.bundledCount,
      groupCode: base.grupos.find((g) => g.id === d.groupId)?.code ?? null,
      nextAction: d.nextAction,
      nextActionOn: d.nextActionOn,
      negativada: f2.negativadas.has(d.id),
      protestada: protestadaDivida.has(d.id) || (d.groupId !== null && protestadoGrupo.has(d.groupId)),
      judicial: f2.judiciais.has(d.id),
      propostaCents: proposta?.cents ?? null,
      propostaValidade: proposta?.validade ?? null,
      custasCents: (custasDaDivida.get(d.id) ?? 0) + (parteDasCustas.get(d.id) ?? 0),
      lastCheckedOn: d.lastCheckedOn,
      pagoCents: (titulos.get(d.id) ?? []).reduce((t, x) => t + x.pagoCents, 0),
      noFinanceiro: (titulos.get(d.id) ?? []).length > 0,
    };
  });
}

/** Os prazos da regra da rede que a tela usa nos selos. */
export function prazosDosSelos(base: BaseDasDividas): { alertaDaProposta: number; conferencia: number } {
  const rede = base.regras.find((r) => r.clinicId === null);
  return {
    alertaDaProposta: Math.max(...(rede?.proposalAlertDays?.length ? rede.proposalAlertDays : [7])),
    conferencia: rede?.staleCheckDays ?? 60,
  };
}

// O DETALHE: tudo o que é da dívida (inclusive o removido, que a tela recolhe).

type Removivel = { removedAt: string | null; removedReason: string | null };
export type Negativacao = Removivel & {
  id: string;
  bureau: string;
  includedOn: string | null;
  amountCents: number | null;
  inLimpaNome: boolean;
  target: "empresa" | "socio";
  targetName: string | null;
  removalConfirmedOn: string | null;
  notes: string | null;
};
export type Protesto = Removivel & {
  id: string;
  debtId: string | null;
  groupId: string | null;
  notaryOfficeId: string | null;
  protocol: string | null;
  protestedOn: string | null;
  amountCents: number | null;
  cancelCostCents: number | null;
  costQuotedOn: string | null;
  consentLetter: string;
  cancelStatus: string;
  cancelledOn: string | null;
  notes: string | null;
};
export type AcaoJudicial = Removivel & {
  id: string;
  processNumber: string | null;
  court: string | null;
  district: string | null;
  phase: string | null;
  claimCents: number | null;
  lawyerName: string | null;
  hasFreeze: boolean;
  hasSeizure: boolean;
  hasSearchAndSeizure: boolean;
  closedOn: string | null;
  notes: string | null;
};
export type Notificacao = Removivel & { id: string; receivedOn: string; notes: string | null };
export type Proposta = {
  id: string;
  debtId: string | null;
  groupId: string | null;
  proposedOn: string;
  amountCents: number;
  paymentKind: string;
  downPaymentCents: number | null;
  installments: number | null;
  installmentCents: number | null;
  method: string | null;
  validUntil: string | null;
  source: string;
  conditionText: string | null;
  notes: string | null;
  status: string;
  statusReason: string | null;
  createdBy: string | null;
  createdAt: string;
};
export type ContatoFeito = {
  id: string;
  occurredAt: string;
  channel: string;
  contactId: string | null;
  summary: string;
  userId: string | null;
};
export type Anexo = Removivel & {
  id: string;
  kind: string;
  refTable: string | null;
  refId: string | null;
  fileName: string;
  sizeBytes: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
};
export type DetalheDaFase2 = {
  ok: boolean;
  negativacoes: Negativacao[];
  protestos: Protesto[];
  acoes: AcaoJudicial[];
  notificacoes: Notificacao[];
  propostas: Proposta[];
  contatos: ContatoFeito[];
  anexos: Anexo[];
};

const removivel = (r: Linha): Removivel => ({ removedAt: s(r.removed_at), removedReason: s(r.removed_reason) });

export async function carregarDetalheDaFase2(debtId: string, groupId: string | null): Promise<DetalheDaFase2> {
  const supabase = await createClient();
  const filtroDividaOuGrupo = groupId ? `debt_id.eq.${debtId},group_id.eq.${groupId}` : `debt_id.eq.${debtId}`;
  const [ng, pt, lw, nt, pp, ct, ax] = await Promise.all([
    supabase.from("debt_negativations").select("*").eq("debt_id", debtId).order("created_at"),
    supabase.from("debt_protests").select("*").or(filtroDividaOuGrupo).order("created_at"),
    supabase.from("debt_lawsuits").select("*").eq("debt_id", debtId).order("created_at"),
    supabase.from("debt_extrajudicial_notices").select("*").eq("debt_id", debtId).order("received_on"),
    supabase.from("debt_proposals").select("*").or(filtroDividaOuGrupo).order("created_at", { ascending: false }),
    supabase.from("debt_contacts").select("*").eq("debt_id", debtId).order("occurred_at", { ascending: false }),
    supabase.from("debt_attachments").select("*").eq("debt_id", debtId).order("uploaded_at", { ascending: false }),
  ]);
  const ok = [ng, pt, lw, nt, pp, ct, ax].every((x) => !x.error);
  const L = (x: { data: unknown }) => (x.data ?? []) as Linha[];
  return {
    ok,
    negativacoes: L(ng).map((r) => ({
      ...removivel(r),
      id: r.id as string,
      bureau: r.bureau as string,
      includedOn: s(r.included_on),
      amountCents: n(r.amount_cents),
      inLimpaNome: r.in_limpa_nome === true,
      target: r.target === "socio" ? "socio" : "empresa",
      targetName: s(r.target_name),
      removalConfirmedOn: s(r.removal_confirmed_on),
      notes: s(r.notes),
    })),
    protestos: L(pt).map((r) => ({
      ...removivel(r),
      id: r.id as string,
      debtId: s(r.debt_id),
      groupId: s(r.group_id),
      notaryOfficeId: s(r.notary_office_id),
      protocol: s(r.protocol),
      protestedOn: s(r.protested_on),
      amountCents: n(r.amount_cents),
      cancelCostCents: n(r.cancel_cost_cents),
      costQuotedOn: s(r.cost_quoted_on),
      consentLetter: r.consent_letter as string,
      cancelStatus: r.cancel_status as string,
      cancelledOn: s(r.cancelled_on),
      notes: s(r.notes),
    })),
    acoes: L(lw).map((r) => ({
      ...removivel(r),
      id: r.id as string,
      processNumber: s(r.process_number),
      court: s(r.court),
      district: s(r.district),
      phase: s(r.phase),
      claimCents: n(r.claim_cents),
      lawyerName: s(r.lawyer_name),
      hasFreeze: r.has_freeze === true,
      hasSeizure: r.has_seizure === true,
      hasSearchAndSeizure: r.has_search_and_seizure === true,
      closedOn: s(r.closed_on),
      notes: s(r.notes),
    })),
    notificacoes: L(nt).map((r) => ({ ...removivel(r), id: r.id as string, receivedOn: r.received_on as string, notes: s(r.notes) })),
    propostas: L(pp).map((r) => ({
      id: r.id as string,
      debtId: s(r.debt_id),
      groupId: s(r.group_id),
      proposedOn: r.proposed_on as string,
      amountCents: Number(r.amount_cents),
      paymentKind: r.payment_kind as string,
      downPaymentCents: n(r.down_payment_cents),
      installments: n(r.installments),
      installmentCents: n(r.installment_cents),
      method: s(r.method),
      validUntil: s(r.valid_until),
      source: r.source as string,
      conditionText: s(r.condition_text),
      notes: s(r.notes),
      status: r.status as string,
      statusReason: s(r.status_reason),
      createdBy: s(r.created_by),
      createdAt: r.created_at as string,
    })),
    contatos: L(ct).map((r) => ({
      id: r.id as string,
      occurredAt: r.occurred_at as string,
      channel: r.channel as string,
      contactId: s(r.contact_id),
      summary: r.summary as string,
      userId: s(r.user_id),
    })),
    anexos: L(ax).map((r) => ({
      ...removivel(r),
      id: r.id as string,
      kind: r.kind as string,
      refTable: s(r.ref_table),
      refId: s(r.ref_id),
      fileName: r.file_name as string,
      sizeBytes: n(r.size_bytes),
      mimeType: s(r.mime_type),
      uploadedBy: s(r.uploaded_by),
      uploadedAt: r.uploaded_at as string,
    })),
  };
}

// ------------------------------------------------------------- fase 3 (0406)

/** Um título do Contas a Pagar que é de uma dívida (gerado ou vinculado). */
export type TituloDaDivida = {
  id: string;
  debtId: string;
  link: "gerado" | "vinculado";
  saldoDeImplantacao: boolean;
  conta: string;
  descricao: string;
  valorCents: number;
  pagoCents: number;
  vencimento: string;
  status: string;
};

const tituloDaLinha = (r: Linha): TituloDaDivida => ({
  id: r.id as string,
  debtId: r.debt_id as string,
  link: r.debt_link === "vinculado" ? "vinculado" : "gerado",
  saldoDeImplantacao: r.opening_balance === true,
  conta: r.account_code as string,
  descricao: r.description as string,
  valorCents: Number(r.amount_cents),
  pagoCents: Number(r.paid_amount_cents ?? 0),
  vencimento: r.due_date as string,
  status: r.status as string,
});

const COLUNAS_DO_TITULO = "id, debt_id, debt_link, opening_balance, account_code, description, amount_cents, paid_amount_cents, due_date, status";

/** Os títulos ativos de todas as dívidas (cancelado e recusado não contam). */
export async function carregarTitulosDasDividas(): Promise<{ ok: boolean; titulos: Map<string, TituloDaDivida[]> }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payables")
    .select(COLUNAS_DO_TITULO)
    .not("debt_id", "is", null)
    .not("status", "in", "(cancelada,recusada)");
  const titulos = new Map<string, TituloDaDivida[]>();
  if (error) return { ok: false, titulos };
  for (const r of (data ?? []) as Linha[]) {
    const t = tituloDaLinha(r);
    titulos.set(t.debtId, [...(titulos.get(t.debtId) ?? []), t]);
  }
  return { ok: true, titulos };
}

/** Os títulos de UMA dívida, inclusive os cancelados (para o histórico da tela). */
export async function carregarTitulosDaDivida(debtId: string): Promise<{ ok: boolean; titulos: TituloDaDivida[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payables")
    .select(COLUNAS_DO_TITULO)
    .eq("debt_id", debtId)
    .order("due_date");
  if (error) return { ok: false, titulos: [] };
  return { ok: true, titulos: ((data ?? []) as Linha[]).map(tituloDaLinha) };
}

/** Títulos em aberto do mesmo CNPJ que ainda não são de nenhuma dívida:
 * para vincular (origem C) e para avisar de duplicidade (ajuste 2). */
export type TituloLivre = {
  id: string;
  fornecedorId: string | null;
  descricao: string;
  valorCents: number;
  vencimento: string;
  status: string;
  documento: string | null;
};

export async function carregarTitulosLivres(clinicId: string): Promise<TituloLivre[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payables")
    .select("id, supplier_id, description, amount_cents, due_date, status, document_number")
    .eq("clinic_id", clinicId)
    .is("debt_id", null)
    .in("status", ["aberta", "parcial", "aguardando_autorizacao"])
    .order("due_date")
    .limit(500);
  return ((data ?? []) as Linha[]).map((r) => ({
    id: r.id as string,
    fornecedorId: s(r.supplier_id),
    descricao: r.description as string,
    valorCents: Number(r.amount_cents),
    vencimento: r.due_date as string,
    status: r.status as string,
    documento: s(r.document_number),
  }));
}
