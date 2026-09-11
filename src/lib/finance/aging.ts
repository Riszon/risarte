/**
 * AS FAIXAS DE PRAZO DOS RECEBÍVEIS (relato OC-00005).
 *
 * ⚠️ ISTO É UMA REGRA, NÃO UM DETALHE DE TELA — por isso mora aqui, puro e com
 * teste. Escada de prazo é o tipo de conta que erra **por um dia**, em silêncio:
 * o que vence exatamente daqui a 30 dias cai na primeira faixa ou na segunda? O
 * que está vencido há 60 dias é "31 a 60" ou "61 a 90"? Errado, o total continua
 * batendo (nada se perde, só troca de coluna) e ninguém descobre — e é sobre
 * essas colunas que se decide antecipar recebível e priorizar cobrança.
 *
 * A convenção, escrita uma vez: a faixa "até N dias" inclui o dia N.
 *   0..30 → "Até 30 dias" · 31..60 → "31 a 60" · 61..90 → "61 a 90" · 91+ → "Mais de 90"
 */

export const AGING_LIMITS = [30, 60, 90] as const;

export const AGING_LABELS = [
  "Até 30 dias",
  "31 a 60 dias",
  "61 a 90 dias",
  "Mais de 90 dias",
] as const;

export type AgingBand = {
  rotulo: string;
  cents: number;
  quantidade: number;
};

/**
 * Em qual faixa cai um prazo de `dias`.
 *
 * `dias` é sempre a DISTÂNCIA, nunca um sinal: para o que vai vencer é quantos
 * dias faltam; para o vencido é há quantos dias venceu. Quem chama já escolheu
 * a direção — misturar as duas numa escada só juntaria "vence semana que vem"
 * com "parado há seis meses", que pedem decisões opostas.
 *
 * Negativo cai na primeira faixa: quem passa um número negativo aqui já errou a
 * direção antes, e espalhar o erro por todas as colunas esconderia isso.
 */
export function agingBand(dias: number): number {
  for (let i = 0; i < AGING_LIMITS.length; i++) {
    if (dias <= AGING_LIMITS[i]) return i;
  }
  return AGING_LIMITS.length;
}

/**
 * Distância em dias entre duas datas civis ISO ("2026-09-10").
 *
 * ⚠️ NÃO PASSA PELO FUSO DA MÁQUINA. `new Date("2026-09-10")` é lido como UTC e
 * `new Date("2026-09-10T00:00:00")` é lido no relógio local — as duas formas já
 * custaram bug neste projeto. Aqui a conta é feita sobre a data civil, com
 * `Date.UTC`, e o resultado é o mesmo em qualquer servidor.
 */
export function daysApart(deIso: string, ateIso: string): number {
  const [ay, am, ad] = deIso.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = ateIso.slice(0, 10).split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

/**
 * Agrupa itens nas quatro faixas, somando o valor de cada uma.
 *
 * Todo item entra em exatamente uma faixa, então **a soma das faixas é a soma
 * dos itens** — é essa propriedade que permite conferir a tela somando as
 * colunas com o dedo, e há teste que a prende.
 */
export function groupByAging<T>(
  items: T[],
  dias: (item: T) => number,
  cents: (item: T) => number
): AgingBand[] {
  const faixas: AgingBand[] = AGING_LABELS.map((rotulo) => ({
    rotulo,
    cents: 0,
    quantidade: 0,
  }));
  for (const item of items) {
    const faixa = faixas[agingBand(dias(item))];
    faixa.cents += cents(item);
    faixa.quantidade += 1;
  }
  return faixas;
}
