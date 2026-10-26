// Risarte Empresarial — OS DEPENDENTES NA PROPOSTA (1032, dono em 26/10/2026).
//
// Pedido: *"deve ter como detalhar mais em um quadro, quantos titulares terão
// dependentes e a quantidade de dependentes: por exemplo, 3 não terão
// dependentes, 4 terão apenas 1 dependente, 2 terão 2 dependentes… Para na
// proposta já conseguir calcular mais aproximado o valor para iniciar o
// programa. Caso não souber a quantidade de dependentes por cada titular, pode
// ser calculado na proposta como individual ou ter a opção de não calcular."*
//
// ⚠️ A CONTA DE CADA FAMÍLIA É A DA COBRANÇA (`custoDosDependentesDoTitular`).
// O quadro diz quantas famílias de cada tamanho existem; o preço de cada uma
// sai da mesma função que o boleto usa. Com o quadro certo, a proposta e a
// primeira mensalidade dão o mesmo número.
//
// Puro e em CENTAVOS: regra de dinheiro não mora em componente de tela.

import {
  custoDosDependentesDoTitular,
  DEFAULT_ADHESION_PRICING,
  type AdhesionPricing,
} from "./pricing";

export const CALCULOS_DOS_DEPENDENTES = ["DISTRIBUTION", "AS_INDIVIDUAL", "NONE"] as const;
export type CalculoDosDependentes = (typeof CALCULOS_DOS_DEPENDENTES)[number];

/** "4 titulares com 2 dependentes cada". */
export type LinhaDoQuadro = { dependentes: number; titulares: number };

export type LinhaCalculada = LinhaDoQuadro & {
  /** O que os dependentes de UM desses titulares custam por mês. */
  porTitularCents: number;
  subtotalCents: number;
};

export type EstimativaDosDependentes = {
  totalCents: number;
  /** Quantos dependentes a conta considerou. */
  dependentes: number;
  /** Só no quadro: as linhas com o preço de cada família. */
  linhas: LinhaCalculada[];
  /** Uma linha que diz como a conta foi feita — a tela e o documento mostram. */
  explicacao: string;
};

const inteiro = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number.parseInt(String(n ?? ""), 10);
  return Number.isFinite(v) ? Math.floor(v) : 0;
};

/**
 * O quadro como veio do banco ou do formulário → linhas limpas.
 *
 * Linha sem titular não diz nada e sai. O que for inválido (negativo) também
 * sai — quem barra é `problemasDoQuadro`, antes de gravar.
 */
export function lerQuadro(bruto: unknown): LinhaDoQuadro[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((l) => ({
      dependentes: inteiro((l as Record<string, unknown>)?.dependentes),
      titulares: inteiro((l as Record<string, unknown>)?.titulares),
    }))
    .filter((l) => l.titulares > 0 && l.dependentes >= 0);
}

/** O que impede gravar o quadro — mesma régua da tela e do servidor. */
export function problemasDoQuadro(linhas: readonly LinhaDoQuadro[]): string[] {
  const p: string[] = [];
  const vistas = new Set<number>();
  for (const l of linhas) {
    if (l.titulares < 0 || l.dependentes < 0) {
      p.push("o quadro não aceita número negativo");
    }
    if (vistas.has(l.dependentes)) {
      p.push(`há duas linhas para titulares com ${l.dependentes} dependente(s) — junte as duas`);
    }
    vistas.add(l.dependentes);
  }
  return [...new Set(p)];
}

/**
 * O QUADRO CONTRA A QUANTIDADE DE TITULARES DA PROPOSTA — aviso, não trava.
 *
 * Quem preenche pode estar contando só quem tem dependente e esquecer a linha
 * "0 dependentes"; o sistema diz o que vê, quem decide é quem vende.
 */
export function avisoDoQuadro(
  linhas: readonly LinhaDoQuadro[],
  titularesDaProposta: number
): string | null {
  const noQuadro = linhas.reduce((s, l) => s + l.titulares, 0);
  if (noQuadro === 0 || titularesDaProposta <= 0) return null;
  if (noQuadro > titularesDaProposta) {
    return `O quadro tem ${noQuadro} titulares, mais que os ${titularesDaProposta} da proposta.`;
  }
  if (noQuadro < titularesDaProposta) {
    const faltam = titularesDaProposta - noQuadro;
    return `O quadro tem ${noQuadro} de ${titularesDaProposta} titulares — ${faltam} sem linha. Se não terão dependentes, ponha-os na linha "0".`;
  }
  return null;
}

export function dependentesDoQuadro(linhas: readonly LinhaDoQuadro[]): number {
  return linhas.reduce((s, l) => s + l.dependentes * l.titulares, 0);
}

/**
 * QUANTO OS DEPENDENTES SOMAM POR MÊS, conforme a escolha da proposta.
 *
 * `null` quando a proposta escolheu não calcular — e aí ninguém mostra zero:
 * "dependentes R$ 0,00" é uma afirmação, e seria falsa.
 */
export function estimativaDosDependentes(e: {
  calculo: CalculoDosDependentes;
  pricing: AdhesionPricing;
  quadro: readonly LinhaDoQuadro[];
  /** A estimativa simples ("quantos dependentes"), usada no "como individual". */
  dependentes: number;
}): EstimativaDosDependentes | null {
  const reais = (v: number) => `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;

  if (e.calculo === "AS_INDIVIDUAL") {
    const n = Math.max(0, inteiro(e.dependentes));
    const individual = Math.max(0, e.pricing.dependentIndividualFeeCents);
    return {
      totalCents: n * individual,
      dependentes: n,
      linhas: [],
      explicacao: `${n} dependente${n === 1 ? "" : "s"} × ${reais(individual)} (calculado como individual)`,
    };
  }

  if (e.calculo === "DISTRIBUTION") {
    const linhas: LinhaCalculada[] = [...e.quadro]
      .sort((a, z) => a.dependentes - z.dependentes)
      .map((l) => {
        const porTitularCents = custoDosDependentesDoTitular(e.pricing, l.dependentes);
        return { ...l, porTitularCents, subtotalCents: porTitularCents * l.titulares };
      });
    const dependentes = dependentesDoQuadro(linhas);
    const familias = linhas.filter((l) => l.dependentes > 0).reduce((s, l) => s + l.titulares, 0);
    return {
      totalCents: linhas.reduce((s, l) => s + l.subtotalCents, 0),
      dependentes,
      linhas,
      explicacao: `${dependentes} dependente${dependentes === 1 ? "" : "s"} de ${familias} titular${familias === 1 ? "" : "es"}, pelo quadro`,
    };
  }

  return null;
}

/** Os campos da proposta gravada que esta conta lê. */
export type PropostaDosDependentes = {
  billing_basis?: string | null;
  includes_dependents?: boolean | null;
  dependents_estimate?: number | null;
  dependent_fee_cents?: number | null;
  dependent_mode?: string | null;
  dependent_family_fee_cents?: number | null;
  dependent_family_extra_fee_cents?: number | null;
  dependent_family_size?: number | null;
  dependents_calc_mode?: string | null;
  dependents_distribution?: unknown;
};

/** A tabela de preço dos dependentes que a proposta combinou. */
export function pricingDaProposta(q: PropostaDosDependentes): AdhesionPricing {
  return {
    ...DEFAULT_ADHESION_PRICING,
    dependentIndividualFeeCents:
      q.dependent_fee_cents ?? DEFAULT_ADHESION_PRICING.dependentIndividualFeeCents,
    dependentFamilyFeeCents:
      q.dependent_family_fee_cents ?? DEFAULT_ADHESION_PRICING.dependentFamilyFeeCents,
    dependentFamilyExtraFeeCents:
      q.dependent_family_extra_fee_cents ??
      DEFAULT_ADHESION_PRICING.dependentFamilyExtraFeeCents,
    dependentFamilySize: q.dependent_family_size ?? 3,
    dependentMode: q.dependent_mode === "PER_DEPENDENT" ? "PER_DEPENDENT" : "FAMILY_PACKAGE",
  };
}

export function calculoDaProposta(q: PropostaDosDependentes): CalculoDosDependentes {
  return q.dependents_calc_mode === "DISTRIBUTION" || q.dependents_calc_mode === "AS_INDIVIDUAL"
    ? q.dependents_calc_mode
    : "NONE";
}

/**
 * A ESTIMATIVA DA PROPOSTA GRAVADA — o documento e o fechamento leem daqui.
 *
 * Nula quando não há o que estimar: dependentes não entram, a proposta é de
 * valor fixo (os dependentes estão dentro do valor da empresa) ou escolheu
 * não calcular.
 */
export function estimativaDaProposta(
  q: PropostaDosDependentes | null
): EstimativaDosDependentes | null {
  if (!q?.includes_dependents) return null;
  if (q.billing_basis === "FIXED_PER_COMPANY") return null;
  return estimativaDosDependentes({
    calculo: calculoDaProposta(q),
    pricing: pricingDaProposta(q),
    quadro: lerQuadro(q.dependents_distribution),
    dependentes: q.dependents_estimate ?? 0,
  });
}
