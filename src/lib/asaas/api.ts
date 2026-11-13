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
export const WEBHOOK_EVENTS_VERSION = 2;

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

export type AsaasCustomer = { id?: string | null; name?: string | null; cpfCnpj?: string | null; deleted?: boolean | null };

/** `GET /v3/customers?cpfCnpj=` — o pagador que já existe na conta (o primeiro não apagado). */
export async function findCustomerByCpfCnpj(cred: AsaasCredential, cpfCnpj: string, opts?: Opts): Promise<AsaasCustomer | null> {
  const r = await asaasRequest<Lista<AsaasCustomer>>(
    { ...cred, method: "GET", path: "/customers", query: { cpfCnpj, limit: 10 } },
    opts
  );
  return (r?.data ?? []).find((c) => c?.id && !c.deleted) ?? null;
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
export type SplitParaEnviar = { walletId: string; percentualValue: number; fixedValue?: number };

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
export type AsaasRefund = { status?: string | null; value?: number | null; dateCreated?: string | null };

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
