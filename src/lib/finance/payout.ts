// FIN5 — repasse ao dentista.
//
// Decisão do dono (briefing §RESOLVIDO): o repasse é **valor FIXO por
// procedimento**, não percentual. A consequência disso atravessa o sistema
// inteiro: desconto concedido na negociação **não reduz o repasse** — ele sai
// integralmente da margem da clínica. É por isso que existe o alerta de margem
// (src/lib/finance/margin.ts).
//
// A tabela é chaveada por **nível do plano de carreira**: o dentista aponta
// para um nível e herda os valores. Valor individual existe, mas é exceção —
// se virar regra, o plano de carreira deixa de significar alguma coisa.

import { roundHalfUp } from "./money";

export type PayoutRate = {
  id: string;
  procedureId: string;
  /** Nulo quando a linha é um valor individual. */
  levelId: string | null;
  /** Preenchido só no override individual. */
  providerId: string | null;
  amountCents: number;
  validFrom: string;
  validTo: string | null;
};

/** De onde o valor do repasse veio — a tela mostra isto para ninguém adivinhar. */
export type PayoutSource =
  | "individual"
  | "nivel"
  | "procedimento_fixo"
  | "procedimento_percentual";

export const PAYOUT_SOURCE_LABELS: Record<PayoutSource, string> = {
  individual: "valor individual",
  nivel: "do nível de carreira",
  procedimento_fixo: "do cadastro do procedimento",
  procedimento_percentual: "percentual do procedimento",
};

/**
 * O valor vigente NA DATA do procedimento, em QUATRO DEGRAUS (decisão do dono,
 * 08/08/2026, depois de ele notar que eu havia duplicado a fonte):
 *
 *   1. valor INDIVIDUAL do profissional
 *   2. valor do NÍVEL de carreira
 *   3. valor FIXO do cadastro do procedimento
 *   4. PERCENTUAL do procedimento sobre o preço padrão
 *
 * Os degraus 3 e 4 são o que já existia em `procedures` desde a 0039 — nada do
 * que foi preenchido se perde, e a precedência fica declarada em vez de
 * depender de quem lê a tela.
 *
 * A data é a do PROCEDIMENTO REALIZADO, nunca "hoje": reajustar a tabela não
 * pode reescrever o que já foi produzido.
 */
export function resolvePayoutRate(
  rates: PayoutRate[],
  input: {
    procedureId: string;
    levelId: string | null;
    providerId: string;
    date: string;
    /** Degraus 3 e 4: o que está no cadastro do procedimento. */
    procedureFixedCents?: number;
    procedurePercent?: number;
    procedurePriceCents?: number;
  }
): (PayoutRate & { source: PayoutSource }) | null {
  const valid = rates.filter(
    (r) =>
      r.procedureId === input.procedureId &&
      r.validFrom <= input.date &&
      (r.validTo === null || r.validTo >= input.date)
  );

  const individual = valid
    .filter((r) => r.providerId === input.providerId)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  if (individual.length > 0) return { ...individual[0], source: "individual" };

  if (input.levelId) {
    const byLevel = valid
      .filter((r) => r.providerId === null && r.levelId === input.levelId)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
    if (byLevel.length > 0) return { ...byLevel[0], source: "nivel" };
  }

  // Degrau 3: valor fixo do cadastro do procedimento.
  const fixed = input.procedureFixedCents ?? 0;
  if (fixed > 0) {
    return {
      id: "procedure",
      procedureId: input.procedureId,
      levelId: null,
      providerId: null,
      amountCents: fixed,
      validFrom: input.date,
      validTo: null,
      source: "procedimento_fixo",
    };
  }

  // Degrau 4: percentual sobre o preço padrão. O briefing decidiu repasse
  // fixo, mas quem já usa percentual não pode ficar sem repasse nenhum.
  const percent = input.procedurePercent ?? 0;
  if (percent > 0) {
    return {
      id: "procedure",
      procedureId: input.procedureId,
      levelId: null,
      providerId: null,
      amountCents: roundHalfUp(
        ((input.procedurePriceCents ?? 0) * percent) / 100
      ),
      validFrom: input.date,
      validTo: null,
      source: "procedimento_percentual",
    };
  }

  // Nenhum degrau: repasse ZERO e o sistema AVISA. Inventar valor seria pior —
  // o dentista receberia errado sem ninguém notar.
  return null;
}

export type PayoutLine = {
  providerId: string;
  providerName: string;
  amountCents: number;
  accrualDate: string;
};

export type PayoutSummary = {
  providerId: string;
  providerName: string;
  /** Quantos procedimentos entraram no período. */
  count: number;
  /** Soma dos repasses fixos. */
  fixedCents: number;
  bonusPercent: number;
  bonusCents: number;
  totalCents: number;
};

/**
 * Consolida o período por dentista e aplica o bônus.
 *
 * O bônus incide sobre o TOTAL DO PERÍODO, nunca procedimento a procedimento
 * (decisão do dono): ele premia o conjunto — campanha, meta batida, evolução
 * no plano de carreira —, não cada ato isolado.
 */
export function summarizePayouts(
  lines: PayoutLine[],
  bonusPercent = 0
): PayoutSummary[] {
  const byProvider = new Map<string, PayoutSummary>();
  for (const l of lines) {
    const cur = byProvider.get(l.providerId) ?? {
      providerId: l.providerId,
      providerName: l.providerName,
      count: 0,
      fixedCents: 0,
      bonusPercent: 0,
      bonusCents: 0,
      totalCents: 0,
    };
    cur.count += 1;
    cur.fixedCents += l.amountCents;
    byProvider.set(l.providerId, cur);
  }

  const pct = Math.max(0, bonusPercent || 0);
  return [...byProvider.values()]
    .map((s) => {
      const bonus = pct > 0 ? roundHalfUp((s.fixedCents * pct) / 100) : 0;
      return {
        ...s,
        bonusPercent: pct,
        bonusCents: bonus,
        totalCents: s.fixedCents + bonus,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

/** Erros que impedem salvar uma linha da tabela. Vazio = pode salvar. */
export function payoutRateErrors(input: {
  procedureId: string;
  levelId: string | null;
  providerId: string | null;
  amountCents: number;
  validFrom: string;
}): string[] {
  const errors: string[] = [];
  if (!input.procedureId) errors.push("Escolha o procedimento.");
  // Uma linha vale para um NÍVEL ou para uma PESSOA — nunca para os dois, senão
  // não há como dizer qual delas o sistema deveria aplicar.
  if (!input.levelId && !input.providerId) {
    errors.push("Escolha o nível de carreira ou o profissional.");
  }
  if (input.levelId && input.providerId) {
    errors.push("A linha vale para um nível OU para um profissional, não ambos.");
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
    errors.push("Informe o valor do repasse (pode ser zero).");
  }
  if (!input.validFrom) errors.push("Informe a data de início da vigência.");
  return errors;
}
