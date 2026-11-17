// O FIM DO TRATAMENTO (0418, Etapa 2 do plano docs/jornada/FIM-DO-TRATAMENTO-PLANO.md).
//
// Cada plano que termina (o original, cada complemento, a venda direta), a
// ortodontia (na entrega da contenção) e a urgência de quem ainda não é cliente
// abrem um FECHAMENTO (`treatment_closures`): uma tarefa com dono que só some
// quando é resolvida. Quem decide o que acontece é o banco
// (`answer_treatment_closure`, `register_closure_contact`); este arquivo só
// traduz as situações, diz quem vê cada botão e transforma as recusas em frases.
//
// 0422 (relato OC-00185): UMA decisão por cliente. Cada plano continua com o
// seu fechamento (a qualidade da 0421 é por plano), mas só um é a decisão — o
// líder; os outros (`groupedInto`) acompanham a resposta dele.

import { formatInBrazil } from "@/lib/dates";

/** 0426: "cancelamento" — o plano cancelado chama o Coordenador (D11). */
export type EscopoDoFechamento = "plano" | "venda_direta" | "ortodontia" | "urgencia" | "cancelamento";

export type SituacaoDoFechamento =
  | "pergunta"
  | "coordenador"
  | "reavaliacao"
  | "contato"
  | "agendar_avaliacao"
  | "encerrado";

export type RespostaDoFechamento = "sim" | "nao" | "nao_sei";

export type DesfechoDoContato = "revisar" | "aguardar_retorno" | "novo_planejamento" | "sem_contato";

export type CanalDoContato = "ligacao" | "mensagem" | "presencial";

export type Fechamento = {
  id: string;
  scope: EscopoDoFechamento;
  status: SituacaoDoFechamento;
  answer: RespostaDoFechamento | null;
  askedUserId: string | null;
  autoYes: boolean;
  treatmentEnd: boolean;
  changedByCoordinator: boolean;
  createdAt: string;
  /** Tentativas de contato registradas e quantas falharam. */
  tentativas: number;
  tentativasSemSucesso: number;
  /** 0422: o líder da decisão (nulo = este É a decisão do cliente). */
  groupedInto: string | null;
  /** 0422: tudo o que terminou nesta decisão (o próprio e os seguidores). */
  escopos: EscopoDoFechamento[];
  /** 0422 (F2): as considerações de quem executou, para o Coordenador. */
  dentistNotes: string | null;
  /** 0422 (F1): o horário com o Coordenador ligado à decisão. */
  horario: HorarioComCoordenador | null;
  /** 0422 (F4/F5): manter o horário distante ou pedir um mais próximo. */
  waitChoice: "manter" | "antecipar" | null;
};

/** 0422 (F1): o próximo horário do cliente com quem é Coordenador Clínico. */
export type HorarioComCoordenador = { startsAt: string; dias: number };

/** 0422 (F4): acima disto, o horário com o Coordenador é "longe demais". */
export const LIMITE_DIAS_DO_HORARIO = 30;

/** 0422 (F2): o mínimo das considerações no Sim e no Não sei. */
export const CONSIDERACOES_MINIMO = 10;

export function horarioLonge(h: HorarioComCoordenador | null): boolean {
  return h !== null && h.dias > LIMITE_DIAS_DO_HORARIO;
}

/** "20/11 às 14:00 — faltam 3 dias" (no relógio do Brasil). */
export function textoDoHorario(h: HorarioComCoordenador): string {
  const quando = formatInBrazil(new Date(h.startsAt), {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).replace(", ", " às ");
  const falta = h.dias <= 0 ? "hoje" : h.dias === 1 ? "falta 1 dia" : `faltam ${h.dias} dias`;
  return `${quando} — ${falta}`;
}

/** F2: o Sim e o Não sei respondidos na pergunta pedem as considerações. */
export function pedeConsideracoes(
  status: SituacaoDoFechamento,
  resposta: RespostaDoFechamento
): boolean {
  return status === "pergunta" && (resposta === "sim" || resposta === "nao_sei");
}

/** A lista do que terminou, para a frase da decisão. */
export function oQueTerminou(escopos: EscopoDoFechamento[]): string {
  const nomes = escopos.map((e) => ESCOPO_LABEL[e]);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export const PERGUNTA_DO_FIM =
  "Este cliente necessita de consulta de reavaliação com o Coordenador Clínico?";

export const ESCOPO_LABEL: Record<EscopoDoFechamento, string> = {
  plano: "plano de tratamento",
  venda_direta: "venda direta",
  ortodontia: "ortodontia (contenção entregue)",
  urgencia: "atendimento de urgência",
  cancelamento: "plano cancelado",
};

export const CANAL_LABEL: Record<CanalDoContato, string> = {
  ligacao: "Ligação",
  mensagem: "Mensagem",
  presencial: "Pessoalmente",
};

export const DESFECHO_LABEL: Record<DesfechoDoContato, string> = {
  revisar: "Chamar para revisar (agendar reavaliação)",
  aguardar_retorno: "Aguardar o retorno (acompanhamento)",
  novo_planejamento: "Precisa de novo planejamento",
  sem_contato: "Encerrar sem contato (3 tentativas)",
};

/** D6: "sem contato" só depois de 3 tentativas sem falar com o cliente. */
export const TENTATIVAS_PARA_SEM_CONTATO = 3;

/** D22: o retorno sugerido, em meses, quando ninguém escolhe outra data. */
export const MESES_DO_RETORNO_SUGERIDO = 6;

/** 0421 (D1): os cinco níveis da avaliação presencial do Coordenador. */
export type NivelDeQualidade = "excelente" | "bom" | "aceitavel" | "revisar" | "refazer";

export const NIVEIS_DE_QUALIDADE: NivelDeQualidade[] = [
  "excelente",
  "bom",
  "aceitavel",
  "revisar",
  "refazer",
];

export const NIVEL_LABEL: Record<NivelDeQualidade, string> = {
  excelente: "Excelente",
  bom: "Bom",
  aceitavel: "Aceitável",
  revisar: "Revisar",
  refazer: "Refazer",
};

/** Excelente, Bom e Aceitável aprovam; Revisar e Refazer pedem nova sessão. */
export function nivelAprova(n: NivelDeQualidade): boolean {
  return n === "excelente" || n === "bom" || n === "aceitavel";
}

/** D7: a observação é obrigatória só em Revisar e Refazer. */
export function nivelPedeObservacao(n: NivelDeQualidade): boolean {
  return !nivelAprova(n);
}

/** D18: a satisfação do cliente no contato, de 0 a 10. */
export const ESCALA_DE_SATISFACAO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * D18: o que o Coordenador pode decidir depois de falar com o cliente. Com
 * queixa, só "chamar para revisar" (o banco recusa o resto).
 */
export function desfechosDoContato(queixa: boolean | null): DesfechoDoContato[] {
  if (queixa) return ["revisar"];
  return ["revisar", "aguardar_retorno", "novo_planejamento"];
}

/** O título da linha no painel "Precisa de atenção". */
export function tituloDoFechamento(f: Pick<Fechamento, "status" | "scope">): string {
  switch (f.status) {
    case "pergunta":
      return "Decisão obrigatória: necessita de reavaliação?";
    case "coordenador":
      return "Decisão do Coordenador: necessita de reavaliação?";
    case "reavaliacao":
      return "Aguardando a reavaliação com o Coordenador";
    case "contato":
      return "Contatar o cliente e colher o feedback";
    case "agendar_avaliacao":
      return "Agendar a avaliação completa (veio pela urgência)";
    case "encerrado":
      return "Fechamento encerrado";
  }
}

/** A frase de baixo da linha: o que terminou e o que falta. */
export function detalheDoFechamento(f: Fechamento): string {
  const o = `Terminou: ${oQueTerminou(f.escopos.length > 0 ? f.escopos : [f.scope])}.`;
  const fim = f.treatmentEnd ? " Não sobra outro tratamento." : " Ainda há tratamento em andamento.";
  switch (f.status) {
    case "pergunta":
      return `${o}${fim} Quem executou responde.`;
    case "coordenador":
      return `${o} Quem executou não soube definir; o Coordenador decide.`;
    case "reavaliacao":
      if (f.horario && f.waitChoice !== "antecipar")
        return `${o} A reavaliação é no horário com o Coordenador: ${textoDoHorario(f.horario)}.`;
      if (f.horario && f.waitChoice === "antecipar")
        return `${o} Foi pedida uma reavaliação antes do horário de ${textoDoHorario(f.horario)}: a Recepção agenda.`;
      return f.autoYes
        ? `${o} O plano tem procedimento de reavaliação obrigatória: a Recepção agenda a consulta.`
        : `${o} A Recepção agenda a consulta de reavaliação.`;
    case "contato":
      return f.tentativas === 0
        ? `${o} Ligue ou mande mensagem, pergunte se foi tudo bem e registre.`
        : `${o} ${f.tentativas} tentativa(s) registrada(s), ${f.tentativasSemSucesso} sem falar com o cliente.`;
    case "agendar_avaliacao":
      return "Atendido(a) na urgência. A tarefa termina quando a avaliação for agendada.";
    case "encerrado":
      return o;
  }
}

/**
 * Quem pode responder a pergunta (espelho da guarda de
 * `answer_treatment_closure`): quem executou ou o Coordenador; o "Não sei" só
 * quem executou; e o Coordenador muda a resposta enquanto nada aconteceu (D21).
 */
export function botoesDaResposta(
  f: Pick<Fechamento, "status" | "answer" | "askedUserId" | "tentativas"> & { groupedInto?: string | null },
  quem: { userId: string; ehCoordenador: boolean; clienteNaFase5: boolean }
): RespostaDoFechamento[] {
  // 0422: quem segue a decisão do cliente não tem resposta própria.
  if (f.groupedInto) return [];
  const executor = f.askedUserId !== null && f.askedUserId === quem.userId;
  if (f.status === "pergunta") {
    if (executor) return ["sim", "nao", "nao_sei"];
    return quem.ehCoordenador ? ["sim", "nao"] : [];
  }
  if (f.status === "coordenador") return quem.ehCoordenador ? ["sim", "nao"] : [];
  if (!quem.ehCoordenador) return [];
  if (f.status === "contato" && f.tentativas === 0) return ["sim"];
  if (f.status === "reavaliacao" && quem.clienteNaFase5) return ["nao"];
  return [];
}

export const RESPOSTA_LABEL: Record<RespostaDoFechamento, string> = {
  sim: "Sim",
  nao: "Não",
  nao_sei: "Não sei (encaminhar ao Coordenador)",
};

/** O que cada botão faz, dito antes de clicar. */
export const RESPOSTA_EFEITO: Record<RespostaDoFechamento, string> = {
  sim: "A Recepção agenda a consulta de reavaliação com o Coordenador.",
  nao: "O Coordenador contata o cliente e registra como foi.",
  nao_sei: "O Coordenador decide.",
};

/** Data sugerida para o retorno (D22), no formato do campo de data. */
export function retornoSugerido(hojeIso: string, meses = MESES_DO_RETORNO_SUGERIDO): string {
  const [a, m, d] = hojeIso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

/** As recusas do banco, em português de quem opera. */
export function recusaDoFechamento(mensagem: string): string {
  const m = mensagem ?? "";
  if (m.includes("GROUPED")) return "Esta parte segue a decisão do cliente: responda na decisão principal.";
  if (m.includes("NOTES_REQUIRED"))
    return `Escreva as considerações para o Coordenador (pelo menos ${CONSIDERACOES_MINIMO} letras).`;
  if (m.includes("FAR_APPOINTMENT_CHOICE"))
    return "O horário com o Coordenador está longe: escolha manter ou pedir uma reavaliação mais próxima.";
  if (m.includes("INVALID_CHOICE")) return "Escolha manter o horário ou pedir uma reavaliação mais próxima.";
  if (m.includes("NOT_ALLOWED")) return "Só quem executou o procedimento ou o Coordenador Clínico responde.";
  if (m.includes("COORDINATOR_DECIDES")) return "O Coordenador decide entre Sim e Não.";
  if (m.includes("ALREADY_CLOSED")) return "Esta tarefa já foi resolvida. Atualize a tela.";
  if (m.includes("ALREADY_ACTED")) return "Não dá mais para mudar a resposta: o próximo passo já aconteceu.";
  if (m.includes("NOTHING_TO_CHANGE")) return "Essa já é a resposta registrada.";
  if (m.includes("NOT_IN_CONTACT")) return "Esta tarefa não está mais na etapa de contato. Atualize a tela.";
  if (m.includes("SUMMARY_REQUIRED")) return "Escreva o que o cliente disse.";
  if (m.includes("OUTCOME_REQUIRED")) return "Escolha o que fazer depois da conversa.";
  if (m.includes("INVALID_OUTCOME")) return "Sem falar com o cliente, só dá para registrar a tentativa ou encerrar sem contato.";
  if (m.includes("NEEDS_THREE_ATTEMPTS"))
    return `Só dá para encerrar sem contato depois de ${TENTATIVAS_PARA_SEM_CONTATO} tentativas sem falar com o cliente.`;
  if (m.includes("RETURN_DATE_PAST")) return "A data do retorno tem de ser depois de hoje.";
  if (m.includes("SATISFACTION_REQUIRED")) return "Marque a satisfação do cliente (0 a 10) e se ele tem queixa.";
  if (m.includes("COMPLAINT_REQUIRES_REVIEW")) return "Com queixa, o próximo passo é chamar o cliente para revisar.";
  if (m.includes("NOTE_REQUIRED")) return "Em Revisar ou Refazer, escreva o motivo.";
  if (m.includes("USE_ITEM_EVALUATION")) return "Plano de tratamento se avalia procedimento por procedimento, no cockpit de avaliação.";
  if (m.includes("NOT_IN_REEVALUATION")) return "Esta tarefa não está mais esperando a reavaliação. Atualize a tela.";
  if (m.includes("INVALID_LEVEL")) return "Escolha um dos cinco níveis.";
  if (m.includes("NOT_FOUND")) return "Tarefa não encontrada. Atualize a tela.";
  return "Não foi possível registrar. Atualize a tela e tente de novo.";
}
