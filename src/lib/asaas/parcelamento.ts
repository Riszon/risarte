import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { credencialDaConta, opcoesDaConta } from "./account";
import {
  createCardInstallment,
  createCustomerWithoutNotices,
  deleteInstallment,
  findCustomerByReference,
  findPaymentsByReference,
  getChargeback,
  listInstallmentPayments,
  refundInstallment,
  REFERENCIA_DO_CADASTRO_DO_PARCELADO,
  updateInstallmentSplits,
  updatePaymentReference,
  type AsaasCredential,
  type AsaasPayment,
} from "./api";
import { AsaasError, mensagemDoAsaas, type AsaasRequestOptions } from "./client";
import { bancoDe, lerCobranca, type CobrancaDoBanco, type ResultadoDaEmissao } from "./cobranca";
import { comIdsDoAsaas, decidirSplit, mesmasEntradas, splitsParaOAsaas, type EntradaParaGravar, type PlanoDoSplit } from "./split";

/**
 * O CARTÃO PARCELADO PELO ASAAS (ASA4, entrega 2; 4013) — só no servidor.
 *
 * O banco já gravou as cobranças do bloco "emitindo" (uma por parcela, o mesmo
 * `installment_block`), com tudo conferido (`_card_block_insert`). Aqui:
 *   1. CONSULTA o Asaas: o parcelamento já gravado, ou achado pela referência do
 *      bloco ou da 1ª cobrança (tentativa anterior que criou sem saber);
 *   2. o CADASTRO SEM AVISOS do parcelamento (19.19.3/19.21: até o Asaas dizer
 *      como cobra a mensageria, nada sai do Asaas para o pagador; o link vai por
 *      quem fechou a venda);
 *   3. o split (Método B com a parte fixa rateada) e o teto;
 *   4. cria o parcelamento (`installmentCount` + `totalValue`), com a referência
 *      do bloco; tempo esgotado = consulta de novo, NUNCA repete o POST;
 *   5. confere cada parcela do Asaas com a do riSZon (valor e vencimento);
 *   6. troca a referência de cada parcela pela da SUA cobrança (provado no
 *      sandbox: o aviso, a baixa e o split continuam parcela a parcela);
 *   7. grava o split e a emissão de cada cobrança.
 * Uma falha no meio deixa o que já foi feito: "Tentar de novo" continua daqui.
 */

type CobrancaDoBloco = {
  id: string;
  status: string;
  gateway_account_id: string | null;
  value_cents: number;
  due_date: string;
  installment_number: number;
  installment_count: number;
  asaas_payment_id: string | null;
  asaas_installment_id: string | null;
};

const reais = (cents: number) => Math.round(Number(cents)) / 100;
const centavos = (r: number | null | undefined) => Math.round(Number(r ?? 0) * 100);

async function lerBloco(blockId: string): Promise<CobrancaDoBloco[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("charges")
    .select("id, status, gateway_account_id, value_cents, due_date, installment_number, installment_count, asaas_payment_id, asaas_installment_id")
    .eq("installment_block", blockId)
    .order("installment_number");
  if (error) throw new Error(`block read failed: ${error.message}`);
  return (data ?? []) as CobrancaDoBloco[];
}

async function marcarErroDoBloco(blockId: string, code: string) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("_card_block_mark_error", { p_block: blockId, p_error: code });
  if (error) console.error("block mark error failed:", error.message);
}

/** O cadastro SEM AVISOS do parcelamento: o já criado (pela referência) ou um novo. */
async function cadastroDoParcelamento(c: CobrancaDoBanco, blockId: string, cred: AsaasCredential, opts: AsaasRequestOptions): Promise<string> {
  const ref = REFERENCIA_DO_CADASTRO_DO_PARCELADO + blockId;
  const achado = await findCustomerByReference(cred, ref, opts);
  if (achado?.id) return achado.id;
  const novo = await createCustomerWithoutNotices(cred, { name: c.payer_name, cpfCnpj: c.payer_cpf, externalReference: ref }, opts);
  if (!novo?.id) throw new AsaasError({ code: "invalid_response", messagePt: "O Asaas não devolveu o pagador.", logMessage: "customer without id" });
  return novo.id;
}

/** O parcelamento que já existe no Asaas para este bloco (ou nulo). */
async function parcelamentoExistente(bloco: CobrancaDoBloco[], blockId: string, cred: AsaasCredential, opts: AsaasRequestOptions): Promise<string | null> {
  if (bloco[0].asaas_installment_id) return bloco[0].asaas_installment_id;
  const [porBloco] = await findPaymentsByReference(cred, blockId, opts);
  if (porBloco?.installment) return porBloco.installment;
  const [pelaPrimeira] = await findPaymentsByReference(cred, bloco[0].id, opts);
  return pelaPrimeira?.installment ?? null;
}

/** As parcelas do Asaas batem com as do riSZon (quantidade, valor e vencimento, na ordem)? */
export function parcelasBatem(bloco: { value_cents: number; due_date: string }[], parcelas: AsaasPayment[]): boolean {
  if (parcelas.length !== bloco.length) return false;
  return bloco.every((c, k) => centavos(parcelas[k].value) === Number(c.value_cents) && String(parcelas[k].dueDate ?? "").slice(0, 10) === c.due_date);
}

export async function emitirParcelamentoNoAsaas(blockId: string, actorId: string | null): Promise<ResultadoDaEmissao> {
  const bloco = await lerBloco(blockId);
  if (bloco.length < 2) return { ok: false, error: "Parcelamento não encontrado." };
  if (bloco.some((c) => c.status !== "emitindo" && c.status !== "emitida")) return { ok: false, error: "Este parcelamento não está esperando emissão." };
  if (bloco.every((c) => c.status === "emitida")) return { ok: true };
  const conta = bloco[0].gateway_account_id;
  if (!conta) return { ok: false, error: "A unidade não tem conta Asaas." };
  const c1 = await lerCobranca(bloco[0].id);
  if (!c1) return { ok: false, error: "Parcelamento não encontrado." };

  const purpose = "emitir_parcelamento";
  let cred: AsaasCredential;
  try {
    cred = await credencialDaConta(conta, purpose, actorId);
  } catch (e) {
    console.error("block credential failed:", e instanceof Error ? e.message : e);
    await marcarErroDoBloco(blockId, "credential");
    return { ok: false, error: "Não foi possível ler a chave da conta Asaas da unidade. Avise o Admin Master." };
  }
  const opts = opcoesDaConta(conta, purpose);
  const admin = createAdminClient();
  const n = bloco.length;
  const total = bloco.reduce((s, c) => s + Number(c.value_cents), 0);

  let instId: string | null = null;
  let parcelas: AsaasPayment[] = [];
  try {
    instId = await parcelamentoExistente(bloco, blockId, cred, opts);
    if (!instId) {
      const cliente = await cadastroDoParcelamento(c1, blockId, cred, opts);
      // O split da 1ª parcela vale para todas (a mesma faixa, a mesma parte fixa rateada).
      const plano = await bancoDe(bloco[0].id, cred, opts).planoDoSplit!();
      const decisao = decidirSplit(plano);
      if (!decisao.vai && decisao.recusar) {
        await marcarErroDoBloco(blockId, "split_teto");
        return { ok: false, error: "O parcelamento não foi emitido: as taxas da rede passariam do valor líquido no pior caso. Avise o Financeiro." };
      }
      try {
        const p = await createCardInstallment(
          cred,
          {
            customer: cliente,
            installmentCount: n,
            totalValue: reais(total),
            dueDate: bloco[0].due_date,
            description: `Parcelamento em ${n}x no cartão — ${c1.description.replace(/^Parcela \d+ — /, "")}`,
            externalReference: blockId,
            ...(decisao.vai ? { splits: splitsParaOAsaas(decisao.entradas) } : {}),
          },
          opts
        );
        instId = p.installment ?? null;
      } catch (e) {
        if (e instanceof AsaasError && e.code === "unknown_outcome") {
          const [p] = await findPaymentsByReference(cred, blockId, opts).catch(() => [] as AsaasPayment[]);
          if (!p?.installment) throw e;
          instId = p.installment;
        } else {
          throw e;
        }
      }
      if (!instId) throw new AsaasError({ code: "invalid_response", messagePt: "O Asaas não devolveu o parcelamento.", logMessage: "installment without id" });
    }
    const { error: e1 } = await admin.rpc("_card_block_save_installment", { p_block: blockId, p_asaas_installment_id: instId });
    if (e1) throw new Error(`installment save failed: ${e1.message}`);
    parcelas = await listInstallmentPayments(cred, instId, opts);
  } catch (e) {
    const code = e instanceof AsaasError ? e.code : "unexpected";
    if (!(e instanceof AsaasError)) console.error("block emit failed:", e instanceof Error ? e.message : e);
    await marcarErroDoBloco(blockId, code);
    return { ok: false, error: mensagemDoAsaas(e) };
  }

  if (!parcelasBatem(bloco, parcelas)) {
    await marcarErroDoBloco(blockId, "parcelamento_divergente");
    return { ok: false, error: "O parcelamento criado no Asaas não bate com as parcelas do riSZon (valor ou vencimento). Avise o Financeiro antes de tentar de novo." };
  }

  for (let k = 0; k < n; k++) {
    const c = bloco[k];
    const p = parcelas[k];
    if (c.status === "emitida") continue;
    try {
      if (p.externalReference !== c.id) await updatePaymentReference(cred, p.id!, c.id, opts);
      const banco = bancoDe(c.id, cred, opts);
      if (p.split?.length) {
        const decisao = decidirSplit(await banco.planoDoSplit!());
        if (decisao.vai) await banco.gravarSplit!(comIdsDoAsaas(decisao.entradas, p.split));
      } else {
        await banco.semSplit?.("sem_split_no_asaas");
      }
      const erro = await banco.gravarEmissao({
        asaasPaymentId: p.id!,
        gatewayCustomerId: null,
        invoiceUrl: p.invoiceUrl ?? null,
        bankSlipUrl: null,
        pixCopyPaste: null,
        identificationField: null,
      });
      if (erro) throw new Error(erro);
    } catch (e) {
      console.error("block parcel save failed:", e instanceof Error ? e.message : e);
      return { ok: false, error: "O parcelamento foi criado no Asaas, mas nem todas as parcelas foram gravadas no riSZon. Use “Tentar de novo”: nada será duplicado." };
    }
  }
  return { ok: true };
}

export type ResultadoDoBloco = { ok: true } | { ok: false; error: string };

/**
 * Cancela o parcelamento NÃO pago, inteiro (`DELETE /installments/{id}`). Quem
 * pode já foi conferido pela porta `card_block_cancel_check` (com a sessão).
 */
export async function cancelarParcelamentoNoAsaas(args: {
  blockId: string;
  accountId: string | null;
  asaasInstallmentId: string | null;
  chargeIds: string[];
  actorId: string;
  reason: string;
}): Promise<ResultadoDoBloco> {
  const admin = createAdminClient();
  try {
    if (args.asaasInstallmentId && args.accountId) {
      const purpose = "cancelar_parcelamento";
      const cred = await credencialDaConta(args.accountId, purpose, args.actorId);
      await deleteInstallment(cred, args.asaasInstallmentId, opcoesDaConta(args.accountId, purpose));
    }
  } catch (e) {
    if (!(e instanceof AsaasError)) console.error("block cancel failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: mensagemDoAsaas(e) };
  }
  for (const id of args.chargeIds) {
    const { error } = await admin.rpc("_charge_mark_cancelled", { p_charge_id: id, p_actor: args.actorId, p_reason: args.reason });
    if (error && !/CHARGE_NOT_CANCELLABLE/.test(error.message)) {
      console.error("block mark cancelled failed:", error.message);
      return { ok: false, error: "O parcelamento foi cancelado no Asaas, mas o riSZon não gravou todas as parcelas. Avise o Financeiro." };
    }
  }
  return { ok: true };
}

/**
 * Estorna o parcelamento INTEIRO (`POST /installments/{id}/refund`). Quem pode
 * e o que a unidade perde já foram mostrados e conferidos (`card_block_refund_*`).
 * A baixa de cada parcela é desfeita pelo aviso `PAYMENT_REFUNDED` de cada uma
 * (como hoje); a taxa da rede continua devida (D13; dispensa só à mão).
 */
export async function estornarParcelamentoNoAsaas(args: {
  accountId: string;
  asaasInstallmentId: string;
  chargeIds: string[];
  actorId: string;
  reason: string;
}): Promise<ResultadoDoBloco> {
  const admin = createAdminClient();
  let status: string | null = null;
  try {
    const purpose = "estornar_parcelamento";
    const cred = await credencialDaConta(args.accountId, purpose, args.actorId);
    const r = await refundInstallment(cred, args.asaasInstallmentId, opcoesDaConta(args.accountId, purpose));
    status = (r?.refunds ?? []).at(-1)?.status ?? r?.status ?? null;
  } catch (e) {
    if (!(e instanceof AsaasError)) console.error("block refund failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: mensagemDoAsaas(e) };
  }
  for (const id of args.chargeIds) {
    const { error } = await admin.rpc("_charge_refund_requested", {
      p_charge_id: id,
      p_actor: args.actorId,
      p_reason: args.reason,
      p_kind: "cartao",
      p_asaas_status: status,
      p_request_url: null,
    });
    if (error) {
      console.error("block refund record failed:", error.message);
      return { ok: false, error: "O Asaas recebeu o estorno, mas o riSZon não gravou todas as parcelas. Avise o Financeiro antes de pedir de novo." };
    }
  }
  return { ok: true };
}

/**
 * ASA4 (4014, 19.20 3a): O SPLIT NA APROVAÇÃO. O Asaas cobra a tarifa do
 * parcelamento inteiro no dia da aprovação. Para cada parcelamento aprovado e
 * ainda não conferido, refaz o split pela tarifa vigente NESSE dia; se for
 * diferente do enviado, troca o split do parcelamento inteiro
 * (`PUT /installments/{id}/splits`) e grava a nova entrada em cada parcela.
 * Parcela já com split liquidado (ou antecipada) fica de fora: o Asaas não muda.
 */
export async function conferirSplitDosParcelamentos(limite = 30): Promise<{ conferidos: number; trocados: number; falharam: number }> {
  const admin = createAdminClient();
  const out = { conferidos: 0, trocados: 0, falharam: 0 };
  const { data, error } = await admin.rpc("_card_blocks_split_to_check", { p_limit: limite });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("block split list failed:", error.message);
    return out;
  }
  for (const b of (data ?? []) as { installment_block: string; account_id: string; asaas_installment_id: string; paid_on: string; charge_ids: string[] }[]) {
    try {
      const purpose = "split_do_parcelamento";
      const cred = await credencialDaConta(b.account_id, purpose, null);
      const opts = opcoesDaConta(b.account_id, purpose);
      const planos: { id: string; plano: PlanoDoSplit; gravado: EntradaParaGravar[] }[] = [];
      for (const id of b.charge_ids) {
        const { data: plano } = await admin.rpc("_charge_split_plan", { p_charge_id: id });
        const { data: gravado } = await admin
          .from("charge_splits")
          .select("walletId:wallet_id, percent, percentualValue:percentual_value, fixedCents:fixed_cents, accountId:destination_account_id, fees, tariffPercent:tariff_percent, tariffFixedCents:tariff_fixed_cents, asaasSplitId:asaas_split_id")
          .eq("charge_id", id);
        // A janela da tarifa é SÓ o dia da aprovação.
        const p = plano as PlanoDoSplit;
        planos.push({
          id,
          plano: p.elegivel ? { ...p, hoje: b.paid_on, vencimento: b.paid_on } : p,
          gravado: ((gravado ?? []) as Record<string, unknown>[]).map((g) => ({
            ...g,
            percent: Number(g.percent),
            percentualValue: Number(g.percentualValue),
            fixedCents: Number(g.fixedCents),
          })) as unknown as EntradaParaGravar[],
        });
      }
      const d0 = decidirSplit(planos[0].plano);
      if (!d0.vai) {
        await admin.rpc("_card_block_split_checked", { p_block: b.installment_block });
        out.conferidos += 1;
        continue;
      }
      const iguais = planos.every((x) => {
        const d = decidirSplit(x.plano);
        return d.vai && mesmasEntradas(d.entradas, x.gravado);
      });
      if (!iguais) {
        await updateInstallmentSplits(cred, b.asaas_installment_id, splitsParaOAsaas(d0.entradas), opts);
        const parcelas = await listInstallmentPayments(cred, b.asaas_installment_id, opts);
        for (const x of planos) {
          const d = decidirSplit(x.plano);
          if (!d.vai) continue;
          const p = parcelas.find((q) => q.externalReference === x.id);
          const { error: e } = await admin.rpc("_charge_save_split", { p_charge_id: x.id, p_entries: comIdsDoAsaas(d.entradas, p?.split ?? null) });
          if (e) throw new Error(`split save failed: ${e.message}`);
        }
        out.trocados += 1;
      }
      await admin.rpc("_card_block_split_checked", { p_block: b.installment_block });
      out.conferidos += 1;
    } catch (e) {
      out.falharam += 1;
      console.error("block split check failed:", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/**
 * ASA4 (4014, ajuste E): o PRAZO DA CONTESTAÇÃO. Para cada cobrança "em
 * contestação" sem prazo conhecido, lê no Asaas (`GET /payments/{id}/chargeback`)
 * o prazo para mandar os documentos e grava. Os avisos saem pelo banco
 * (`chargeback_alerts_run`): quando chega e 2 dias úteis antes do prazo.
 */
export async function conferirContestacoes(limite = 30): Promise<{ lidas: number; falharam: number }> {
  const admin = createAdminClient();
  const out = { lidas: 0, falharam: 0 };
  const { data, error } = await admin.rpc("_chargebacks_to_check", { p_limit: limite });
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message)) console.error("chargeback list failed:", error.message);
    return out;
  }
  for (const c of (data ?? []) as { charge_id: string; account_id: string; asaas_payment_id: string }[]) {
    try {
      const purpose = "prazo_da_contestacao";
      const cred = await credencialDaConta(c.account_id, purpose, null);
      const cb = await getChargeback(cred, c.asaas_payment_id, opcoesDaConta(c.account_id, purpose));
      await admin.rpc("_chargeback_save", {
        p_charge_id: c.charge_id,
        p_deadline: cb?.deadlineToSendDisputeDocuments ? String(cb.deadlineToSendDisputeDocuments).slice(0, 10) : null,
        p_status: cb?.status ?? null,
      });
      out.lidas += 1;
    } catch (e) {
      out.falharam += 1;
      // Lida, mesmo sem prazo: tenta de novo em 6 horas.
      await admin.rpc("_chargeback_save", { p_charge_id: c.charge_id, p_deadline: null, p_status: null });
      console.error("chargeback read failed:", e instanceof Error ? e.message : e);
    }
  }
  return out;
}
