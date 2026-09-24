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

export type PrecoDeDependente = {
  /** `PER_DEPENDENT` = um valor por dependente (o de sempre). */
  modo: "PER_DEPENDENT" | "FAMILY_PACKAGE";
  individualCents: number;
  /** Pacote que cobre até `tamanhoDaFamilia` dependentes de um mesmo titular. */
  familiaCents: number;
  /** Cada dependente acima do pacote. */
  extraCents: number;
  tamanhoDaFamilia: number;
};

export type ContaDosDependentes = {
  totalCents: number;
  /** A conta é estimativa? O pacote familiar precisa supor a distribuição. */
  estimado: boolean;
  /** Uma linha explicando de onde saiu o número. */
  explicacao: string;
};

/**
 * QUANTO OS DEPENDENTES CUSTAM POR MÊS.
 *
 * ⚠️ O PACOTE FAMILIAR É POR TITULAR, e na hora da proposta ninguém sabe como
 * os dependentes vão se distribuir — só o total estimado. A conta supõe que
 * eles se dividem por igual entre os titulares que terão dependentes, e
 * DECLARA que é estimativa. Fingir precisão aqui seria pior: a primeira
 * fatura, calculada família a família, não bateria e ninguém saberia por quê.
 *
 * Sem saber quantos titulares terão dependentes, o pacote não tem como ser
 * estimado — a conta cai no valor individual e diz isso.
 */
export function custoDosDependentes(
  preco: PrecoDeDependente,
  dependentes: number,
  titularesComDependentes: number | null
): ContaDosDependentes {
  const d = Math.max(0, Math.floor(dependentes));
  if (d === 0) {
    return { totalCents: 0, estimado: false, explicacao: "Sem dependentes nesta fase." };
  }

  if (preco.modo === "PER_DEPENDENT") {
    return {
      totalCents: d * Math.max(0, preco.individualCents),
      estimado: false,
      explicacao: `${d} dependente(s) × valor por dependente.`,
    };
  }

  const titulares = Math.floor(titularesComDependentes ?? 0);
  if (titulares <= 0) {
    return {
      totalCents: d * Math.max(0, preco.individualCents),
      estimado: true,
      explicacao:
        "Sem saber quantos titulares terão dependentes, a conta usa o valor individual para todos.",
    };
  }

  const tamanho = Math.max(1, Math.floor(preco.tamanhoDaFamilia));
  // Distribuição por igual: o resto vai para os primeiros titulares, um a
  // cada, como a última parcela que absorve o resíduo no resto do sistema.
  const base = Math.floor(d / titulares);
  const sobra = d % titulares;

  let total = 0;
  for (let i = 0; i < titulares; i += 1) {
    const deste = base + (i < sobra ? 1 : 0);
    if (deste <= 0) continue;
    if (deste === 1) {
      total += Math.max(0, preco.individualCents);
    } else if (deste <= tamanho) {
      total += Math.max(0, preco.familiaCents);
    } else {
      total +=
        Math.max(0, preco.familiaCents) +
        (deste - tamanho) * Math.max(0, preco.extraCents);
    }
  }

  return {
    totalCents: total,
    estimado: true,
    explicacao: `Estimativa: ${d} dependente(s) divididos entre ${titulares} titular(es), pacote de até ${tamanho}.`,
  };
}

/** A implantação: um valor fixo pela empresa, ou por adesão. */
export function custoDaImplantacao(
  modo: "PER_ADHESION" | "FIXED" | null,
  porAdesaoCents: number,
  fixoCents: number,
  titulares: number
): number {
  if (modo === "FIXED") return Math.max(0, fixoCents);
  return Math.max(0, Math.floor(titulares)) * Math.max(0, porAdesaoCents);
}

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
