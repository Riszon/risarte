// O REPASSE EM R$ OU EM % (pedido do dono, 27/10/2026).
//
// No cadastro do procedimento, quem lança o repasse pode digitar o VALOR ou o
// PERCENTUAL, e a tela mostra o outro. Decisão do dono: o que fica GRAVADO é
// sempre o valor em R$ — o percentual é uma calculadora sobre o preço padrão.
// É a regra do FIN5 (repasse é valor fixo): reajustar o preço não aumenta o
// repasse de ninguém sem alguém decidir. Por isso, depois de um reajuste, o
// mesmo R$ aparece com outro percentual.
//
// Uma conta só, usada pela tela (enquanto se digita) e pelo servidor (ao
// gravar): duas contas para o mesmo número é como elas passam a divergir.

import { roundHalfUp } from "./money";

/** Quanto é `percent`% do preço, em centavos. Nulo sem preço ou com % inválido. */
export function valorDoPercentual(
  percent: number,
  precoCents: number
): number | null {
  if (!Number.isFinite(percent) || percent < 0) return null;
  if (!Number.isFinite(precoCents) || precoCents <= 0) return null;
  return roundHalfUp((precoCents * percent) / 100);
}

/** Que percentual do preço o valor representa, com até 2 casas. Nulo sem preço. */
export function percentualDoValor(
  valorCents: number,
  precoCents: number
): number | null {
  if (!Number.isFinite(valorCents) || valorCents < 0) return null;
  if (!Number.isFinite(precoCents) || precoCents <= 0) return null;
  return Math.round((valorCents / precoCents) * 10000) / 100;
}

/** "30", "12,5", "33,33" — como a pessoa digitaria no campo. */
export function percentualParaCampo(percent: number): string {
  return String(Math.round(percent * 100) / 100).replace(".", ",");
}

/** "30%", "12,5%" — para ler ao lado do valor. */
export function textoDoPercentual(percent: number): string {
  return `${percentualParaCampo(percent)}%`;
}

/** Lê "12,5" / "12.5" / "12,5%". Nulo quando não é número ≥ 0. */
export function lerPercentual(texto: string): number | null {
  const limpo = texto.replace("%", "").trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * O que gravar no cadastro do procedimento (`commission_fixed_cents` e
 * `commission_percent`), a partir do que veio da tela:
 *
 * - veio valor em R$ → grava o valor e zera o percentual;
 * - veio só percentual e há preço → converte para R$ e zera o percentual;
 * - veio só percentual e NÃO há preço → guarda o percentual como está (não há
 *   como converter; é o caso antigo, anterior a esta tela, e o repasse segue
 *   pelo degrau do percentual em `resolvePayoutRate`).
 *
 * Antes, valor e percentual podiam ficar os dois preenchidos e a lista mostrava
 * "10% + R$ 50,00" — mas o repasse paga só o valor (o percentual é o degrau de
 * baixo). Com esta regra, os dois nunca convivem quando há preço.
 */
export function repasseParaGravar(input: {
  valorCents: number;
  percent: number;
  precoCents: number;
}): { valorCents: number; percent: number } {
  if (input.valorCents > 0) return { valorCents: input.valorCents, percent: 0 };
  if (input.percent > 0) {
    const convertido = valorDoPercentual(input.percent, input.precoCents);
    if (convertido !== null) return { valorCents: convertido, percent: 0 };
    return { valorCents: 0, percent: input.percent };
  }
  return { valorCents: 0, percent: 0 };
}
