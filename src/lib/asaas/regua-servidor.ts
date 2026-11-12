import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import { getBalance, getCustomerNotifications, updateCustomer, updateNotificationsBatch, type AsaasCredential } from "./api";
import { AsaasError, type AsaasRequestOptions } from "./client";
import { contatoParaOAsaas, pacoteDosAvisos, type AvisoDaRegua } from "./regua";

/**
 * A RÉGUA NO ASAAS (ASA2, entrega 3; 4007) — só no servidor.
 *
 * O banco decide o que cada pagador deve ter (`_gateway_regua_queue`: ligado,
 * desligado ou contato apagado) e guarda a fila. Aqui só se fala com o Asaas
 * e se devolve o resultado (`_gateway_regua_done`). Cada pagador:
 *   - ligado:    contato + avisos ligados; lê os 8 avisos; grava a régua (3 chamadas);
 *   - desligado: avisos desligados (1 chamada; o contato fica no Asaas, 17.3);
 *   - apagar:    conta desativada — e-mail e celular em branco (1 chamada, D6).
 *
 * Cota do Asaas: 25.000 chamadas por CONTA a cada 12 h. A rotina roda a cada
 * 10 min com até 50 pagadores por conta (pior caso 10.800 em 12 h). No 429, a
 * conta para até a próxima volta.
 */

export type ItemDaFila = {
  customer_id: string;
  account_id: string;
  asaas_customer_id: string;
  mode: "on" | "off" | "clear";
  email: string | null;
  mobile: string | null;
  rules: AvisoDaRegua[] | null;
  rules_version: number;
  started_at: string;
};

export const PAGADORES_POR_CONTA = 50;

/** Aplica um pagador no Asaas. Devolve se o contato foi junto. Lança o erro do Asaas. */
export async function aplicarNoAsaas(item: ItemDaFila, cred: AsaasCredential, opts: AsaasRequestOptions): Promise<boolean> {
  const { body, levouContato } = contatoParaOAsaas(item.mode, { email: item.email, mobile: item.mobile });
  await updateCustomer(cred, item.asaas_customer_id, body, opts);
  if (item.mode === "on") {
    const atuais = await getCustomerNotifications(cred, item.asaas_customer_id, opts);
    const pacote = pacoteDosAvisos(atuais, item.rules ?? [], {
      temEmail: !!body.email,
      temCelular: !!body.mobilePhone,
    });
    await updateNotificationsBatch(cred, item.asaas_customer_id, pacote, opts);
  }
  return levouContato;
}

async function devolver(item: ItemDaFila, levouContato: boolean, erro: string | null) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("_gateway_regua_done", {
    p_customer_id: item.customer_id,
    p_mode: item.mode,
    p_rules_version: item.rules_version,
    p_contact_sent: levouContato,
    p_started_at: item.started_at,
    p_error: erro,
  });
  if (error) console.error("gateway regua done failed:", error.message);
}

const codigoDoErro = (e: unknown) =>
  e instanceof AsaasError ? e.code : e instanceof Error ? e.message.slice(0, 120) : "erro";

export type ResultadoDaFila = { pagadores: number; aplicados: number; falharam: number; contasParadas: number };

/** A rodada da fila (o cron de 10 em 10 minutos). */
export async function rodarFilaDaRegua(): Promise<ResultadoDaFila> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_regua_queue", { p_per_account: PAGADORES_POR_CONTA });
  if (error) throw new Error(`gateway regua queue failed: ${error.message}`);
  const itens = (data ?? []) as ItemDaFila[];
  const r: ResultadoDaFila = { pagadores: itens.length, aplicados: 0, falharam: 0, contasParadas: 0 };

  const porConta = new Map<string, ItemDaFila[]>();
  for (const i of itens) porConta.set(i.account_id, [...(porConta.get(i.account_id) ?? []), i]);

  for (const [conta, lista] of porConta) {
    let cred: AsaasCredential;
    try {
      cred = await credencialDaConta(conta, "regua", null);
    } catch (e) {
      console.error("gateway regua key read failed:", e instanceof Error ? e.message : e);
      r.contasParadas++;
      continue;
    }
    // Sem insistir no 429 dentro da rodada: a próxima volta é em 10 minutos.
    const opts = { ...opcoesDaConta(conta, "regua"), rateLimitRetries: 0 };
    for (const item of lista) {
      try {
        const levou = await aplicarNoAsaas(item, cred, opts);
        await devolver(item, levou, null);
        r.aplicados++;
      } catch (e) {
        await devolver(item, false, codigoDoErro(e));
        r.falharam++;
        if (e instanceof AsaasError && (e.code === "rate_limited" || e.code === "unauthorized")) {
          r.contasParadas++;
          break;
        }
      }
    }
  }
  return r;
}

/**
 * Na emissão: se o pagador está na fila, aplica a régua ANTES de criar a
 * cobrança, para o aviso "cobrança criada" sair. Falha aqui não impede a
 * cobrança: o pagador fica na fila e a rotina tenta de novo.
 */
export async function aplicarReguaDoPagador(
  gatewayCustomerId: string,
  cred: AsaasCredential,
  opts: AsaasRequestOptions
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_regua_for_customer", { p_customer_id: gatewayCustomerId });
  if (error) {
    // Banco sem a 4007: a emissão segue como antes.
    if (!/does not exist|schema cache/i.test(error.message)) console.error("gateway regua for customer failed:", error.message);
    return;
  }
  const item = ((Array.isArray(data) ? data[0] : data) ?? null) as ItemDaFila | null;
  if (!item) return;
  try {
    const levou = await aplicarNoAsaas(item, cred, opts);
    await devolver(item, levou, null);
  } catch (e) {
    await devolver(item, false, codigoDoErro(e));
  }
}

/**
 * Na rotina diária: o saldo das contas com a régua ligada e WhatsApp em algum
 * aviso. O WhatsApp só sai com saldo na conta; saldo zerado avisa o Gerente e
 * o Admin (uma vez por dia). O Asaas NÃO avisa falha de envio (17.4).
 */
export async function conferirSaldoDaRegua(hoje: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_regua_balance_accounts");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("gateway regua balance accounts failed:", error.message);
    return 0;
  }
  let zerados = 0;
  for (const c of (data ?? []) as { account_id: string; clinic_id: string }[]) {
    try {
      const cred = await credencialDaConta(c.account_id, "balance_check", null);
      const saldo = await getBalance(cred, opcoesDaConta(c.account_id, "balance_check"));
      if (saldo == null) continue;
      const cents = Math.round(saldo * 100);
      await admin.rpc("_gateway_save_balance", { p_account_id: c.account_id, p_balance_cents: cents });
      if (cents <= 0) {
        zerados++;
        await admin.rpc("_gateway_notify", {
          p_account_id: c.account_id,
          p_kind: "saldo_zerado_whatsapp",
          p_key: hoje,
          p_clinic_id: c.clinic_id,
          p_managers: true,
          p_finance: false,
          p_admins: true,
          p_title: "Asaas: conta sem saldo para o WhatsApp",
          p_body: "A régua de avisos tem WhatsApp ligado, mas a conta Asaas da unidade está sem saldo. O WhatsApp só sai com saldo na conta no momento do envio; e-mail e SMS continuam.",
          p_link: `/central/unidades/${c.clinic_id}/cobranca`,
        });
      }
    } catch (e) {
      console.error("gateway regua balance check failed:", e instanceof Error ? e.message : e);
    }
  }
  return zerados;
}
