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

/**
 * O valor vigente NA DATA do procedimento.
 *
 * Precedência: **individual vence o nível**. Entre linhas do mesmo tipo, a
 * vigência mais recente manda.
 *
 * A data é a do PROCEDIMENTO REALIZADO, nunca "hoje": reajustar a tabela não
 * pode reescrever o que já foi produzido (mesma lógica das taxas congeladas da
 * parcela e da adquirente).
 */
export function resolvePayoutRate(
  rates: PayoutRate[],
  input: {
    procedureId: string;
    levelId: string | null;
    providerId: string;
    date: string;
  }
): PayoutRate | null {
  const valid = rates.filter(
    (r) =>
      r.procedureId === input.procedureId &&
      r.validFrom <= input.date &&
      (r.validTo === null || r.validTo >= input.date)
  );

  const individual = valid
    .filter((r) => r.providerId === input.providerId)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  if (individual.length > 0) return individual[0];

  if (input.levelId) {
    const byLevel = valid
      .filter((r) => r.providerId === null && r.levelId === input.levelId)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
    if (byLevel.length > 0) return byLevel[0];
  }

  // Sem tabela para este procedimento/nível: repasse ZERO e o sistema avisa.
  // Inventar valor seria pior — o dentista receberia errado sem ninguém notar.
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
