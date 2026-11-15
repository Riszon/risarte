// ASA4 (4013, spec 19.19): o CARTÃO PARCELADO PELO ASAAS — regras puras.
//
// Medido no sandbox (19.19.1 e 19.19.2), centavo a centavo em 42 parcelas:
//   - valores iguais, com a sobra dos centavos na ÚLTIMA parcela;
//   - vencimentos mês a mês, no mesmo dia do 1º;
//   - tarifa da parcela = a × V (cortado no centavo) + b ÷ n (cortado no centavo):
//     a parte fixa sai UMA vez por parcelamento, rateada;
//   - split (Método B): q = p ÷ (1 − a), em 4 casas; F = q × (b ÷ n), no centavo.

export const MAXIMO_DE_PARCELAS = 21;
/** Acima disto, só Visa e Mastercard (documentação do Asaas). */
export const MAXIMO_DEMAIS_BANDEIRAS = 12;

/** Os valores das parcelas como o Asaas faz: iguais, a sobra na última. */
export function valoresDoBloco(totalCents: number, n: number): number[] {
  if (n < 1) return [];
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? totalCents - base * (n - 1) : base));
}

/** O dia k meses depois (AAAA-MM-DD), como o Asaas: o mesmo dia do mês (até o dia 28). */
export function mesesDepois(iso: string, k: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, d));
  return t.toISOString().slice(0, 10);
}

/** As datas das parcelas como o Asaas faz: mês a mês, no dia do 1º vencimento. */
export function datasDoBloco(primeiro: string, n: number): string[] {
  return Array.from({ length: n }, (_, k) => mesesDepois(primeiro, k));
}

/** Por que o bloco não bate com o Asaas (ou null). Espelha `_card_block_check`. */
export function erroDoBloco(linhas: { due_date: string; amount_cents: number }[]): string | null {
  const n = linhas.length;
  if (n === 0) return null;
  if (n < 2) return "O cartão parcelado pelo Asaas precisa de pelo menos 2 parcelas.";
  if (n > MAXIMO_DE_PARCELAS) return `O cartão parcelado pelo Asaas vai até ${MAXIMO_DE_PARCELAS} parcelas.`;
  const ord = [...linhas].sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (Number(ord[0].due_date.slice(8, 10)) > 28) return "No cartão parcelado pelo Asaas, o 1º vencimento tem de ser até o dia 28.";
  const datas = datasDoBloco(ord[0].due_date, n);
  if (ord.some((l, k) => l.due_date.slice(0, 10) !== datas[k]))
    return "No cartão parcelado pelo Asaas, as parcelas vencem mês a mês, no mesmo dia do 1º vencimento.";
  const total = ord.reduce((s, l) => s + Number(l.amount_cents), 0);
  const valores = valoresDoBloco(total, n);
  if (ord.some((l, k) => Number(l.amount_cents) !== valores[k]))
    return "No cartão parcelado pelo Asaas, as parcelas têm o mesmo valor e a sobra dos centavos fica na última.";
  return null;
}

/** Uma faixa de tarifa do parcelado da conta (`card_block_fee_table`). */
export type FaixaDoParcelado = { de: number; ate: number; pct: number; fixo: number };

export function faixaDe(faixas: FaixaDoParcelado[], n: number): FaixaDoParcelado | null {
  const ok = faixas.filter((f) => n >= Number(f.de) && n <= Number(f.ate));
  if (!ok.length) return null;
  // Mais de uma vigente (promoção começando/terminando): a menor, como no split.
  return ok.reduce((m, f) => (Number(f.pct) < Number(m.pct) ? f : m));
}

const corte = (x: number) => Math.floor(x + 1e-7);

/** A tarifa do Asaas numa parcela de V centavos de um parcelamento de n (regra medida no sandbox). */
export function tarifaDaParcela(valorCents: number, n: number, faixa: { pct: number; fixo: number }): number {
  return corte((Number(faixa.pct) / 100) * valorCents) + Math.floor(Number(faixa.fixo) / n);
}

export type CustoDoParcelamento = {
  parcelas: number;
  valorDaParcelaCents: number;
  tarifaCents: number;
  redeCents: number;
  /** O que fica para a unidade: total − tarifa do Asaas − taxas da rede. */
  unidadeCents: number;
  /** Acima de 12×: só Visa e Mastercard. */
  soVisaEMaster: boolean;
};

/** O custo do parcelamento para a unidade (a unidade absorve a tarifa; o paciente não paga juros). */
export function custoDoParcelamento(totalCents: number, n: number, faixa: { pct: number; fixo: number }, redePercent: number): CustoDoParcelamento {
  const valores = valoresDoBloco(totalCents, n);
  const tarifa = valores.reduce((s, v) => s + tarifaDaParcela(v, n, faixa), 0);
  const rede = Math.round((totalCents * Number(redePercent)) / 100);
  return {
    parcelas: n,
    valorDaParcelaCents: valores[0] ?? 0,
    tarifaCents: tarifa,
    redeCents: rede,
    unidadeCents: totalCents - tarifa - rede,
    soVisaEMaster: n > MAXIMO_DEMAIS_BANDEIRAS,
  };
}

/** A tabela do fechamento: de 2 até o teto (o menor entre a regra comercial e 21). */
export function tabelaDeCusto(totalCents: number, teto: number, faixas: FaixaDoParcelado[], redePercent: number): CustoDoParcelamento[] {
  const max = Math.min(Math.max(2, Math.floor(teto)), MAXIMO_DE_PARCELAS);
  const out: CustoDoParcelamento[] = [];
  for (let n = 2; n <= max; n++) {
    const f = faixaDe(faixas, n);
    if (f) out.push(custoDoParcelamento(totalCents, n, f, redePercent));
  }
  return out;
}
