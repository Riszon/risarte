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
  INVALID_TRANSITION: "Esta mudança de situação não é possível agora (as contenções só são entregues a um caso em tratamento; a alta, a um caso em acompanhamento; suspender e emitir mensalidades, só em tratamento).",
  REASON_REQUIRED: "Escreva o motivo.",
  // ORTO8/ORTO9 (0334/0335)
  SALE_REQUIRED: "O caso de ortodontia nasce de uma venda fechada no Comercial. Para quem já estava em tratamento antes do sistema, use o caso legado.",
  SALE_NOT_CLOSED: "A venda desta negociação ainda não foi fechada (contrato assinado e pagamento confirmado).",
  LEGACY_CLOSED: "O cadastro de caso legado está fechado nesta unidade — peça ao Admin para reabrir na Configuração da Ortodontia.",
  LEGACY_NOTE_REQUIRED: "Diga por que este caso entra como legado.",
  BATCH_ACTIVE: "Este caso já tem um lote de mensalidades em andamento. Decida o lote atual (renovar ou encerrar) antes de emitir outro.",
  INVALID_DECISION: "Decisão inválida.",
  PAID_ON_FUTURE: "A data do pagamento não pode ser no futuro.",
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
