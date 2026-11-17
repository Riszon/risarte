// O ABANDONO DE TRATAMENTO E A LISTA DE ESQUECIDOS (0423, Etapa 4 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seções 6 e 7).
//
// Quem decide é o banco (`register_abandonment_attempt`,
// `register_treatment_abandonment`, `decide_treatment_abandonment`,
// `start_treatment_abandonment`, `clients_without_next_step`); este arquivo só
// traduz as etapas, diz quem vê cada botão e transforma as recusas em frases.

export type EtapaDoAbandono = "reagendar" | "contato" | "gerente" | "cancelamento" | "encerrado";

export type CanalDaTentativa = "ligacao" | "mensagem" | "presencial";
export type CanalDosRiscos = CanalDaTentativa | "carta";

export type DecisaoDoGerente = "fase7" | "cancelamento";

export type MotivoSemProximoPasso =
  | "sessoes_sem_horario"
  | "ortodontia_suspensa"
  | "ortodontia_sem_inicio"
  | "complemento_parado"
  | "reavaliacao_sem_horario"
  | "sem_tratamento_pendente";

export type Abandono = {
  id: string;
  status: EtapaDoAbandono;
  origin: "automatico" | "manual";
  lastActivityAt: string | null;
  /** Tentativas da Recepção (etapa reagendar) e do Coordenador (contato). */
  tentativasRecepcao: number;
  tentativasCoordenador: number;
  risksInformed: string | null;
  risksChannel: CanalDosRiscos | null;
  risksInformedOn: string | null;
  registeredAt: string | null;
};

/** D16: tentativas da Recepção antes de o Coordenador assumir. */
export const TENTATIVAS_DA_RECEPCAO = 3;

/** O mínimo de texto dos riscos informados (o banco recusa abaixo). */
export const MINIMO_DOS_RISCOS = 20;

export const CANAL_DA_TENTATIVA_LABEL: Record<CanalDaTentativa, string> = {
  ligacao: "Ligação",
  mensagem: "Mensagem",
  presencial: "Pessoalmente",
};

export const CANAL_DOS_RISCOS_LABEL: Record<CanalDosRiscos, string> = {
  ...CANAL_DA_TENTATIVA_LABEL,
  carta: "Carta ou e-mail",
};

export const MOTIVO_LABEL: Record<MotivoSemProximoPasso, string> = {
  sessoes_sem_horario: "Sessões pendentes sem horário",
  ortodontia_suspensa: "Ortodontia suspensa",
  ortodontia_sem_inicio: "Ortodontia aguardando início, sem horário",
  complemento_parado: "Plano complementar parado",
  reavaliacao_sem_horario: "Reavaliação sem horário",
  sem_tratamento_pendente: "Nada pendente, mas ainda na Fase 5",
};

/** Dias inteiros desde a última atividade (null quando não se sabe). */
export function diasDesde(iso: string | null, agoraMs: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((agoraMs - t) / 86_400_000));
}

/** O título da linha no painel "Precisa de atenção". */
export function tituloDoAbandono(etapa: EtapaDoAbandono): string {
  switch (etapa) {
    case "reagendar":
      return "Reagendar o tratamento: sessões pendentes sem horário";
    case "contato":
      return "Possível abandono: o Coordenador contata o cliente";
    case "gerente":
      return "Abandono registrado: o Gerente decide";
    case "cancelamento":
      return "Abandono: abrir o cancelamento formal";
    case "encerrado":
      return "Abandono encerrado";
  }
}

/** A frase de baixo da linha. */
export function detalheDoAbandono(a: Abandono, agoraMs: number): string {
  const dias = diasDesde(a.lastActivityAt, agoraMs);
  const parado = dias === null ? "" : `Última atividade há ${dias} dia(s). `;
  switch (a.status) {
    case "reagendar":
      return `${parado}Tentativas da Recepção: ${a.tentativasRecepcao} de ${TENTATIVAS_DA_RECEPCAO}. Agendar a próxima sessão encerra a tarefa.`;
    case "contato":
      return a.origin === "manual"
        ? `${parado}Aberto pela lista "Clientes sem próximo passo". Contate o cliente; se ele não voltar, registre o abandono com os riscos informados.`
        : `${parado}A Recepção não conseguiu reagendar. Contate o cliente; se ele não voltar, registre o abandono com os riscos informados.`;
    case "gerente":
      return "O Coordenador registrou o abandono e os riscos informados. Decida: Acompanhamento (Fase 7) com retorno ou cancelamento formal.";
    case "cancelamento":
      return "O Gerente decidiu pelo cancelamento formal. A tarefa termina quando o termo for aberto (aba Plano).";
    case "encerrado":
      return "";
  }
}

/** Quem vê cada botão (espelho das guardas do banco). */
export function acoesDoAbandono(
  etapa: EtapaDoAbandono,
  quem: { ehRecepcao: boolean; ehCoordenador: boolean; ehGerente: boolean }
): { tentativa: boolean; registrar: boolean; decidir: boolean; agendar: boolean; termo: boolean } {
  return {
    tentativa:
      (etapa === "reagendar" && (quem.ehRecepcao || quem.ehCoordenador || quem.ehGerente)) ||
      (etapa === "contato" && quem.ehCoordenador),
    registrar: etapa === "contato" && quem.ehCoordenador,
    decidir: etapa === "gerente" && quem.ehGerente,
    agendar: (etapa === "reagendar" || etapa === "contato") && quem.ehRecepcao,
    termo: etapa === "cancelamento" && quem.ehGerente,
  };
}

/** As recusas do banco, em português de quem opera. */
export function recusaDoAbandono(mensagem: string): string {
  const m = mensagem ?? "";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para esta etapa do abandono.";
  if (m.includes("WRONG_STAGE")) return "Esta tarefa já mudou de etapa. Atualize a tela.";
  if (m.includes("SUMMARY_REQUIRED")) return "Escreva o que o cliente disse.";
  if (m.includes("ESCALATE_NEEDS_TALK")) return "Só dá para encaminhar ao Coordenador depois de falar com o cliente.";
  if (m.includes("INVALID_CHANNEL")) return "Escolha como foi o contato.";
  if (m.includes("RISKS_REQUIRED"))
    return `Descreva os riscos clínicos informados ao cliente (pelo menos ${MINIMO_DOS_RISCOS} caracteres).`;
  if (m.includes("INVALID_DATE")) return "A data em que os riscos foram informados não pode ser no futuro.";
  if (m.includes("INVALID_DECISION")) return "Escolha Acompanhamento ou cancelamento formal.";
  if (m.includes("RETURN_DATE_PAST")) return "A data do retorno tem de ser depois de hoje.";
  if (m.includes("WRONG_PHASE")) return "Só para clientes em tratamento ou em reavaliação.";
  if (m.includes("ALREADY_OPEN")) return "Este cliente já tem uma tarefa de abandono aberta.";
  if (m.includes("NOT_FOUND")) return "Tarefa não encontrada. Atualize a tela.";
  return "Não foi possível registrar. Atualize a tela e tente de novo.";
}
