// FIN8.1 — TAXAS DA REDE E SPLIT DE PAGAMENTO.
//
// A base é o DINHEIRO QUE ENTROU (decisão do dono): cada baixa de parcela
// dispara o cálculo sobre o valor efetivamente recebido. Desconto concedido já
// está embutido no que entrou; parcela nunca paga não gera taxa.
//
// Percentuais em 4 casas (2,5% = 2.5), dinheiro em centavos.

export const NETWORK_FEES = [
  { fee: "royalty", label: "Royalty", kind: "percent" },
  { fee: "fundo", label: "Fundo de propaganda", kind: "percent" },
  { fee: "planejamento", label: "Centro de planejamento", kind: "percent" },
  { fee: "comercial", label: "Comercial", kind: "percent" },
  { fee: "sistema", label: "Taxa de sistema e suporte", kind: "fixed" },
  { fee: "sdr", label: "SDR", kind: "fixed" },
] as const;

export type NetworkFeeKey = (typeof NETWORK_FEES)[number]["fee"];
export type NetworkFeeKind = "percent" | "fixed";

export type NetworkFeeRule = {
  fee: NetworkFeeKey;
  kind: NetworkFeeKind;
  percent: number;
  amountCents: number;
  dueDay: number;
  active: boolean;
  /** A unidade tem acordo próprio (não segue a rede). */
  isOverride: boolean;
  note: string;
};

export function feeLabel(fee: string): string {
  return NETWORK_FEES.find((f) => f.fee === fee)?.label ?? fee;
}

export function feeKind(fee: string): NetworkFeeKind {
  return NETWORK_FEES.find((f) => f.fee === fee)?.kind ?? "percent";
}

/**
 * O valor de UMA baixa para UMA taxa percentual.
 *
 * Arredonda meio para cima, como todo o resto do dinheiro no sistema. Taxa
 * desligada ou zerada não gera cobrança — e devolver 0 aqui é o que impede uma
 * linha de R$ 0,00 aparecer no extrato do franqueado.
 */
export function splitAmountCents(
  receivedCents: number,
  rule: Pick<NetworkFeeRule, "kind" | "percent" | "active">
): number {
  if (!rule.active || rule.kind !== "percent") return 0;
  if (rule.percent <= 0 || receivedCents <= 0) return 0;
  return Math.round((receivedCents * rule.percent) / 100);
}

/** A soma dos percentuais que incidem sobre cada real recebido. */
export function totalPercent(rules: NetworkFeeRule[]): number {
  return rules
    .filter((r) => r.active && r.kind === "percent")
    .reduce((s, r) => s + r.percent, 0);
}

/** O total fixo mensal, independente de faturamento. */
export function totalFixedCents(rules: NetworkFeeRule[]): number {
  return rules
    .filter((r) => r.active && r.kind === "fixed")
    .reduce((s, r) => s + r.amountCents, 0);
}

/**
 * O que a unidade paga num mês, dado o quanto ela recebeu.
 *
 * Serve para a tela responder "e se eu receber X?" sem esperar o mês acontecer
 * — que é a pergunta que o franqueado faz ao ver o percentual pela primeira vez.
 */
export function simulateMonth(
  rules: NetworkFeeRule[],
  receivedCents: number
): { percentCents: number; fixedCents: number; totalCents: number } {
  const percentCents = rules
    .filter((r) => r.active && r.kind === "percent")
    .reduce((s, r) => s + splitAmountCents(receivedCents, r), 0);
  const fixedCents = totalFixedCents(rules);
  return { percentCents, fixedCents, totalCents: percentCents + fixedCents };
}

/** Erros de preenchimento da configuração, em pt-BR. */
export function ruleErrors(rule: {
  kind: NetworkFeeKind;
  percent: number;
  amountCents: number;
  dueDay: number;
}): string[] {
  const errors: string[] = [];
  if (rule.kind === "percent") {
    if (rule.percent < 0) errors.push("O percentual não pode ser negativo.");
    if (rule.percent > 100) errors.push("O percentual não pode passar de 100%.");
  } else if (rule.amountCents < 0) {
    errors.push("O valor não pode ser negativo.");
  }
  if (rule.dueDay < 1 || rule.dueDay > 28) {
    // Até 28 porque fevereiro existe: vencimento no dia 30 não cai em fevereiro
    // nenhum, e a conta nasceria com data inválida.
    errors.push("O dia do vencimento precisa estar entre 1 e 28.");
  }
  return errors;
}
