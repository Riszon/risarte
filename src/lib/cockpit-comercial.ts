import type { NegotiationStatus } from "@/lib/commercial";
import { QUALIFICACAO } from "@/lib/signatures/signers";
import { isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus, SignerStatus, SignerType } from "@/lib/signatures/types";

/**
 * O CAMINHO DA VENDA NO COCKPIT DO CONSULTOR (OC-00158, 03/11/2026).
 *
 * Relato do Admin Master: o cockpit estava "bagunçado", fazia rolar muito e
 * não dizia se o cliente tinha assinado o contrato. Decisão do dono: uma faixa
 * de etapas no alto, com o próximo passo escrito, e uma aba por etapa que abre
 * sozinha na etapa da vez. Esta é a regra da faixa — pura, com teste
 * (`cockpit-comercial.test.ts`); a página só lê e entrega.
 *
 * As quatro etapas são as da regra de ouro do fechamento (contrato assinado E
 * pagamento confirmado), com o que vem antes: a apresentação (o resumo é
 * obrigatório para o aceite desde a 0348) e a negociação até o aceite.
 */

export type AbaDoCockpit = "apresentacao" | "negociacao" | "fechamento" | "cliente";
export const ABAS_DO_COCKPIT: AbaDoCockpit[] = ["apresentacao", "negociacao", "fechamento", "cliente"];

export type SituacaoDaEtapa = "feito" | "agora" | "depois";

export type Etapa = {
  id: "apresentacao" | "negociacao" | "contrato" | "pagamento";
  titulo: string;
  detalhe: string;
  situacao: SituacaoDaEtapa;
  aba: AbaDoCockpit;
};

export type SignatarioDoContrato = {
  nome: string;
  tipo: SignerType;
  grupo: number;
  ordem: number;
  status: SignerStatus;
  assinouEm: string | null;
};

export type PacoteDoContrato = {
  id: string;
  numero: string;
  status: PackageStatus;
  etapaAtual: PackageStage;
  enviadoEm: string | null;
  criadoEm: string;
  signatarios: SignatarioDoContrato[];
};

export type EntradaDoCockpit = {
  naFaseComercial: boolean;
  temResumo: boolean;
  negociacao: { status: NegotiationStatus } | null;
  venda: {
    contractSigned: boolean;
    paymentIssued?: boolean;
    paymentConfirmed: boolean;
    closedAt: string | null;
  } | null;
  /** O envio digital do aceite (o mais recente que vale), ou nulo. */
  contrato: PacoteDoContrato | null;
};

/** "Testemunha", "Representante da Risarte"… — os mesmos nomes do PDF. */
export function papelDoSignatario(tipo: SignerType): string {
  return (QUALIFICACAO as Record<string, string>)[tipo] ?? "Signatário";
}

/**
 * Qual envio o cockpit mostra: o mais recente que não é rascunho nem foi
 * cancelado antes de sair. Um reenvio novo esconde o antigo (que segue na aba
 * Documentos da ficha).
 */
export function contratoDoAceite(pacotes: PacoteDoContrato[]): PacoteDoContrato | null {
  const validos = pacotes.filter((p) => p.status !== "draft" && !(p.status === "cancelled" && !p.enviadoEm));
  if (validos.length === 0) return null;
  return [...validos].sort((a, b) => (b.enviadoEm ?? b.criadoEm).localeCompare(a.enviadoEm ?? a.criadoEm))[0];
}

/** Quem assinou e quem falta, na ordem em que a ZapSign chama. */
export function situacaoDoContrato(p: PacoteDoContrato): {
  assinaram: SignatarioDoContrato[];
  faltam: SignatarioDoContrato[];
  frase: string;
} {
  const ordem = [...p.signatarios].sort((a, b) => a.grupo - b.grupo || a.ordem - b.ordem);
  const assinaram = ordem.filter((s) => s.status === "signed");
  const faltam = ordem.filter((s) => s.status !== "signed");
  const total = ordem.length;
  let frase: string;
  if (p.status === "signed") frase = `Todos assinaram (${total} de ${total}).`;
  else if (p.status === "refused") frase = "Alguém recusou a assinatura — o envio parou.";
  else if (p.status === "expired") frase = "O prazo para assinar venceu — é preciso reenviar.";
  else if (p.status === "cancelled") frase = "O envio foi cancelado.";
  else frase = `${assinaram.length} de ${total} assinaram. Falta${faltam.length === 1 ? "" : "m"}: ${faltam.map((s) => papelDoSignatario(s.tipo).toLowerCase()).join(", ")}.`;
  return { assinaram, faltam, frase };
}

function contratoEsperando(e: EntradaDoCockpit): boolean {
  return !!e.contrato && isWaiting(e.contrato.status);
}

export function etapasDoCockpit(e: EntradaDoCockpit): Etapa[] {
  const status = e.negociacao?.status ?? null;
  const aceita = status === "aceita";
  const signed = e.venda?.contractSigned ?? false;
  const paid = e.venda?.paymentConfirmed ?? false;

  const detalheNegociacao =
    status === null
      ? "Ainda não salva"
      : status === "aceita"
        ? "Aceita pelo cliente"
        : status === "aguardando_autorizacao"
          ? "Esperando o Gerente"
          : status === "devolvida"
            ? "Devolvida ao planejamento"
            : status === "cancelada"
              ? "Venda cancelada"
              : status === "em_negociacao"
                ? "Em negociação"
                : "Encerrada";

  let detalheContrato: string;
  if (signed) detalheContrato = e.contrato?.status === "signed" ? "Assinado (digital)" : "Assinado";
  else if (e.contrato && isWaiting(e.contrato.status)) {
    const s = situacaoDoContrato(e.contrato);
    detalheContrato = `${s.assinaram.length} de ${e.contrato.signatarios.length} assinaram`;
  } else if (e.contrato?.status === "refused") detalheContrato = "Recusado";
  else if (e.contrato?.status === "expired") detalheContrato = "Prazo vencido";
  else detalheContrato = aceita ? "Não enviado" : "Depois do aceite";

  const detalhePagamento = paid ? "Confirmado" : e.venda?.paymentIssued ? "Cobrança emitida" : "Aguardando";

  // Caso antigo (aceito antes da 0348) com o contrato já assinado: o resumo não
  // tem mais para onde ir — a etapa conta como passada, e a frase diz isso.
  const feitos = [e.temResumo || signed, aceita || status === "cancelada", signed, paid];
  const primeiraPendente = feitos.findIndex((f) => !f);
  const situacao = (i: number): SituacaoDaEtapa =>
    feitos[i] ? "feito" : i === primeiraPendente ? "agora" : "depois";

  return [
    {
      id: "apresentacao",
      titulo: "Apresentação",
      detalhe: e.temResumo ? "Resumo escrito" : signed ? "Sem resumo" : "Falta o resumo",
      situacao: situacao(0),
      aba: "apresentacao",
    },
    { id: "negociacao", titulo: "Negociação e aceite", detalhe: detalheNegociacao, situacao: situacao(1), aba: "negociacao" },
    { id: "contrato", titulo: "Contrato", detalhe: detalheContrato, situacao: situacao(2), aba: "fechamento" },
    { id: "pagamento", titulo: "Pagamento", detalhe: detalhePagamento, situacao: situacao(3), aba: "fechamento" },
  ];
}

/** A frase do "Próximo passo", no alto do cockpit. */
export function proximoPasso(e: EntradaDoCockpit): string {
  const status = e.negociacao?.status ?? null;
  // OC-00171: a venda fechada vem ANTES da fase — depois do fechamento o
  // cliente já saiu da Conversão Comercial, e a frase dizia que a negociação
  // "abre quando o caso chegar ao Comercial".
  if (status === "cancelada") return "Venda cancelada. O termo de cancelamento está no prontuário.";
  if (e.venda?.closedAt) return "Venda concluída! A recepção foi acionada para iniciar o tratamento.";
  if (!e.naFaseComercial) return "O cliente não está na Conversão Comercial — a negociação abre quando o caso chegar ao Comercial.";
  if (status === "aceita") {
    const signed = e.venda?.contractSigned ?? false;
    if (!signed && !e.temResumo) return "Escreva o resumo da apresentação: sem ele o contrato não pode ser enviado.";
    if (!signed) {
      if (e.contrato && contratoEsperando(e)) return `Aguardando as assinaturas: ${situacaoDoContrato(e.contrato).frase}`;
      if (e.contrato?.status === "refused" || e.contrato?.status === "expired") {
        return "O envio do contrato não foi concluído — veja em Fechamento e reenvie.";
      }
      return "Envie o contrato para assinatura (ou imprima o orçamento para assinar no papel).";
    }
    if (!(e.venda?.paymentConfirmed ?? false)) return "Contrato assinado. Falta confirmar o pagamento.";
    return "Tudo pronto.";
  }
  if (status === "aguardando_autorizacao") return "Aguardando a autorização do Gerente para as condições fora da regra.";
  if (status === "devolvida") return "A negociação voltou do planejamento: revise e salve a nova rodada.";
  if (status === "em_negociacao") {
    return e.temResumo
      ? "Registre o aceite do cliente quando ele concordar com as condições."
      : "Escreva o resumo da apresentação — sem ele não dá para registrar o aceite.";
  }
  return e.temResumo
    ? "Monte a negociação: o que o cliente aprovou e como vai pagar."
    : "Faça a apresentação e escreva o resumo; depois, monte a negociação.";
}

/** A aba que abre: a pedida no endereço (`?aba=`), senão a da etapa da vez. */
export function abaInicial(e: EntradaDoCockpit, pedida?: string | null): AbaDoCockpit {
  if (pedida && (ABAS_DO_COCKPIT as string[]).includes(pedida)) return pedida as AbaDoCockpit;
  const status = e.negociacao?.status ?? null;
  // OC-00171: venda fechada abre no Fechamento (o que foi feito), em qualquer fase.
  if (e.venda?.closedAt || status === "cancelada") return "fechamento";
  if (!e.naFaseComercial) return "apresentacao";
  if (status === "aceita") return e.temResumo || e.venda?.contractSigned ? "fechamento" : "apresentacao";
  if (status !== null) return "negociacao";
  return "apresentacao";
}
