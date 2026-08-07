import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Installment } from "@/lib/finance/receivables";
import type { RenegotiationStatus } from "@/lib/finance/renegotiation";
import {
  acquirerAppliesTo,
  pickAcquirer,
  type AcquirerScope,
} from "@/lib/finance/acquirers";

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
};

type InstallmentRow = {
  id: string;
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

  const { data: instRows } = await supabase
    .from("payment_installments")
    .select(
      "id, seq, kind, due_date, amount_cents, benefit_discount_cents, paid_amount_cents, paid_benefit_cents, paid_fee_cents, paid_interest_cents, status, payment_method, late_fee_percent, monthly_interest_percent, grace_days, was_overdue, negotiation_id, direct_sale_id, renegotiation_id, renegotiated_by_id, boleto_issued_at, boleto_fee_cents, acquirer_id"
    )
    .eq("client_id", clientId)
    .order("due_date")
    .returns<InstallmentRow[]>();

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
    };
  }

  const ids = installments.map((i) => i.id);
  const { data: recRows } = await supabase
    .from("payment_receipts")
    .select(
      "id, installment_id, amount_cents, principal_cents, benefit_cents, late_fee_cents, interest_cents, received_at, payment_method, reference, reversed, reversal_of, reversal_reason, created_at, profiles:profiles!payment_receipts_created_by_fkey ( full_name )"
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
        reversed: boolean;
        reversal_of: string | null;
        reversal_reason: string | null;
        created_at: string;
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
    byName: r.profiles?.full_name ?? null,
    createdAt: r.created_at,
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
  };
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

  const today = new Date().toISOString().slice(0, 10);
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
