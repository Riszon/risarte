/**
 * 4017 (19.28) — as recusas do banco na renegociação, nas palavras da tela.
 * Devolve null quando o erro não é conhecido (a tela mostra a mensagem geral).
 */
export function mensagemDaRenegociacao(m: string): string | null {
  if (m.includes("NO_INSTALLMENTS")) return "Escolha ao menos uma cobrança.";
  if (m.includes("NO_ENTRIES")) return "Monte o novo parcelamento antes de salvar.";
  if (m.includes("INSTALLMENT_NOT_OPEN")) return "Alguma cobrança escolhida já foi paga, cancelada ou renegociada. Recarregue a tela.";
  if (m.includes("CLIENT_MISMATCH") || m.includes("CLINIC_MISMATCH")) return "As cobranças precisam ser do mesmo cliente e da mesma unidade.";
  if (m.includes("MULTIPLE_DOWN_PAYMENTS")) return "Só pode haver uma entrada.";
  if (m.includes("RENEGOTIATION_PENDING"))
    return "Alguma dessas cobranças já está numa renegociação que ainda não vale (esperando a autorização do Gerente ou a assinatura do cliente).";
  if (m.includes("SALE_NOT_CLOSED"))
    return "Esta parcela é de uma venda que ainda não foi fechada. Feche a venda (contrato assinado) antes de renegociar.";
  if (m.includes("PERMUTA_NOT_ALLOWED")) return "Parcela em permuta só pelo Gerente da unidade ou pelo Admin Master.";
  if (m.includes("PERMUTA_DESCRIPTION_REQUIRED")) return "Descreva o que é a permuta em cada parcela de permuta.";
  if (m.includes("METHOD_NOT_ALLOWED"))
    return "Meio de pagamento não aceito na renegociação. Use Pix, boleto, cartão, cartão parcelado pelo Asaas, dinheiro ou permuta.";
  if (m.includes("FIRST_DUE_TOO_SOON"))
    return "O primeiro vencimento novo precisa ser depois de hoje: o termo precisa de ao menos um dia para ser assinado.";
  if (m.includes("PARCELADO_ASAAS_MIN_2")) return "O cartão parcelado pelo Asaas precisa de ao menos 2 parcelas.";
  if (m.includes("PARCELADO_ASAAS_MAX_21")) return "O cartão parcelado pelo Asaas aceita no máximo 21 parcelas.";
  if (m.includes("PARCELADO_ASAAS_DIA")) return "No cartão parcelado pelo Asaas, o primeiro vencimento tem de ser até o dia 28.";
  if (m.includes("PARCELADO_ASAAS_DATAS")) return "No cartão parcelado pelo Asaas, os vencimentos são mês a mês, no mesmo dia do primeiro.";
  if (m.includes("PARCELADO_ASAAS_VALORES")) return "No cartão parcelado pelo Asaas, as parcelas têm o mesmo valor; a sobra vai na última.";
  if (m.includes("INVALID_MODE")) return "Forma dos boletos inválida.";
  if (m.includes("NOT_ALLOWED")) return "Renegociar é do Gerente da unidade, do Financeiro da Franqueadora ou do Admin Master.";
  return null;
}
