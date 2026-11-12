import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Installment } from "@/lib/finance/receivables";
import type { RenegotiationStatus } from "@/lib/finance/renegotiation";
import {
  acquirerAppliesTo,
  pickAcquirer,
  type AcquirerScope,
} from "@/lib/finance/acquirers";
import { todayInBrazil } from "@/lib/dates";
import { cobrancaEhSoProposta } from "@/lib/venda-fechada";

/** FIN4b.2 — o boleto que já foi gerado (e o que ele custou na emissão). */
export type BoletoIssue = { issuedAt: string; feeCents: number };

export type ReceiptRow = {
  id: string;
  installmentId: string;
  amountCents: number;
  /** Composição da baixa (0188): a soma das quatro bate com amountCents. */
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  receivedAt: string;
  paymentMethod: string | null;
  reference: string | null;
  reversed: boolean;
  reversalOf: string | null;
  reversalReason: string | null;
  byName: string | null;
  createdAt: string;
  /** FIN4c: o que a adquirente descontou e quando o dinheiro cai. */
  acquirerFeeCents: number;
  acquirerFeeChargedAtIssue: boolean;
  settlementDate: string | null;
};

export type ReceivablesData = {
  installments: Installment[];
  receipts: ReceiptRow[];
  renegotiations: RenegotiationRow[];
  sales: SaleSummary[];
  /** Teto de desconto da unidade — o MESMO da regra comercial (FIN2). */
  maxDiscountPercent: number | null;
  /** Recebido no período consultado (baixas ativas). */
  receivedInPeriodCents: number;
  periodStart: string;
  periodEnd: string;
  /** Boletos já emitidos, por cobrança (FIN4b.2). */
  boletos: Record<string, BoletoIssue>;
  /**
   * Cobranças que aceitam o registro da emissão: boleto em aberto cuja
   * **adquirente** cobra a taxa NA EMISSÃO. A conta é por cobrança, não por
   * unidade — duas adquirentes da mesma unidade podem cobrar em momentos
   * diferentes, e oferecer o botão na errada só daria erro.
   */
  boletoIssuableIds: string[];
  /** 4004 — as cobranças do Asaas das parcelas (as mais novas primeiro). */
  charges: ChargeRow[];
  /** 4004 — as dispensas da quitação por valor menor. */
  waivers: WaiverRow[];
  /**
   * 4004 — a unidade de cada parcela está pronta para cobrar pelo Asaas?
   * Vazio quando o banco ainda não tem a 4004 (`cobrancaDisponivel` falso).
   */
  unidadesProntas: Record<string, boolean>;
  cobrancaDisponivel: boolean;
  /** 4005 — pagamentos pelo Asaas em duplicidade deste cliente (abertos e resolvidos). */
  surpluses: SurplusRow[];
  /** 4005 — baixas estornadas pelo Asaas cuja taxa da rede continua devida (D13). */
  keptFeeReceiptIds: string[];
};

/** 4005 — um pagamento em duplicidade (16.6). */
export type SurplusRow = {
  id: string;
  installmentId: string | null;
  amountCents: number;
  paidOn: string | null;
  reason: string;
  status: "aberto" | "devolvido" | "abatido";
  appliedInstallmentId: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

/** 4004 — uma cobrança do Asaas (sem CPF: o pagador vai só pelo nome). */
export type ChargeRow = {
  id: string;
  installmentId: string;
  status: string;
  billingType: string | null;
  valueCents: number | null;
  discountCents: number;
  dueDate: string | null;
  isOverdueReissue: boolean;
  isExternal: boolean;
  externalNote: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixCopyPaste: string | null;
  identificationField: string | null;
  errorCode: string | null;
  payerKind: string | null;
  payerName: string | null;
  payerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  byName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

/** 4004 — o que foi dispensado numa quitação por valor menor. */
export type WaiverRow = {
  id: string;
  installmentId: string;
  principalCents: number;
  benefitCents: number;
  lateFeeCents: number;
  interestCents: number;
  totalCents: number;
  reason: string;
  /** 4005: a dispensa de sempre ou o arredondamento automático do Asaas. */
  kind: "dispensa" | "arredondamento";
  byName: string | null;
  createdAt: string;
};

type InstallmentRow = {
  id: string;
  clinic_id: string;
  seq: number;
  kind: "entrada" | "parcela";
  due_date: string;
  amount_cents: number;
  benefit_discount_cents: number | null;
  paid_amount_cents: number;
  paid_benefit_cents: number | null;
  paid_fee_cents: number | null;
  paid_interest_cents: number | null;
  status: Installment["status"];
  payment_method: string | null;
  late_fee_percent: number | null;
  monthly_interest_percent: number | null;
  grace_days: number | null;
  was_overdue: boolean;
  negotiation_id: string | null;
  direct_sale_id: string | null;
  renegotiation_id: string | null;
  renegotiated_by_id: string | null;
  boleto_issued_at: string | null;
  boleto_fee_cents: number | null;
  acquirer_id: string | null;
};

/**
 * FIN2.1 — o resumo do que a cobrança está pagando. O dono pediu poder clicar
 * na parcela e ver a que venda ela se refere (código + procedimentos).
 */
export type SaleSummary = {
  id: string;
  kind: "negotiation" | "direct_sale";
  code: string | null;
  createdAt: string;
  totalCents: number;
  items: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    finalCents: number;
  }[];
};

/** FIN2 — uma renegociação do cliente (documento, não cobrança). */
export type RenegotiationRow = {
  id: string;
  code: string | null;
  createdAt: string;
  status: RenegotiationStatus;
  originalPrincipalCents: number;
  originalBenefitCents: number;
  originalFeeCents: number;
  originalInterestCents: number;
  originalTotalCents: number;
  discountCents: number;
  discountPercent: number;
  newTotalCents: number;
  /** Juros ao mês do novo parcelamento (Tabela Price). */
  monthlyInterestPercent: number;
  financedInterestCents: number;
  reason: string | null;
  requiresAuthorization: boolean;
  authorizationNote: string | null;
  byName: string | null;
  authorizedByName: string | null;
  /** Etapas do fechamento (manuais, como na venda) — FIN2.4. */
  contractSigned: boolean;
  paymentIssued: boolean;
  paymentConfirmed: boolean;
  closedAt: string | null;
};

/**
 * FIN1 — cobranças do cliente + baixas. A RLS já limita o que este usuário pode
 * ver; aqui só montamos a visão.
 */
export async function loadClientReceivables(
  clientId: string,
  clinicId?: string,
  period?: { start: string; end: string }
): Promise<ReceivablesData> {
  const supabase = await createClient();

  const now = new Date();
  const start =
    period?.start ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [py, pm] = start.split("-").map(Number);
  const end =
    period?.end ??
    `${pm === 12 ? py + 1 : py}-${String(pm === 12 ? 1 : pm + 1).padStart(2, "0")}-01`;

  const { data: todasAsCobrancas } = await supabase
    .from("payment_installments")
    .select(
      "id, clinic_id, seq, kind, due_date, amount_cents, benefit_discount_cents, paid_amount_cents, paid_benefit_cents, paid_fee_cents, paid_interest_cents, status, payment_method, late_fee_percent, monthly_interest_percent, grace_days, was_overdue, negotiation_id, direct_sale_id, renegotiation_id, renegotiated_by_id, boleto_issued_at, boleto_fee_cents, acquirer_id"
    )
    .eq("client_id", clientId)
    .order("due_date")
    .returns<InstallmentRow[]>();
  // 0373: cobrança de negociação ainda ABERTA é só a proposta de pagamento —
  // não é cobrança, não atrasa (CBE-00001: 8 parcelas e "1 em atraso" com a
  // cliente ainda decidindo com o marido).
  const instRows = await semAsPropostas(supabase, todasAsCobrancas ?? []);

  const renegotiations = await loadRenegotiations(supabase, clientId);
  const sales = await loadSaleSummaries(supabase, instRows ?? []);
  const codeById = new Map<string, string | null>();
  for (const s of sales) codeById.set(s.id, s.code);
  for (const r of renegotiations) codeById.set(r.id, r.code);

  const installments: Installment[] = (instRows ?? []).map((r) => ({
    id: r.id,
    seq: r.seq,
    kind: r.kind,
    dueDate: r.due_date,
    amountCents: r.amount_cents,
    benefitDiscountCents: r.benefit_discount_cents ?? 0,
    paidAmountCents: r.paid_amount_cents ?? 0,
    paidBenefitCents: r.paid_benefit_cents ?? 0,
    paidFeeCents: r.paid_fee_cents ?? 0,
    paidInterestCents: r.paid_interest_cents ?? 0,
    status: r.status,
    paymentMethod: r.payment_method,
    terms: {
      lateFeePercent: r.late_fee_percent ?? 2,
      monthlyInterestPercent: r.monthly_interest_percent ?? 1,
      graceDays: r.grace_days ?? 0,
    },
    origin: r.renegotiation_id
      ? "renegotiation"
      : r.direct_sale_id
        ? "direct_sale"
        : "negotiation",
    sourceId: r.renegotiation_id ?? r.direct_sale_id ?? r.negotiation_id,
    sourceCode:
      codeById.get(
        r.renegotiation_id ?? r.direct_sale_id ?? r.negotiation_id ?? ""
      ) ?? null,
    renegotiatedById: r.renegotiated_by_id,
    wasOverdue: r.was_overdue,
    clinicId: r.clinic_id,
  }));

  const boletos: Record<string, BoletoIssue> = {};
  for (const r of instRows ?? []) {
    if (r.boleto_issued_at) {
      boletos[r.id] = {
        issuedAt: r.boleto_issued_at,
        feeCents: r.boleto_fee_cents ?? 0,
      };
    }
  }

  const maxDiscountPercent = await loadMaxDiscountPercent(supabase, clinicId);
  const boletoIssuableIds = await loadBoletoIssuable(
    supabase,
    clinicId,
    instRows ?? []
  );

  if (installments.length === 0) {
    return {
      installments: [],
      receipts: [],
      renegotiations,
      sales,
      maxDiscountPercent,
      receivedInPeriodCents: 0,
      periodStart: start,
      periodEnd: end,
      boletos,
      boletoIssuableIds,
      charges: [],
      waivers: [],
      unidadesProntas: {},
      cobrancaDisponivel: false,
      surpluses: [],
      keptFeeReceiptIds: [],
    };
  }

  const ids = installments.map((i) => i.id);
  const { charges, waivers, disponivel: cobrancaDisponivel } = await loadChargesAndWaivers(supabase, clientId, ids);
  const unidadesProntas: Record<string, boolean> = {};
  if (cobrancaDisponivel) {
    for (const cid of new Set(installments.map((i) => i.clinicId).filter((x): x is string => !!x))) {
      const { data: pronta } = await supabase.rpc("central_is_ready", { p_clinic_id: cid });
      unidadesProntas[cid] = pronta === true;
    }
  }
  const waivedPrincipal = new Map<string, number>();
  for (const w of waivers) {
    waivedPrincipal.set(w.installmentId, (waivedPrincipal.get(w.installmentId) ?? 0) + w.principalCents);
  }
  for (const i of installments) i.waivedPrincipalCents = waivedPrincipal.get(i.id) ?? 0;
  const { data: recRows } = await supabase
    .from("payment_receipts")
    .select(
      "id, installment_id, amount_cents, principal_cents, benefit_cents, late_fee_cents, interest_cents, received_at, payment_method, reference, notes, reversed, reversal_of, reversal_reason, created_at, acquirer_fee_cents, acquirer_fee_charged_at_issue, settlement_date, profiles:profiles!payment_receipts_created_by_fkey ( full_name )"
    )
    .in("installment_id", ids)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        installment_id: string;
        amount_cents: number;
        principal_cents: number | null;
        benefit_cents: number | null;
        late_fee_cents: number | null;
        interest_cents: number | null;
        received_at: string;
        payment_method: string | null;
        reference: string | null;
        notes: string | null;
        reversed: boolean;
        reversal_of: string | null;
        reversal_reason: string | null;
        created_at: string;
        acquirer_fee_cents: number | null;
        acquirer_fee_charged_at_issue: boolean | null;
        settlement_date: string | null;
        profiles: { full_name: string } | null;
      }[]
    >();

  const receipts: ReceiptRow[] = (recRows ?? []).map((r) => ({
    id: r.id,
    installmentId: r.installment_id,
    amountCents: r.amount_cents,
    principalCents: r.principal_cents ?? 0,
    benefitCents: r.benefit_cents ?? 0,
    lateFeeCents: r.late_fee_cents ?? 0,
    interestCents: r.interest_cents ?? 0,
    receivedAt: r.received_at,
    paymentMethod: r.payment_method,
    reference: r.reference,
    reversed: r.reversed,
    reversalOf: r.reversal_of,
    reversalReason: r.reversal_reason,
    // 4005: a baixa vinda do aviso do Asaas não tem pessoa.
    byName:
      r.profiles?.full_name ??
      (r.notes === "Baixa automática (Asaas)" || (r.reversal_of && r.reference?.startsWith("Asaas "))
        ? "Asaas (automático)"
        : null),
    createdAt: r.created_at,
    acquirerFeeCents: r.acquirer_fee_cents ?? 0,
    acquirerFeeChargedAtIssue: Boolean(r.acquirer_fee_charged_at_issue),
    settlementDate: r.settlement_date ?? null,
  }));

  // "Recebido no período": baixas ATIVAS (não estornadas, não estornos).
  const receivedInPeriodCents = receipts
    .filter(
      (r) =>
        !r.reversed &&
        !r.reversalOf &&
        r.receivedAt >= start &&
        r.receivedAt < end
    )
    .reduce((s, r) => s + r.amountCents, 0);

  return {
    installments,
    receipts,
    renegotiations,
    sales,
    maxDiscountPercent,
    receivedInPeriodCents,
    periodStart: start,
    periodEnd: end,
    boletos,
    boletoIssuableIds,
    charges,
    waivers,
    unidadesProntas,
    cobrancaDisponivel,
    ...(await loadGatewayExtras(supabase, clientId, receipts.map((r) => r.id))),
  };
}

/**
 * 4005 — duplicidades do cliente e as baixas com a taxa da rede mantida.
 * Sem a 4005 no banco: listas vazias.
 */
async function loadGatewayExtras(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  receiptIds: string[]
): Promise<{ surpluses: SurplusRow[]; keptFeeReceiptIds: string[] }> {
  const { data: sRows, error } = await supabase
    .from("gateway_payment_surpluses")
    .select("id, installment_id, amount_cents, paid_on, reason, status, applied_installment_id, resolution_note, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        installment_id: string | null;
        amount_cents: number;
        paid_on: string | null;
        reason: string;
        status: SurplusRow["status"];
        applied_installment_id: string | null;
        resolution_note: string | null;
        created_at: string;
      }[]
    >();
  if (error) return { surpluses: [], keptFeeReceiptIds: [] };
  const surpluses: SurplusRow[] = (sRows ?? []).map((s) => ({
    id: s.id,
    installmentId: s.installment_id,
    amountCents: Number(s.amount_cents),
    paidOn: s.paid_on,
    reason: s.reason,
    status: s.status,
    appliedInstallmentId: s.applied_installment_id,
    resolutionNote: s.resolution_note,
    createdAt: s.created_at,
  }));
  let keptFeeReceiptIds: string[] = [];
  if (receiptIds.length > 0) {
    const { data: kRows } = await supabase
      .from("split_charges")
      .select("receipt_id")
      .in("receipt_id", receiptIds)
      .eq("kept_after_refund", true)
      .is("waived_at", null)
      .returns<{ receipt_id: string }[]>();
    keptFeeReceiptIds = [...new Set((kRows ?? []).map((k) => k.receipt_id))];
  }
  return { surpluses, keptFeeReceiptIds };
}

/**
 * 4004 — cobranças e dispensas. Antes de a 4004 rodar neste banco as tabelas
 * não existem: a tela segue como era (sem cobranças).
 */
async function loadChargesAndWaivers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  installmentIds: string[]
): Promise<{ charges: ChargeRow[]; waivers: WaiverRow[]; disponivel: boolean }> {
  const { data: cRows, error: cErr } = await supabase
    .from("charges")
    .select(
      "id, payment_installment_id, status, billing_type, value_cents, discount_cents, due_date, is_overdue_reissue, is_external, external_note, invoice_url, bank_slip_url, pix_copy_paste, identification_field, error_code, payer_kind, payer_guardian_id, created_at, updated_at, cancelled_at, cancel_reason, profiles:profiles!charges_created_by_fkey ( full_name )"
    )
    .in("payment_installment_id", installmentIds)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        payment_installment_id: string;
        status: string;
        billing_type: string | null;
        value_cents: number | null;
        discount_cents: number | null;
        due_date: string | null;
        is_overdue_reissue: boolean;
        is_external: boolean;
        external_note: string | null;
        invoice_url: string | null;
        bank_slip_url: string | null;
        pix_copy_paste: string | null;
        identification_field: string | null;
        error_code: string | null;
        payer_kind: string | null;
        payer_guardian_id: string | null;
        created_at: string;
        updated_at: string;
        cancelled_at: string | null;
        cancel_reason: string | null;
        profiles: { full_name: string } | null;
      }[]
    >();
  if (cErr) return { charges: [], waivers: [], disponivel: false };

  // O nome e o telefone de quem paga (para o WhatsApp): o cliente ou o responsável.
  const { data: cli } = await supabase
    .from("clients")
    .select("full_name, phone")
    .eq("id", clientId)
    .maybeSingle<{ full_name: string; phone: string | null }>();
  const guardianIds = [
    ...new Set((cRows ?? []).map((r) => r.payer_guardian_id).filter((x): x is string => !!x)),
  ];
  const guardians = new Map<string, { full_name: string; phone: string | null }>();
  if (guardianIds.length > 0) {
    const { data: gRows } = await supabase
      .from("client_guardians")
      .select("id, full_name, phone")
      .in("id", guardianIds)
      .returns<{ id: string; full_name: string; phone: string | null }[]>();
    for (const g of gRows ?? []) guardians.set(g.id, g);
  }

  const charges: ChargeRow[] = (cRows ?? []).map((r) => {
    const g = r.payer_guardian_id ? guardians.get(r.payer_guardian_id) : null;
    return {
      id: r.id,
      installmentId: r.payment_installment_id,
      status: r.status,
      billingType: r.billing_type,
      valueCents: r.value_cents === null ? null : Number(r.value_cents),
      discountCents: Number(r.discount_cents ?? 0),
      dueDate: r.due_date,
      isOverdueReissue: r.is_overdue_reissue,
      isExternal: r.is_external,
      externalNote: r.external_note,
      invoiceUrl: r.invoice_url,
      bankSlipUrl: r.bank_slip_url,
      pixCopyPaste: r.pix_copy_paste,
      identificationField: r.identification_field,
      errorCode: r.error_code,
      payerKind: r.payer_kind,
      payerName: g?.full_name ?? (r.payer_kind === "client" ? (cli?.full_name ?? null) : null),
      payerPhone: g ? (g.phone ?? cli?.phone ?? null) : (cli?.phone ?? null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      byName: r.profiles?.full_name ?? null,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
    };
  });

  const comNatureza = await supabase
    .from("payment_waivers")
    .select(
      "id, installment_id, principal_cents, benefit_cents, late_fee_cents, interest_cents, total_cents, reason, kind, created_at, profiles:profiles!payment_waivers_created_by_fkey ( full_name )"
    )
    .in("installment_id", installmentIds)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        installment_id: string;
        principal_cents: number;
        benefit_cents: number;
        late_fee_cents: number;
        interest_cents: number;
        total_cents: number;
        reason: string;
        kind?: string | null;
        created_at: string;
        profiles: { full_name: string } | null;
      }[]
    >();
  let wRows = comNatureza.data;
  if (comNatureza.error) {
    // Banco sem a 4005: a coluna `kind` ainda não existe.
    ({ data: wRows } = await supabase
      .from("payment_waivers")
      .select(
        "id, installment_id, principal_cents, benefit_cents, late_fee_cents, interest_cents, total_cents, reason, created_at, profiles:profiles!payment_waivers_created_by_fkey ( full_name )"
      )
      .in("installment_id", installmentIds)
      .order("created_at", { ascending: false })
      .returns<
        {
          id: string;
          installment_id: string;
          principal_cents: number;
          benefit_cents: number;
          late_fee_cents: number;
          interest_cents: number;
          total_cents: number;
          reason: string;
          kind?: string | null;
          created_at: string;
          profiles: { full_name: string } | null;
        }[]
      >());
  }
  const waivers: WaiverRow[] = (wRows ?? []).map((w) => ({
    id: w.id,
    installmentId: w.installment_id,
    principalCents: Number(w.principal_cents),
    benefitCents: Number(w.benefit_cents),
    lateFeeCents: Number(w.late_fee_cents),
    interestCents: Number(w.interest_cents),
    totalCents: Number(w.total_cents),
    reason: w.reason,
    kind: w.kind === "arredondamento" ? "arredondamento" : "dispensa",
    byName: w.profiles?.full_name ?? null,
    createdAt: w.created_at,
  }));
  return { charges, waivers, disponivel: true };
}

/**
 * FIN4b.2 — quais cobranças aceitam o registro da emissão do boleto.
 *
 * A pergunta é **por cobrança**, não por unidade: quem manda é a adquirente
 * daquela cobrança. Duas adquirentes da mesma unidade podem cobrar em momentos
 * diferentes (uma no pagamento, outra na emissão), e oferecer o botão na errada
 * só produziria erro. A trava de verdade está no banco
 * (`register_boleto_issue`); isto aqui é para não mostrar botão inútil.
 */
async function loadBoletoIssuable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string | undefined,
  rows: InstallmentRow[]
): Promise<string[]> {
  if (!clinicId) return [];

  const candidates = rows.filter(
    (r) =>
      r.payment_method === "boleto" &&
      (r.status === "em_aberto" || r.status === "parcial") &&
      r.boleto_issued_at === null
  );
  if (candidates.length === 0) return [];

  const { data: acquirerRows } = await supabase
    .from("card_acquirers")
    .select("id, clinic_id, scope, is_default, active, name")
    .eq("active", true)
    .returns<
      {
        id: string;
        clinic_id: string | null;
        scope: AcquirerScope | null;
        is_default: boolean;
        active: boolean;
        name: string;
      }[]
    >();
  if (!acquirerRows || acquirerRows.length === 0) return [];

  const { data: links } = await supabase
    .from("card_acquirer_clinics")
    .select("acquirer_id, clinic_id")
    .eq("clinic_id", clinicId)
    .returns<{ acquirer_id: string; clinic_id: string }[]>();
  const linked = new Set((links ?? []).map((l) => l.acquirer_id));

  const applicable = acquirerRows
    .map((a) => ({
      id: a.id,
      clinicId: a.clinic_id,
      scope: a.scope ?? ("unidade" as AcquirerScope),
      isDefault: a.is_default,
      active: a.active,
      name: a.name,
      clinicIds: linked.has(a.id) ? [clinicId] : [],
    }))
    .filter((a) => acquirerAppliesTo(a, clinicId));
  if (applicable.length === 0) return [];

  // A cobrança sem adquirente gravada cairia na mesma escolha automática do
  // banco — espelhamos a regra para o botão bater com o que vai acontecer.
  const fallback = pickAcquirer(applicable, clinicId);

  const today = todayInBrazil();
  const { data: rates } = await supabase
    .from("acquirer_rates")
    .select("acquirer_id, valid_from, valid_to")
    .in(
      "acquirer_id",
      applicable.map((a) => a.id)
    )
    .eq("modality", "boleto")
    .eq("fee_charged_on", "emissao")
    .returns<
      { acquirer_id: string; valid_from: string; valid_to: string | null }[]
    >();

  const chargesAtIssue = new Set(
    (rates ?? [])
      .filter(
        (r) =>
          r.valid_from <= today && (r.valid_to === null || r.valid_to >= today)
      )
      .map((r) => r.acquirer_id)
  );
  if (chargesAtIssue.size === 0) return [];

  return candidates
    .filter((r) => {
      const acquirerId = r.acquirer_id ?? fallback?.id ?? null;
      return acquirerId !== null && chargesAtIssue.has(acquirerId);
    })
    .map((r) => r.id);
}

/**
 * FIN2.1 — o resumo de cada venda que gerou cobrança para este cliente:
 * código, data e os procedimentos com o preço de tabela e o benefício aplicado.
 * É o que a ficha mostra quando o usuário clica no código da parcela.
 */
async function loadSaleSummaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: InstallmentRow[]
): Promise<SaleSummary[]> {
  const negotiationIds = [
    ...new Set(rows.map((r) => r.negotiation_id).filter((x): x is string => !!x)),
  ];
  const saleIds = [
    ...new Set(rows.map((r) => r.direct_sale_id).filter((x): x is string => !!x)),
  ];
  const out: SaleSummary[] = [];

  if (negotiationIds.length > 0) {
    const { data: negs } = await supabase
      .from("plan_negotiations")
      .select("id, code, created_at, final_cents, option_id")
      .in("id", negotiationIds)
      .returns<
        {
          id: string;
          code: string | null;
          created_at: string;
          final_cents: number;
          option_id: string;
        }[]
      >();
    const { data: items } = await supabase
      .from("plan_negotiation_items")
      .select(
        "negotiation_id, included, program_discount_cents, treatment_plan_option_items ( option_id, description, quantity, unit_price_cents, sort_order )"
      )
      .in("negotiation_id", negotiationIds)
      .returns<
        {
          negotiation_id: string;
          included: boolean;
          program_discount_cents: number | null;
          treatment_plan_option_items: {
            option_id: string;
            description: string;
            quantity: number;
            unit_price_cents: number;
            sort_order: number;
          } | null;
        }[]
      >();

    for (const n of negs ?? []) {
      const mine = (items ?? [])
        // Só a opção que foi negociada, e só o que entrou na venda.
        .filter(
          (i) =>
            i.negotiation_id === n.id &&
            i.included &&
            i.treatment_plan_option_items?.option_id === n.option_id
        )
        .sort(
          (a, b) =>
            (a.treatment_plan_option_items?.sort_order ?? 0) -
            (b.treatment_plan_option_items?.sort_order ?? 0)
        );
      out.push({
        id: n.id,
        kind: "negotiation",
        code: n.code,
        createdAt: n.created_at,
        totalCents: n.final_cents,
        items: mine.map((i) => {
          const item = i.treatment_plan_option_items!;
          const gross = item.quantity * item.unit_price_cents;
          const discount = i.program_discount_cents ?? 0;
          return {
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unit_price_cents,
            discountCents: discount,
            finalCents: Math.max(0, gross - discount),
          };
        }),
      });
    }
  }

  if (saleIds.length > 0) {
    const { data: sales } = await supabase
      .from("direct_sales")
      .select("id, code, created_at, final_cents")
      .in("id", saleIds)
      .returns<
        {
          id: string;
          code: string | null;
          created_at: string;
          final_cents: number;
        }[]
      >();
    const { data: items } = await supabase
      .from("direct_sale_items")
      .select(
        "sale_id, description, quantity, unit_price_cents, program_discount_cents, final_cents"
      )
      .in("sale_id", saleIds)
      .returns<
        {
          sale_id: string;
          description: string;
          quantity: number;
          unit_price_cents: number;
          program_discount_cents: number | null;
          final_cents: number;
        }[]
      >();

    for (const s of sales ?? []) {
      out.push({
        id: s.id,
        kind: "direct_sale",
        code: s.code,
        createdAt: s.created_at,
        totalCents: s.final_cents,
        items: (items ?? [])
          .filter((i) => i.sale_id === s.id)
          .map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: i.unit_price_cents,
            discountCents: i.program_discount_cents ?? 0,
            finalCents: i.final_cents,
          })),
      });
    }
  }

  return out;
}

/**
 * 0373: tira as cobranças que são só a PROPOSTA de uma negociação aberta
 * (`cobrancaEhSoProposta`). Se a leitura da situação falhar, mostra tudo —
 * esconder por falta de leitura sumiria com cobrança de verdade.
 */
async function semAsPropostas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: InstallmentRow[]
): Promise<InstallmentRow[]> {
  const negIds = [
    ...new Set(
      rows
        .filter((r) => r.negotiation_id && !r.renegotiation_id && !r.direct_sale_id)
        .map((r) => r.negotiation_id as string)
    ),
  ];
  if (negIds.length === 0) return rows;
  const [{ data: negs, error: e1 }, { data: vendas, error: e2 }] = await Promise.all([
    supabase
      .from("plan_negotiations")
      .select("id, status")
      .in("id", negIds)
      .returns<{ id: string; status: string }[]>(),
    supabase
      .from("commercial_sales")
      .select("negotiation_id, closed_at")
      .in("negotiation_id", negIds)
      .returns<{ negotiation_id: string; closed_at: string | null }[]>(),
  ]);
  if (e1 || e2) return rows;
  const status = new Map((negs ?? []).map((n) => [n.id, n.status]));
  const fechada = new Set(
    (vendas ?? []).filter((v) => v.closed_at).map((v) => v.negotiation_id)
  );
  return rows.filter(
    (r) =>
      !cobrancaEhSoProposta({
        origin: r.renegotiation_id
          ? "renegotiation"
          : r.direct_sale_id
            ? "direct_sale"
            : "negotiation",
        negotiationStatus: r.negotiation_id ? (status.get(r.negotiation_id) ?? null) : null,
        saleClosed: r.negotiation_id ? fechada.has(r.negotiation_id) : false,
        paidAmountCents: r.paid_amount_cents ?? 0,
      })
  );
}

/** Cascata rede → unidade, como no resto do sistema. */
async function loadMaxDiscountPercent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId?: string
): Promise<number | null> {
  const { data } = await supabase
    .from("commercial_rules")
    .select("clinic_id, max_discount_percent")
    .returns<{ clinic_id: string | null; max_discount_percent: number | null }[]>();
  const unit = (data ?? []).find((r) => clinicId && r.clinic_id === clinicId);
  const network = (data ?? []).find((r) => r.clinic_id === null);
  const value = unit?.max_discount_percent ?? network?.max_discount_percent;
  return value === null || value === undefined ? null : Number(value);
}

/** FIN2 — histórico de renegociações do cliente (a RLS já limita o acesso). */
async function loadRenegotiations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string
): Promise<RenegotiationRow[]> {
  const { data } = await supabase
    .from("payment_renegotiations")
    .select(
      "id, code, created_at, status, original_principal_cents, original_benefit_cents, original_fee_cents, original_interest_cents, original_total_cents, discount_cents, discount_percent, new_total_cents, monthly_interest_percent, financed_interest_cents, reason, requires_authorization, authorization_note, contract_signed, payment_issued, payment_confirmed, closed_at, author:profiles!payment_renegotiations_created_by_fkey ( full_name ), approver:profiles!payment_renegotiations_authorized_by_fkey ( full_name )"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        code: string | null;
        created_at: string;
        status: RenegotiationStatus;
        original_principal_cents: number;
        original_benefit_cents: number;
        original_fee_cents: number;
        original_interest_cents: number;
        original_total_cents: number;
        discount_cents: number;
        discount_percent: number;
        new_total_cents: number;
        monthly_interest_percent: number | null;
        financed_interest_cents: number | null;
        reason: string | null;
        requires_authorization: boolean;
        authorization_note: string | null;
        contract_signed: boolean;
        payment_issued: boolean;
        payment_confirmed: boolean;
        closed_at: string | null;
        author: { full_name: string } | null;
        approver: { full_name: string } | null;
      }[]
    >();

  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    createdAt: r.created_at,
    status: r.status,
    originalPrincipalCents: r.original_principal_cents,
    originalBenefitCents: r.original_benefit_cents,
    originalFeeCents: r.original_fee_cents,
    originalInterestCents: r.original_interest_cents,
    originalTotalCents: r.original_total_cents,
    discountCents: r.discount_cents,
    discountPercent: Number(r.discount_percent ?? 0),
    newTotalCents: r.new_total_cents,
    monthlyInterestPercent: Number(r.monthly_interest_percent ?? 0),
    financedInterestCents: r.financed_interest_cents ?? 0,
    reason: r.reason,
    requiresAuthorization: r.requires_authorization,
    authorizationNote: r.authorization_note,
    byName: r.author?.full_name ?? null,
    authorizedByName: r.approver?.full_name ?? null,
    contractSigned: r.contract_signed,
    paymentIssued: r.payment_issued,
    paymentConfirmed: r.payment_confirmed,
    closedAt: r.closed_at,
  }));
}
