// O FIM DO TRATAMENTO (0416, Etapa 2 do plano docs/jornada/FIM-DO-TRATAMENTO-PLANO.md).
//
// Cada plano que termina (o original, cada complemento, a venda direta), a
// ortodontia (na entrega da contenção) e a urgência de quem ainda não é cliente
// abrem um FECHAMENTO (`treatment_closures`): uma tarefa com dono que só some
// quando é resolvida. Quem decide o que acontece é o banco
// (`answer_treatment_closure`, `register_closure_contact`); este arquivo só
// traduz as situações, diz quem vê cada botão e transforma as recusas em frases.

export type EscopoDoFechamento = "plano" | "venda_direta" | "ortodontia" | "urgencia";

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
};

export const PERGUNTA_DO_FIM =
  "Este cliente necessita de consulta de reavaliação com o Coordenador Clínico?";

export const ESCOPO_LABEL: Record<EscopoDoFechamento, string> = {
  plano: "plano de tratamento",
  venda_direta: "venda direta",
  ortodontia: "ortodontia (contenção entregue)",
  urgencia: "atendimento de urgência",
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
  const o = `Terminou: ${ESCOPO_LABEL[f.scope]}.`;
  const fim = f.treatmentEnd ? " Não sobra outro tratamento." : " Ainda há tratamento em andamento.";
  switch (f.status) {
    case "pergunta":
      return `${o}${fim} Quem executou responde.`;
    case "coordenador":
      return `${o} Quem executou não soube definir; o Coordenador decide.`;
    case "reavaliacao":
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
  f: Pick<Fechamento, "status" | "answer" | "askedUserId" | "tentativas">,
  quem: { userId: string; ehCoordenador: boolean; clienteNaFase5: boolean }
): RespostaDoFechamento[] {
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
  if (m.includes("NOT_FOUND")) return "Tarefa não encontrada. Atualize a tela.";
  return "Não foi possível registrar. Atualize a tela e tente de novo.";
}
