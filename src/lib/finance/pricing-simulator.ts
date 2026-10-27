// Precificador — quanto um procedimento CUSTA e por quanto ele deveria ser
// vendido.
//
// Mora em Procedimentos, não no Financeiro (decisão do dono, 08/08/2026): o
// preço nasce do procedimento, e quem simula é quem conhece a clínica por
// dentro — tempo de cadeira, material, laboratório. Ficar ao lado do preço que
// ele justifica evita copiar número de uma tela para outra.
//
// Dois tipos de custo, e confundi-los é o erro clássico da precificação:
//
//   • CUSTO DIRETO (R$): material, laboratório, repasse, cadeira. Não muda com
//     o preço — é o mesmo cobrando R$ 300 ou R$ 900.
//   • CUSTO PROPORCIONAL (%): imposto e taxa do meio de pagamento. Sobem junto
//     com o preço, e por isso NÃO podem ser somados como valor fixo antes de
//     saber qual é o preço.
//
// É essa diferença que exige a fórmula de markup em vez de "custo + margem".

import { roundHalfUp } from "./money";

export type CostInput = {
  /** Tempo de cadeira em minutos (vem do cadastro do procedimento). */
  minutes: number;
  /** Custo da hora de cadeira na unidade — aluguel, luz, equipe indireta. */
  chairCostPerHourCents: number;
  materialsCents: number;
  labCents: number;
  /** Repasse ao dentista (os quatro degraus da 0210). */
  payoutCents: number;
};

export type CostBreakdown = {
  chairCents: number;
  materialsCents: number;
  labCents: number;
  payoutCents: number;
  /** Soma dos custos que NÃO variam com o preço. */
  directCents: number;
};

export function computeDirectCost(input: CostInput): CostBreakdown {
  const minutes = Math.max(0, input.minutes || 0);
  const chair = roundHalfUp(
    (Math.max(0, input.chairCostPerHourCents || 0) * minutes) / 60
  );
  const materials = Math.max(0, Math.round(input.materialsCents || 0));
  const lab = Math.max(0, Math.round(input.labCents || 0));
  const payout = Math.max(0, Math.round(input.payoutCents || 0));

  return {
    chairCents: chair,
    materialsCents: materials,
    labCents: lab,
    payoutCents: payout,
    directCents: chair + materials + lab + payout,
  };
}

export type SimulationInput = {
  cost: CostInput;
  /** Imposto sobre a receita (%). */
  taxPercent: number;
  /** Taxa média do meio de pagamento (%). */
  acquirerFeePercent: number;
  /** Margem que a unidade quer sobre o preço (%). */
  targetMarginPercent: number;
  /** Preço praticado hoje — para comparar. */
  currentPriceCents: number;
};

export type Simulation = {
  breakdown: CostBreakdown;
  /** Soma dos percentuais que saem do preço. */
  proportionalPercent: number;
  /**
   * Preço que entrega exatamente a margem-alvo. Null quando os percentuais
   * somam 100% ou mais: aí nenhum preço fecha a conta, porque tudo o que
   * entrasse já estaria comprometido.
   */
  suggestedPriceCents: number | null;
  /** O que o preço ATUAL entrega hoje. */
  currentMarginCents: number;
  currentMarginPercent: number;
  /** Preço atual abaixo do que a margem-alvo exige. */
  belowTarget: boolean;
  /** O preço atual não cobre nem os custos. */
  currentIsLoss: boolean;
};

/**
 * O preço que entrega a margem desejada.
 *
 * Não é "custo + margem": imposto e taxa incidem sobre o PREÇO, então somá-los
 * ao custo antes de conhecer o preço subestima os dois. A conta certa é
 *
 *     preço = custo direto ÷ (1 − imposto% − taxa% − margem%)
 *
 * Um exemplo do porquê: custo de R$ 200, imposto 6%, taxa 3%, margem 40%.
 * "Custo + 40%" daria R$ 280 — mas desses R$ 280 saem R$ 25 de imposto e taxa,
 * sobrando R$ 55 de margem (19,6%), menos da metade do pretendido. A fórmula
 * devolve R$ 392, que entrega os 40% de verdade.
 */
export function simulatePrice(input: SimulationInput): Simulation {
  const breakdown = computeDirectCost(input.cost);
  const tax = Math.max(0, input.taxPercent || 0);
  const fee = Math.max(0, input.acquirerFeePercent || 0);
  const target = Math.max(0, input.targetMarginPercent || 0);
  const proportional = tax + fee + target;

  const suggested =
    proportional >= 100
      ? null
      : roundHalfUp(breakdown.directCents / (1 - proportional / 100));

  const price = Math.max(0, Math.round(input.currentPriceCents || 0));
  const proportionalCents = roundHalfUp((price * (tax + fee)) / 100);
  const currentMargin = price - breakdown.directCents - proportionalCents;
  const currentPercent =
    price > 0 ? roundHalfUp((currentMargin * 10000) / price) / 100 : 0;

  return {
    breakdown,
    proportionalPercent: proportional,
    suggestedPriceCents: suggested,
    currentMarginCents: currentMargin,
    currentMarginPercent: currentPercent,
    belowTarget: price > 0 && currentPercent < target,
    currentIsLoss: price > 0 && currentMargin < 0,
  };
}

/** Erros que impedem simular. Vazio = a conta é confiável. */
export function simulationWarnings(input: SimulationInput): string[] {
  const warnings: string[] = [];
  if ((input.cost.minutes || 0) <= 0) {
    warnings.push(
      "O procedimento não tem tempo de cadeira: o custo da cadeira ficou de fora."
    );
  }
  if ((input.cost.chairCostPerHourCents || 0) <= 0) {
    warnings.push(
      "A unidade não tem custo da hora de cadeira configurado — sem ele a conta ignora a estrutura."
    );
  }
  if ((input.cost.payoutCents || 0) <= 0) {
    warnings.push(
      "Sem repasse cadastrado para este procedimento: o custo do dentista ficou de fora."
    );
  }
  if (
    (input.taxPercent || 0) + (input.acquirerFeePercent || 0) +
      (input.targetMarginPercent || 0) >=
    100
  ) {
    warnings.push(
      "Imposto + taxa + margem somam 100% ou mais — nenhum preço fecha essa conta."
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// A margem no preço normal E no preço mínimo; o filtro da lista (pedido do
// dono, 27/10/2026).
// ---------------------------------------------------------------------------

/** O que um preço entrega: o que sai em imposto + taxa e o que sobra. */
export type MargemNoPreco = {
  precoCents: number;
  impostoETaxaCents: number;
  margemCents: number;
  margemPercent: number;
  prejuizo: boolean;
  abaixoDaMeta: boolean;
};

/**
 * A mesma conta do `simulatePrice` (custo direto fixo; imposto e taxa sobre o
 * preço), para um preço qualquer — o normal ou o mínimo. Nulo sem preço.
 */
export function margemNoPreco(
  input: Omit<SimulationInput, "currentPriceCents">,
  precoCents: number | null
): MargemNoPreco | null {
  if (precoCents === null || !(precoCents > 0)) return null;
  const sim = simulatePrice({ ...input, currentPriceCents: precoCents });
  return lerMargem(sim, precoCents, (input.taxPercent || 0) + (input.acquirerFeePercent || 0));
}

/**
 * Uma simulação já feita, lida como "o que este preço entrega" — a tela usa
 * esta (com o material e o laboratório que a pessoa está digitando) e o filtro
 * usa `margemNoPreco`: a mesma leitura nos dois.
 */
export function lerMargem(
  sim: Simulation,
  precoCents: number,
  impostoETaxaPercent: number
): MargemNoPreco | null {
  if (!(precoCents > 0)) return null;
  return {
    precoCents,
    impostoETaxaCents: roundHalfUp((precoCents * Math.max(0, impostoETaxaPercent)) / 100),
    margemCents: sim.currentMarginCents,
    margemPercent: sim.currentMarginPercent,
    prejuizo: sim.currentIsLoss,
    abaixoDaMeta: sim.belowTarget,
  };
}

/** As opções do filtro da lista da Precificação. */
export const FILTROS_DA_MARGEM = {
  todos: "Todos",
  acima: "Na margem desejada ou acima",
  abaixo: "Abaixo da margem desejada",
  abaixo_no_minimo: "Abaixo da margem no preço mínimo",
  sem_preco: "Sem preço",
} as const;
export type FiltroDaMargem = keyof typeof FILTROS_DA_MARGEM;

/**
 * Se o procedimento entra no filtro. "Acima" e "abaixo" olham o preço NORMAL;
 * "abaixo no mínimo" olha o preço mínimo (só quem tem mínimo). Sem preço não
 * é acima nem abaixo — tem opção própria (não há margem para comparar).
 * Prejuízo é abaixo da meta.
 */
export function passaNoFiltroDaMargem(
  filtro: FiltroDaMargem,
  normal: MargemNoPreco | null,
  minimo: MargemNoPreco | null
): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "sem_preco":
      return normal === null;
    case "acima":
      return normal !== null && !normal.abaixoDaMeta;
    case "abaixo":
      return normal !== null && normal.abaixoDaMeta;
    case "abaixo_no_minimo":
      return minimo !== null && minimo.abaixoDaMeta;
  }
}
