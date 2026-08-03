// FIN0 — dinheiro do Módulo Financeiro. SEMPRE centavos inteiros; no banco as
// tabelas novas usam BIGINT (decisão do dono, 31/07/2026).
//
// Nenhuma regra de dinheiro pode viver dentro de componente de tela: tudo o que
// arredonda, rateia ou acumula fica aqui, com teste.

/**
 * Arredondamento MEIO PARA CIMA (half up), a política padrão da rede.
 * Cuidado: `Math.round` do JS arredonda -0,5 para 0 (para cima no eixo), o que
 * quebra valores negativos — por isso o tratamento explícito do sinal.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Arredondamento bancário (half even) — disponível na configuração. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export type RoundingMode = "half_up" | "half_even";

export function roundCents(value: number, mode: RoundingMode = "half_up"): number {
  return mode === "half_even" ? roundHalfEven(value) : roundHalfUp(value);
}

/**
 * Percentual sobre um valor em centavos, já arredondado.
 * Ex.: 2% de R$ 1.000,00 = percentOf(100000, 2) = 2000.
 */
export function percentOf(
  amountCents: number,
  percent: number,
  mode: RoundingMode = "half_up"
): number {
  if (!Number.isFinite(percent) || percent <= 0 || amountCents <= 0) return 0;
  return roundCents((amountCents * percent) / 100, mode);
}

/**
 * Divide um valor em N partes iguais. **A ÚLTIMA parte absorve o resíduo de
 * centavos** — a soma das partes bate EXATAMENTE com o total. É a regra que
 * evita o clássico "faltou 1 centavo" no parcelamento e no rateio.
 */
export function splitAmount(totalCents: number, parts: number): number[] {
  const total = roundHalfUp(totalCents);
  const count = Math.floor(parts);
  if (count <= 0) return [];
  if (count === 1) return [total];
  const base = Math.floor(total / count);
  const out: number[] = [];
  let assigned = 0;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const value = isLast ? total - assigned : base;
    assigned += value;
    out.push(value);
  }
  return out;
}

/**
 * Rateio PROPORCIONAL a pesos (ex.: dividir uma taxa entre procedimentos pelo
 * valor de cada um). O resíduo vai para o maior peso — não para o último —
 * porque em rateio a distorção deve cair onde ela pesa relativamente menos.
 */
export function allocateProportional(
  totalCents: number,
  weights: number[]
): number[] {
  const total = roundHalfUp(totalCents);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return splitAmount(total, weights.length);

  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = raw.map((v) => Math.floor(v));
  let rest = total - out.reduce((s, v) => s + v, 0);
  // Distribui o resíduo começando por quem tem maior parte fracionária.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (rest > 0 && order.length > 0) {
    out[order[k % order.length].i] += 1;
    rest -= 1;
    k += 1;
  }
  return out;
}

/** Soma segura de centavos (protege contra NaN vindo de campo vazio). */
export function sumCents(values: (number | null | undefined)[]): number {
  return values.reduce<number>(
    (s, v) => s + (Number.isFinite(v) ? (v as number) : 0),
    0
  );
}
