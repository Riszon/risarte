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
