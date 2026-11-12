// Repasse (0402) — A DIVERGÊNCIA QUE CHEGA AO FINANCEIRO.
//
// A regra mora no banco: sem a conversa com a unidade E com o dentista
// (`payout_mediation_contacts`), a decisão é recusada (MEDIATION_REQUIRED);
// "corrigir" só PROPÕE o valor (a unidade confirma, o dentista aceita).
// Aqui ficam os tipos, o passo a passo que a tela mostra e as mensagens
// prontas para falar rápido com cada um.

import { toWhatsappNumber } from "@/lib/whatsapp";
import { formatBRL } from "@/lib/pricing";
import { MIN_REASON } from "@/lib/finance/payout-report";

export type MediationParty = "unidade" | "dentista";
export type MediationOutcome = "conversou" | "sem_contato";
export type MediationChannel = "whatsapp" | "ligacao" | "chat" | "presencial" | "outro";

export const CHANNELS: MediationChannel[] = ["whatsapp", "ligacao", "chat", "presencial", "outro"];
export const CHANNEL_LABEL: Record<MediationChannel, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  chat: "Chat do sistema",
  presencial: "Pessoalmente",
  outro: "Outro",
};

export const PARTY_LABEL: Record<MediationParty, string> = {
  unidade: "a unidade",
  dentista: "o dentista",
};

/** Uma conversa registrada pelo Financeiro sobre uma linha. */
export type MediationContact = {
  itemId: string;
  party: MediationParty;
  outcome: MediationOutcome;
  channel: MediationChannel | null;
  contactName: string | null;
  summary: string;
  createdByName: string | null;
  createdAt: string;
  /** Conta para a decisão de agora (registrada depois que a linha chegou ao Financeiro). */
  counts: boolean;
};

export type MediationContactDb = {
  item_id: string;
  party: string;
  outcome: string;
  channel: string | null;
  contact_name: string | null;
  summary: string;
  created_by_name: string | null;
  created_at: string;
  counts: boolean | null;
};

export function mediationFromDb(r: MediationContactDb): MediationContact {
  return {
    itemId: r.item_id,
    party: r.party === "dentista" ? "dentista" : "unidade",
    outcome: r.outcome === "sem_contato" ? "sem_contato" : "conversou",
    channel: CHANNELS.includes(r.channel as MediationChannel) ? (r.channel as MediationChannel) : null,
    contactName: r.contact_name,
    summary: r.summary,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    counts: Boolean(r.counts),
  };
}

/** Com quem falar: quem aprova a unidade e o dentista do relatório. */
export type MediationPerson = {
  userId: string;
  party: MediationParty;
  roleLabel: string;
  fullName: string;
  phone: string | null;
};

export type MediationPersonDb = {
  user_id: string;
  party: string;
  role_label: string | null;
  full_name: string | null;
  phone: string | null;
};

export function personFromDb(r: MediationPersonDb): MediationPerson {
  return {
    userId: r.user_id,
    party: r.party === "dentista" ? "dentista" : "unidade",
    roleLabel: r.role_label ?? "",
    fullName: r.full_name ?? "—",
    phone: r.phone,
  };
}

/** O passo a passo de UMA linha: o que já foi feito nesta rodada. */
export function roteiro(contatos: MediationContact[], itemId: string) {
  const daRodada = contatos.filter((c) => c.itemId === itemId && c.counts);
  const ultimo = (p: MediationParty) =>
    [...daRodada].reverse().find((c) => c.party === p) ?? null;
  const unidade = ultimo("unidade");
  const dentista = ultimo("dentista");
  return {
    unidade,
    dentista,
    /** Os dois registros feitos: a decisão se libera (o banco confere de novo). */
    podeDecidir: unidade !== null && dentista !== null,
    /** Conversas de rodadas anteriores (antes de a linha voltar ao Financeiro). */
    anteriores: contatos.filter((c) => c.itemId === itemId && !c.counts),
  };
}

/** Confere o registro da conversa antes de ir ao banco. */
export function mediationError(input: {
  outcome: MediationOutcome;
  channel: MediationChannel | null;
  summary: string;
}): string | null {
  if (input.outcome === "conversou" && !input.channel) return "Escolha por onde conversou.";
  if (input.summary.trim().length < MIN_REASON) {
    return input.outcome === "sem_contato"
      ? `Diga o que tentou (pelo menos ${MIN_REASON} letras).`
      : `Resuma a conversa (pelo menos ${MIN_REASON} letras).`;
  }
  return null;
}

/** A orientação que vai junto com a decisão. */
export function guidanceError(text: string): string | null {
  return text.trim().length < MIN_REASON
    ? `Escreva a orientação para a unidade e o dentista (pelo menos ${MIN_REASON} letras).`
    : null;
}

/**
 * A mensagem pronta para abrir a conversa. Sem dado do paciente (vai pelo
 * WhatsApp): o relatório e o procedimento bastam para a pessoa achar a linha.
 */
export function mensagemDaDivergencia(input: {
  party: MediationParty;
  reportCode: string;
  procedureName: string;
  amountCents: number;
}): string {
  const base = `o relatório de repasse ${input.reportCode}, procedimento "${input.procedureName}" (${formatBRL(input.amountCents)})`;
  return input.party === "unidade"
    ? `Olá {nome}! Aqui é do Financeiro da Franqueadora. Preciso conversar com você sobre ${base}, que o dentista contestou. Você tem alguns minutos?`
    : `Olá {nome}! Aqui é do Financeiro da Franqueadora. Recebi a sua contestação sobre ${base} e quero entender melhor antes de decidir. Você tem alguns minutos?`;
}

/** Link de ligação (`tel:`) — só com DDD; senão, nulo (o botão some). */
export function linkDeLigacao(phone: string | null | undefined): string | null {
  const n = toWhatsappNumber(phone);
  return n ? `tel:+${n}` : null;
}

// -----------------------------------------------------------------------------
// "Registrar falha" — o que a pessoa precisa saber antes de usar (pedido do
// dono, 12/11/2026). Os nomes batem com `payout_failure_decide` (0400).
// -----------------------------------------------------------------------------
export const FALHA_QUANDO_USAR =
  "Use quando o procedimento precisou (ou vai precisar) ser refeito por falha do dentista. Não é para valor errado nem para \"não fui eu que fiz\": isso é contestação, e quem contesta é o próprio dentista.";

export const FALHA_QUEM_DECIDE =
  "Registrar não desconta nada: abre uma ocorrência. Quem aprova a equipe da unidade (o Gerente; sem Gerente, o Coordenador clínico; sem ninguém, o Financeiro da Franqueadora) decide em Repasses › Ocorrências se foi ou não falha, com motivo. O dentista nunca decide a própria ocorrência.";

/** O que acontece depois da decisão. A saída de "foi falha" é o sistema que define. */
export const FALHA_SAIDAS: { titulo: string; texto: string; exemplo: string }[] = [
  {
    titulo: "Não foi falha",
    texto: "A ocorrência é encerrada e nada muda no repasse.",
    exemplo: "O cliente quebrou a restauração mastigando gelo.",
  },
  {
    titulo: "Foi falha, e o mesmo dentista refaz",
    texto: "Nada a descontar: ele já recebeu uma vez e refaz sem receber de novo.",
    exemplo: "A revisão de qualidade mandou o mesmo dentista ajustar a coroa.",
  },
  {
    titulo: "Foi falha, e o repasse já estava em relatório, em conta ou pago",
    texto:
      "Vira um desconto no próximo relatório do dentista (o valor pago; quem decide pode descontar menos, nunca mais). Se o desconto passar do repasse, o saldo vai para o relatório seguinte. O dentista confere e pode contestar.",
    exemplo: "O canal já pago precisou ser refeito por outro dentista.",
  },
  {
    titulo: "Foi falha, e o repasse ainda não estava em relatório",
    texto: "O repasse simplesmente não é pago.",
    exemplo: "A falha apareceu antes de o procedimento entrar em relatório.",
  },
];

export const FALHA_SOZINHA =
  "A ocorrência também abre sozinha quando a revisão de qualidade reprova um procedimento que já tem repasse e quando uma venda com procedimentos já repassados é cancelada. Quando outro dentista refaz, o repasse do primeiro é anulado e quem refez recebe normalmente.";
