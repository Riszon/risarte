// Risarte Empresarial — OS BENEFÍCIOS COMBINADOS NA PROPOSTA (OC-00083, H2).
//
// Pedido do dono: configurar procedimento a procedimento dentro da proposta,
// marcando se cada benefício vale para o TITULAR, para o DEPENDENTE ou para
// os dois; e poder aplicar um GRUPO pronto em vez de repetir a configuração
// em toda negociação.
//
// As regras moram aqui, puras, porque duas telas e o motor de orçamento fazem
// a mesma pergunta — e a resposta não pode depender de qual delas perguntou.

import { BENEFIT_TYPE_LABELS, type BenefitType } from "./constants";

export type BeneficioDaProposta = {
  procedureId: string;
  benefitType: BenefitType;
  /** % (0–100) para DISCOUNT_PERCENT; CENTAVOS para DISCOUNT_AMOUNT. */
  benefitValue: number | null;
  /** Quantos usos por janela. `null` = ilimitado. */
  usageLimitCount: number | null;
  /** Tamanho da janela em meses. `null` = sem janela. */
  usagePeriodMonths: number | null;
  /** Carência DESTE benefício, em meses, a partir da entrada da pessoa. */
  gracePeriodMonths: number;
  maxInstallments: number | null;
  forHolder: boolean;
  forDependent: boolean;
  /** Unidades onde ESTE benefício vale. Vazio/ausente = todas as da parceria. */
  clinicIds?: string[] | null;
};

/**
 * PARA QUEM VALE, nas palavras de quem lê a proposta.
 *
 * Os dois desmarcados não existem: o banco recusa, porque benefício que não
 * alcança ninguém é linha que só confunde. Quem quer tirar a cobertura usa
 * "Não coberto", que é uma decisão declarada em vez de uma omissão.
 */
export function paraQuemVale(b: Pick<BeneficioDaProposta, "forHolder" | "forDependent">): string {
  if (b.forHolder && b.forDependent) return "Titular e dependente";
  if (b.forHolder) return "Só o titular";
  if (b.forDependent) return "Só o dependente";
  return "Ninguém — corrija";
}

/** O benefício alcança esta pessoa? */
export function valeParaPessoa(
  b: Pick<BeneficioDaProposta, "forHolder" | "forDependent">,
  pessoa: "titular" | "dependente"
): boolean {
  return pessoa === "titular" ? b.forHolder : b.forDependent;
}

/**
 * O benefício em uma linha, para o documento e para a lista da tela.
 *
 * ⚠️ O VALOR SÓ APARECE ONDE ELE SIGNIFICA ALGO. "Sem custo (0%)" e "Não
 * coberto (R$ 0,00)" são frases que o sistema escreveria por descuido, e as
 * duas confundem quem lê a proposta.
 */
export function rotuloDoBeneficio(b: BeneficioDaProposta): string {
  const base = BENEFIT_TYPE_LABELS[b.benefitType];
  if (b.benefitType === "DISCOUNT_PERCENT") {
    return `${b.benefitValue ?? 0}% de desconto`;
  }
  if (b.benefitType === "DISCOUNT_AMOUNT") {
    const reais = ((b.benefitValue ?? 0) / 100).toFixed(2).replace(".", ",");
    return `R$ ${reais} de desconto`;
  }
  return base;
}

/**
 * A REGRA DE USO, quando existe.
 *
 * Limite sem janela é "3 vezes, e acabou"; janela sem limite não restringe
 * nada e por isso não vira texto — dizer "a cada 6 meses" sem dizer quantas
 * vezes sugere uma restrição que não existe.
 */
export function rotuloDoUso(b: BeneficioDaProposta): string | null {
  if (!b.usageLimitCount || b.usageLimitCount <= 0) return null;
  const vezes = b.usageLimitCount === 1 ? "1 vez" : `${b.usageLimitCount} vezes`;
  if (!b.usagePeriodMonths || b.usagePeriodMonths <= 0) return `${vezes} no total`;
  const janela =
    b.usagePeriodMonths === 1 ? "por mês" : `a cada ${b.usagePeriodMonths} meses`;
  return `${vezes} ${janela}`;
}

/** A carência do benefício, quando existe. */
export function rotuloDaCarencia(b: BeneficioDaProposta): string | null {
  if (!b.gracePeriodMonths || b.gracePeriodMonths <= 0) return null;
  return b.gracePeriodMonths === 1
    ? "após 1 mês de programa"
    : `após ${b.gracePeriodMonths} meses de programa`;
}

/**
 * AS TRÊS CATEGORIAS DA LISTA (dono, 26/10/2026): *"vai ficando uma lista
 * muito longa… deve organizar em 3 categorias (sem custo, com desconto e não
 * coberto)"*. Desconto em % e em R$ são a mesma pergunta para quem lê a
 * proposta — por isso viram uma categoria só.
 */
export const CATEGORIAS_DE_BENEFICIO = ["sem_custo", "com_desconto", "nao_coberto"] as const;
export type CategoriaDeBeneficio = (typeof CATEGORIAS_DE_BENEFICIO)[number];

export const CATEGORIA_ROTULO: Record<CategoriaDeBeneficio, string> = {
  sem_custo: "Sem custo",
  com_desconto: "Com desconto",
  nao_coberto: "Não coberto",
};

/** O tipo com que um procedimento nasce ao ser incluído direto na categoria. */
export const TIPO_DA_CATEGORIA: Record<CategoriaDeBeneficio, BenefitType> = {
  sem_custo: "FREE",
  com_desconto: "DISCOUNT_PERCENT",
  nao_coberto: "NOT_COVERED",
};

export function categoriaDoBeneficio(tipo: BenefitType): CategoriaDeBeneficio {
  if (tipo === "FREE") return "sem_custo";
  if (tipo === "NOT_COVERED") return "nao_coberto";
  return "com_desconto";
}

export function contarPorCategoria(
  lista: readonly Pick<BeneficioDaProposta, "benefitType">[]
): Record<CategoriaDeBeneficio, number> {
  const c: Record<CategoriaDeBeneficio, number> = { sem_custo: 0, com_desconto: 0, nao_coberto: 0 };
  for (const b of lista) c[categoriaDoBeneficio(b.benefitType)] += 1;
  return c;
}

/**
 * O BENEFÍCIO RECOLHIDO, em uma linha: o que se ganha, a regra de uso, a
 * carência e para quem. É o que a lista mostra enquanto ninguém está editando
 * aquele procedimento — a linha inteira de campos só abre quando se pede.
 *
 * No "sem custo" e no "não coberto" a categoria já diz o tipo, então a linha
 * começa pela regra; repetir "Sem custo" dentro da seção "Sem custo" é ruído.
 */
export function resumoDoBeneficio(b: BeneficioDaProposta): string {
  const partes = [
    categoriaDoBeneficio(b.benefitType) === "com_desconto" ? rotuloDoBeneficio(b) : null,
    b.benefitType === "NOT_COVERED" ? null : rotuloDoUso(b),
    b.benefitType === "NOT_COVERED" ? null : rotuloDaCarencia(b),
    paraQuemVale(b),
  ].filter((p): p is string => Boolean(p));
  return partes.join(" · ");
}

export type ResultadoDaAplicacao = {
  lista: BeneficioDaProposta[];
  /** Quantos vieram do grupo e não existiam na proposta. */
  incluidos: number;
  /** Quantos o grupo TROCOU, e que procedimentos eram. */
  trocados: string[];
};

/**
 * APLICAR UM GRUPO sobre o que a proposta já tem.
 *
 * ⚠️ O GRUPO GANHA DO QUE ESTAVA LÁ, e a tela diz quantos trocou. A alternativa
 * — preservar o que já existia — faria "aplicar o grupo Completo" devolver
 * uma mistura que não é nem o grupo nem o que havia antes, e ninguém saberia
 * o que foi ofertado. Aplicar é um ato deliberado; o consultor ajusta depois
 * o que a negociação pedir.
 *
 * O que o grupo NÃO menciona fica como está: aplicar "Preventivo" não apaga um
 * desconto de ortodontia combinado à parte.
 */
export function aplicarGrupo(
  atuais: readonly BeneficioDaProposta[],
  grupo: readonly BeneficioDaProposta[]
): ResultadoDaAplicacao {
  const porProcedimento = new Map(atuais.map((b) => [b.procedureId, b]));
  const trocados: string[] = [];
  let incluidos = 0;

  for (const item of grupo) {
    if (porProcedimento.has(item.procedureId)) trocados.push(item.procedureId);
    else incluidos += 1;
    porProcedimento.set(item.procedureId, { ...item });
  }

  return { lista: [...porProcedimento.values()], incluidos, trocados };
}

/**
 * O que impede de salvar. Lista em vez de recusar no primeiro erro: quem está
 * montando uma proposta quer saber tudo o que falta de uma vez.
 */
export function problemasDoBeneficio(b: BeneficioDaProposta): string[] {
  const p: string[] = [];
  if (!b.forHolder && !b.forDependent) {
    p.push("marque se vale para o titular, para o dependente ou para os dois");
  }
  if (b.benefitType === "DISCOUNT_PERCENT") {
    const v = b.benefitValue ?? 0;
    if (v <= 0 || v > 100) p.push("o desconto em % vai de 1 a 100");
  }
  if (b.benefitType === "DISCOUNT_AMOUNT" && (b.benefitValue ?? 0) <= 0) {
    p.push("informe o valor do desconto");
  }
  if (b.usagePeriodMonths != null && b.usagePeriodMonths > 0 && !b.usageLimitCount) {
    // Janela sem limite não restringe nada, e some do texto da proposta —
    // quem a preencheu achando que restringia precisa ouvir isso agora.
    p.push("a janela em meses só vale com um limite de usos");
  }
  if (b.gracePeriodMonths < 0) p.push("a carência não pode ser negativa");
  return p;
}

// -----------------------------------------------------------------------------
// I3 (1019) — em QUAIS UNIDADES o benefício vale
// -----------------------------------------------------------------------------

/**
 * ⚠️ NULO E VAZIO SIGNIFICAM "TODAS AS UNIDADES DA PARCERIA".
 *
 * A diferença entre "não restringi" e "restringi a nenhuma" parece filosófica
 * e não é: a segunda leitura faria todo benefício já existente parar de valer
 * no dia em que a coluna nasceu. Quem quer tirar a cobertura usa "Não
 * coberto"; lista vazia é ausência de restrição.
 */
export function valeNaUnidade(
  clinicIds: readonly string[] | null | undefined,
  unidade: string | null,
  unidadesDaParceria: readonly string[]
): boolean {
  // Sem restrição: vale onde a parceria valer.
  if (!clinicIds || clinicIds.length === 0) {
    // Sem parceria declarada, o programa não limita unidade nenhuma — é como
    // funcionava antes de existir esta regra.
    if (unidadesDaParceria.length === 0) return true;
    return unidade == null || unidadesDaParceria.includes(unidade);
  }
  // Com restrição, mas sem saber onde a pessoa está sendo atendida, a resposta
  // honesta é SIM: recusar por falta de informação tiraria benefício de quem
  // tem direito, e quem cruza de verdade é a tela do orçamento.
  if (unidade == null) return true;
  return clinicIds.includes(unidade);
}

/** Como a restrição é escrita na tela e no documento. */
export function rotuloDasUnidades(
  clinicIds: readonly string[] | null | undefined,
  nomePorId: ReadonlyMap<string, string>
): string {
  if (!clinicIds || clinicIds.length === 0) return "Em todas as unidades da parceria";
  const nomes = clinicIds
    .map((id) => nomePorId.get(id))
    .filter((n): n is string => Boolean(n));
  // Id que não é mais unidade da parceria some da lista — e some do texto:
  // escrever "e mais 1" sem saber qual seria pior que não escrever nada.
  if (nomes.length === 0) return "Em todas as unidades da parceria";
  return nomes.length === 1 ? `Só em ${nomes[0]}` : `Só em: ${nomes.join(", ")}`;
}

// -----------------------------------------------------------------------------
// 1036 — O RESUMO NO DOCUMENTO E O ANEXO
// -----------------------------------------------------------------------------
// Pedido do dono (28/10/2026): *"No documento da proposta a lista de
// benefícios está muito grande, deve mostrar apenas resumido X procedimentos
// com custo R$ 0,00 e Y procedimentos com descontos de X% a Y%. E no final do
// documento, como anexo, a relação dos procedimentos com os descontos.
// Classificar os procedimentos por desconto, do maior desconto pro menor."*

/** O benefício como o anexo precisa: com nome e o preço de tabela. */
export type BeneficioDoAnexo = BeneficioDaProposta & {
  nome: string;
  /** Preço de tabela da rede. Nulo/zero = sem preço cadastrado. */
  precoCents: number | null;
};

/**
 * QUANTOS POR CENTO O BENEFÍCIO DESCONTA.
 *
 * Sem custo é 100%. O desconto em reais vira % pelo preço de tabela — é o
 * único jeito de ele entrar na mesma faixa e na mesma ordem dos outros. Sem
 * preço cadastrado não há como saber, e a resposta é nula: inventar um % seria
 * imprimir uma promessa que ninguém fez.
 */
export function percentualDoDesconto(
  b: Pick<BeneficioDoAnexo, "benefitType" | "benefitValue" | "precoCents">
): number | null {
  if (b.benefitType === "FREE") return 100;
  if (b.benefitType === "DISCOUNT_PERCENT") return Math.min(100, Math.max(0, b.benefitValue ?? 0));
  if (b.benefitType === "DISCOUNT_AMOUNT") {
    if (!b.precoCents || b.precoCents <= 0) return null;
    return Math.min(100, Math.round(((b.benefitValue ?? 0) / b.precoCents) * 100));
  }
  return null;
}

/**
 * A ORDEM DO ANEXO: do maior desconto para o menor (sem custo primeiro), e
 * pelo nome quando empata. Desconto em reais sem preço vai para o fim — não
 * dá para dizer onde ele cairia. "Não coberto" não é benefício e não entra.
 */
export function ordenarParaOAnexo<T extends BeneficioDoAnexo>(lista: readonly T[]): T[] {
  return lista
    .filter((b) => b.benefitType !== "NOT_COVERED")
    .map((b) => ({ b, pct: percentualDoDesconto(b) }))
    .sort((x, y) => {
      if (x.pct !== y.pct) {
        if (x.pct == null) return 1;
        if (y.pct == null) return -1;
        return y.pct - x.pct;
      }
      return x.b.nome.localeCompare(y.b.nome, "pt-BR");
    })
    .map(({ b }) => b);
}

export type ResumoDosBeneficios = {
  semCusto: number;
  /** Com desconto cujo % se conhece (inclui o em reais com preço). */
  comDesconto: number;
  menorPercent: number | null;
  maiorPercent: number | null;
  /** Desconto em reais em procedimento sem preço: % desconhecido. */
  emReaisSemPreco: number;
};

export function resumoDosBeneficios(lista: readonly BeneficioDoAnexo[]): ResumoDosBeneficios {
  const r: ResumoDosBeneficios = {
    semCusto: 0,
    comDesconto: 0,
    menorPercent: null,
    maiorPercent: null,
    emReaisSemPreco: 0,
  };
  for (const b of lista) {
    if (b.benefitType === "NOT_COVERED") continue;
    if (b.benefitType === "FREE") {
      r.semCusto += 1;
      continue;
    }
    const pct = percentualDoDesconto(b);
    if (pct == null) {
      r.emReaisSemPreco += 1;
      continue;
    }
    r.comDesconto += 1;
    r.menorPercent = r.menorPercent == null ? pct : Math.min(r.menorPercent, pct);
    r.maiorPercent = r.maiorPercent == null ? pct : Math.max(r.maiorPercent, pct);
  }
  return r;
}

const pctTexto = (n: number) => `${String(n).replace(".", ",")}%`;
const procedimentos = (n: number) => `${n} procedimento${n === 1 ? "" : "s"}`;

/** As frases do resumo, na ordem em que o documento as imprime. */
export function frasesDoResumo(r: ResumoDosBeneficios): string[] {
  const f: string[] = [];
  if (r.semCusto > 0) f.push(`${procedimentos(r.semCusto)} sem custo (R$ 0,00)`);
  if (r.comDesconto > 0 && r.menorPercent != null && r.maiorPercent != null) {
    f.push(
      r.menorPercent === r.maiorPercent
        ? `${procedimentos(r.comDesconto)} com ${pctTexto(r.maiorPercent)} de desconto`
        : `${procedimentos(r.comDesconto)} com descontos de ${pctTexto(r.menorPercent)} a ${pctTexto(r.maiorPercent)}`
    );
  }
  if (r.emReaisSemPreco > 0) f.push(`${procedimentos(r.emReaisSemPreco)} com desconto em reais`);
  return f;
}

/** O desconto como a coluna do anexo escreve. */
export function descontoNoAnexo(b: BeneficioDoAnexo): string {
  if (b.benefitType === "FREE") return "Sem custo";
  if (b.benefitType === "DISCOUNT_PERCENT") return pctTexto(b.benefitValue ?? 0);
  if (b.benefitType === "DISCOUNT_AMOUNT") {
    const reais = `R$ ${((b.benefitValue ?? 0) / 100).toFixed(2).replace(".", ",")}`;
    const pct = percentualDoDesconto(b);
    return pct == null ? reais : `${reais} (${pctTexto(pct)})`;
  }
  return "Não coberto";
}
