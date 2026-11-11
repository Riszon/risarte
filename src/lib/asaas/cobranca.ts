import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import {
  createCustomer,
  createPayment,
  deletePayment,
  findCustomerByCpfCnpj,
  findPaymentsByReference,
  getIdentificationField,
  getPayment,
  getPixPayload,
  type AsaasCredential,
  type AsaasPayment,
} from "./api";
import { AsaasError, mensagemDoAsaas, type AsaasRequestOptions } from "./client";

/**
 * A COBRANÇA NO ASAAS (ASA1, entrega 2) — só no servidor.
 *
 * O banco já gravou a cobrança "emitindo" pela porta (`charge_prepare`), com
 * permissão, prontidão, pagador e valor conferidos. Aqui:
 *   1. CONSULTA o Asaas pela referência (o id da cobrança) — se uma tentativa
 *      anterior criou e não soube, aproveita a que existe (sem duplicar);
 *   2. acha o pagador pelo CPF na conta, ou cria (só nome e CPF, notificações
 *      do Asaas desligadas);
 *   3. cria a cobrança; se o Asaas não responder a tempo, consulta de novo
 *      pela referência antes de desistir (NUNCA repete o POST às cegas);
 *   4. busca o Pix copia e cola ou a linha digitável (falha aqui não desfaz
 *      a cobrança: o link da fatura já serve);
 *   5. grava a resposta (`_charge_mark_issued`) ou o erro (`_charge_mark_error`).
 */

export type CobrancaDoBanco = {
  charge_id: string;
  status: string;
  clinic_id: string;
  gateway_account_id: string | null;
  billing_type: "BOLETO" | "PIX" | "CREDIT_CARD";
  value_cents: number;
  discount_cents: number;
  fine_percent: number;
  interest_percent: number;
  due_date: string;
  description: string;
  asaas_payment_id: string | null;
  payer_kind: "client" | "guardian";
  payer_guardian_id: string | null;
  client_id: string;
  payer_name: string;
  payer_cpf: string;
  asaas_customer_id: string | null;
};

export type ResultadoDaEmissao = { ok: true } | { ok: false; error: string };

const reais = (cents: number) => Math.round(Number(cents)) / 100;

/** Situações do Asaas em que a cobrança já está paga (não se cancela). */
const PAGA_NO_ASAAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);

async function lerCobranca(chargeId: string): Promise<CobrancaDoBanco | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_charge_for_gateway", { p_charge_id: chargeId });
  if (error) throw new Error(`charge read failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as CobrancaDoBanco | null;
  return row ?? null;
}

async function marcarErro(chargeId: string, code: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("_charge_mark_error", { p_charge_id: chargeId, p_code: code });
  if (error) console.error("charge mark error failed:", error.message);
}

/** O pagador no Asaas: o já gravado, o achado pelo CPF ou um novo. */
async function pagadorNoAsaas(
  c: CobrancaDoBanco,
  cred: AsaasCredential,
  opts: AsaasRequestOptions,
  banco: BancoDaEmissao
): Promise<{ asaasId: string; localId: string }> {
  let asaasId = c.asaas_customer_id;
  if (!asaasId) {
    const achado = await findCustomerByCpfCnpj(cred, c.payer_cpf, opts);
    asaasId = achado?.id ?? null;
  }
  if (!asaasId) {
    const novo = await createCustomer(cred, { name: c.payer_name, cpfCnpj: c.payer_cpf }, opts);
    asaasId = novo?.id ?? null;
  }
  if (!asaasId) throw new AsaasError({ code: "invalid_response", messagePt: "O Asaas não devolveu o pagador.", logMessage: "customer without id" });
  return { asaasId, localId: await banco.salvarPagador(c, asaasId) };
}

/** O que a emissão grava no banco (separado para o teste do tempo esgotado). */
export type BancoDaEmissao = {
  salvarPagador: (c: CobrancaDoBanco, asaasCustomerId: string) => Promise<string>;
  gravarErro: (code: string) => Promise<void>;
  /** Devolve a mensagem de erro, ou nulo se gravou. */
  gravarEmissao: (r: {
    asaasPaymentId: string;
    gatewayCustomerId: string | null;
    invoiceUrl: string | null;
    bankSlipUrl: string | null;
    pixCopyPaste: string | null;
    identificationField: string | null;
  }) => Promise<string | null>;
};

function bancoDe(chargeId: string): BancoDaEmissao {
  const admin = createAdminClient();
  return {
    salvarPagador: async (c, asaasId) => {
      const { data, error } = await admin.rpc("_gateway_customer_save", {
        p_account_id: c.gateway_account_id,
        p_cpf_cnpj: c.payer_cpf,
        p_asaas_customer_id: asaasId,
        p_owner_kind: c.payer_kind,
        p_client_id: c.client_id,
        p_guardian_id: c.payer_guardian_id,
      });
      if (error) throw new Error(`gateway customer save failed: ${error.message}`);
      return data as string;
    },
    gravarErro: (code) => marcarErro(chargeId, code),
    gravarEmissao: async (r) => {
      const { error } = await admin.rpc("_charge_mark_issued", {
        p_charge_id: chargeId,
        p_asaas_payment_id: r.asaasPaymentId,
        p_gateway_customer_id: r.gatewayCustomerId,
        p_invoice_url: r.invoiceUrl,
        p_bank_slip_url: r.bankSlipUrl,
        p_pix_copy_paste: r.pixCopyPaste,
        p_identification_field: r.identificationField,
      });
      return error ? error.message : null;
    },
  };
}

/** Emite no Asaas a cobrança que o banco deixou "emitindo". */
export async function emitirNoAsaas(chargeId: string, actorId: string | null): Promise<ResultadoDaEmissao> {
  const c = await lerCobranca(chargeId);
  if (!c) return { ok: false, error: "Cobrança não encontrada." };
  if (c.status !== "emitindo") return { ok: false, error: "Esta cobrança não está esperando emissão." };
  if (!c.gateway_account_id) return { ok: false, error: "A unidade não tem conta Asaas." };

  const purpose = "emitir_cobranca";
  let cred: AsaasCredential;
  try {
    cred = await credencialDaConta(c.gateway_account_id, purpose, actorId);
  } catch (e) {
    console.error("charge credential failed:", e instanceof Error ? e.message : e);
    await marcarErro(chargeId, "credential");
    return { ok: false, error: "Não foi possível ler a chave da conta Asaas da unidade. Avise o Admin Master." };
  }
  const opts = opcoesDaConta(c.gateway_account_id, purpose);
  return emitirComOAsaas(c, cred, opts, bancoDe(chargeId));
}

/**
 * O miolo da emissão, sem ler a chave: consulta pela referência, pagador,
 * cobrança (com a nova consulta se o POST esgotar o tempo), Pix/linha e grava.
 */
export async function emitirComOAsaas(
  c: CobrancaDoBanco,
  cred: AsaasCredential,
  opts: AsaasRequestOptions,
  banco: BancoDaEmissao
): Promise<ResultadoDaEmissao> {
  let pagador: { asaasId: string; localId: string } | null = null;
  let pagamento: AsaasPayment | null = null;
  try {
    // 1) Já existe? (tentativa anterior que criou sem saber)
    [pagamento] = await findPaymentsByReference(cred, c.charge_id, opts);
    if (!pagamento) {
      // 2) O pagador.
      pagador = await pagadorNoAsaas(c, cred, opts, banco);
      // 3) A cobrança.
      try {
        pagamento = await createPayment(
          cred,
          {
            customer: pagador.asaasId,
            billingType: c.billing_type,
            value: reais(c.value_cents),
            dueDate: c.due_date,
            description: c.description,
            externalReference: c.charge_id,
            discountValue: reais(c.discount_cents),
            finePercent: Number(c.fine_percent),
            interestPercent: Number(c.interest_percent),
          },
          opts
        );
      } catch (e) {
        if (e instanceof AsaasError && e.code === "unknown_outcome") {
          // Não sabemos se criou: pergunta pela referência, nunca repete.
          [pagamento] = await findPaymentsByReference(cred, c.charge_id, opts).catch(() => [null as unknown as AsaasPayment]);
          if (!pagamento) throw e;
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    const code = e instanceof AsaasError ? e.code : "unexpected";
    if (!(e instanceof AsaasError)) console.error("charge emit failed:", e instanceof Error ? e.message : e);
    await banco.gravarErro(code);
    return { ok: false, error: mensagemDoAsaas(e) };
  }

  if (!pagamento?.id) {
    await banco.gravarErro("invalid_response");
    return { ok: false, error: "O Asaas não devolveu a cobrança." };
  }

  // 4) Pix copia e cola ou linha digitável (não desfaz a cobrança se falhar).
  let pix: string | null = null;
  let linha: string | null = null;
  try {
    if (c.billing_type === "PIX") pix = await getPixPayload(cred, pagamento.id, opts);
    if (c.billing_type === "BOLETO") linha = await getIdentificationField(cred, pagamento.id, opts);
  } catch {
    // o link da fatura basta; o Pix e a linha podem ser lidos depois
  }

  // 5) Grava.
  const error = await banco.gravarEmissao({
    asaasPaymentId: pagamento.id,
    gatewayCustomerId: pagador?.localId ?? null,
    invoiceUrl: pagamento.invoiceUrl ?? null,
    bankSlipUrl: pagamento.bankSlipUrl ?? null,
    pixCopyPaste: pix,
    identificationField: linha,
  });
  if (error) {
    console.error("charge mark issued failed:", error);
    return { ok: false, error: "A cobrança foi criada no Asaas, mas não foi gravada no riSZon. Use “Tentar de novo”: nada será duplicado." };
  }
  return { ok: true };
}

export type ResultadoDoCancelamento = { ok: true } | { ok: false; error: string; jaPaga?: boolean };

/**
 * Cancela no Asaas e, só se o Asaas confirmar, grava. Quem pode já foi
 * conferido pela porta `charge_cancel_check` (com a sessão da pessoa).
 * Cobrança paga no Asaas é recusada (a baixa vem pelo webhook na ASA2).
 */
export async function cancelarNoAsaas(args: {
  chargeId: string;
  accountId: string | null;
  asaasPaymentId: string | null;
  actorId: string;
  reason: string;
}): Promise<ResultadoDoCancelamento> {
  const admin = createAdminClient();
  if (args.accountId) {
    const purpose = "cancelar_cobranca";
    try {
      const cred = await credencialDaConta(args.accountId, purpose, args.actorId);
      const opts = opcoesDaConta(args.accountId, purpose);
      // Sem id do Asaas (erro ou "emitindo"): pode ter sido criada sem saber.
      const ids = args.asaasPaymentId
        ? [args.asaasPaymentId]
        : (await findPaymentsByReference(cred, args.chargeId, opts)).map((p) => p.id as string);
      for (const id of ids) {
        const p = await getPayment(cred, id, opts);
        if (p?.deleted) continue;
        if (p?.status && PAGA_NO_ASAAS.has(p.status)) {
          return { ok: false, jaPaga: true, error: "Esta cobrança já foi paga no Asaas. Ela não pode ser cancelada; a baixa vem do Asaas." };
        }
        await deletePayment(cred, id, opts);
      }
    } catch (e) {
      if (!(e instanceof AsaasError)) console.error("charge cancel failed:", e instanceof Error ? e.message : e);
      return { ok: false, error: mensagemDoAsaas(e) };
    }
  }
  const { error } = await admin.rpc("_charge_mark_cancelled", {
    p_charge_id: args.chargeId,
    p_actor: args.actorId,
    p_reason: args.reason,
  });
  if (error) {
    console.error("charge mark cancelled failed:", error.message);
    return { ok: false, error: "A cobrança foi cancelada no Asaas, mas não foi gravada no riSZon. Tente de novo." };
  }
  return { ok: true };
}
