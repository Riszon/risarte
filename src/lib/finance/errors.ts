// Mensagens pt-BR para os erros que o banco levanta como código.
//
// O banco fala em código (`PERIOD_CLOSED`) porque a regra é dele e precisa valer
// para qualquer caminho — inclusive os que ninguém lembrou de tratar. A tradução
// mora aqui, num lugar só: espalhar `if (msg.includes(...))` por cada action é
// como metade delas acaba mostrando "algo deu errado" para um erro que tinha
// explicação.

const MESSAGES: Record<string, string> = {
  PERIOD_CLOSED:
    "Este mês já foi fechado — o resultado dele não muda mais. Para lançar aqui, peça à Franqueadora para reabrir o período.",
  PERIOD_NOT_ENDED:
    "O mês ainda não terminou. Só dá para fechar depois do último dia.",
  EARLIER_PERIOD_OPEN:
    "Existe mês anterior ainda aberto com movimento. Feche os meses em ordem.",
  REASON_REQUIRED: "Escreva o motivo da reabertura.",
  NOT_ALLOWED: "Você não tem permissão para isto.",
  ACCOUNT_NOT_ANALYTIC: "Esta conta é um grupo e não recebe lançamento.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada no plano de contas.",
  UNIT_LOCKED:
    "O item já tem movimento: a unidade de medida não pode mais mudar.",
};

/**
 * Traduz a mensagem crua do Postgres. Devolve `null` quando não reconhece —
 * quem chama decide o texto genérico, e assim um erro novo nunca vira uma
 * mensagem errada com cara de certa.
 */
export function financeErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) {
      // Alguns erros carregam detalhe depois de dois-pontos
      // (`EARLIER_PERIOD_OPEN: 02/2026`) — vale mostrar.
      const detail = raw.split(`${code}:`)[1]?.trim().split("\n")[0];
      return detail ? `${message} (${detail})` : message;
    }
  }
  return null;
}
