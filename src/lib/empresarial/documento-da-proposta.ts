// Risarte Empresarial — O TEXTO DA PROPOSTA COMERCIAL (OC-00083, Bloco F).
//
// A conta já existia e é de `proposta.ts` (`simularProposta`, pura e testada).
// O que faltava era o DOCUMENTO: até aqui o sistema calculava os números na
// tela e o consultor montava a proposta por fora — cada um do seu jeito, com
// os valores redigitados à mão. Aqui moram as frases que o documento diz,
// puras, para poderem ser lidas em teste em vez de conferidas de olho.
//
// ⚠️ NADA DE DADO INTERNO ENTRA AQUI. O levantamento guarda a leitura do
// consultor (interesse, chance de fechar) e as observações dele; isso é nota
// de trabalho, não argumento de venda, e imprimir seria entregar à empresa o
// que se pensa dela. O documento só repete o que foi combinado com ela.

import { addDaysIso, formatBrDate, startOfDayInBrazil } from "@/lib/dates";
import { PAYMENT_MODEL_LABELS, type PaymentModel } from "./constants";
import type { BillingBasis, PropostaResult, SubsidyType } from "./proposta";

/**
 * POR QUANTOS DIAS A PROPOSTA VALE.
 *
 * Quinze dias é o padrão que o sistema imprime hoje, e está aqui em um lugar
 * só justamente porque é um número de negócio: quando virar configuração da
 * rede (Bloco G, que já leva migração), é esta constante que some — e não
 * quinze pedaços de texto espalhados pelo documento.
 */
export const VALIDADE_PADRAO_DIAS = 15;

/** A data até quando a proposta vale, no relógio de parede brasileiro. */
export function validadeDaProposta(
  emitidaEm: string,
  dias: number = VALIDADE_PADRAO_DIAS
): { iso: string; texto: string } {
  const iso = addDaysIso(emitidaEm, dias);
  return { iso, texto: formatBrDate(startOfDayInBrazil(iso)) };
}

/**
 * QUEM PAGA O QUÊ, em uma frase que a empresa entende.
 *
 * O rótulo interno ("Empresa paga parcial") não serve num documento que vai
 * para o cliente: ele não diz quanto. A frase diz.
 */
export function quemPagaOQue(
  model: PaymentModel,
  subsidyType: SubsidyType | null,
  subsidyValue: number | null
): string {
  if (model === "COMPANY_PAYS") {
    return "A empresa custeia integralmente a mensalidade. O titular não paga nada.";
  }
  if (model === "EMPLOYEE_PAYS") {
    return "Cada titular custeia a própria mensalidade, com desconto em folha ou cobrança direta, conforme combinado.";
  }
  // Parcial: a parte da empresa é o que importa, e ela vem da conta — não do
  // percentual digitado, que pode ter sido limitado ao total da mensalidade.
  const como =
    subsidyType === "PERCENT" && subsidyValue
      ? ` (${subsidyValue}% da mensalidade)`
      : "";
  return `A empresa custeia parte da mensalidade${como}; o restante fica com o titular.`;
}

/** Como a cobrança chega: uma fatura só ou uma por CNPJ. */
export function comoSeraCobrado(
  billingModel: "unico" | "por_cnpj" | null,
  basis: BillingBasis
): string {
  const base =
    basis === "FIXED_PER_COMPANY"
      ? "Valor fixo mensal por empresa, independente do número de vidas."
      : "Valor por vida ativa no mês.";
  const fatura =
    billingModel === "por_cnpj"
      ? " A cobrança é emitida separadamente para cada CNPJ do grupo."
      : billingModel === "unico"
        ? " A cobrança é emitida em uma fatura única."
        : "";
  return base + fatura;
}

/**
 * O QUE DIZER SOBRE O CONVÊNIO ATUAL — inclusive quando a notícia é ruim.
 *
 * Economia negativa aparece, e com o argumento certo ao lado. Esconder faria a
 * proposta provar apenas o que ela quer provar, e o consultor seria
 * desmentido pela primeira planilha que a empresa abrisse.
 */
export function comparacaoComOAtual(r: PropostaResult): string | null {
  if (r.economiaMensalCents == null) return null;
  if (r.economiaMensalCents === 0) {
    return "O investimento é equivalente ao do convênio atual — a diferença está na cobertura e no atendimento.";
  }
  return r.economiaMensalCents > 0
    ? "Comparado ao convênio atual da empresa, o programa representa a economia abaixo."
    : "O investimento é maior que o do convênio atual. A comparação honesta está abaixo, e o que muda é a cobertura e o atendimento — não o preço.";
}

/** O rótulo interno continua existindo para as telas de dentro. */
export const ROTULO_INTERNO_DO_PAGAMENTO = PAYMENT_MODEL_LABELS;
