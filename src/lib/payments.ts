// I9: entrada + parcelas personalizadas (docs/COMERCIAL.md).
// Dinheiro SEMPRE em centavos. Estas regras valem na negociação do consultor e
// na venda direta, e são a base do futuro módulo Financeiro (contas a receber).

export type ScheduleKind = "entrada" | "parcela";

export type ScheduleEntry = {
  /** Ordem de cobrança (1 = entrada, quando houver). */
  seq: number;
  kind: ScheduleKind;
  /** YYYY-MM-DD. */
  dueDate: string;
  amountCents: number;
};

/** Soma de um plano de pagamento. */
export function scheduleTotalCents(entries: ScheduleEntry[]): number {
  return entries.reduce((s, e) => s + Math.max(0, e.amountCents), 0);
}

/** Data + N dias, em YYYY-MM-DD (sem fuso: trabalha só com a parte da data). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Mesma data no mês seguinte (dia 31 vira o último dia do mês curto). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
  ).getUTCDate();
  base.setUTCDate(Math.min(d ?? 1, lastDay));
  return base.toISOString().slice(0, 10);
}

/**
 * Monta o plano de pagamento: entrada (opcional) + N parcelas iguais, com a
 * sobra dos centavos na ÚLTIMA parcela (a soma bate exatamente com o total).
 */
export function buildSchedule(input: {
  totalCents: number;
  downPaymentCents: number;
  installments: number;
  /** Vencimento da entrada (ou da 1ª parcela quando não há entrada). */
  firstDueDate: string;
  /** Intervalo entre as parcelas: mensal (padrão) ou a cada N dias. */
  everyDays?: number;
}): ScheduleEntry[] {
  const total = Math.max(0, Math.round(input.totalCents));
  const down = Math.min(Math.max(0, Math.round(input.downPaymentCents)), total);
  const count = Math.max(0, Math.floor(input.installments));
  const entries: ScheduleEntry[] = [];
  let seq = 1;

  if (down > 0) {
    entries.push({
      seq: seq++,
      kind: "entrada",
      dueDate: input.firstDueDate,
      amountCents: down,
    });
  }

  const rest = total - down;
  if (count <= 0 || rest <= 0) return entries;

  const base = Math.floor(rest / count);
  let assigned = 0;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const amount = isLast ? rest - assigned : base;
    assigned += amount;
    // Com entrada, a 1ª parcela cai um período DEPOIS da entrada.
    const step = down > 0 ? i + 1 : i;
    const dueDate = input.everyDays
      ? addDays(input.firstDueDate, step * input.everyDays)
      : addMonths(input.firstDueDate, step);
    entries.push({ seq: seq++, kind: "parcela", dueDate, amountCents: amount });
  }
  return entries;
}

/**
 * Editou o valor de uma cobrança → as SEGUINTES se ajustam sozinhas para o
 * plano continuar fechando com o total (pedido do dono: entrada de R$ 500 e 2ª
 * parcela de R$ 500 recalculam as demais). As anteriores ficam intactas — já
 * foram decididas. Se não sobrar nada, as seguintes somem.
 */
export function redistributeFrom(
  entries: ScheduleEntry[],
  index: number,
  newAmountCents: number,
  totalCents: number
): ScheduleEntry[] {
  const head = entries.slice(0, index).map((e) => ({ ...e }));
  const edited = {
    ...entries[index],
    amountCents: Math.max(0, Math.round(newAmountCents)),
  };
  const fixed = [...head, edited];
  const used = fixed.reduce((s, e) => s + e.amountCents, 0);
  const rest = Math.round(totalCents) - used;
  const tailCount = entries.length - index - 1;

  if (tailCount <= 0) return fixed.map((e, i) => ({ ...e, seq: i + 1 }));
  // Sem saldo: as cobranças seguintes deixam de existir.
  if (rest <= 0) return fixed.map((e, i) => ({ ...e, seq: i + 1 }));

  const base = Math.floor(rest / tailCount);
  let assigned = 0;
  const tail = entries.slice(index + 1).map((e, i) => {
    const isLast = i === tailCount - 1;
    const amount = isLast ? rest - assigned : base;
    assigned += amount;
    return { ...e, amountCents: amount };
  });
  return [...fixed, ...tail].map((e, i) => ({ ...e, seq: i + 1 }));
}

/**
 * Erros que impedem salvar o plano de pagamento. Vazio = pode salvar.
 * `minInstallmentCents` (I8) vale só para as PARCELAS — a entrada é livre.
 */
export function scheduleErrors(
  entries: ScheduleEntry[],
  opts: { totalCents: number; minInstallmentCents?: number | null }
): string[] {
  const errors: string[] = [];
  if (entries.length === 0) {
    errors.push("Inclua ao menos uma cobrança.");
    return errors;
  }
  if (entries.some((e) => e.amountCents <= 0)) {
    errors.push("Toda cobrança precisa de um valor maior que zero.");
  }
  if (entries.some((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.dueDate))) {
    errors.push("Toda cobrança precisa de uma data de vencimento.");
  }
  if (entries.filter((e) => e.kind === "entrada").length > 1) {
    errors.push("Só pode haver uma entrada.");
  }
  const total = scheduleTotalCents(entries);
  if (total !== Math.round(opts.totalCents)) {
    errors.push(
      `A soma das cobranças (${brl(total)}) precisa fechar com o valor da venda (${brl(opts.totalCents)}).`
    );
  }
  const min = opts.minInstallmentCents ?? 0;
  if (min > 0) {
    const small = entries.filter(
      (e) => e.kind === "parcela" && e.amountCents < min
    );
    if (small.length > 0) {
      errors.push(
        `${small.length} parcela(s) abaixo do mínimo de ${brl(min)} para este meio de pagamento.`
      );
    }
  }
  // Datas em ordem crescente evitam boleto vencendo antes do anterior.
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].dueDate < entries[i - 1].dueDate) {
      errors.push("As datas de vencimento precisam estar em ordem crescente.");
      break;
    }
  }
  return errors;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
