import { asaasRequest, type AsaasRequestOptions } from "./client";
import type { AsaasEnvironment } from "./env";
import type { AsaasFeesResponse } from "./fees";

/**
 * OS ENDPOINTS DO ASAAS QUE A ASA0 USA — cada um conferido na documentação
 * oficial (docs.asaas.com) em 10/11/2026. Arquivo PURO: recebe a credencial
 * (`AsaasCredential`) de quem chama.
 *
 * Cada fase acrescenta aqui os endpoints dela (clientes e cobranças na ASA1).
 */

export type AsaasCredential = { apiKey: string; environment: AsaasEnvironment };
type Opts = AsaasRequestOptions;

type Lista<T> = { data?: T[] | null; totalCount?: number | null; hasMore?: boolean | null };

// ---- A conta ----------------------------------------------------------------

/** `GET /v3/wallets/` — o identificador de carteira (walletId) da conta. */
export async function getWalletId(cred: AsaasCredential, opts?: Opts): Promise<string | null> {
  const r = await asaasRequest<Lista<{ id?: string | null }>>({ ...cred, method: "GET", path: "/wallets/" }, opts);
  const id = r?.data?.[0]?.id;
  return typeof id === "string" && id ? id : null;
}

export type AsaasCommercialInfo = {
  status?: string | null;
  personType?: string | null;
  cpfCnpj?: string | null;
  name?: string | null;
  companyType?: string | null;
  commercialInfoExpiration?: { isExpired?: boolean | null; scheduledDate?: string | null } | null;
};

/** `GET /v3/myAccount/commercialInfo/` — nome, CNPJ e a validade dos dados comerciais. */
export function getCommercialInfo(cred: AsaasCredential, opts?: Opts): Promise<AsaasCommercialInfo> {
  return asaasRequest<AsaasCommercialInfo>({ ...cred, method: "GET", path: "/myAccount/commercialInfo/" }, opts);
}

export type AsaasAccountStatus = {
  id?: string | null;
  commercialInfo?: string | null;
  bankAccountInfo?: string | null;
  documentation?: string | null;
  general?: string | null;
};

/** `GET /v3/myAccount/status/` — PENDING, APPROVED, REJECTED ou AWAITING_APPROVAL em cada frente. */
export function getAccountStatus(cred: AsaasCredential, opts?: Opts): Promise<AsaasAccountStatus> {
  return asaasRequest<AsaasAccountStatus>({ ...cred, method: "GET", path: "/myAccount/status/" }, opts);
}

/** `GET /v3/myAccount/fees/` — a tabela de tarifas da conta. */
export function getFees(cred: AsaasCredential, opts?: Opts): Promise<AsaasFeesResponse> {
  return asaasRequest<AsaasFeesResponse>({ ...cred, method: "GET", path: "/myAccount/fees/" }, opts);
}

/** `GET /v3/pix/addressKeys?status=ACTIVE` — a conta tem chave Pix ativa? */
export async function hasActivePixKey(cred: AsaasCredential, opts?: Opts): Promise<boolean> {
  const r = await asaasRequest<Lista<{ status?: string | null }>>(
    { ...cred, method: "GET", path: "/pix/addressKeys", query: { status: "ACTIVE", limit: 1 } },
    opts
  );
  return (r?.data ?? []).some((k) => k?.status === "ACTIVE");
}

/** `GET /v3/anticipations/configurations` — a antecipação automática (cartão) está ligada? */
export async function isAutomaticAnticipationEnabled(cred: AsaasCredential, opts?: Opts): Promise<boolean | null> {
  const r = await asaasRequest<{ creditCardAutomaticEnabled?: boolean | null }>(
    { ...cred, method: "GET", path: "/anticipations/configurations" },
    opts
  );
  return typeof r?.creditCardAutomaticEnabled === "boolean" ? r.creditCardAutomaticEnabled : null;
}

// ---- Webhooks -----------------------------------------------------------------

export type AsaasWebhook = {
  id?: string | null;
  name?: string | null;
  url?: string | null;
  enabled?: boolean | null;
  interrupted?: boolean | null;
  hasAuthToken?: boolean | null;
  /** Os avisos assinados (ASA3, 4009: conferidos e corrigidos pela rotina). */
  events?: string[] | null;
};

/**
 * Os eventos que o riSZon pede na ASA0: cobranças (inclusive split),
 * situação da conta e da chave de API. As fases seguintes acrescentam os
 * delas (nota fiscal na ASA8, Pix Automático na ASA4B) e ATUALIZAM o webhook.
 */
export const WEBHOOK_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  // ASA3 (4009): estorno de boleto negado.
  "PAYMENT_REFUND_DENIED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_ANTICIPATED",
  "PAYMENT_SPLIT_DONE",
  "PAYMENT_SPLIT_CANCELLED",
  "PAYMENT_SPLIT_DIVERGENCE_BLOCK",
  "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED",
  // ASA4 (4012): "Aberta pelo pagador" (19.3).
  "PAYMENT_CHECKOUT_VIEWED",
  "PAYMENT_BANK_SLIP_VIEWED",
  "ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED",
  "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON",
  "ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED",
  "ACCESS_TOKEN_EXPIRING_SOON",
  "ACCESS_TOKEN_DISABLED",
  "ACCESS_TOKEN_EXPIRED",
  "ACCESS_TOKEN_DELETED",
] as const;

/**
 * A VERSÃO da lista acima. Mudou a lista → sobe a versão: a rotina de 10 em 10
 * minutos confere cada conta e corrige o webhook pela API (18.7.5).
 * 1 = ASA0 a ASA3 entrega 1; 2 = + PAYMENT_REFUND_DENIED (4009).
 */
export const WEBHOOK_EVENTS_VERSION = 3;

/** `PUT /v3/webhooks/{id}` — troca os avisos assinados, sem recriar o webhook. */
export function updateWebhookEvents(cred: AsaasCredential, id: string, events: readonly string[], opts?: Opts): Promise<AsaasWebhook> {
  return asaasRequest<AsaasWebhook>({ ...cred, method: "PUT", path: "/webhooks/{id}", params: { id }, body: { events: [...events] } }, opts);
}

/** `GET /v3/webhooks/{id}` */
export function getWebhook(cred: AsaasCredential, id: string, opts?: Opts): Promise<AsaasWebhook> {
  return asaasRequest<AsaasWebhook>({ ...cred, method: "GET", path: "/webhooks/{id}", params: { id } }, opts);
}

/** `GET /v3/webhooks` — os webhooks da conta (máximo de 10 por conta). */
export async function listWebhooks(cred: AsaasCredential, opts?: Opts): Promise<AsaasWebhook[]> {
  const r = await asaasRequest<Lista<AsaasWebhook>>({ ...cred, method: "GET", path: "/webhooks", query: { limit: 100 } }, opts);
  return r?.data ?? [];
}

/**
 * `POST /v3/webhooks` — cria o webhook com o token gerado pelo riSZon.
 * `SEQUENTIALLY`: o Asaas entrega um evento por vez, na ordem.
 */
export function createWebhook(
  cred: AsaasCredential,
  input: { name: string; url: string; email: string; authToken: string },
  opts?: Opts
): Promise<AsaasWebhook> {
  return asaasRequest<AsaasWebhook>(
    {
      ...cred,
      method: "POST",
      path: "/webhooks",
      body: {
        name: input.name,
        url: input.url,
        email: input.email,
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken: input.authToken,
        sendType: "SEQUENTIALLY",
        events: [...WEBHOOK_EVENTS],
      },
    },
    opts
  );
}

/** `DELETE /v3/webhooks/{id}` */
export function deleteWebhook(cred: AsaasCredential, id: string, opts?: Opts): Promise<unknown> {
  return asaasRequest<unknown>({ ...cred, method: "DELETE", path: "/webhooks/{id}", params: { id } }, opts);
}

// ---- Clientes (ASA1) -------------------------------------------------------------
// Conferido em docs.asaas.com (criar-novo-cliente, listar-clientes) em 11/11/2026.

export type AsaasCustomer = { id?: string | null; name?: string | null; cpfCnpj?: string | null; deleted?: boolean | null; externalReference?: string | null };

/**
 * ASA4 (4013, 19.19.3): o cadastro SEM AVISOS do cartão parcelado leva esta
 * referência; nunca é "o" pagador da régua (a busca pelo CPF o ignora).
 */
export const REFERENCIA_DO_CADASTRO_DO_PARCELADO = "riszon-parcelado:";

/** ASA4 (4015): o cadastro do CARNÊ (forma 2): "cobrança criada" desligado para sempre. */
export const REFERENCIA_DO_CADASTRO_DO_CARNE = "riszon-carne:";

/** Os cadastros que NUNCA são "o" pagador da régua (parcelado e carnê). */
export function ehCadastroAuxiliar(externalReference: string | null | undefined): boolean {
  const r = String(externalReference ?? "");
  return r.startsWith(REFERENCIA_DO_CADASTRO_DO_PARCELADO) || r.startsWith(REFERENCIA_DO_CADASTRO_DO_CARNE);
}

/** `GET /v3/customers?cpfCnpj=` — o pagador que já existe na conta (o primeiro não apagado). */
export async function findCustomerByCpfCnpj(cred: AsaasCredential, cpfCnpj: string, opts?: Opts): Promise<AsaasCustomer | null> {
  const r = await asaasRequest<Lista<AsaasCustomer>>(
    { ...cred, method: "GET", path: "/customers", query: { cpfCnpj, limit: 10 } },
    opts
  );
  return (r?.data ?? []).find((c) => c?.id && !c.deleted && !ehCadastroAuxiliar(c.externalReference)) ?? null;
}

/** ASA4 (4013): o cadastro sem avisos de um parcelamento (`GET /customers?externalReference=`). */
export async function findCustomerByReference(cred: AsaasCredential, externalReference: string, opts?: Opts): Promise<AsaasCustomer | null> {
  const r = await asaasRequest<Lista<AsaasCustomer>>(
    { ...cred, method: "GET", path: "/customers", query: { externalReference, limit: 10 } },
    opts
  );
  return (r?.data ?? []).find((c) => c?.id && !c.deleted && c.externalReference === externalReference) ?? null;
}

/**
 * ASA4 (4013): cria o cadastro SEM AVISOS do parcelamento (só nome e CPF, avisos
 * do Asaas desligados, sem contato): nenhum e-mail, SMS ou WhatsApp do Asaas
 * sai para ele. O link vai por quem fechou a venda (19.19.3, 19.21).
 */
export function createCustomerWithoutNotices(
  cred: AsaasCredential,
  input: { name: string; cpfCnpj: string; externalReference: string },
  opts?: Opts
): Promise<AsaasCustomer> {
  return asaasRequest<AsaasCustomer>(
    {
      ...cred,
      method: "POST",
      path: "/customers",
      body: { name: input.name, cpfCnpj: input.cpfCnpj, notificationDisabled: true, externalReference: input.externalReference },
    },
    opts
  );
}

/**
 * ASA6 (4021): a UNIDADE como pagadora da cobrança mensal, na conta da
 * franqueadora. Com o e-mail financeiro e os avisos do Asaas LIGADOS — sem
 * celular, então só e-mail (cobrança criada, vencendo e vencida; 20.6).
 */
export function createUnitCustomer(
  cred: AsaasCredential,
  input: { name: string; cpfCnpj: string; email: string; externalReference: string },
  opts?: Opts
): Promise<AsaasCustomer> {
  return asaasRequest<AsaasCustomer>(
    {
      ...cred,
      method: "POST",
      path: "/customers",
      body: {
        name: input.name,
        cpfCnpj: input.cpfCnpj,
        email: input.email,
        notificationDisabled: false,
        externalReference: input.externalReference,
      },
    },
    opts
  );
}

/**
 * `POST /v3/customers` — até a ASA2, SÓ nome e CPF/CNPJ e as notificações do
 * Asaas desligadas (o riSZon é quem avisa o paciente).
 */
export function createCustomer(
  cred: AsaasCredential,
  input: { name: string; cpfCnpj: string },
  opts?: Opts
): Promise<AsaasCustomer> {
  return asaasRequest<AsaasCustomer>(
    {
      ...cred,
      method: "POST",
      path: "/customers",
      body: { name: input.name, cpfCnpj: input.cpfCnpj, notificationDisabled: true },
    },
    opts
  );
}

// ---- Cobranças (ASA1) --------------------------------------------------------------
// Conferido em docs.asaas.com (criar-nova-cobranca, listar-cobrancas,
// obter-qr-code-para-pagamentos-via-pix, obter-linha-digitavel-do-boleto,
// excluir-cobranca) em 11/11/2026.

export type AsaasPayment = {
  id?: string | null;
  status?: string | null;
  value?: number | null;
  dueDate?: string | null;
  billingType?: string | null;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  deleted?: boolean | null;
  /** ASA3: o split como o Asaas gravou (só vem se a cobrança tem split). */
  split?: AsaasSplit[] | null;
  netValue?: number | null;
  refunds?: AsaasRefund[] | null;
  /** ASA4 (4013): o parcelamento no cartão a que a parcela pertence. */
  installment?: string | null;
  installmentNumber?: number | null;
  estimatedCreditDate?: string | null;
  creditDate?: string | null;
};

/** Uma entrada de split devolvida pelo Asaas. */
export type AsaasSplit = {
  id?: string | null;
  walletId?: string | null;
  fixedValue?: number | null;
  percentualValue?: number | null;
  totalValue?: number | null;
  status?: string | null;
};

/** O que o riSZon envia em `splits` (ASA3, método B — `split.ts`). */
/** ASA6 (4021): a cobrança mensal manda só o valor fixo (o fundo), sem percentual. */
export type SplitParaEnviar = { walletId: string; percentualValue?: number; fixedValue?: number };

export type NovaCobranca = {
  customer: string;
  billingType: "BOLETO" | "PIX" | "CREDIT_CARD";
  /** Em reais (o Asaas trabalha em reais com 2 casas). */
  value: number;
  dueDate: string;
  description: string;
  /** O id da cobrança no riSZon. */
  externalReference: string;
  /** Desconto FIXO válido até o vencimento (0 = sem desconto). */
  discountValue: number;
  /**
   * Multa EM REAIS (0 = sem multa). ASA2 (16.3): o riSZon calcula a multa
   * sobre o valor cheio da parcela e manda o valor pronto.
   */
  fineValue: number;
  /** Juros em % AO MÊS (0 = sem juros), já ajustados à proporção do valor cheio. */
  interestPercent: number;
  /** ASA3: o split (ausente = sem split; NUNCA lista vazia, que desligaria). */
  splits?: SplitParaEnviar[];
};

/** `POST /v3/payments` — multa e juros vão SEMPRE explícitos (nunca os padrões da conta). */
export function createPayment(cred: AsaasCredential, input: NovaCobranca, opts?: Opts): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(
    {
      ...cred,
      method: "POST",
      path: "/payments",
      body: {
        customer: input.customer,
        billingType: input.billingType,
        value: input.value,
        dueDate: input.dueDate,
        description: input.description.slice(0, 500),
        externalReference: input.externalReference,
        discount: { value: input.discountValue, dueDateLimitDays: 0, type: "FIXED" },
        fine: { value: input.fineValue, type: "FIXED" },
        interest: { value: input.interestPercent },
        ...(input.splits && input.splits.length ? { split: input.splits } : {}),
      },
    },
    opts
  );
}

// ---- Cartão parcelado pelo Asaas (ASA4, entrega 2; 4013) -------------------------
// Provado no sandbox em 14/11/2026 (spec 19.19 e 19.23): `installmentCount` +
// `totalValue` cria o parcelamento inteiro (valores iguais, a sobra na ÚLTIMA,
// vencimentos mês a mês); a referência do POST vai para todas as parcelas e cada
// parcela aceita a SUA (`PUT /payments/{id}`), que se mantém depois do pagamento.

export type NovoParcelamento = Omit<NovaCobranca, "billingType" | "value" | "discountValue" | "fineValue" | "interestPercent"> & {
  /** De 2 a 21. */
  installmentCount: number;
  /** O total do parcelamento, em reais. */
  totalValue: number;
};

/** `POST /v3/payments` com `installmentCount` + `totalValue` — o cartão parcelado, sem cartão (o pagador paga pelo link da fatura). */
export function createCardInstallment(cred: AsaasCredential, input: NovoParcelamento, opts?: Opts): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(
    {
      ...cred,
      method: "POST",
      path: "/payments",
      body: {
        customer: input.customer,
        billingType: "CREDIT_CARD",
        installmentCount: input.installmentCount,
        totalValue: input.totalValue,
        dueDate: input.dueDate,
        description: input.description.slice(0, 500),
        externalReference: input.externalReference,
        ...(input.splits && input.splits.length ? { split: input.splits } : {}),
      },
    },
    opts
  );
}

/** `GET /v3/installments/{id}/payments` — as parcelas do parcelamento, na ordem. */
export async function listInstallmentPayments(cred: AsaasCredential, id: string, opts?: Opts): Promise<AsaasPayment[]> {
  const r = await asaasRequest<Lista<AsaasPayment>>(
    { ...cred, method: "GET", path: "/installments/{id}/payments", params: { id }, query: { limit: 50 } },
    opts
  );
  return (r?.data ?? []).filter((p) => p?.id && !p.deleted).sort((a, b) => Number(a.installmentNumber ?? 0) - Number(b.installmentNumber ?? 0));
}

/** `PUT /v3/payments/{id}` só com a referência: a parcela passa a apontar para a SUA cobrança no riSZon. */
export function updatePaymentReference(cred: AsaasCredential, id: string, externalReference: string, opts?: Opts): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>({ ...cred, method: "PUT", path: "/payments/{id}", params: { id }, body: { externalReference } }, opts);
}

/** `DELETE /v3/installments/{id}` — cancela o parcelamento NÃO pago, inteiro. */
export function deleteInstallment(cred: AsaasCredential, id: string, opts?: Opts): Promise<{ deleted?: boolean | null }> {
  return asaasRequest<{ deleted?: boolean | null }>({ ...cred, method: "DELETE", path: "/installments/{id}", params: { id } }, opts);
}

/** `POST /v3/installments/{id}/refund` — estorno do parcelamento INTEIRO (sem `value`; provado no sandbox com o corpo vazio). */
export function refundInstallment(cred: AsaasCredential, id: string, opts?: Opts): Promise<{ status?: string | null; refunds?: AsaasRefund[] | null }> {
  return asaasRequest<{ status?: string | null; refunds?: AsaasRefund[] | null }>(
    { ...cred, method: "POST", path: "/installments/{id}/refund", params: { id }, body: {} },
    opts
  );
}

/**
 * ASA4 (4014): troca o split do parcelamento INTEIRO (`PUT /installments/{id}/splits`).
 * Provado no sandbox (19.20): muda as parcelas todas, e aceita depois do cartão
 * aprovado (enquanto nenhuma foi antecipada nem teve o split liquidado).
 */
export function updateInstallmentSplits(cred: AsaasCredential, id: string, splits: SplitParaEnviar[], opts?: Opts): Promise<unknown> {
  return asaasRequest<unknown>({ ...cred, method: "PUT", path: "/installments/{id}/splits", params: { id }, body: { splits } }, opts);
}

/** ASA4 (4014): a contestação de uma cobrança (`GET /payments/{id}/chargeback`) — o prazo dos documentos. */
export type AsaasChargeback = { status?: string | null; reason?: string | null; deadlineToSendDisputeDocuments?: string | null; disputeStatus?: string | null };
export function getChargeback(cred: AsaasCredential, id: string, opts?: Opts): Promise<AsaasChargeback> {
  return asaasRequest<AsaasChargeback>({ ...cred, method: "GET", path: "/payments/{id}/chargeback", params: { id } }, opts);
}

/** `GET /v3/payments?externalReference=` — o que já foi criado com esta referência. */
export async function findPaymentsByReference(cred: AsaasCredential, externalReference: string, opts?: Opts): Promise<AsaasPayment[]> {
  const r = await asaasRequest<Lista<AsaasPayment>>(
    { ...cred, method: "GET", path: "/payments", query: { externalReference, limit: 10 } },
    opts
  );
  return (r?.data ?? []).filter((p) => p?.id && !p.deleted);
}

/** `GET /v3/payments/{id}` */
/**
 * ASA3 (4009): troca SÓ o split de uma cobrança (`PUT /v3/payments/{id}` com
 * `split`). Provado no sandbox: não muda fatura, boleto, Pix nem gera
 * PAYMENT_UPDATED. ⚠️ Lista vazia DESLIGA o split — só com a confirmação (U4).
 */
export function updatePaymentSplit(cred: AsaasCredential, id: string, splits: SplitParaEnviar[], opts?: Opts): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>({ ...cred, method: "PUT", path: "/payments/{id}", params: { id }, body: { split: splits } }, opts);
}

/** Um estorno como o Asaas devolve na cobrança. */
export type AsaasRefund = {
  status?: string | null;
  value?: number | null;
  dateCreated?: string | null;
  /** 4020a: a cobrança da parcela, no estorno do parcelamento. */
  paymentId?: string | null;
  transactionReceiptUrl?: string | null;
};

/**
 * 4020a: o estorno PARCIAL (com o valor) de uma cobrança Pix ou cartão
 * (`POST /v3/payments/{id}/refund` com `value`). O Pix pode ficar esperando a
 * autorização do titular; o cartão sai na hora ou em processamento.
 */
export function refundPaymentValue(cred: AsaasCredential, id: string, valueReais: number, description: string, opts?: Opts): Promise<AsaasPayment & { refunds?: AsaasRefund[] | null }> {
  return asaasRequest<AsaasPayment & { refunds?: AsaasRefund[] | null }>(
    { ...cred, method: "POST", path: "/payments/{id}/refund", params: { id }, body: { value: valueReais, description: description.slice(0, 200) } },
    opts
  );
}

/**
 * 4020a: o estorno PARCIAL do parcelamento (`POST /v3/installments/{id}/refund`
 * com `value`). Provado no sandbox em 17/11/2026: o Asaas reparte — as parcelas
 * inteiras primeiro, e a parte da seguinte.
 */
export function refundInstallmentValue(cred: AsaasCredential, id: string, valueReais: number, description: string, opts?: Opts): Promise<{ status?: string | null; refunds?: AsaasRefund[] | null }> {
  return asaasRequest<{ status?: string | null; refunds?: AsaasRefund[] | null }>(
    { ...cred, method: "POST", path: "/installments/{id}/refund", params: { id }, body: { value: valueReais, description: description.slice(0, 200) } },
    opts
  );
}

/** `POST /v3/payments/{id}/refund` — estorno TOTAL de Pix ou cartão. Pode ficar aguardando a autorização do titular. */
export function refundPayment(cred: AsaasCredential, id: string, description: string, opts?: Opts): Promise<AsaasPayment & { refunds?: AsaasRefund[] | null }> {
  return asaasRequest<AsaasPayment & { refunds?: AsaasRefund[] | null }>(
    { ...cred, method: "POST", path: "/payments/{id}/refund", params: { id }, body: { description: description.slice(0, 200) } },
    opts
  );
}

/** `POST /v3/payments/{id}/bankSlip/refund` — estorno de boleto: devolve o link para o PAGADOR informar os dados bancários. */
export async function refundBankSlip(cred: AsaasCredential, id: string, opts?: Opts): Promise<string | null> {
  const r = await asaasRequest<{ requestUrl?: string | null }>({ ...cred, method: "POST", path: "/payments/{id}/bankSlip/refund", params: { id }, body: {} }, opts);
  return typeof r?.requestUrl === "string" && r.requestUrl.startsWith("https://") ? r.requestUrl : null;
}

export function getPayment(cred: AsaasCredential, id: string, opts?: Opts): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>({ ...cred, method: "GET", path: "/payments/{id}", params: { id } }, opts);
}

/** `GET /v3/payments/{id}/pixQrCode` — o Pix copia e cola (`payload`). */
export async function getPixPayload(cred: AsaasCredential, id: string, opts?: Opts): Promise<string | null> {
  const r = await asaasRequest<{ payload?: string | null }>(
    { ...cred, method: "GET", path: "/payments/{id}/pixQrCode", params: { id } },
    opts
  );
  return typeof r?.payload === "string" && r.payload ? r.payload : null;
}

/** `GET /v3/payments/{id}/identificationField` — a linha digitável do boleto. */
export async function getIdentificationField(cred: AsaasCredential, id: string, opts?: Opts): Promise<string | null> {
  const r = await asaasRequest<{ identificationField?: string | null }>(
    { ...cred, method: "GET", path: "/payments/{id}/identificationField", params: { id } },
    opts
  );
  return typeof r?.identificationField === "string" && r.identificationField ? r.identificationField : null;
}

/** `DELETE /v3/payments/{id}` — cancela (o Asaas recusa a cobrança já paga). */
export function deletePayment(cred: AsaasCredential, id: string, opts?: Opts): Promise<{ deleted?: boolean | null }> {
  return asaasRequest<{ deleted?: boolean | null }>({ ...cred, method: "DELETE", path: "/payments/{id}", params: { id } }, opts);
}

// ---- A régua de avisos (ASA2, entrega 3) ---------------------------------------
// Conferido em docs.asaas.com (atualizar-cliente-existente,
// recuperar-notificacoes-de-um-cliente, atualizar-notificacoes-existentes-em-lote,
// recuperar-saldo-da-conta) em 12/11/2026.

/** O que a régua manda no `PUT /v3/customers/{id}` — só os campos a mudar. */
export type ContatoDoPagador = {
  email?: string;
  mobilePhone?: string;
  notificationDisabled: boolean;
};

/** `PUT /v3/customers/{id}` — contato e avisos ligados ou desligados. */
export function updateCustomer(cred: AsaasCredential, id: string, body: ContatoDoPagador, opts?: Opts): Promise<AsaasCustomer> {
  return asaasRequest<AsaasCustomer>({ ...cred, method: "PUT", path: "/customers/{id}", params: { id }, body }, opts);
}

export type AsaasNotification = {
  id?: string | null;
  customer?: string | null;
  enabled?: boolean | null;
  event?: string | null;
  scheduleOffset?: number | null;
  emailEnabledForProvider?: boolean | null;
  smsEnabledForProvider?: boolean | null;
  emailEnabledForCustomer?: boolean | null;
  smsEnabledForCustomer?: boolean | null;
  phoneCallEnabledForCustomer?: boolean | null;
  whatsappEnabledForCustomer?: boolean | null;
  deleted?: boolean | null;
};

/** `GET /v3/customers/{id}/notifications` — os avisos do pagador (não o histórico de envios). */
export async function getCustomerNotifications(cred: AsaasCredential, id: string, opts?: Opts): Promise<AsaasNotification[]> {
  const r = await asaasRequest<Lista<AsaasNotification>>(
    { ...cred, method: "GET", path: "/customers/{id}/notifications", params: { id } },
    opts
  );
  return (r?.data ?? []).filter((n): n is AsaasNotification => !!n && typeof n.id === "string" && !n.deleted);
}

export type AvisoParaGravar = {
  id: string;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  scheduleOffset?: number;
};

/** `PUT /v3/notifications/batch` — grava os avisos de um pagador de uma vez. */
export function updateNotificationsBatch(
  cred: AsaasCredential,
  customer: string,
  notifications: AvisoParaGravar[],
  opts?: Opts
): Promise<{ notifications?: AsaasNotification[] | null }> {
  return asaasRequest<{ notifications?: AsaasNotification[] | null }>(
    { ...cred, method: "PUT", path: "/notifications/batch", body: { customer, notifications } },
    opts
  );
}

/** `GET /v3/finance/balance` — o saldo da conta, em reais. */
export async function getBalance(cred: AsaasCredential, opts?: Opts): Promise<number | null> {
  const r = await asaasRequest<{ balance?: number | null }>({ ...cred, method: "GET", path: "/finance/balance" }, opts);
  return typeof r?.balance === "number" && Number.isFinite(r.balance) ? r.balance : null;
}

/**
 * 4012 (spec 19.5): `GET /v3/payments/limits` — o limite diário de criação de
 * cobranças da conta. Devolve null quando o Asaas não informa.
 */
export async function getPaymentLimits(
  cred: AsaasCredential,
  opts?: Opts
): Promise<{ limite: number; usado: number; atingido: boolean } | null> {
  const r = await asaasRequest<{ creation?: { daily?: { limit?: number; used?: number; wasReached?: boolean } } }>(
    { ...cred, method: "GET", path: "/payments/limits" },
    opts
  );
  const d = r?.creation?.daily;
  if (!d || typeof d.limit !== "number") return null;
  return { limite: d.limit, usado: Number(d.used ?? 0), atingido: Boolean(d.wasReached) };
}

// ---- ASA7 (4022): o levantamento, a conciliação e a sonda da chave --------------

export type PaginaDoAsaas<T> = { itens: T[]; chamadas: number; truncado: boolean };

/**
 * `GET /v3/payments` com filtros, página a página (100 por página, o máximo do
 * Asaas). `maxPaginas` limita o custo; `truncado` diz se parou antes do fim.
 */
export async function listPaymentsAll(
  cred: AsaasCredential,
  query: Record<string, string | number | undefined>,
  maxPaginas: number,
  opts?: Opts
): Promise<PaginaDoAsaas<AsaasPayment>> {
  const itens: AsaasPayment[] = [];
  let chamadas = 0;
  for (let p = 0; p < maxPaginas; p++) {
    const r = await asaasRequest<Lista<AsaasPayment>>(
      { ...cred, method: "GET", path: "/payments", query: { ...query, offset: p * 100, limit: 100 } },
      opts
    );
    chamadas++;
    for (const x of r?.data ?? []) if (x?.id) itens.push(x);
    if (!r?.hasMore) return { itens, chamadas, truncado: false };
  }
  return { itens, chamadas, truncado: true };
}

export type AsaasInstallmentResumo = { id?: string | null; value?: number | null; deleted?: boolean | null; externalReference?: string | null };

/** `GET /v3/installments`, página a página. */
export async function listInstallmentsAll(cred: AsaasCredential, maxPaginas: number, opts?: Opts): Promise<PaginaDoAsaas<AsaasInstallmentResumo>> {
  const itens: AsaasInstallmentResumo[] = [];
  let chamadas = 0;
  for (let p = 0; p < maxPaginas; p++) {
    const r = await asaasRequest<Lista<AsaasInstallmentResumo>>(
      { ...cred, method: "GET", path: "/installments", query: { offset: p * 100, limit: 100 } },
      opts
    );
    chamadas++;
    for (const x of r?.data ?? []) if (x?.id && !x.deleted) itens.push(x);
    if (!r?.hasMore) return { itens, chamadas, truncado: false };
  }
  return { itens, chamadas, truncado: true };
}

export type AsaasSubscriptionResumo = { id?: string | null; value?: number | null; status?: string | null; externalReference?: string | null; deleted?: boolean | null };

/** `GET /v3/subscriptions?status=ACTIVE`, página a página. */
export async function listActiveSubscriptionsAll(cred: AsaasCredential, maxPaginas: number, opts?: Opts): Promise<PaginaDoAsaas<AsaasSubscriptionResumo>> {
  const itens: AsaasSubscriptionResumo[] = [];
  let chamadas = 0;
  for (let p = 0; p < maxPaginas; p++) {
    const r = await asaasRequest<Lista<AsaasSubscriptionResumo>>(
      { ...cred, method: "GET", path: "/subscriptions", query: { status: "ACTIVE", offset: p * 100, limit: 100 } },
      opts
    );
    chamadas++;
    for (const x of r?.data ?? []) if (x?.id && !x.deleted) itens.push(x);
    if (!r?.hasMore) return { itens, chamadas, truncado: false };
  }
  return { itens, chamadas, truncado: true };
}

/**
 * A SONDA DA CHAVE (21.7 item 2): uma LEITURA que a chave com as permissões
 * mínimas não pode fazer. "recusada" = 403 (sem a permissão); "respondeu" = a
 * chave tem a permissão (demais); "erro" = não deu para saber. Nunca escreve.
 */
export async function sondarLeituraProibida(
  cred: AsaasCredential,
  path: "/transfers" | "/pix/transactions" | "/bill",
  opts?: Opts
): Promise<{ resultado: "recusada" | "respondeu" | "erro"; codigo?: string | null; asaas?: string[] }> {
  try {
    await asaasRequest<unknown>({ ...cred, method: "GET", path, query: { limit: 1 } }, { ...opts, getRetries: 0, rateLimitRetries: 1 });
    return { resultado: "respondeu" };
  } catch (e) {
    const err = e as { code?: string; httpStatus?: number | null; asaasCodes?: string[] };
    if (err?.httpStatus === 403 || err?.code === "forbidden") return { resultado: "recusada", codigo: err.code ?? null, asaas: err.asaasCodes ?? [] };
    return { resultado: "erro", codigo: err?.code ?? null, asaas: err?.asaasCodes ?? [] };
  }
}
