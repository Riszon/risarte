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

// -----------------------------------------------------------------------------
// 0.91.0 (dono, 28/10/2026) — textos que a empresa precisa ler, e o nome do PDF
// -----------------------------------------------------------------------------

/**
 * COMO O COLABORADOR PAGA O TRATAMENTO, em três frases.
 *
 * Pedido: *"O colaborador vai contratar o tratamento, vai receber o desconto e
 * poder pagar pelo boleto, mas se ele não cumprir com o pagamento em dia vai
 * perder o desconto daquela parcela"*. Os meios e as parcelas vêm do que a
 * proposta combinou (`textoDoPagamento`).
 */
export function comoOColaboradorPaga(meiosEParcelas: string): string[] {
  const meios = meiosEParcelas.charAt(0).toLowerCase() + meiosEParcelas.slice(1);
  return [
    // 1037: "Titular", e não "colaborador" (dono, 28/10/2026).
    "O Titular contrata o tratamento diretamente na unidade Risarte, e o desconto do programa já vem aplicado no orçamento dele.",
    `O pagamento pode ser feito por ${meios}, somado às condições da unidade.`,
    "O desconto vale para as parcelas pagas em dia. A parcela paga com atraso perde o desconto do programa naquela parcela; as demais seguem com o desconto normalmente.",
  ];
}

/**
 * O RELATÓRIO MENSAL E QUEM CORRIGE A LISTA.
 *
 * Pedido: *"Todo mês será enviado um relatório dos titulares e dependentes que
 * estão atrelados a empresa e juntamente o boleto de pagamento da mensalidade
 * do programa, caso houver alguma divergência a responsabilidade de solicitar
 * a alteração é da empresa."* Quando só o titular paga, o boleto não é da
 * empresa — a frase diz "cobrança", e não promete um boleto que não chega.
 */
export function relatorioMensal(model: PaymentModel): string {
  const cobranca =
    model === "EMPLOYEE_PAYS"
      ? ", junto com a cobrança da mensalidade, conforme combinado"
      : ", junto com o boleto da mensalidade do programa";
  return (
    `Todo mês a empresa recebe o relatório dos titulares e dependentes vinculados a ela${cobranca}. ` +
    "Se houver alguma divergência — alguém que entrou, saiu ou não deveria constar —, cabe à empresa solicitar a correção à Risarte."
  );
}

/**
 * A PERMANÊNCIA NO PROGRAMA, como a proposta a apresenta (1037). É a mesma
 * regra da cláusula quinta do contrato, dita para quem decide.
 */
export function textoDaPermanencia(
  meses: number | null | undefined,
  multaCents: number | null | undefined
): string {
  if (!meses || meses <= 0) {
    return "Sem prazo mínimo de fidelidade: a empresa pode encerrar a participação no programa a qualquer tempo, com aviso por escrito de 30 dias.";
  }
  const prazo = `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const base = `Prazo mínimo de fidelidade de ${prazo}, contados da assinatura do contrato.`;
  if (!multaCents || multaCents <= 0) return base;
  const reais = `R$ ${(multaCents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  return `${base} Se a empresa encerrar a participação antes desse prazo, há multa de ${reais}, em parcela única.`;
}

/**
 * O NOME DO ARQUIVO QUE O NAVEGADOR SUGERE AO SALVAR O PDF.
 *
 * Pedido: *"quando vai salvar o PDF o arquivo já salvar com nome de arquivo de
 * acordo a proposta"*. Antes era o formato técnico dos relatórios
 * (`risarte-empresarial_proposta_…`), e o dono renomeava à mão. Agora é legível
 * e com acento: "Proposta Risarte Empresarial - Cooperativa Recicla Brasil -
 * 28-10-2026". Só saem os caracteres que o Windows não aceita em nome de arquivo.
 */
export function nomeDoArquivo(
  tipo: "Proposta" | "Contrato",
  empresa: string,
  dataIso: string
): string {
  const limpo = empresa.replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Empresa";
  const [a, m, d] = dataIso.slice(0, 10).split("-");
  return `${tipo} Risarte Empresarial - ${limpo} - ${d}-${m}-${a}`;
}
