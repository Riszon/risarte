import "server-only";
import { createClient } from "@/lib/supabase/server";
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
    })),
    prazosPorTipo: ((dr.data ?? []) as Linha[]).map((r) => ({ supplierKind: r.supplier_kind as string, days: Number(r.days_to_default) })),
  };
}

export const COLUNAS_DA_DIVIDA =
  "id, code, clinic_id, supplier_id, group_id, collection_contact_id, debt_type, contract_number, installment_label, description, bundled_count, needs_split, has_guarantor, guarantor_name, real_guarantee, receivables_assignment, guarantee_notes, category_id, subcategory_id, nature_code, account_code, tax_active_debt, original_cents, updated_cents, updated_ref_date, interest_cents, fine_cents, charges_cents, contract_rate_percent, accrual_month, issue_date, due_date, origin, origin_suggested, origin_override_reason, finance_synced_at, status, status_changed_at, manual_stage, stage_reason, priority, priority_reasons, owner_user_id, next_action, next_action_on, notes, created_by, created_at, updated_by, updated_at, debt_tag_links(tag_id)";

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

/** A linha da lista: a dívida com os nomes já resolvidos. */
export function linhaDaLista(d: Divida, base: BaseDasDividas): DebtListRow {
  const credor = base.credores.find((c) => c.id === d.supplierId);
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
  };
}
