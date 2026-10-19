// O PROCEDIMENTO NA LISTA (pedido do dono, 19/10/2026).
//
// A lista de Procedimentos virou blocos por especialidade, com uma linha de
// resumo por procedimento. Cada linha diz o que FALTA para o procedimento
// estar pronto para o orçamento, quanto sobra do preço depois do material e
// do repasse, e quanto ele é usado. As contas moram aqui — puras e testadas —
// para a tela só desenhar.

export type Pendencia = "preco" | "tempo" | "pilar" | "repasse";

export const ROTULO_DA_PENDENCIA: Record<Pendencia, string> = {
  preco: "preço",
  tempo: "tempo",
  pilar: "pilar",
  repasse: "repasse",
};

export type DadosDaPendencia = {
  defaultPriceCents: number;
  estimatedMinutes: number | null;
  /** Sessões do protocolo da rede. */
  sessionsCount: number;
  pillar: string | null;
  /** Níveis do plano de carreira que existem. */
  levelIds: string[];
  /** Repasse vigente por nível (só os níveis que TÊM valor). */
  payoutByLevel: Record<string, { amountCents: number }>;
};

/**
 * O que falta para o procedimento estar pronto para o orçamento.
 *  - preço: R$ 0,00 — desde a 0306 o item do plano usa o preço do catálogo;
 *  - tempo: sem sessões e sem tempo estimado (a agenda não sabe a duração);
 *  - pilar: sem pilar da Metodologia;
 *  - repasse: algum nível sem valor (a apuração do dentista daria zero).
 * Sem níveis cadastrados, o repasse não é cobrado — não há o que preencher.
 */
export function pendenciasDoProcedimento(d: DadosDaPendencia): Pendencia[] {
  const faltas: Pendencia[] = [];
  if (!(d.defaultPriceCents > 0)) faltas.push("preco");
  if (d.sessionsCount === 0 && !(d.estimatedMinutes && d.estimatedMinutes > 0)) faltas.push("tempo");
  if (!d.pillar) faltas.push("pilar");
  if (d.levelIds.some((id) => !d.payoutByLevel[id])) faltas.push("repasse");
  return faltas;
}

export type Sobra = {
  /** Preço − material − o MAIOR repasse entre os níveis (o pior caso). */
  sobraCents: number;
  /** Sobre o preço, inteiro. */
  percentual: number;
  negativa: boolean;
};

/**
 * Quanto sobra do preço depois do material do kit e do repasse do dentista.
 * Usa o MAIOR repasse (o nível mais caro): é o pior caso, e é ele que importa
 * para saber se o preço aguenta. Sem preço, não há conta (nulo) — "0%" seria
 * lido como "não sobra nada", e não é isso: falta o preço.
 * NÃO é a margem completa: cadeira, imposto e taxa ficam na Precificação.
 */
export function sobraDoPreco(
  priceCents: number,
  materialCents: number,
  payoutByLevel: Record<string, { amountCents: number }>
): Sobra | null {
  if (!(priceCents > 0)) return null;
  const repasses = Object.values(payoutByLevel).map((v) => v.amountCents);
  const maiorRepasse = repasses.length > 0 ? Math.max(...repasses) : 0;
  const sobraCents = priceCents - Math.max(0, materialCents) - Math.max(0, maiorRepasse);
  return {
    sobraCents,
    percentual: Math.round((sobraCents / priceCents) * 100),
    negativa: sobraCents < 0,
  };
}

/** O nome do bloco: a especialidade, ou "Sem especialidade". */
export const SEM_ESPECIALIDADE = "Sem especialidade";

/**
 * Agrupa por especialidade, na ordem da lista de especialidades (a da tela de
 * Especialidades); as que não estão na lista vêm depois, em ordem alfabética;
 * "Sem especialidade" por último. Dentro do bloco, a ordem recebida.
 */
export function agruparPorEspecialidade<T extends { specialty: string | null }>(
  itens: T[],
  ordem: string[]
): { especialidade: string; itens: T[] }[] {
  const mapa = new Map<string, T[]>();
  for (const it of itens) {
    const chave = it.specialty?.trim() || SEM_ESPECIALIDADE;
    const lista = mapa.get(chave);
    if (lista) lista.push(it);
    else mapa.set(chave, [it]);
  }
  const posicao = (e: string) => {
    if (e === SEM_ESPECIALIDADE) return Number.MAX_SAFE_INTEGER;
    const i = ordem.indexOf(e);
    return i === -1 ? ordem.length : i;
  };
  return [...mapa.entries()]
    .sort((a, b) => posicao(a[0]) - posicao(b[0]) || a[0].localeCompare(b[0], "pt-BR"))
    .map(([especialidade, lista]) => ({ especialidade, itens: lista }));
}

/** Uso em planos: frase curta. Nulo = não foi possível medir (nunca "0"). */
export function textoDoUso(planos: number | null): string | null {
  if (planos === null) return null;
  if (planos === 0) return "não usado em 90 dias";
  return planos === 1 ? "1 plano em 90 dias" : `${planos} planos em 90 dias`;
}
