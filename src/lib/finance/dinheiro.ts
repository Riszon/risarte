// 4011 (spec 19.12, ajuste D e F5): regras puras do painel do dinheiro.

/** Soma dos recebimentos escolhidos para o depósito, em centavos. */
export function somaDosEscolhidos(pendentes: { receipt_id: string; valor: number }[], escolhidos: Set<string>): number {
  return pendentes.filter((p) => escolhidos.has(p.receipt_id)).reduce((s, p) => s + Number(p.valor), 0);
}

/** Limite do pagamento de boleto em espécie (Resolução CMN 4.648/2018, art. 1º). */
export const LIMITE_BOLETO_EM_ESPECIE_CENTS = 1_000_000;
/** Valor a partir do qual a lotérica costuma recusar (aviso, não trava). */
export const AVISO_LOTERICA_CENTS = 500_000;

/**
 * O aviso da tela do depósito. Um depósito só por dia, sem dividir o caixa em
 * vários: dividir para ficar abaixo do limite é indício de tentativa de burlar
 * a vedação (parágrafo único da Resolução CMN 4.648/2018).
 */
export function avisoDoDeposito(cents: number): string | null {
  if (cents >= LIMITE_BOLETO_EM_ESPECIE_CENTS)
    return "Valor de R$ 10.000 ou mais: deposite na agência, direto na conta bancária da unidade (boleto desse valor não pode ser pago em dinheiro). Não divida o dinheiro em vários depósitos menores.";
  if (cents > AVISO_LOTERICA_CENTS)
    return "Acima de R$ 5.000: prefira a agência à lotérica. Não divida o dinheiro em vários depósitos menores.";
  return null;
}
