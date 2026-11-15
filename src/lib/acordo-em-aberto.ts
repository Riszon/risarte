/**
 * 4015a (19.28.11, decisão A(a)): a venda com parcelas num acordo de
 * renegociação ainda em aberto não é cancelada. O banco recusa com
 * `RENEGOTIATED_OPEN: RN-…, RN-…`; a tela explica o motivo e a quem recorrer.
 */
export function mensagemDoAcordoEmAberto(erro: string): string | null {
  const m = /RENEGOTIATED_OPEN:?\s*([^\n]*)/.exec(erro);
  if (!m) return null;
  const codigos = m[1].trim();
  const acordo = codigos ? `no acordo ${codigos}` : "num acordo de renegociação";
  return (
    `Esta venda tem parcelas ${acordo}, ainda em aberto (ou esperando autorização). ` +
    "Cancelar a venda agora deixaria as parcelas do acordo sendo cobradas e ignoraria o que o cliente já pagou nelas. " +
    "O cancelamento de venda com acordo fica para o distrato. Até lá, fale com o Financeiro da Franqueadora ou com o Admin Master."
  );
}
