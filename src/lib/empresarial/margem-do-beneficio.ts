// Risarte Empresarial — QUANTO CADA BENEFÍCIO CUSTA DE MARGEM (OC-00083, I2).
//
// Pedido do dono (24/09/2026): *"em configurações dos benefícios dos
// procedimentos deve ter como visualizar a margem de lucro de cada
// procedimento (com base na precificação do procedimento) para conseguir
// controlar melhor o que pode dar de lucro para cada procedimento (baseado na
// média da rede)."*
//
// A conta não é nova: ela é a do FIN5 (`computeMargin`), com o benefício
// aplicado ao preço antes. O que este módulo acrescenta é a comparação —
// **quanto sobra sem o benefício e quanto sobra com ele** — que é a pergunta
// de quem está decidindo o que oferecer.
//
// ⚠️ E ELE DECLARA QUANDO NÃO SABE. Procedimento sem repasse e sem material
// cadastrados tem custo zero, e custo zero faz a margem parecer 100% — o
// número mais perigoso que esta tela poderia mostrar, porque ele convida a
// dar desconto que a clínica não tem.

import { applyBenefit } from "./pricing";
import type { BenefitType } from "./constants";

export type CustoDoProcedimento = {
  /** Preço cheio (padrão da rede). */
  precoCents: number;
  /** Repasse ao dentista — FIXO: não cai quando o preço cai. */
  repasseCents: number;
  /** Material e laboratório, do kit ou informado à mão. */
  materialCents: number;
  /** Taxa média do meio de pagamento, em % sobre o preço cobrado. */
  taxaPercent: number;
  /** O repasse deste procedimento está cadastrado. */
  temRepasse: boolean;
  /** O custo de material deste procedimento está cadastrado. */
  temMaterial: boolean;
};

export type MargemComBeneficio = {
  precoCheioCents: number;
  /** O que o beneficiário paga com o benefício aplicado. */
  precoComBeneficioCents: number;
  custoCents: number;
  margemCheiaCents: number;
  margemComBeneficioCents: number;
  /** Sobre o preço COM benefício. `null` quando o preço cobrado é zero. */
  margemPercent: number | null;
  /** Quanto o benefício tira da margem, em centavos. */
  custoDoBeneficioCents: number;
  /** A margem ficou negativa: o procedimento dá prejuízo direto. */
  negativa: boolean;
  /**
   * O que o sistema NÃO sabe sobre o custo. Vazio = a conta está completa.
   * Com item aqui, o número é um teto otimista, e a tela precisa dizer isso.
   */
  faltaSaber: string[];
};

export function margemComBeneficio(
  custo: CustoDoProcedimento,
  beneficio: { benefitType: BenefitType; benefitValue: number | null } | null
): MargemComBeneficio {
  const precoCheio = Math.max(0, Math.round(custo.precoCents));
  const { chargedCents } = applyBenefit(beneficio, precoCheio);

  // ⚠️ A TAXA INCIDE SOBRE O QUE ENTRA, não sobre o preço de tabela: se o
  // procedimento saiu de graça, não houve cobrança e não houve taxa.
  const taxaCents = Math.round((chargedCents * Math.max(0, custo.taxaPercent)) / 100);
  const taxaCheiaCents = Math.round((precoCheio * Math.max(0, custo.taxaPercent)) / 100);

  const base = Math.max(0, custo.repasseCents) + Math.max(0, custo.materialCents);
  const custoCents = base + taxaCents;

  const margemCheiaCents = precoCheio - (base + taxaCheiaCents);
  const margemComBeneficioCents = chargedCents - custoCents;

  const faltaSaber: string[] = [];
  if (!custo.temRepasse) faltaSaber.push("o repasse ao dentista");
  if (!custo.temMaterial) faltaSaber.push("o custo de material");
  if (custo.taxaPercent <= 0) faltaSaber.push("a taxa do meio de pagamento");

  return {
    precoCheioCents: precoCheio,
    precoComBeneficioCents: chargedCents,
    custoCents,
    margemCheiaCents,
    margemComBeneficioCents,
    margemPercent:
      chargedCents > 0
        ? Math.round((margemComBeneficioCents / chargedCents) * 1000) / 10
        : null,
    custoDoBeneficioCents: margemCheiaCents - margemComBeneficioCents,
    negativa: margemComBeneficioCents < 0,
    faltaSaber,
  };
}

/**
 * A frase que acompanha o número.
 *
 * ⚠️ Sem ela, "margem de 100%" seria lido como notícia boa quando na verdade
 * é a confissão de que o custo não foi cadastrado.
 */
export function avisoDaMargem(m: MargemComBeneficio): string | null {
  if (m.faltaSaber.length > 0) {
    return `Falta cadastrar ${m.faltaSaber.join(" e ")} — a margem acima é um teto otimista.`;
  }
  if (m.negativa) {
    return "Este benefício deixa o procedimento no prejuízo: o custo é maior que o valor cobrado.";
  }
  return null;
}
