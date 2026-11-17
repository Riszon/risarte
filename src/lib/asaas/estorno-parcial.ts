import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import { getBalance, getPayment, refundInstallment, refundInstallmentValue, refundPayment, refundPaymentValue, type AsaasRefund } from "./api";
import { AsaasError, mensagemDoAsaas } from "./client";
import { decidirSaldo, explicarRecusaDoEstorno, repartirPeloAsaas, type ParcelaLida } from "./estorno-parcial-regras";

/**
 * 4020a (spec 19.38) — O PEDIDO DE ESTORNO VAI AO ASAAS. Só no servidor.
 *
 * O banco já conferiu quem pode, o valor e a confirmação (`refund_request_create`
 * e `refund_request_confirm`) e deixou o pedido "enviar". Aqui:
 *   1. o SALDO (19.37, item 1): o parcial sai todo da conta da unidade; o total
 *      devolve também o split da franqueadora. Sem saldo, o pedido não sai, e a
 *      unidade vê só "temporariamente indisponível" (19.37.5);
 *   2. o pedido ao Asaas, com o valor (o parcial) ou sem (o total);
 *   3. a repartição REAL, lida da API, gravada contra a prevista (cuidado 2).
 * O riSZon NUNCA pede, recebe nem guarda o código de autorização.
 */

type Envio = {
  id: string;
  kind: "pix" | "cartao";
  account_id: string;
  asaas_payment_id: string | null;
  asaas_installment_id: string | null;
  block: string | null;
  charge_id: string | null;
  amount_cents: number | null;
  partial: boolean;
  reason: string;
  requested_by: string;
  hq_part_cents: number;
  hq_account_id: string | null;
  min_balance_cents: number | null;
  charges: { charge_id: string; numero: number | null; asaas_payment_id: string | null }[];
};

const reais = (c: number) => Math.round(c) / 100;

export async function enviarPedidoDeEstorno(requestId: string, actorId: string | null): Promise<{ ok: true; estado: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("_refund_request_for_send", { p_id: requestId });
  if (error) {
    console.error("refund request read failed:", error.message);
    return { ok: false, error: "Não foi possível ler o pedido de estorno." };
  }
  const e = data as Envio | null;
  if (!e) return { ok: false, error: "Este pedido não está pronto para ir ao Asaas." };
  const gravar = (p: Record<string, unknown>) => admin.rpc("_refund_request_sent", { p_id: e.id, p });
  const purpose = "estorno_parcial";
  try {
    const cred = await credencialDaConta(e.account_id, purpose, actorId);
    const opts = opcoesDaConta(e.account_id, purpose);

    // 1) O saldo.
    let saldoUnidade: number | null = null;
    let saldoRede: number | null = null;
    if (e.partial) saldoUnidade = await getBalance(cred, opts);
    else if (e.hq_part_cents > 0 && e.hq_account_id) {
      const credHq = await credencialDaConta(e.hq_account_id, "estorno_saldo", actorId);
      saldoRede = await getBalance(credHq, opcoesDaConta(e.hq_account_id, "estorno_saldo"));
    }
    const saldo = decidirSaldo({ parcial: e.partial, valorCents: e.amount_cents ?? 0, saldoUnidadeReais: saldoUnidade, parteDaRedeCents: e.hq_part_cents, saldoRedeReais: saldoRede });
    if (!saldo.ok) {
      await gravar({ result: "sem_saldo", detalhe: saldo.detalhe });
      return { ok: false, error: saldo.mensagemDaUnidade };
    }

    // 2) O pedido.
    const descricao = `Estorno pelo riSZon: ${e.reason}`;
    let refunds: AsaasRefund[] = [];
    if (e.block && e.asaas_installment_id) {
      const r = e.amount_cents
        ? await refundInstallmentValue(cred, e.asaas_installment_id, reais(e.amount_cents), descricao, opts)
        : await refundInstallment(cred, e.asaas_installment_id, opts);
      refunds = r?.refunds ?? [];
    } else if (e.asaas_payment_id) {
      const r = e.amount_cents
        ? await refundPaymentValue(cred, e.asaas_payment_id, reais(e.amount_cents), descricao, opts)
        : await refundPayment(cred, e.asaas_payment_id, descricao, opts);
      const ultimo = (r?.refunds ?? []).at(-1);
      refunds = ultimo ? [{ ...ultimo, paymentId: e.asaas_payment_id }] : [];
    }

    // 3) A repartição real (lida de cada parcela, se a resposta não trouxer).
    let lidas: ParcelaLida[] = [];
    if (e.block) {
      for (const p of e.charges) {
        if (!p.asaas_payment_id) continue;
        const g = await getPayment(cred, p.asaas_payment_id, opts);
        lidas.push({ chargeId: p.charge_id, asaasPaymentId: p.asaas_payment_id, valorCents: Math.round(Number(g?.value ?? 0) * 100), refunds: (g as { refunds?: AsaasRefund[] } | null)?.refunds ?? [] });
      }
    } else if (e.charge_id && e.asaas_payment_id) {
      lidas = [{ chargeId: e.charge_id, asaasPaymentId: e.asaas_payment_id, valorCents: 0, refunds }];
    }
    const reparticao = repartirPeloAsaas({ parcial: Boolean(e.amount_cents), valorCents: e.amount_cents, lidas, respostaDoPedido: refunds });
    const { error: eg } = await gravar({ result: "ok", refunds: reparticao });
    if (eg) {
      console.error("refund request record failed:", eg.message);
      return { ok: false, error: "O Asaas recebeu o estorno, mas o riSZon não gravou. Avise o Financeiro antes de pedir de novo." };
    }
    const pendente = reparticao.some((x) => x.asaas_status !== "DONE");
    return { ok: true, estado: !pendente ? "concluido" : e.kind === "pix" ? "aguardando_autorizacao" : "em_processamento" };
  } catch (err) {
    if (!(err instanceof AsaasError)) console.error("refund request failed:", err instanceof Error ? err.message : err);
    const motivo = explicarRecusaDoEstorno(mensagemDoAsaas(err));
    await gravar({ result: "falhou", error: motivo });
    return { ok: false, error: motivo };
  }
}

/**
 * A rotina do dia (19.37, item 3): a régua dos pedidos pendentes e os pedidos
 * parados por falta de saldo que já podem sair.
 */
export async function conferirReguaDosEstornos(): Promise<{ lembretes: number; caidos: number; liberados: number }> {
  const admin = createAdminClient();
  const r = { lembretes: 0, caidos: 0, liberados: 0 };
  const { data, error } = await admin.rpc("_refund_regua_list");
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("refund regua list failed:", error.message);
    return r;
  }
  for (const p of (data ?? []) as { refund_id: string; kind: string; dias: number; dias_uteis: number; reminders: number; processing_notice_at: string | null }[]) {
    if (p.kind === "cartao") {
      if (p.dias_uteis > 5 && !p.processing_notice_at) {
        await admin.rpc("_refund_regua_notice", { p_refund_id: p.refund_id, p_kind: "processamento" });
        r.lembretes++;
      }
      continue;
    }
    if (p.dias >= 30) {
      await admin.rpc("_refund_fell", { p_refund_id: p.refund_id, p_status: "caiu" });
      r.caidos++;
    } else if (p.dias >= 25 && p.reminders < Math.floor(25 / 7) + 1) {
      await admin.rpc("_refund_regua_notice", { p_refund_id: p.refund_id, p_kind: "dia25" });
      r.lembretes++;
    } else if (p.dias >= 7 * (p.reminders + 1)) {
      await admin.rpc("_refund_regua_notice", { p_refund_id: p.refund_id, p_kind: "semana" });
      r.lembretes++;
    }
  }
  const { data: parados } = await admin.rpc("_refund_requests_blocked");
  for (const b of (parados ?? []) as { request_id: string; kind: string; account_id: string; hq_account_id: string | null; needed_cents: number }[]) {
    try {
      const conta = b.needed_cents > 0 ? b.account_id : b.hq_account_id;
      if (!conta) continue;
      const cred = await credencialDaConta(conta, "estorno_saldo", null);
      const saldo = await getBalance(cred, opcoesDaConta(conta, "estorno_saldo"));
      if (saldo != null && saldo * 100 >= Math.max(b.needed_cents, 1)) {
        await admin.rpc("_refund_request_balance_back", { p_id: b.request_id });
        r.liberados++;
      }
    } catch {
      // a conta não respondeu: tenta amanhã
    }
  }
  return r;
}
