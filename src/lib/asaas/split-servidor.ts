import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENTS_VERSION,
  getBalance,
  getPayment,
  getWebhook,
  refundBankSlip,
  refundPayment,
  updateCustomer,
  updatePaymentSplit,
  updateWebhookEvents,
  type AsaasCredential,
} from "./api";
import { AsaasError, mensagemDoAsaas, type AsaasRequestOptions } from "./client";
import { VARIAVEL_DOS_PERMITIDOS, celularDoAsaas, lerPermitidos, travaForaDaProducao } from "./regua";
import {
  comIdsDoAsaas,
  decidirSplit,
  mesmasEntradas,
  reduzirAoLiquido,
  splitsParaOAsaas,
  type EntradaParaGravar,
  type PlanoDoSplit,
} from "./split";

/**
 * A FILA DO SPLIT, O ESTORNO, O SALDO E O WEBHOOK (ASA3, entrega 2; 4009) —
 * só no servidor. O banco decide o que entra na fila e guarda o resultado;
 * aqui só se fala com o Asaas.
 */

export const COBRANCAS_POR_CONTA = 150;

type ItemDaFila = {
  charge_id: string;
  account_id: string;
  asaas_payment_id: string;
  billing_type: string;
  mode: "atualizar" | "remover";
  reasons: string[];
  plan: PlanoDoSplit;
  inputs: unknown;
  started_at: string;
};

export type ResultadoDaFilaDoSplit = { conferidas: number; alteradas: number; falharam: number; contasParadas: number };

const codigo = (e: unknown) => (e instanceof AsaasError ? e.code : e instanceof Error ? e.message.slice(0, 120) : "erro");

async function devolver(item: ItemDaFila, outcome: string, entradas: EntradaParaGravar[] | null, erro: string | null, actor: string | null) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("_gateway_split_done", {
    p_charge_id: item.charge_id,
    p_outcome: outcome,
    p_entries: entradas ?? [],
    p_inputs: erro ? null : item.inputs,
    p_reasons: item.reasons,
    p_started_at: item.started_at,
    p_error: erro,
    p_actor: actor,
  });
  if (error) console.error("gateway split done failed:", error.message);
}

/** O split que está gravado hoje para a cobrança (para não chamar o Asaas à toa). */
async function splitGravado(chargeId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("charge_splits")
    .select("wallet_id, percentual_value, fixed_cents, status")
    .eq("charge_id", chargeId);
  return ((data ?? []) as { wallet_id: string; percentual_value: number; fixed_cents: number; status: string }[]).map((s) => ({
    walletId: s.wallet_id,
    percentualValue: Number(s.percentual_value),
    fixedCents: Number(s.fixed_cents),
  }));
}

/** Uma cobrança da fila. Devolve "alterada" | "igual" | "fora" | "teto". Lança o erro do Asaas. */
export async function aplicarItem(item: ItemDaFila, cred: AsaasCredential, opts: AsaasRequestOptions, actor: string | null) {
  if (item.mode === "remover") {
    // U4, exceção: todas as taxas em zero, CONFIRMADO pelo Financeiro ou Admin.
    await updatePaymentSplit(cred, item.asaas_payment_id, [], opts);
    await devolver(item, "removido", null, null, actor);
    return "alterada" as const;
  }
  const decisao = decidirSplit(item.plan);
  if (!decisao.vai) {
    // Teto: mantém o split que está; registra. Sem split possível: nada (U4).
    await devolver(item, decisao.motivo === "teto" ? "teto" : "igual", null, null, actor);
    return decisao.motivo === "teto" ? ("teto" as const) : ("igual" as const);
  }
  const atual = await splitGravado(item.charge_id);
  if (atual.length > 0 && mesmasEntradas(atual, decisao.entradas)) {
    await devolver(item, "igual", decisao.entradas, null, actor);
    return "igual" as const;
  }
  try {
    const p = await updatePaymentSplit(cred, item.asaas_payment_id, splitsParaOAsaas(decisao.entradas), opts);
    await devolver(item, atual.length ? "atualizado" : "acrescentado", comIdsDoAsaas(decisao.entradas, p?.split), null, actor);
    return "alterada" as const;
  } catch (e) {
    // U5: cartão confirmado fora da janela do Asaas — sai da fila (a S5 cobre).
    if (e instanceof AsaasError && e.code === "bad_request" && item.billing_type === "CREDIT_CARD") {
      await devolver(item, "fora_da_janela", null, null, actor);
      return "fora" as const;
    }
    throw e;
  }
}

/**
 * A rodada da fila (o cron de 10 em 10 minutos, ou "Atualizar agora" de uma
 * unidade). 150 por conta; vencidas e vencimento mais próximo primeiro (o
 * banco ordena). No limite de chamadas, a conta para até a próxima rodada.
 */
export async function rodarFilaDoSplit(args: { clinicId?: string | null; actorId?: string | null } = {}): Promise<ResultadoDaFilaDoSplit> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_split_queue", {
    p_per_account: COBRANCAS_POR_CONTA,
    p_clinic_id: args.clinicId ?? null,
  });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return { conferidas: 0, alteradas: 0, falharam: 0, contasParadas: 0 };
    throw new Error(`gateway split queue failed: ${error.message}`);
  }
  const itens = (data ?? []) as ItemDaFila[];
  const r: ResultadoDaFilaDoSplit = { conferidas: itens.length, alteradas: 0, falharam: 0, contasParadas: 0 };
  const porConta = new Map<string, ItemDaFila[]>();
  for (const i of itens) porConta.set(i.account_id, [...(porConta.get(i.account_id) ?? []), i]);

  for (const [conta, lista] of porConta) {
    let cred: AsaasCredential;
    try {
      cred = await credencialDaConta(conta, "split_fila", args.actorId ?? null);
    } catch (e) {
      console.error("gateway split key read failed:", e instanceof Error ? e.message : e);
      r.contasParadas++;
      continue;
    }
    const opts = { ...opcoesDaConta(conta, "split_fila"), rateLimitRetries: 0 };
    for (const item of lista) {
      try {
        if ((await aplicarItem(item, cred, opts, args.actorId ?? null)) === "alterada") r.alteradas++;
      } catch (e) {
        await devolver(item, "atualizado", null, codigo(e), args.actorId ?? null);
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

/** U7: as cobranças com split BLOQUEADO — reduz ao líquido real e reenvia. */
export async function corrigirBloqueios(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_split_blocked");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("gateway split blocked failed:", error.message);
    return 0;
  }
  let n = 0;
  for (const b of (data ?? []) as { charge_id: string; account_id: string; asaas_payment_id: string; plan: PlanoDoSplit; started_at: string }[]) {
    try {
      const cred = await credencialDaConta(b.account_id, "split_bloqueio", null);
      const opts = opcoesDaConta(b.account_id, "split_bloqueio");
      const p = await getPayment(cred, b.asaas_payment_id, opts);
      const liquido = Math.round(Number(p?.netValue ?? 0) * 100);
      const decisao = decidirSplit(b.plan);
      if (!decisao.vai || liquido <= 0) continue;
      const reduzidas = reduzirAoLiquido(decisao.entradas, liquido);
      const r = await updatePaymentSplit(cred, b.asaas_payment_id, splitsParaOAsaas(reduzidas), opts);
      await admin.rpc("_gateway_split_done", {
        p_charge_id: b.charge_id,
        p_outcome: "reduzido_bloqueio",
        p_entries: comIdsDoAsaas(reduzidas, r?.split),
        p_inputs: null,
        p_reasons: ["bloqueio"],
        p_started_at: b.started_at,
        p_error: null,
        p_actor: null,
      });
      n++;
    } catch (e) {
      console.error("gateway split block fix failed:", codigo(e));
    }
  }
  return n;
}

// ---- O ESTORNO (18.7.1, 18.7.4) ---------------------------------------------------

export type ResultadoDoEstorno =
  | { ok: true; estado: "aguardando_autorizacao" | "aguardando_pagador" | "concluido"; link: string | null }
  | { ok: false; error: string };

/**
 * Pede o estorno TOTAL ao Asaas. Quem pode e o motivo já foram conferidos pela
 * porta `charge_refund_check` (com a sessão da pessoa). O riSZon NUNCA pede,
 * recebe nem guarda o código de autorização.
 */
export async function pedirEstornoNoAsaas(args: {
  chargeId: string;
  accountId: string;
  asaasPaymentId: string;
  billingType: string;
  actorId: string;
  reason: string;
}): Promise<ResultadoDoEstorno> {
  const admin = createAdminClient();
  const kind = args.billingType === "BOLETO" ? "boleto" : args.billingType === "PIX" ? "pix" : "cartao";
  try {
    const cred = await credencialDaConta(args.accountId, "estorno", args.actorId);
    const opts = opcoesDaConta(args.accountId, "estorno");
    let status: string | null = null;
    let link: string | null = null;
    let celularEnviado = false;
    if (kind === "boleto") {
      // 18.7.7: o Asaas só estorna boleto com o CELULAR do pagador cadastrado
      // (manda SMS com o link). Vai o da ficha; os avisos ficam como estavam.
      const { data: pg } = await admin.rpc("_charge_refund_payer", { p_charge_id: args.chargeId });
      const pagador = (Array.isArray(pg) ? pg[0] : pg) as {
        asaas_customer_id: string | null;
        mobile: string | null;
        avisos_ligados: boolean;
        regua_da_unidade: boolean;
        termo_declarado: boolean;
      } | null;
      const cel = celularDoAsaas(pagador?.mobile);
      if (!pagador?.asaas_customer_id || !cel) return { ok: false, error: "O pagador não tem celular válido na ficha. Cadastre o celular antes de pedir o estorno do boleto." };
      if (!pagador.termo_declarado) return { ok: false, error: "Falta o Admin Master declarar o termo de privacidade. Faça este estorno no painel do Asaas." };
      // A trava fora da produção (D10): no sandbox, só número da lista de permitidos.
      const trava = travaForaDaProducao({
        ambiente: cred.environment,
        modo: "on",
        contato: { email: null, mobile: cel },
        permitidos: lerPermitidos(process.env[VARIAVEL_DOS_PERMITIDOS]),
      });
      if (!trava.contato.mobile) {
        return { ok: false, error: "Ambiente de teste: o celular do pagador só vai ao Asaas se estiver na lista de permitidos." };
      }
      await updateCustomer(cred, pagador.asaas_customer_id, { mobilePhone: cel, notificationDisabled: !pagador.avisos_ligados }, opts);
      celularEnviado = true;
      try {
        link = await refundBankSlip(cred, args.asaasPaymentId, opts);
      } catch (e) {
        // O pedido não saiu: com a régua desligada, o celular sai de novo do Asaas.
        if (!pagador.regua_da_unidade) {
          await updateCustomer(cred, pagador.asaas_customer_id, { mobilePhone: "", notificationDisabled: !pagador.avisos_ligados }, opts).catch(() => {});
        }
        throw e;
      }
      status = "AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION";
    } else {
      const p = await refundPayment(cred, args.asaasPaymentId, `Estorno pelo riSZon: ${args.reason}`, opts);
      const ultimo = (p?.refunds ?? []).at(-1);
      status = ultimo?.status ?? p?.status ?? null;
    }
    const { error } = await admin.rpc("_charge_refund_requested", {
      p_charge_id: args.chargeId,
      p_actor: args.actorId,
      p_reason: args.reason,
      p_kind: kind,
      p_asaas_status: status,
      p_request_url: link,
    });
    if (error) {
      console.error("charge refund record failed:", error.message);
      return { ok: false, error: "O Asaas recebeu o pedido, mas o riSZon não conseguiu gravar. Avise o Financeiro antes de pedir de novo." };
    }
    if (celularEnviado) await admin.rpc("_charge_refund_mobile_sent", { p_charge_id: args.chargeId, p_actor: args.actorId });
    return { ok: true, estado: kind === "boleto" ? "aguardando_pagador" : status === "DONE" ? "concluido" : "aguardando_autorizacao", link };
  } catch (e) {
    if (!(e instanceof AsaasError)) console.error("charge refund failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: mensagemDoAsaas(e) };
  }
}

/**
 * A rotina diária: cada pedido pendente consultado no Asaas (o Asaas não
 * avisa o cancelamento pelo webhook). Cancelado → volta a "Paga"; parado há
 * mais de 1 dia útil → aviso (uma vez).
 */
export async function conferirEstornos(): Promise<{ consultados: number; cancelados: number; parados: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_charge_refunds_open");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("charge refunds open failed:", error.message);
    return { consultados: 0, cancelados: 0, parados: 0 };
  }
  const r = { consultados: 0, cancelados: 0, parados: 0 };
  for (const p of (data ?? []) as { charge_id: string; account_id: string; asaas_payment_id: string; kind: string; late: boolean; late_notice_at: string | null }[]) {
    r.consultados++;
    try {
      const cred = await credencialDaConta(p.account_id, "estorno_consulta", null);
      const g = await getPayment(cred, p.asaas_payment_id, opcoesDaConta(p.account_id, "estorno_consulta"));
      const ultimo = (g?.refunds ?? []).at(-1);
      if (ultimo?.status === "CANCELLED") {
        await admin.rpc("_charge_refund_closed", { p_charge_id: p.charge_id, p_status: "cancelado", p_note: "cancelado no Asaas" });
        r.cancelados++;
        continue;
      }
      if (p.late && !p.late_notice_at) {
        await admin.rpc("_charge_refund_late", { p_charge_id: p.charge_id });
        r.parados++;
      }
    } catch (e) {
      console.error("charge refund check failed:", codigo(e));
    }
  }
  return r;
}

// ---- O SALDO DE QUEM RECEBE O SPLIT (18.7.4) ----------------------------------

export async function conferirSaldosDoSplit(hoje: string): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_split_balance_accounts");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("split balance accounts failed:", error.message);
    return 0;
  }
  let avisos = 0;
  for (const c of (data ?? []) as { account_id: string; label: string; min_balance_cents: number | null }[]) {
    try {
      const cred = await credencialDaConta(c.account_id, "balance_check", null);
      const saldo = await getBalance(cred, opcoesDaConta(c.account_id, "balance_check"));
      if (saldo == null) continue;
      const cents = Math.round(saldo * 100);
      await admin.rpc("_gateway_save_balance", { p_account_id: c.account_id, p_balance_cents: cents });
      const negativo = cents < 0;
      const abaixo = c.min_balance_cents != null && cents < Number(c.min_balance_cents);
      if (!negativo && !abaixo) continue;
      avisos++;
      await admin.rpc("_gateway_notify", {
        p_account_id: c.account_id,
        p_kind: negativo ? "saldo_negativo" : "saldo_abaixo_do_minimo",
        p_key: hoje,
        p_clinic_id: null,
        p_managers: false,
        p_finance: true,
        p_admins: true,
        p_title: negativo ? `Asaas: saldo NEGATIVO em ${c.label}` : `Asaas: saldo abaixo do mínimo em ${c.label}`,
        p_body: negativo
          ? "A conta que recebe o split ficou com saldo negativo (provavelmente um estorno devolveu o split). Cubra o saldo no Asaas."
          : "O saldo da conta que recebe o split está abaixo do mínimo definido na aba Taxas da franquia. Estornos devolvem o split dessa conta.",
        p_link: "/central/rede/taxas",
      });
    } catch (e) {
      console.error("split balance check failed:", codigo(e));
    }
  }
  return avisos;
}

// ---- O WEBHOOK QUE SE CORRIGE SOZINHO (18.7.5) ----------------------------------

/** Confere os avisos assinados de UMA conta e corrige pela API. */
export async function conferirWebhookDaConta(accountId: string): Promise<"ok" | "corrigido" | "falhou"> {
  const admin = createAdminClient();
  const { data: conta } = await admin.from("gateway_accounts").select("id, webhook_id").eq("id", accountId).single();
  if (!conta?.webhook_id) return "falhou";
  try {
    const cred = await credencialDaConta(accountId, "webhook_conferencia", null);
    const opts = opcoesDaConta(accountId, "webhook_conferencia");
    const w = await getWebhook(cred, conta.webhook_id, opts);
    const tem = new Set(w?.events ?? []);
    const falta = WEBHOOK_EVENTS.some((e) => !tem.has(e));
    if (!falta && w?.enabled !== false) {
      await admin.rpc("_gateway_webhook_events_mark", { p_account_id: accountId, p_ok: true, p_version: WEBHOOK_EVENTS_VERSION });
      return "ok";
    }
    await updateWebhookEvents(cred, conta.webhook_id, WEBHOOK_EVENTS, opts);
    const de_novo = await getWebhook(cred, conta.webhook_id, opts);
    const ok = WEBHOOK_EVENTS.every((e) => (de_novo?.events ?? []).includes(e));
    await admin.rpc("_gateway_webhook_events_mark", { p_account_id: accountId, p_ok: ok, p_version: WEBHOOK_EVENTS_VERSION });
    return ok ? "corrigido" : "falhou";
  } catch (e) {
    console.error("webhook events check failed:", codigo(e));
    await admin.rpc("_gateway_webhook_events_mark", { p_account_id: accountId, p_ok: false, p_version: WEBHOOK_EVENTS_VERSION });
    return "falhou";
  }
}

/** As contas com a lista desatualizada (versão nova) ou sem conferência há uma semana. */
export async function conferirWebhooks(): Promise<{ ok: number; corrigidos: number; falharam: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_gateway_webhook_accounts", { p_version: WEBHOOK_EVENTS_VERSION });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("webhook accounts failed:", error.message);
    return { ok: 0, corrigidos: 0, falharam: 0 };
  }
  const r = { ok: 0, corrigidos: 0, falharam: 0 };
  for (const c of (data ?? []) as { account_id: string }[]) {
    const x = await conferirWebhookDaConta(c.account_id);
    if (x === "ok") r.ok++;
    else if (x === "corrigido") r.corrigidos++;
    else r.falharam++;
  }
  return r;
}

/**
 * 18.7.7: o estorno de boleto terminou (concluído, negado, cancelado) com a
 * régua da unidade DESLIGADA: o celular enviado só para ele sai do Asaas (o
 * método da D6: `mobilePhone: ""`). Roda na rotina de 10 minutos.
 */
export async function limparCelularesDeEstorno(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_charge_refund_mobiles_to_clear");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("refund mobiles to clear failed:", error.message);
    return 0;
  }
  let n = 0;
  for (const r of (data ?? []) as { refund_id: string; account_id: string; asaas_customer_id: string }[]) {
    try {
      const cred = await credencialDaConta(r.account_id, "estorno_limpeza", null);
      await updateCustomer(cred, r.asaas_customer_id, { mobilePhone: "", notificationDisabled: true }, opcoesDaConta(r.account_id, "estorno_limpeza"));
      await admin.rpc("_charge_refund_mobile_cleared", { p_refund_id: r.refund_id });
      n++;
    } catch (e) {
      console.error("refund mobile clear failed:", codigo(e));
    }
  }
  return n;
}
