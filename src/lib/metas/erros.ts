/**
 * As recusas do banco (0318) em português. O banco devolve um CÓDIGO; quem
 * escreve a frase é a tela. Código desconhecido vira a frase genérica — nunca
 * a mensagem técnica crua.
 */
const MENSAGENS: Record<string, string> = {
  GOAL_NOT_ALLOWED: "Você não tem permissão para esta meta.",
  GOAL_NOT_FOUND: "Esta meta não existe mais.",
  GOAL_NAME_REQUIRED: "Dê um nome para a meta.",
  GOAL_UNKNOWN_INDICATOR: "Escolha um indicador da lista.",
  GOAL_BAD_PERIOD: "O prazo precisa de início e fim, e o fim não pode vir antes do início.",
  GOAL_BAD_DIRECTION: "Este indicador acumula no período: a meta só pode ser de aumentar.",
  GOAL_RATE_SPLIT: "Uma taxa não se divide entre pessoas: use o mesmo alvo para cada participante.",
  GOAL_BAD_CLINIC: "Escolha apenas unidades franqueadas.",
  GOAL_CLOSED: "Meta finalizada ou cancelada não pode mais ser alterada.",
  GOAL_REASON_REQUIRED: "Escreva o motivo. Depois de publicada, toda alteração fica registrada com o motivo.",
  GOAL_LOCKED_FIELD:
    "Depois de publicada, indicador, recorte, abrangência, modo, direção e periodicidade não mudam — isso seria outra meta. Cancele esta e crie uma nova.",
  GOAL_STARTED: "A meta já começou: a data de início não muda mais.",
  GOAL_END_IN_PAST: "O fim do prazo não pode ficar no passado.",
  GOAL_NOT_DRAFT: "Só um rascunho pode ser publicado ou descartado.",
  GOAL_SMART_S: "Falta o S (Específica): escreva como a meta vai ser alcançada.",
  GOAL_SMART_M: "Falta o M (Mensurável): defina o valor-alvo.",
  GOAL_SMART_A: "Falta o A (Atingível): diga quais recursos e apoio a equipe terá.",
  GOAL_SMART_R: "Falta o R (Relevante): escolha o objetivo estratégico e diga por que esta meta importa agora.",
  GOAL_NO_PARTICIPANTS: "Escolha quem participa da meta.",
  GOAL_BAD_TRANSITION: "Esta mudança de situação não é possível agora.",
};

export function mensagemDaMeta(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  const codigo = Object.keys(MENSAGENS).find((k) => msg.includes(k));
  return codigo ? MENSAGENS[codigo] : "Não foi possível concluir agora. Tente de novo em instantes.";
}
