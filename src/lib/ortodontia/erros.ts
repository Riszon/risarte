/**
 * As recusas do banco (0329) em português. O banco devolve um CÓDIGO; quem
 * escreve a frase é a tela. Código desconhecido vira a frase genérica — nunca
 * a mensagem técnica crua.
 */
const MENSAGENS: Record<string, string> = {
  NOT_ALLOWED: "Você não tem permissão para esta ação na ortodontia.",
  NOT_FOUND: "Este registro não existe mais.",
  CLIENT_NOT_FOUND: "Paciente não encontrado.",
  CASE_ALREADY_OPEN: "Este paciente já tem um caso ortodôntico aberto. Finalize ou interrompa o atual antes de abrir outro.",
  CASE_CLOSED: "O caso está finalizado ou interrompido: reabra antes de mexer no cronograma.",
  INVALID_STATUS: "Situação inválida.",
  INVALID_TRANSITION: "Esta mudança de situação não é possível agora.",
  REASON_REQUIRED: "Escreva o motivo.",
  ALREADY_DONE: "Esta manutenção já foi realizada — para desfazer, use a evolução.",
  MAINTENANCE_CANCELLED: "Esta manutenção foi cancelada.",
  PAYOUT_CLOSED: "O repasse desta manutenção já foi fechado no mês: não dá para desfazer.",
  APPOINTMENT_NOT_FOUND: "Agendamento não encontrado.",
  APPOINTMENT_OTHER_CLIENT: "Este agendamento é de outro paciente.",
  APPOINTMENT_ALREADY_LINKED: "Este agendamento já está ligado a outra manutenção.",
  CHARGE_PAID: "Mensalidade já paga não pode ser cancelada — desfaça a baixa antes.",
  CHARGE_CANCELLED: "Esta mensalidade foi cancelada.",
};

export function mensagemDaOrtodontia(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  for (const [codigo, frase] of Object.entries(MENSAGENS)) {
    if (msg.includes(codigo)) return frase;
  }
  // O banco sem a 0329: a função não existe.
  if (/function .* does not exist|Could not find the function/i.test(msg)) {
    return "A ortodontia ainda não está instalada neste banco (falta a migração 0329).";
  }
  return "Não foi possível concluir. Tente de novo em instantes.";
}
