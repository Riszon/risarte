// Risarte Empresarial — AS CONDIÇÕES COMERCIAIS DA PROPOSTA (OC-00083, H3).
//
// Faixas de preço por quantidade, preço de dependente em pacote, implantação
// fixa ou por adesão, e os limites de adesão e de valor. Tudo puro e em
// CENTAVOS — é dinheiro, e regra de dinheiro não mora em componente de tela
// (invariante que o Financeiro impôs e vale aqui igual).

export type FaixaDePreco = {
  /** A partir de quantas adesões esta faixa passa a valer. */
  minQuantity: number;
  /** Por titular, ou da empresa inteira — depende da base da proposta. */
  priceCents: number;
};

/**
 * QUAL FAIXA VALE PARA ESTA QUANTIDADE.
 *
 * ⚠️ A FAIXA DO TOTAL VALE PARA TODOS (decisão do dono, 23/09/2026): 120
 * adesões pagam 120 × o preço da faixa de 120. É simples de explicar e de
 * conferir na fatura; o efeito colateral assumido é que passar de 99 para 100
 * barateia todo mundo de uma vez.
 *
 * Sem faixa que alcance a quantidade, vale o preço combinado na proposta —
 * incluindo o caso de não haver faixa nenhuma, que é o normal.
 */
export function precoDaFaixa(
  faixas: readonly FaixaDePreco[],
  quantidade: number,
  precoBaseCents: number
): { precoCents: number; faixa: FaixaDePreco | null } {
  let escolhida: FaixaDePreco | null = null;
  for (const f of faixas) {
    if (quantidade >= f.minQuantity) {
      // A MAIOR faixa que a quantidade alcança. Ordenar a lista antes seria
      // depender de quem chama; aqui a resposta não muda com a ordem.
      if (!escolhida || f.minQuantity > escolhida.minQuantity) escolhida = f;
    }
  }
  return {
    precoCents: escolhida ? escolhida.priceCents : precoBaseCents,
    faixa: escolhida,
  };
}

/**
 * O que impede a tabela de faixas de fazer sentido.
 *
 * Não é validação de formulário — é a régua que impede uma tabela que o
 * cliente vai ler e não entender.
 */
export function problemasDasFaixas(faixas: readonly FaixaDePreco[]): string[] {
  const p: string[] = [];
  const vistas = new Set<number>();
  for (const f of faixas) {
    if (f.minQuantity < 1) p.push("a faixa começa a partir de 1 adesão");
    if (f.priceCents < 0) p.push("o preço da faixa não pode ser negativo");
    if (vistas.has(f.minQuantity)) {
      p.push(`há duas faixas começando em ${f.minQuantity}`);
    }
    vistas.add(f.minQuantity);
  }
  // ⚠️ FAIXA MAIS CARA PARA QUANTIDADE MAIOR É AVISO, NÃO ERRO. Quase sempre é
  // digitação trocada — a ideia da faixa é baratear com volume —, mas existe
  // negociação em que o volume custa mais (atendimento dedicado). O sistema
  // diz o que vê; quem decide é quem vende.
  const ordenadas = [...faixas].sort((a, z) => a.minQuantity - z.minQuantity);
  for (let i = 1; i < ordenadas.length; i += 1) {
    if (ordenadas[i].priceCents > ordenadas[i - 1].priceCents) {
      p.push(
        `a faixa de ${ordenadas[i].minQuantity} custa MAIS que a de ${ordenadas[i - 1].minQuantity} — confira se não trocou os valores`
      );
    }
  }
  return p;
}

/**
 * ⚠️ A CONTA DOS DEPENDENTES SAIU DAQUI (24/09/2026), e a decisão é do dono.
 *
 * Existia `custoDosDependentes`, que estimava o total do pacote familiar
 * supondo distribuição por igual entre os titulares — e declarava a
 * estimativa. Ele cortou pela raiz: **a proposta não calcula valor de
 * dependente**, porque na contratação ninguém sabe quantos entram nem de
 * quais titulares, e o pacote é POR titular.
 *
 * O que a proposta faz agora é mostrar a TABELA (individual, pacote familiar
 * e extra) e dizer que o total sai na implantação, quando os cadastros
 * existem. Quem soma de verdade é `computeMonthlyCents`, família a família.
 *
 * A função foi REMOVIDA em vez de ficar sem uso: regra que o dono rejeitou,
 * guardada no código, é regra que volta a ser chamada por engano.
 *
 * (26/10/2026: a estimativa voltou, mas SÓ para a simulação na tela — ver
 * `estimativaDosDependentes` abaixo. O documento segue sem ela.)
 */

export type ConfigDosDependentes = {
  modo: "PER_DEPENDENT" | "FAMILY_PACKAGE";
  dependentes: number;
  /** Valor de UM dependente — vale no individual e é a alternativa no pacote. */
  individualCents: number;
  pacoteCents: number;
  /** Quantos dependentes de um mesmo titular o pacote cobre. */
  pacoteCobre: number;
  extraCents: number;
  /** Quantos titulares levam dependentes. Null = ninguém informou. */
  titularesComDependentes: number | null;
};

export type EstimativaDosDependentes = {
  totalCents: number;
  /** Como a conta foi feita, em uma linha — a tela mostra junto do número. */
  explicacao: string;
  /** Pacote sem "titulares com dependentes": a conta caiu no individual. */
  caiuNoIndividual: boolean;
};

/**
 * ⚠️ A ESTIMATIVA DOS DEPENDENTES VOLTOU — SÓ PARA A TELA (dono, 26/10/2026).
 *
 * Pedido: *"quando estou gerando uma simulação de proposta não aparece o valor
 * dos dependentes"*. Quem monta a proposta precisa enxergar quanto os
 * dependentes somam para negociar. A decisão de 24/09 continua de pé para o
 * DOCUMENTO: `simularProposta` segue sem somar dependente, e esta função não
 * é chamada pela proposta impressa nem pela cobrança.
 *
 * No pacote, os dependentes se dividem por igual entre os titulares que têm
 * dependentes, e cada família fica com o mais barato entre o pacote e o
 * individual — uma família de um só dependente não compraria o pacote.
 */
export function estimativaDosDependentes(
  c: ConfigDosDependentes
): EstimativaDosDependentes {
  const deps = Math.max(0, Math.floor(c.dependentes));
  const individual = Math.max(0, c.individualCents);
  const reais = (v: number) => `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
  if (deps === 0) {
    return { totalCents: 0, explicacao: "Nenhum dependente estimado.", caiuNoIndividual: false };
  }

  const porIndividual = {
    totalCents: deps * individual,
    explicacao: `${deps} × ${reais(individual)} por dependente`,
  };
  if (c.modo === "PER_DEPENDENT") return { ...porIndividual, caiuNoIndividual: false };

  const familias = Math.min(deps, Math.floor(c.titularesComDependentes ?? 0));
  if (familias <= 0) {
    return {
      totalCents: porIndividual.totalCents,
      explicacao: `${porIndividual.explicacao} — informe quantos titulares têm dependentes para calcular o pacote`,
      caiuNoIndividual: true,
    };
  }

  const cobre = Math.max(1, Math.floor(c.pacoteCobre));
  const custoDaFamilia = (n: number) =>
    Math.min(
      n * individual,
      Math.max(0, c.pacoteCents) + Math.max(0, n - cobre) * Math.max(0, c.extraCents)
    );
  // Divisão por igual: as primeiras `resto` famílias levam um dependente a mais.
  const base = Math.floor(deps / familias);
  const resto = deps % familias;
  const totalCents =
    resto * custoDaFamilia(base + 1) + (familias - resto) * custoDaFamilia(base);
  return {
    totalCents,
    explicacao: `${deps} dependentes em ${familias} família${familias === 1 ? "" : "s"} (~${(deps / familias).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por titular)`,
    caiuNoIndividual: false,
  };
}

/**
 * O TOTAL DE CADA FAIXA, para quem monta a proposta (dono, 26/10/2026).
 *
 * Só tela: o documento continua mostrando o preço unitário da faixa. Na base
 * por titular, é a quantidade de início × o preço; na fixa, o preço já é o
 * total da empresa.
 */
export function totalDaFaixa(f: FaixaDePreco, porTitular: boolean): number {
  return porTitular ? Math.max(0, f.minQuantity) * Math.max(0, f.priceCents) : Math.max(0, f.priceCents);
}

// ⚠️ `custoDaImplantacao` (por adesão × titulares, ou fixa) foi REMOVIDA no
// AP18 (27/09/2026): a implantação é SEMPRE o 1º pagamento, decisão do dono.
// A cobrança nunca a usou — a proposta prometia um número e o boleto cobrava
// outro. Mesmo critério de acima: regra rejeitada não fica guardada.

export type LimitesDeAdesao = {
  min: number | null;
  max: number | null;
  alvo: "HOLDERS" | "DEPENDENTS" | "BOTH" | null;
};

export type AvisoDeCondicao = {
  /** `bloqueia` impede seguir; `avisa` só aparece. */
  gravidade: "avisa" | "bloqueia";
  texto: string;
};

/**
 * OS LIMITES DE ADESÃO — e o que acontece quando a quantidade sai deles.
 *
 * ⚠️ Decisão do dono: **abaixo do mínimo AVISA; acima do máximo BLOQUEIA.**
 * A assimetria não é descuido. Abaixo do mínimo a empresa pode estar entrando
 * aos poucos, e barrar adesão é barrar receita; acima do máximo o limite
 * costuma ser capacidade de atendimento, e furá-lo é prometer o que não se
 * entrega.
 */
export function avisosDosLimites(
  limites: LimitesDeAdesao,
  titulares: number,
  dependentes: number
): AvisoDeCondicao[] {
  if (limites.min == null && limites.max == null) return [];
  const alvo = limites.alvo ?? "HOLDERS";
  const quantidade =
    alvo === "HOLDERS" ? titulares : alvo === "DEPENDENTS" ? dependentes : titulares + dependentes;
  const oQue =
    alvo === "HOLDERS" ? "titulares" : alvo === "DEPENDENTS" ? "dependentes" : "adesões";

  const avisos: AvisoDeCondicao[] = [];
  if (limites.min != null && quantidade < limites.min) {
    avisos.push({
      gravidade: "avisa",
      texto: `Abaixo do mínimo combinado: ${quantidade} ${oQue}, mínimo de ${limites.min}.`,
    });
  }
  if (limites.max != null && quantidade > limites.max) {
    avisos.push({
      gravidade: "bloqueia",
      texto: `Acima do máximo combinado: ${quantidade} ${oQue}, máximo de ${limites.max}.`,
    });
  }
  return avisos;
}

/** O valor mínimo da proposta: aviso, nunca trava — quem decide é quem vende. */
export function avisoDoValorMinimo(
  minimoCents: number | null,
  mensalidadeCents: number
): AvisoDeCondicao | null {
  if (minimoCents == null || minimoCents <= 0) return null;
  if (mensalidadeCents >= minimoCents) return null;
  const falta = ((minimoCents - mensalidadeCents) / 100).toFixed(2).replace(".", ",");
  return {
    gravidade: "avisa",
    texto: `A mensalidade está abaixo do mínimo desta negociação — faltam R$ ${falta}.`,
  };
}

/** Como a faixa é escrita no documento e na tela. */
export function rotuloDaFaixa(f: FaixaDePreco, porTitular: boolean): string {
  const reais = (f.priceCents / 100).toFixed(2).replace(".", ",");
  return porTitular
    ? `A partir de ${f.minQuantity} titulares: R$ ${reais} por titular`
    : `A partir de ${f.minQuantity} adesões: R$ ${reais} por mês`;
}
