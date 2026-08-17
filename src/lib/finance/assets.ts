// Bens do imobilizado e depreciação.
//
// COMPRAR UM BEM NÃO É GASTAR — a mesma regra que já vale para o estoque. Uma
// cadeira de R$ 30 mil não afunda o mês em que foi comprada: ela vira R$ 250
// por mês durante dez anos, que é o que de fato custa usá-la. É essa conta que
// faz a DRE dizer a verdade sobre o mês.
//
// Duas regras carregam o resto:
//
//   • A ÚLTIMA PARCELA ABSORVE O RESÍDUO — igual às parcelas de venda
//     (invariante do módulo financeiro). Sem ela, R$ 10.000 em 36 meses
//     deixaria centavos órfãos e o bem nunca zeraria.
//   • COMEÇA NO MÊS SEGUINTE À ENTRADA EM USO, que é diferente da data da
//     compra: equipamento comprado em dezembro e instalado em fevereiro só
//     deprecia a partir de março.

import { roundHalfUp } from "./money";

export type Asset = {
  costCents: number;
  residualCents: number;
  usefulLifeMonths: number;
};

/** O valor de um mês cheio. O último mês pode ser diferente — ver `schedule`. */
export function monthlyDepreciation(asset: Asset): number {
  const base = Math.max(0, asset.costCents - asset.residualCents);
  const months = Math.max(1, Math.round(asset.usefulLifeMonths));
  return roundHalfUp(base / months);
}

/**
 * Quanto depreciar num mês, dado o que já foi depreciado.
 *
 * NUNCA DEPRECIA ALÉM DO CUSTO: o último mês leva só o que sobrou, e bem
 * totalmente depreciado devolve zero. Um bem que continuasse depreciando viraria
 * despesa eterna de algo que já não vale nada.
 */
export function depreciationForMonth(
  asset: Asset,
  alreadyDepreciatedCents: number
): number {
  const base = Math.max(0, asset.costCents - asset.residualCents);
  const remaining = base - Math.max(0, alreadyDepreciatedCents);
  if (remaining <= 0) return 0;
  return Math.min(monthlyDepreciation(asset), remaining);
}

/** Valor contábil: o que o bem ainda "vale" nos livros. */
export function bookValue(
  asset: Asset,
  alreadyDepreciatedCents: number
): number {
  return Math.max(0, asset.costCents - Math.max(0, alreadyDepreciatedCents));
}

/**
 * A série inteira, mês a mês. Serve para conferir que a soma fecha EXATAMENTE
 * com o valor depreciável — é o teste que impede o centavo órfão.
 */
export function depreciationSchedule(asset: Asset): number[] {
  const out: number[] = [];
  let done = 0;
  const base = Math.max(0, asset.costCents - asset.residualCents);
  let guard = 0;
  while (done < base && guard < 1200) {
    const amount = depreciationForMonth(asset, done);
    if (amount <= 0) break;
    out.push(amount);
    done += amount;
    guard += 1;
  }
  return out;
}

/**
 * O primeiro mês de competência da depreciação.
 *
 * Convenção contábil: o mês SEGUINTE à entrada em uso. Depreciar meio mês
 * exigiria uma conta proporcional que ninguém confere e que muda o resultado
 * por centavos.
 */
export function firstDepreciationMonth(inServiceDate: string): string {
  const [y, m] = inServiceDate.slice(0, 7).split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  return `${year}-${String(nextMonth).padStart(2, "0")}`;
}

/** Já pode depreciar neste mês? */
export function isDepreciable(
  inServiceDate: string,
  month: string
): boolean {
  return month >= firstDepreciationMonth(inServiceDate);
}

/** Erros que impedem cadastrar um bem. Vazio = pode gravar. */
export function assetErrors(input: {
  name: string;
  costCents: number | null;
  usefulLifeMonths: number;
  acquisitionDate: string;
  inServiceDate: string;
}): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Informe o nome do bem.");
  if (!input.costCents || input.costCents <= 0) {
    errors.push("Informe o valor de aquisição.");
  }
  if (!Number.isFinite(input.usefulLifeMonths) || input.usefulLifeMonths <= 0) {
    errors.push("Informe a vida útil em meses.");
  }
  if (
    input.acquisitionDate &&
    input.inServiceDate &&
    input.inServiceDate < input.acquisitionDate
  ) {
    // Entrar em uso antes de existir é erro de digitação, e faria a
    // depreciação começar antes da compra.
    errors.push("A entrada em uso não pode ser anterior à aquisição.");
  }
  return errors;
}
