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
};

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
