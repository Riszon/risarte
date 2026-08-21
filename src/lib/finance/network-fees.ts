// FIN8.1 — TAXAS DA REDE E SPLIT DE PAGAMENTO.
//
// A base é o DINHEIRO QUE ENTROU (decisão do dono): cada baixa de parcela
// dispara o cálculo sobre o valor efetivamente recebido. Desconto concedido já
// está embutido no que entrou; parcela nunca paga não gera taxa.
//
// AS TAXAS SÃO DADOS, NÃO LISTA FIXA (0233). O catálogo vive no banco, e criar
// a sétima é operação de tela. Por isso não existe mais um array de taxas aqui:
// uma cópia no código envelheceria no dia em que alguém cadastrasse uma nova, e
// a tela mostraria uma lista diferente da que o banco cobra.
//
// Percentuais em 4 casas (2,5% = 2.5), dinheiro em centavos.

export type NetworkFeeKind = "percent" | "fixed";

/** Uma taxa do catálogo. */
export type NetworkFeeType = {
  key: string;
  label: string;
  kind: NetworkFeeKind;
  unitAccount: string;
  franchisorAccount: string;
  /** As seis originais: podem ser inativadas, nunca apagadas. */
  system: boolean;
  active: boolean;
  sortOrder: number;
  note: string;
};

/** O que vale para uma unidade, já com campanha aplicada. */
export type NetworkFeeRule = {
  fee: string;
  label: string;
  kind: NetworkFeeKind;
  percent: number;
  amountCents: number;
  dueDay: number;
  active: boolean;
  /** A unidade tem acordo próprio (não segue a rede). */
  isOverride: boolean;
  note: string;
  /** Campanha vigente que está mudando este valor, se houver. */
  campaignName: string | null;
};

export type CampaignMode = "valor" | "desconto";

export type FeeCampaign = {
  id: string;
  name: string;
  clinicId: string | null;
  /** Taxas alcançadas. `null` ou vazio = todas. */
  fees: string[] | null;
  startsOn: string;
  endsOn: string;
  mode: CampaignMode;
  percent: number | null;
  amountCents: number | null;
  discountPercent: number | null;
  note: string;
  active: boolean;
};

/**
 * A campanha alcança esta taxa?
 *
 * Lista vazia significa TODAS — e é por isso que apagar uma taxa que está em
 * campanha é recusado no banco: esvaziar a lista transformaria a campanha de
 * uma taxa em campanha de todas, sem ninguém pedir.
 */
export function campaignCoversFee(
  campaign: Pick<FeeCampaign, "fees">,
  feeKey: string
): boolean {
  const fees = campaign.fees;
  if (!fees || fees.length === 0) return true;
  return fees.includes(feeKey);
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

/**
 * A campanha aplicada sobre o valor combinado — o espelho, em TypeScript, do
 * que o banco faz em `network_fee_for`.
 *
 * Existe para a tela mostrar o efeito ANTES de salvar a campanha. Os dois
 * caminhos precisam concordar; por isso a regra está escrita uma vez de cada
 * lado, e os testes prendem os dois números.
 */
export function applyCampaign(
  base: Pick<NetworkFeeRule, "kind" | "percent" | "amountCents">,
  campaign: Pick<
    FeeCampaign,
    "mode" | "percent" | "amountCents" | "discountPercent"
  > | null
): { percent: number; amountCents: number } {
  if (!campaign) {
    return { percent: base.percent, amountCents: base.amountCents };
  }
  if (campaign.mode === "valor") {
    return {
      percent: campaign.percent ?? base.percent,
      amountCents: campaign.amountCents ?? base.amountCents,
    };
  }
  const keep = 1 - (campaign.discountPercent ?? 0) / 100;
  return {
    percent: Math.round(base.percent * keep * 10_000) / 10_000,
    amountCents: Math.round(base.amountCents * keep),
  };
}

/** A campanha está valendo na data? */
export function isCampaignLive(
  campaign: Pick<FeeCampaign, "startsOn" | "endsOn" | "active">,
  isoDate: string
): boolean {
  return (
    campaign.active && isoDate >= campaign.startsOn && isoDate <= campaign.endsOn
  );
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

/** Erros de uma campanha, em pt-BR. */
export function campaignErrors(c: {
  name: string;
  startsOn: string;
  endsOn: string;
  mode: CampaignMode;
  percent: number | null;
  discountPercent: number | null;
}): string[] {
  const errors: string[] = [];
  if (!c.name.trim()) errors.push("Dê um nome à campanha.");
  if (!c.startsOn || !c.endsOn) errors.push("Informe o período da campanha.");
  else if (c.endsOn < c.startsOn) {
    errors.push("O fim da campanha não pode ser antes do início.");
  }
  if (c.mode === "desconto") {
    const d = c.discountPercent ?? 0;
    if (d <= 0) errors.push("O desconto precisa ser maior que zero.");
    if (d > 100) errors.push("O desconto não pode passar de 100%.");
  }
  if (c.mode === "valor" && c.percent !== null && (c.percent < 0 || c.percent > 100)) {
    errors.push("O percentual da campanha precisa ficar entre 0 e 100.");
  }
  return errors;
}

/** Nome para a chave de uma taxa nova: minúsculas, sem acento, com _ . */
export function slugifyFeeKey(label: string): string {
  return label
    .normalize("NFD")
    // Acentos separados pelo NFD. Escapado de propósito: escrito com os
    // caracteres de verdade, o intervalo fica invisível no editor e some numa
    // cópia descuidada.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
