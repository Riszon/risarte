import "server-only";
import { randomBytes } from "node:crypto";
import { todayInBrazil } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { carregarConta, credencialDaConta, opcoesDaConta } from "./account";
import {
  createWebhook,
  deleteWebhook,
  getAccountStatus,
  getCommercialInfo,
  getFees,
  getWalletId,
  hasActivePixKey,
  isAutomaticAnticipationEnabled,
  listWebhooks,
  type AsaasCredential,
} from "./api";
import { AsaasError, mensagemDoAsaas } from "./client";
import { MENSAGEM_DA_RECUSA, recusaDeAmbiente, webhookBaseUrl } from "./env";
import { diaDoAsaas, ratesFromAsaasFees } from "./fees";
import { tarifasDeAvisoDoAsaas } from "./regua";

/**
 * VINCULAR E VERIFICAR UMA CONTA ASAAS (ASA0).
 *
 * VINCULAR (a pessoa cola a chave na Central):
 *   1. trava de ambiente e permissão (o banco decide de novo ao gravar);
 *   2. VALIDA a chave no Asaas ANTES de gravar: carteira, dados e situação;
 *   3. grava a chave no Vault (`_gateway_store_credentials`);
 *   4. cria o webhook pela API, com token gerado aqui, e grava o token;
 *   5. roda a verificação (tarifas, chave Pix, antecipação).
 * A chave colada nunca é devolvida, logada nem guardada fora do Vault.
 *
 * VERIFICAR (toda semana, e pelo botão): valida a chave, atualiza a situação
 * e as tarifas. Recusa da chave derruba a prontidão e avisa o Admin Master
 * (`_gateway_record_check`). Falha passageira (rede, tempo limite, limite de
 * chamadas, Asaas fora do ar) NÃO derruba nada: fica para a próxima rodada.
 */

export type ResultadoDaVinculacao =
  | {
      ok: true;
      webhook: "created" | "no_public_url" | "failed";
      verificacao: ResultadoDaVerificacao;
    }
  | { ok: false; error: string };

export type ResultadoDaVerificacao =
  | { status: "ok"; tarifasAlteradas: number; chavePix: boolean; antecipacaoLigada: boolean | null }
  | { status: "failed"; error: string }
  | { status: "inconclusive"; error: string };

const MENSAGEM_DO_BANCO: Record<string, string> = {
  NOT_ALLOWED:
    "Você não pode gravar a chave desta conta. O Gerente só pode depois de o termo de autorização do franqueado estar registrado.",
  ACCOUNT_NOT_FOUND: "Esta conta não foi encontrada.",
  ACCOUNT_DISABLED: "Esta conta foi desativada. Abra um novo cadastro de conta para a unidade.",
  API_KEY_INVALID: "A chave de API parece incompleta.",
  API_KEY_WRONG_ENVIRONMENT: MENSAGEM_DA_RECUSA.key_environment_mismatch,
  GATEWAY_PRODUCTION_LOCKED: MENSAGEM_DA_RECUSA.production_locked,
  WALLET_REQUIRED: "O Asaas não devolveu o identificador de carteira desta conta.",
};

export function mensagemDoBancoDoGateway(error: { message?: string } | null | undefined): string {
  const m = error?.message ?? "";
  for (const [codigo, texto] of Object.entries(MENSAGEM_DO_BANCO)) {
    if (m.includes(codigo)) return texto;
  }
  if (/Could not find the function|does not exist|schema cache/i.test(m)) {
    return "A integração com o Asaas ainda não existe neste banco (faltam as migrações 4000 a 4002).";
  }
  return "Não foi possível gravar. Tente de novo; se continuar, avise o Admin Master.";
}

/** Token do webhook: 64 caracteres aleatórios (o Asaas exige de 32 a 255). */
export function novoTokenDeWebhook(): string {
  return randomBytes(32).toString("hex");
}

/** O endereço do webhook desta conta, ou nulo se o servidor não tem endereço público. */
export function enderecoDoWebhook(webhookRef: string): string | null {
  const base = webhookBaseUrl();
  return base ? `${base}/api/webhooks/asaas/${webhookRef}` : null;
}

export async function vincularConta(args: {
  accountId: string;
  apiKey: string;
  actorId: string | null;
  /** E-mail que recebe os avisos do Asaas sobre a fila do webhook. */
  notifyEmail: string;
}): Promise<ResultadoDaVinculacao> {
  const apiKey = args.apiKey.trim();
  const conta = await carregarConta(args.accountId);
  if (!conta) return { ok: false, error: MENSAGEM_DO_BANCO.ACCOUNT_NOT_FOUND };
  if (conta.status === "disabled") return { ok: false, error: MENSAGEM_DO_BANCO.ACCOUNT_DISABLED };

  const recusa = recusaDeAmbiente({ apiKey, environment: conta.environment });
  if (recusa) return { ok: false, error: MENSAGEM_DA_RECUSA[recusa] };

  const admin = createAdminClient();
  if (args.actorId) {
    const pode = await admin.rpc("_gateway_actor_can_link", { p_actor: args.actorId, p_account_id: conta.id });
    if (pode.error) return { ok: false, error: mensagemDoBancoDoGateway(pode.error) };
    if (pode.data !== true) return { ok: false, error: MENSAGEM_DO_BANCO.NOT_ALLOWED };
  }

  // 2) Valida no Asaas com a chave colada (ainda não gravada).
  const colada: AsaasCredential = { apiKey, environment: conta.environment };
  const opts = opcoesDaConta(conta.id, "link");
  let walletId: string | null;
  let info: Awaited<ReturnType<typeof getCommercialInfo>>;
  let situacao: Awaited<ReturnType<typeof getAccountStatus>>;
  try {
    [walletId, info, situacao] = await Promise.all([
      getWalletId(colada, opts),
      getCommercialInfo(colada, opts),
      getAccountStatus(colada, opts),
    ]);
  } catch (e) {
    return { ok: false, error: mensagemDoAsaas(e) };
  }
  if (!walletId) return { ok: false, error: MENSAGEM_DO_BANCO.WALLET_REQUIRED };

  // 3) Grava no Vault. O banco confere a permissão e o ambiente de novo.
  const gravou = await admin.rpc("_gateway_store_credentials", {
    p_account_id: conta.id,
    p_actor: args.actorId,
    p_api_key: apiKey,
    p_wallet_id: walletId,
    p_asaas_account_id: situacao?.id ?? null,
    p_account_name: info?.name ?? null,
    p_cnpj: info?.cpfCnpj ?? null,
    p_account_status: {
      general: situacao?.general ?? null,
      commercialInfo: situacao?.commercialInfo ?? null,
      bankAccountInfo: situacao?.bankAccountInfo ?? null,
      documentation: situacao?.documentation ?? null,
    },
    p_commercial_info_expires_on: diaDoAsaas(info?.commercialInfoExpiration?.scheduledDate),
  });
  if (gravou.error) return { ok: false, error: mensagemDoBancoDoGateway(gravou.error) };

  // 4) O webhook. Daqui em diante a credencial vem do Vault (uso registrado).
  const webhook = await criarWebhookDaConta({ accountId: conta.id, actorId: args.actorId, notifyEmail: args.notifyEmail });

  // 5) Tarifas, chave Pix e antecipação.
  const verificacao = await verificarConta({ accountId: conta.id, actorId: args.actorId, purpose: "link_check" });
  return { ok: true, webhook, verificacao };
}

/**
 * Cria (ou recria) o webhook da conta no Asaas, com token gerado aqui, e grava
 * o token no Vault. Usado na vinculação e pelo botão "Criar o webhook" quando a
 * primeira tentativa falhou ou o servidor não tinha endereço público.
 */
export async function criarWebhookDaConta(args: {
  accountId: string;
  actorId: string | null;
  notifyEmail: string;
}): Promise<"created" | "no_public_url" | "failed"> {
  const conta = await carregarConta(args.accountId);
  if (!conta || conta.status === "disabled") return "failed";
  const url = enderecoDoWebhook(conta.webhook_ref);
  if (!url) return "no_public_url";
  const admin = createAdminClient();
  try {
    const cred = await credencialDaConta(conta.id, "webhook", args.actorId);
    const wopts = opcoesDaConta(conta.id, "webhook");
    // Tira o webhook anterior DESTE endereço (revinculação), sem tocar nos
    // webhooks que a unidade tenha para outros sistemas.
    const existentes = await listWebhooks(cred, wopts);
    for (const w of existentes) {
      if (w.id && w.url === url) await deleteWebhook(cred, w.id, wopts);
    }
    const token = novoTokenDeWebhook();
    const criado = await createWebhook(
      cred,
      { name: `riSZon — ${conta.label}`.slice(0, 80), url, email: args.notifyEmail, authToken: token },
      wopts
    );
    if (!criado?.id) throw new Error("webhook without id");
    const guardou = await admin.rpc("_gateway_store_webhook", {
      p_account_id: conta.id,
      p_webhook_id: criado.id,
      p_token: token,
    });
    if (guardou.error) throw new Error(guardou.error.message);
    return "created";
  } catch (e) {
    console.error("asaas webhook setup failed:", e instanceof AsaasError ? e.logMessage : e instanceof Error ? e.message : String(e));
    return "failed";
  }
}

/** Erro que diz que a CHAVE ou a CONTA foi recusada (não é passageiro). */
function recusaDefinitiva(e: unknown): boolean {
  return e instanceof AsaasError && (e.code === "unauthorized" || e.code === "forbidden" || e.code === "environment");
}

export async function verificarConta(args: {
  accountId: string;
  actorId: string | null;
  purpose?: string;
}): Promise<ResultadoDaVerificacao> {
  const purpose = args.purpose ?? "weekly_check";
  const admin = createAdminClient();
  let cred: AsaasCredential;
  try {
    cred = await credencialDaConta(args.accountId, purpose, args.actorId);
  } catch (e) {
    return { status: "inconclusive", error: e instanceof Error ? e.message.slice(0, 80) : "key_read_failed" };
  }
  const opts = opcoesDaConta(args.accountId, purpose);

  try {
    const [situacao, info, fees, chavePix, antecipacao] = await Promise.all([
      getAccountStatus(cred, opts),
      getCommercialInfo(cred, opts),
      getFees(cred, opts),
      hasActivePixKey(cred, opts),
      // A consulta da antecipação pode não existir para toda conta: sem
      // resposta, o item de prontidão continua faltando (nunca "passa" calado).
      isAutomaticAnticipationEnabled(cred, opts).catch((e) => {
        if (recusaDefinitiva(e)) throw e;
        return null;
      }),
    ]);

    const rates = ratesFromAsaasFees(fees, todayInBrazil());
    const sync = await admin.rpc("_gateway_sync_fees", { p_account_id: args.accountId, p_rates: rates });
    if (sync.error) console.error("gateway fees sync failed:", sync.error.message);
    // ASA2 (4007): as tarifas de aviso (mensageria, WhatsApp, ligação) para a
    // estimativa da régua. Banco sem a 4007 só registra e segue.
    const avisos = tarifasDeAvisoDoAsaas(fees);
    const notif = await admin.rpc("_gateway_save_notification_fees", {
      p_account_id: args.accountId,
      p_messaging_cents: avisos.mensageriaCents,
      p_whatsapp_cents: avisos.whatsappCents,
      p_phone_call_cents: avisos.ligacaoCents,
    });
    if (notif.error && !/does not exist|schema cache/i.test(notif.error.message)) {
      console.error("gateway notification fees save failed:", notif.error.message);
    }

    const gravou = await admin.rpc("_gateway_record_check", {
      p_account_id: args.accountId,
      p_ok: true,
      p_error: null,
      p_account_status: {
        general: situacao?.general ?? null,
        commercialInfo: situacao?.commercialInfo ?? null,
        bankAccountInfo: situacao?.bankAccountInfo ?? null,
        documentation: situacao?.documentation ?? null,
      },
      p_commercial_info_expires_on: diaDoAsaas(info?.commercialInfoExpiration?.scheduledDate),
      p_pix_key_active: chavePix,
      p_anticipation_auto_enabled: antecipacao,
    });
    if (gravou.error) return { status: "inconclusive", error: "record_failed" };
    return {
      status: "ok",
      tarifasAlteradas: typeof sync.data === "number" ? sync.data : 0,
      chavePix,
      antecipacaoLigada: antecipacao,
    };
  } catch (e) {
    if (recusaDefinitiva(e)) {
      const code = e instanceof AsaasError ? e.code : "unknown";
      await admin.rpc("_gateway_record_check", { p_account_id: args.accountId, p_ok: false, p_error: code });
      return { status: "failed", error: mensagemDoAsaas(e) };
    }
    return { status: "inconclusive", error: mensagemDoAsaas(e) };
  }
}

/** Remove o webhook no Asaas antes de desativar a conta. Nunca derruba a desativação. */
export async function removerWebhookDaConta(accountId: string, actorId: string | null): Promise<void> {
  try {
    const conta = await carregarConta(accountId);
    if (!conta?.webhook_id) return;
    const cred = await credencialDaConta(accountId, "disable", actorId);
    await deleteWebhook(cred, conta.webhook_id, opcoesDaConta(accountId, "disable"));
  } catch (e) {
    console.error("asaas webhook removal failed:", e instanceof AsaasError ? e.logMessage : e instanceof Error ? e.message : String(e));
  }
}
