import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import { deletePayment, getPayment } from "./api";
import { AsaasError, mensagemDoAsaas } from "./client";

/**
 * BOLETO QUE DEIXA DE VALER (ASA4, 1B; 4015; spec 19.26.1 e 19.27).
 *
 * A trava da 4004 recusa mudar, cancelar, renegociar ou dar baixa à mão numa
 * parcela com cobrança viva no Asaas. Aqui a OPERAÇÃO cancela os boletos sozinha,
 * sem ampliar quem pode fazê-la:
 *   1. tenta a operação como sempre. A permissão é conferida DENTRO dela, antes
 *      da trava: só um erro da trava (`CHARGE_ACTIVE`/`CHARGE_IN_GATEWAY`) chega
 *      aqui depois de a pessoa já ter passado na permissão;
 *   2. sem a confirmação da tela, devolve quantos boletos já entregues serão
 *      cancelados ("esta operação cancela N boletos já entregues ao cliente");
 *   3. confirmada: cancela no Asaas (primeiro o Asaas, depois o riSZon), como
 *      "cancelamento do sistema" (não conta como à mão), e repete a operação;
 *   4. se o boleto já foi pago no Asaas, para e não muda nada;
 *   5. se a operação falhar DEPOIS de cancelar, a parcela não fica sem boleto em
 *      silêncio: vira pendência, com aviso a quem fez e ao Gerente
 *      (`_boleto_op_failure_record`), e a rotina/botão reemite.
 */

export type ResultadoDaOperacao<T> =
  | { ok: true; data: T | null; cancelados: number }
  | { ok: false; error: string; precisaConfirmar?: number; codigo?: string };

type ErroDoBanco = { message: string } | null;

const TRAVA = /CHARGE_ACTIVE|CHARGE_IN_GATEWAY/;
const PAGA_NO_ASAAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const VIVAS = ["emitindo", "emitida", "vencida", "erro_emissao"];

export function textoDaConfirmacao(n: number): string {
  return n === 1
    ? "Esta operação cancela 1 boleto já entregue ao cliente. Ele deixa de valer, e a lista de boletos mostra a situação nova. Confirmar?"
    : `Esta operação cancela ${n} boletos já entregues ao cliente. Eles deixam de valer, e a lista de boletos mostra a situação nova. Confirmar?`;
}

async function boletosVivos(installmentIds: string[]) {
  if (!installmentIds.length) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("charges")
    .select("id, gateway_account_id, asaas_payment_id, installment_block, clinic_id, client_id")
    .in("payment_installment_id", installmentIds)
    .eq("is_external", false)
    .in("status", VIVAS);
  return (data ?? []) as { id: string; gateway_account_id: string | null; asaas_payment_id: string | null; installment_block: string | null; clinic_id: string; client_id: string }[];
}

/** Cancela no Asaas e, só se o Asaas confirmar, grava como cancelamento do sistema. */
async function cancelarDoSistema(c: { id: string; gateway_account_id: string | null; asaas_payment_id: string | null }, actorId: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string; paga?: boolean }> {
  const admin = createAdminClient();
  try {
    if (c.asaas_payment_id && c.gateway_account_id) {
      const purpose = "cancelar_na_operacao";
      const cred = await credencialDaConta(c.gateway_account_id, purpose, actorId);
      const opts = opcoesDaConta(c.gateway_account_id, purpose);
      const p = await getPayment(cred, c.asaas_payment_id, opts).catch(() => null);
      if (p?.status && PAGA_NO_ASAAS.has(p.status)) return { ok: false, paga: true, error: "Um dos boletos já foi pago no Asaas: nada foi mudado. A baixa vem pelo aviso do Asaas." };
      if (!p?.deleted) await deletePayment(cred, c.asaas_payment_id, opts);
    }
  } catch (e) {
    if (!(e instanceof AsaasError)) console.error("system cancel failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: mensagemDoAsaas(e) };
  }
  const { error } = await admin.rpc("_charge_mark_cancelled_system", { p_charge_id: c.id, p_actor: actorId, p_reason: motivo });
  if (error && !/CHARGE_NOT_CANCELLABLE/.test(error.message)) return { ok: false, error: "O boleto foi cancelado no Asaas, mas o riSZon não gravou. Avise o Financeiro." };
  return { ok: true };
}

export async function comBoletosCancelados<T>(args: {
  /** Nome da operação, em português, para a pendência e o aviso ("renegociação"). */
  operacao: string;
  /** O motivo gravado em cada boleto cancelado. */
  motivo: string;
  installmentIds: string[];
  actorId: string;
  confirmar: boolean;
  venda?: { negotiationId?: string | null; directSaleId?: string | null };
  tentar: () => Promise<{ error: ErroDoBanco; data?: T | null }>;
}): Promise<ResultadoDaOperacao<T>> {
  const primeira = await args.tentar();
  if (!primeira.error) return { ok: true, data: primeira.data ?? null, cancelados: 0 };
  if (!TRAVA.test(primeira.error.message)) return { ok: false, error: primeira.error.message, codigo: "banco" };

  const vivos = await boletosVivos(args.installmentIds);
  if (!vivos.length) return { ok: false, error: primeira.error.message, codigo: "banco" };
  if (vivos.some((v) => v.installment_block)) {
    return { ok: false, error: "Uma das parcelas faz parte do cartão parcelado pelo Asaas: cancele ou estorne o parcelamento inteiro antes, nas Cobranças da venda." };
  }
  if (!args.confirmar) return { ok: false, error: textoDaConfirmacao(vivos.length), precisaConfirmar: vivos.length };

  const cancelados: string[] = [];
  for (const v of vivos) {
    const r = await cancelarDoSistema(v, args.actorId, args.motivo);
    if (!r.ok) {
      if (cancelados.length) await registrarFalha(args, vivos[0], cancelados, r.error);
      return { ok: false, error: r.error };
    }
    cancelados.push(v.id);
  }
  const segunda = await args.tentar();
  if (segunda.error) {
    await registrarFalha(args, vivos[0], cancelados, segunda.error.message);
    return {
      ok: false,
      error: `Os ${cancelados.length} boleto(s) foram cancelados no Asaas, mas a ${args.operacao} não entrou no riSZon. A parcela está sem boleto: a pendência ficou em Financeiro › Cobranças automáticas, com o botão para reemitir. (${segunda.error.message.slice(0, 120)})`,
    };
  }
  return { ok: true, data: segunda.data ?? null, cancelados: cancelados.length };
}

async function registrarFalha<T>(
  args: Parameters<typeof comBoletosCancelados<T>>[0],
  um: { clinic_id: string; client_id: string },
  cancelados: string[],
  erro: string
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("_boleto_op_failure_record", {
    p: {
      clinic_id: um.clinic_id,
      client_id: um.client_id,
      negotiation_id: args.venda?.negotiationId ?? null,
      direct_sale_id: args.venda?.directSaleId ?? null,
      operation: args.operacao,
      installment_ids: args.installmentIds,
      cancelled_charge_ids: cancelados,
      error: erro.slice(0, 500),
      actor_id: args.actorId,
    },
  });
  if (error) console.error("boleto op failure record failed:", error.message);
}

/**
 * Cancela no Asaas, como cancelamento do sistema, os boletos indicados (a troca
 * da forma 2 para a 1: os que vencem fora do prazo). Para no primeiro que já foi
 * pago lá. Devolve quantos cancelou.
 */
export async function cancelarBoletosDoSistema(chargeIds: string[], actorId: string, motivo: string): Promise<{ ok: true; cancelados: number } | { ok: false; error: string; cancelados: number }> {
  if (!chargeIds.length) return { ok: true, cancelados: 0 };
  const admin = createAdminClient();
  const { data } = await admin.from("charges").select("id, gateway_account_id, asaas_payment_id").in("id", chargeIds).in("status", VIVAS);
  let n = 0;
  for (const c of (data ?? []) as { id: string; gateway_account_id: string | null; asaas_payment_id: string | null }[]) {
    const r = await cancelarDoSistema(c, actorId, motivo);
    if (!r.ok) return { ok: false, error: r.error, cancelados: n };
    n++;
  }
  return { ok: true, cancelados: n };
}
