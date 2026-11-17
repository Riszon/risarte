/**
 * 4020a (spec 19.38) — as regras puras do estorno parcial: o saldo e a
 * repartição real lida do Asaas. Sem banco e sem Asaas (testadas à parte).
 */
import type { AsaasRefund } from "./api";

export type ParcelaLida = { chargeId: string; asaasPaymentId: string; valorCents: number; refunds: AsaasRefund[] };
export type EstornoGravado = { charge_id: string; amount_cents: number; inteira: boolean; asaas_status: string; receipt_url?: string | null };

const MENSAGEM_DA_UNIDADE =
  "O estorno pelo Asaas está temporariamente indisponível. O Financeiro da Franqueadora já foi avisado. Enquanto isso, você pode esperar o aviso de que o estorno voltou a ficar disponível, ou combinar com o Financeiro a devolução por Pix da conta da unidade.";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O saldo (19.37, item 1): o PARCIAL sai todo da conta da unidade; o TOTAL
 * devolve o split da franqueadora (a parte dela precisa estar no saldo dela).
 * Saldo não lido = não bloqueia (o Asaas recusa, e a recusa é tratada).
 */
export function decidirSaldo(a: {
  parcial: boolean;
  valorCents: number;
  saldoUnidadeReais: number | null;
  parteDaRedeCents: number;
  saldoRedeReais: number | null;
}): { ok: true } | { ok: false; mensagemDaUnidade: string; detalhe: string } {
  if (a.parcial && a.saldoUnidadeReais != null && Math.round(a.saldoUnidadeReais * 100) < a.valorCents) {
    return {
      ok: false,
      mensagemDaUnidade: "A conta Asaas da unidade não tem saldo para este estorno. Use a devolução por Pix da conta da unidade, ou espere o saldo.",
      detalhe: `A conta da unidade tem ${brl(Math.round(a.saldoUnidadeReais * 100))} e o estorno é de ${brl(a.valorCents)}.`,
    };
  }
  if (!a.parcial && a.parteDaRedeCents > 0 && a.saldoRedeReais != null && Math.round(a.saldoRedeReais * 100) < a.parteDaRedeCents) {
    return {
      ok: false,
      mensagemDaUnidade: MENSAGEM_DA_UNIDADE,
      detalhe: `A conta da franqueadora tem ${brl(Math.round(a.saldoRedeReais * 100))} e a parte dela nesta cobrança é ${brl(a.parteDaRedeCents)}.`,
    };
  }
  return { ok: true };
}

/**
 * A repartição REAL (cuidado 2): de cada parcela lida, o estorno novo (o último
 * da lista); inteira quando o estornado é o valor da parcela. Sem a leitura, usa
 * a resposta do pedido.
 */
export function repartirPeloAsaas(a: {
  parcial: boolean;
  valorCents: number | null;
  lidas: ParcelaLida[];
  respostaDoPedido: AsaasRefund[];
}): EstornoGravado[] {
  const out: EstornoGravado[] = [];
  const temResposta = a.respostaDoPedido.length > 0;
  for (const l of a.lidas) {
    // Com a resposta do pedido, só as parcelas que ela traz (as outras não foram tocadas).
    const daResposta = a.respostaDoPedido.filter((r) => !r.paymentId || r.paymentId === l.asaasPaymentId);
    const ultimo = temResposta ? daResposta.at(-1) : l.refunds.at(-1);
    if (!ultimo) continue;
    const valor = Math.round(Number(ultimo.value ?? 0) * 100);
    out.push({
      charge_id: l.chargeId,
      amount_cents: valor,
      inteira: !a.parcial || (l.valorCents > 0 && valor >= l.valorCents),
      asaas_status: String(ultimo.status ?? "PENDING"),
      receipt_url: ultimo.transactionReceiptUrl ?? null,
    });
  }
  return out;
}

/**
 * A recusa do Asaas em palavras de quem pediu. No cartão, o estorno PARCIAL só
 * é aceito a partir do dia seguinte à aprovação (prova de 17/11/2026).
 */
export function explicarRecusaDoEstorno(mensagem: string): string {
  if (/estornada parcialmente no pr[oó]ximo dia/i.test(mensagem)) {
    return "No cartão, o Asaas só aceita estorno de parte a partir do dia seguinte à aprovação. Nada foi estornado: peça de novo amanhã (ou estorne o total hoje).";
  }
  return mensagem;
}
