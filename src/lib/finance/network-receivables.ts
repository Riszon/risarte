/**
 * OS RECEBÍVEIS DA REDE — as regras da tela da Franqueadora (OC-00005).
 *
 * Puro e com teste, como `network-panel.ts` (FIN8.3): a tela desenha, aqui se
 * decide.
 */

export type UnidadeRecebivel = {
  clinicId: string;
  nome: string;
  ownership: "own" | "franchised";
  abertoCents: number;
  vencidoCents: number;
  vencidoQuantidade: number;
  abertoQuantidade: number;
  /** `null` quando a unidade não tem nada a receber. */
  taxaPercent: number | null;
  /** O teto da unidade, resolvido pela cascata rede → unidade. */
  limitePercent: number | null;
  aVencer: [number, number, number, number];
  atrasadas: [number, number, number, number];
};

/**
 * A TAXA DA REDE — soma em cima, soma embaixo.
 *
 * ⚠️ **NÃO É A MÉDIA DAS TAXAS DAS UNIDADES**, e a diferença não é sutil: a
 * média simples dá o mesmo peso a uma unidade com R$ 500 a receber e a outra
 * com R$ 500 mil. Uma unidade pequena com tudo vencido jogaria a taxa da rede
 * para cima e a Franqueadora iria atrás do problema errado; uma unidade grande
 * afundando ficaria diluída no meio de várias pequenas em dia.
 *
 * Devolve `null` quando a rede não tem nada a receber — 0% se leria como "está
 * tudo em dia", quando a verdade é "não há o que medir".
 */
export function taxaDaRede(unidades: UnidadeRecebivel[]): number | null {
  const aberto = unidades.reduce((s, u) => s + u.abertoCents, 0);
  if (aberto <= 0) return null;
  const vencido = unidades.reduce((s, u) => s + u.vencidoCents, 0);
  return Math.round((vencido * 10000) / aberto) / 100;
}

/** A unidade passou do teto que a rede definiu para ela? */
export function acimaDoLimite(u: UnidadeRecebivel): boolean {
  return (
    u.taxaPercent !== null &&
    u.limitePercent !== null &&
    u.taxaPercent > u.limitePercent
  );
}

/**
 * ORDEM DE ATENÇÃO: quem está pior primeiro.
 *
 * ⚠️ ACIMA DO LIMITE VEM ANTES, E DENTRE ESSAS MANDA O VALOR VENCIDO, não a
 * taxa. Ordenar só por taxa colocaria na frente a unidade com R$ 300 vencidos e
 * 100% de inadimplência, e deixaria para depois a que tem R$ 80 mil vencidos e
 * 12% — e é atrás dos R$ 80 mil que se vai primeiro. A taxa diz se a unidade
 * está doente; o valor diz o tamanho do problema.
 *
 * Unidade sem nada a receber vai para o fim: não há o que cobrar nela.
 */
export function porAtencao(a: UnidadeRecebivel, b: UnidadeRecebivel): number {
  const rank = (u: UnidadeRecebivel) =>
    u.taxaPercent === null ? 2 : acimaDoLimite(u) ? 0 : 1;
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  if (a.vencidoCents !== b.vencidoCents) return b.vencidoCents - a.vencidoCents;
  return a.nome.localeCompare(b.nome);
}

export type TotaisDaRede = {
  unidades: number;
  abertoCents: number;
  vencidoCents: number;
  vencidoQuantidade: number;
  taxaPercent: number | null;
  /** Quantas unidades passaram do próprio teto. */
  acimaDoLimite: number;
  /** Quantas não têm nada a receber — nem boas nem ruins, apenas sem dado. */
  semReceber: number;
  aVencer: [number, number, number, number];
  atrasadas: [number, number, number, number];
};

export function totaisDaRede(unidades: UnidadeRecebivel[]): TotaisDaRede {
  const soma4 = (
    pega: (u: UnidadeRecebivel) => [number, number, number, number]
  ): [number, number, number, number] =>
    unidades.reduce<[number, number, number, number]>(
      (acc, u) => {
        const v = pega(u);
        return [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2], acc[3] + v[3]];
      },
      [0, 0, 0, 0]
    );

  return {
    unidades: unidades.length,
    abertoCents: unidades.reduce((s, u) => s + u.abertoCents, 0),
    vencidoCents: unidades.reduce((s, u) => s + u.vencidoCents, 0),
    vencidoQuantidade: unidades.reduce((s, u) => s + u.vencidoQuantidade, 0),
    taxaPercent: taxaDaRede(unidades),
    acimaDoLimite: unidades.filter(acimaDoLimite).length,
    semReceber: unidades.filter((u) => u.taxaPercent === null).length,
    aVencer: soma4((u) => u.aVencer),
    atrasadas: soma4((u) => u.atrasadas),
  };
}
