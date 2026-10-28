// Risarte Empresarial — PADRÃO × PROPOSTA (1036, dono em 28/10/2026).
//
// Pedido: *"caso a proposta for diferente do padrão, ficar mais barato, deve
// aparecer o quanto a empresa estará economizando com esta proposta. Mostrar
// o padrão e o que estamos propondo."*
//
// O PADRÃO é a mesma empresa — os mesmos titulares e os mesmos dependentes
// estimados — pelo preço da rede (Configurações → Preço da adesão): por vida,
// sem faixa por quantidade. A PROPOSTA é a conta de `simularProposta`, a que o
// documento já imprime. A economia é a diferença entre as duas.
//
// Puro e em CENTAVOS: a tela da proposta e o documento fazem a mesma conta.

import type { AdhesionPricing } from "./pricing";
import type { BillingBasis, PropostaResult } from "./proposta";
import {
  estimativaDosDependentes,
  type CalculoDosDependentes,
  type LinhaDoQuadro,
} from "./dependentes-da-proposta";

export type ComparacaoComOPadrao = {
  padraoMensalCents: number;
  propostaMensalCents: number;
  /** Positivo = a proposta é mais barata. */
  economiaMensalCents: number;
  economiaAnualCents: number;
  padraoImplantacaoCents: number;
  propostaImplantacaoCents: number;
  economiaImplantacaoCents: number;
  /** O preço de tabela de um titular, e o proposto (nulo no valor fixo). */
  padraoPorTitularCents: number;
  propostaPorTitularCents: number | null;
  /** A mensalidade proposta sai abaixo da padrão. */
  maisBarata: boolean;
};

export function comparacaoComOPadrao(e: {
  proposta: PropostaResult;
  padrao: AdhesionPricing;
  basis: BillingBasis;
  titulares: number;
  incluiDependentes: boolean;
  calculo: CalculoDosDependentes;
  quadro: readonly LinhaDoQuadro[];
  dependentes: number;
  implantacaoComDependentes: boolean;
}): ComparacaoComOPadrao | null {
  const titulares = Math.max(0, Math.floor(e.titulares || 0));
  // Sem titular não há empresa para comparar — e "economia de R$ 0,00" seria
  // uma afirmação.
  if (titulares === 0) return null;

  const titularesCents = titulares * Math.max(0, e.padrao.holderFeeCents);

  // ⚠️ OS DEPENDENTES DO PADRÃO SÃO CONTADOS DO MESMO JEITO QUE OS DA PROPOSTA
  // (o mesmo quadro, a mesma escolha). Só o preço muda. Se a proposta escolheu
  // não calcular, o padrão também não calcula — senão a "economia" seria só o
  // dependente que um lado contou e o outro não.
  //
  // No valor fixo os dependentes estão DENTRO do valor da empresa; o padrão,
  // que é por vida, precisa contá-los, ou o fixo pareceria caro. Sem quadro
  // nem escolha, contam como individuais.
  const calculo: CalculoDosDependentes =
    e.basis === "FIXED_PER_COMPANY" && e.calculo === "NONE" ? "AS_INDIVIDUAL" : e.calculo;
  const dependentesCents = e.incluiDependentes
    ? (estimativaDosDependentes({
        calculo,
        pricing: e.padrao,
        quadro: e.quadro,
        dependentes: e.dependentes,
      })?.totalCents ?? 0)
    : 0;

  const padraoMensalCents = titularesCents + dependentesCents;
  const padraoImplantacaoCents =
    titularesCents + (e.implantacaoComDependentes ? dependentesCents : 0);
  const economiaMensalCents = padraoMensalCents - e.proposta.mensalidadeCents;

  return {
    padraoMensalCents,
    propostaMensalCents: e.proposta.mensalidadeCents,
    economiaMensalCents,
    economiaAnualCents: economiaMensalCents * 12,
    padraoImplantacaoCents,
    propostaImplantacaoCents: e.proposta.implantacaoCents,
    economiaImplantacaoCents: padraoImplantacaoCents - e.proposta.implantacaoCents,
    padraoPorTitularCents: Math.max(0, e.padrao.holderFeeCents),
    propostaPorTitularCents: e.basis === "PER_EMPLOYEE" ? e.proposta.porColaboradorCents : null,
    maisBarata: economiaMensalCents > 0,
  };
}
