// Risarte Empresarial — AS ETAPAS DA FICHA DA EMPRESA NO FUNIL (OC-00083).
//
// Relato do dono (23/09/2026): abrir uma empresa do funil mostrava TUDO de uma
// vez — levantamento, apresentação, envio e fechamento empilhados numa rolagem
// só —, sem nenhuma relação com a fase em que a empresa está. Uma empresa em
// "Captação" via exatamente a mesma tela de uma em "Implantação", e o chapéu
// dizia "fase 4" escrito à mão, ignorando as nove fases que existem.
//
// Aqui ficam as três regras que a tela consome, puras e testadas: em qual aba
// a ficha ABRE, o que cada aba tem a DIZER de si mesma, e qual aba é a do
// passo de agora.
//
// ⚠️ NENHUMA ABA É TRANCADA, de propósito. A tentação era bloquear o envio
// enquanto a proposta estivesse incompleta; seria um jeito novo de a pessoa
// ficar presa — e a mesma aba do envio guarda os selos de contrato assinado e
// implantação paga, que precisam ser marcados mesmo em caso fora do roteiro.
// O sistema DIZ onde está o buraco; quem decide a ordem é quem atende.

import type { LeadStage } from "./constants";

export const ETAPAS_DA_FICHA = [
  "levantamento",
  "apresentacao",
  "envio",
  "fechamento",
] as const;
export type EtapaDaFicha = (typeof ETAPAS_DA_FICHA)[number];

export const ETAPA_ROTULO: Record<EtapaDaFicha, string> = {
  levantamento: "Levantamento",
  apresentacao: "Apresentação",
  envio: "Envio e selos",
  fechamento: "Fechamento",
};

/**
 * EM QUAL ABA A FICHA ABRE, pela fase em que a empresa está.
 *
 * A ideia é a tela abrir no trabalho de agora, não no começo de tudo — quem
 * abre uma empresa em follow-up não quer reler o levantamento.
 *
 * `CLOSED_LOST` abre no fechamento porque é lá que está o desfecho; abrir no
 * levantamento sugeriria que ainda há o que preencher.
 */
export function etapaInicial(stage: LeadStage): EtapaDaFicha {
  switch (stage) {
    case "CAPTURE":
    case "CONTACT":
      return "levantamento";
    case "MEETING_SCHEDULED":
      // A reunião está marcada: o que se faz agora é preparar a apresentação.
      return "apresentacao";
    case "PRESENTED":
      // Apresentou: agora se registra o que ouviu e monta a proposta.
      return "levantamento";
    case "PROPOSAL_SENT":
    case "FOLLOW_UP":
      return "envio";
    case "CLOSED_WON":
    case "CLOSED_LOST":
    case "IMPLEMENTATION":
      return "fechamento";
  }
}

export type SituacaoDaEtapa = {
  /**
   * `falta` = há campo por preencher ou passo por dar; `pronto` = pode seguir;
   * `feito` = o ato daquela etapa já aconteceu (e a data prova).
   */
  estado: "falta" | "pronto" | "feito";
  /** Uma linha, para caber ao lado do rótulo da aba. */
  resumo: string;
};

export type DadosDasEtapas = {
  /**
   * A empresa já tem levantamento salvo.
   *
   * ⚠️ É UMA PERGUNTA SEPARADA, e a primeira versão não a fazia: sem
   * levantamento nenhum eu mandava um campo de mentira (`["o levantamento"]`)
   * na lista do que falta, e a aba contava e escrevia **"falta 1 campo"** —
   * como se faltasse um detalhe, quando não havia nada preenchido. Achado ao
   * conferir a proposta no treino, comparando as duas telas. Contagem só
   * responde "quantos"; ela não sabe dizer "nenhum".
   */
  temLevantamento: boolean;
  /** Campos que ainda faltam para a proposta (régua de `proposta.ts`). */
  faltaProposta: readonly string[];
  /** Campos que ainda faltam para o contrato (régua de `proposta.ts`). */
  faltaContrato: readonly string[];
  /** A apresentação foi personalizada para esta empresa, ou é o modelo da rede. */
  apresentacaoPersonalizada: boolean;
  /** Quantos envios já foram registrados. */
  envios: number;
  /** A proposta chegou a ser enviada em algum deles. */
  propostaEnviada: boolean;
  contratoAssinadoEm: string | null;
  implantacaoPagaEm: string | null;
  /** A conferência de fechamento foi confirmada. */
  conferido: boolean;
  /** Passos de implantação: quantos já resolvidos e quantos existem. */
  passosFeitos: number;
  passosTotal: number;
};

const plural = (n: number, um: string, muitos: string) =>
  n === 1 ? `1 ${um}` : `${n} ${muitos}`;

/**
 * O QUE CADA ABA DIZ DE SI MESMA.
 *
 * ⚠️ Reusa as réguas que já existem (`faltaParaProposta`/`faltaParaContrato`,
 * puras e com teste desde a 1009). Escrever uma segunda contagem de "o que
 * falta" aqui garantiria que um dia as duas discordassem — e a aba passaria a
 * dizer "pronto" numa tela que recusa salvar.
 */
export function situacaoDasEtapas(
  d: DadosDasEtapas
): Record<EtapaDaFicha, SituacaoDaEtapa> {
  const faltam = new Set([...d.faltaProposta, ...d.faltaContrato]).size;

  const levantamento: SituacaoDaEtapa = !d.temLevantamento
    ? { estado: "falta", resumo: "não começou" }
    : faltam > 0
      ? { estado: "falta", resumo: `falta ${plural(faltam, "campo", "campos")}` }
      : { estado: "pronto", resumo: "completo" };

  const apresentacao: SituacaoDaEtapa = d.apresentacaoPersonalizada
    ? { estado: "feito", resumo: "personalizada" }
    : { estado: "pronto", resumo: "modelo da rede" };

  const envio: SituacaoDaEtapa = d.propostaEnviada
    ? { estado: "feito", resumo: "proposta enviada" }
    : d.envios > 0
      ? { estado: "pronto", resumo: plural(d.envios, "envio", "envios") }
      : { estado: "falta", resumo: "nada enviado" };

  const fechamento: SituacaoDaEtapa = d.implantacaoPagaEm
    ? d.passosTotal > 0 && d.passosFeitos < d.passosTotal
      ? {
          estado: "pronto",
          resumo: `implantação ${d.passosFeitos}/${d.passosTotal}`,
        }
      : { estado: "feito", resumo: "implantação concluída" }
    : d.contratoAssinadoEm
      ? { estado: "pronto", resumo: "contrato assinado" }
      : d.conferido
        ? { estado: "pronto", resumo: "conferido" }
        : { estado: "falta", resumo: "em aberto" };

  return { levantamento, apresentacao, envio, fechamento };
}
