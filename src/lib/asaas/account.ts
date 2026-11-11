import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AsaasCredential } from "./api";
import type { AsaasLogEntry, AsaasRequestOptions } from "./client";
import { isAsaasFake, type AsaasEnvironment } from "./env";
import { fakeAsaasFetch } from "./fake";

/**
 * A PONTE ENTRE O CLIENTE DO ASAAS E O BANCO — só no servidor.
 *
 * ⚠️ É AQUI, E SÓ AQUI, QUE A CHAVE SAI DO VAULT. `credencialDaConta` chama a
 * função do banco `_gateway_read_key` (4000), que só responde à chave de
 * serviço e grava cada leitura (conta, finalidade, quem, quando). A chave fica
 * na memória desta requisição e nunca vai para tela, log ou resposta.
 *
 * Toda chamada ao Asaas sai do servidor com a chave da conta certa: quem
 * precisa falar com o Asaas pede a credencial pela CONTA (que é de uma
 * unidade), nunca por variável de ambiente.
 */

export type GatewayAccountRow = {
  id: string;
  owner_type: "franchisor" | "unit" | "recipient";
  clinic_id: string | null;
  label: string;
  environment: AsaasEnvironment;
  status: "awaiting_key" | "active" | "error" | "disabled";
  webhook_ref: string;
  webhook_id: string | null;
};

/** A conta, pela chave de serviço (quem chama já passou pela guarda da tela). */
export async function carregarConta(accountId: string): Promise<GatewayAccountRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("gateway_accounts")
    .select("id, owner_type, clinic_id, label, environment, status, webhook_ref, webhook_id")
    .eq("id", accountId)
    .maybeSingle<GatewayAccountRow>();
  if (error) throw new Error(`gateway_accounts read failed: ${error.message}`);
  return data ?? null;
}

/**
 * A credencial da conta, lida do Vault. `purpose` diz PARA QUÊ (fica no
 * registro de uso); `actorId` é a pessoa logada, ou nulo numa rotina.
 */
export async function credencialDaConta(
  accountId: string,
  purpose: string,
  actorId: string | null
): Promise<AsaasCredential> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_read_key", {
    p_account_id: accountId,
    p_purpose: purpose,
    p_actor: actorId,
  });
  if (error) throw new Error(`gateway key read failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { api_key?: string; environment?: AsaasEnvironment } | null;
  if (!row?.api_key || !row.environment) throw new Error("gateway key read failed: empty");
  return { apiKey: row.api_key, environment: row.environment };
}

/**
 * As opções de toda chamada desta conta: o registro em `gateway_api_log`
 * (método, modelo da rota, status, duração — sem corpo, chave ou CPF) e, no
 * servidor de teste, o Asaas de mentira.
 */
export function opcoesDaConta(accountId: string | null, purpose: string): AsaasRequestOptions {
  const admin = createAdminClient();
  const onLog = async (e: AsaasLogEntry) => {
    const { error } = await admin.from("gateway_api_log").insert({
      account_id: accountId,
      method: e.method,
      path: e.path,
      http_status: e.httpStatus,
      duration_ms: e.durationMs,
      attempt: e.attempt,
      error_code: e.errorCode,
      rate_remaining: e.rateRemaining,
      purpose,
    });
    if (error) console.error("gateway_api_log insert failed:", error.message);
  };
  return isAsaasFake() ? { onLog, fetchImpl: fakeAsaasFetch } : { onLog };
}
