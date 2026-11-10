/**
 * 0373 (09/11/2026, cliente CBE-00001 de Cambé) — A VENDA SÓ VALE DEPOIS DO
 * FECHAMENTO (contrato assinado + pagamento confirmado = `closed_at`).
 *
 * O cockpit grava as cobranças ao "Salvar negociação": é o plano de pagamento
 * PROPOSTO. Enquanto a negociação está aberta, elas não são cobrança de
 * verdade — não entram no Financeiro do cliente, não ficam "em atraso" e a
 * opção do plano não é "comprada". O banco (0373) já não lança receita delas.
 */

/** Situações de `plan_negotiations.status`. */
export type NegotiationStatus =
  | "em_negociacao"
  | "aguardando_autorizacao"
  | "aceita"
  | "devolvida"
  | "perdida"
  | "substituida"
  | "cancelada"
  | (string & {});

export type SeloDaVenda = {
  texto: string;
  tom: "comprada" | "aguardando" | "cancelada";
};

/**
 * O selo da opção do plano no prontuário. "Comprada pelo cliente" SÓ com a
 * venda fechada; aceita sem assinatura avisa que falta a assinatura; em
 * negociação não leva selo (a opção ainda não foi comprada).
 */
export function seloDaVenda(v: {
  status: NegotiationStatus;
  closed: boolean;
}): SeloDaVenda | null {
  if (v.status === "cancelada") {
    return { texto: "Comprada — cancelada", tom: "cancelada" };
  }
  if (v.closed) return { texto: "Comprada pelo cliente", tom: "comprada" };
  if (v.status === "aceita") {
    return { texto: "Aceita — aguardando assinatura", tom: "aguardando" };
  }
  return null;
}

/**
 * A cobrança é só a PROPOSTA de uma negociação ainda aberta? Então não aparece
 * como cobrança no Financeiro do cliente.
 *
 * Fica de fora desta regra (continua aparecendo):
 * - renegociação e venda direta (têm fluxo próprio);
 * - negociação ACEITA: a equipe emite a cobrança antes de o contrato voltar
 *   assinado ("Cobrança emitida" no fechamento);
 * - venda fechada;
 * - cobrança que já recebeu dinheiro (venda antiga, antes da trava da 0203) —
 *   esconder dinheiro recebido seria pior do que mostrá-lo.
 */
export function cobrancaEhSoProposta(i: {
  origin: "negotiation" | "direct_sale" | "renegotiation";
  negotiationStatus: NegotiationStatus | null;
  saleClosed: boolean;
  paidAmountCents: number;
}): boolean {
  if (i.origin !== "negotiation") return false;
  if (i.saleClosed) return false;
  if (i.paidAmountCents > 0) return false;
  if (i.negotiationStatus === "aceita") return false;
  // Sem a situação (não deu para ler), mostra: esconder por falta de leitura
  // apagaria cobrança de verdade da tela.
  if (i.negotiationStatus === null) return false;
  return true;
}
