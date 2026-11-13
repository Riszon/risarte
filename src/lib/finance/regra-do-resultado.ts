// A REGRA "FORA DO RESULTADO" — UM LUGAR SÓ (0406, decisão D5 do dono).
//
// Espelho de `public.account_outside_result` e `public.account_cash_activity`.
// Antes da 0406 a lista de prefixos (6, 5.1, 5.3, 5.4) estava repetida em nove
// funções do banco; com a família 5.5 (dívidas — passivo) ela passou a morar
// numa função só, chamada por todas. Mudou aqui, muda lá — a régua
// `regra-fora-do-resultado.test.ts` prende os dois e reprova leitor novo do
// razão que filtre prefixo por conta própria.

/** Prefixos de conta que NÃO entram no resultado (DRE, ponto de equilíbrio,
 * orçado × realizado, consolidado, hora clínica, ponte lucro × caixa). */
export const PREFIXOS_FORA_DO_RESULTADO = ["6", "5.1", "5.3", "5.4", "5.5"] as const;

export function contaForaDoResultado(code: string | null | undefined): boolean {
  const c = code ?? "";
  return PREFIXOS_FORA_DO_RESULTADO.some((p) => c.startsWith(p));
}

/** Contas que só recebem título pelo Levantamento de Dívidas (5.5): não
 * aparecem no lançamento manual do Contas a Pagar. */
export function contaSoPorDivida(code: string | null | undefined): boolean {
  return (code ?? "").startsWith("5.5");
}

export type AtividadeDoCaixa = "operacional" | "investimento" | "financiamento" | "dividas";

/** A atividade do fluxo de caixa. Dívidas antigas e acordos (5.5) em linha
 * própria, separada da operação (ajuste 3 do dono). */
export function atividadeDoCaixa(code: string | null | undefined): AtividadeDoCaixa {
  const c = code ?? "";
  if (c.startsWith("5.5")) return "dividas";
  if (c.startsWith("5.1") || c.startsWith("6.3")) return "investimento";
  if (c.startsWith("5.3") || c.startsWith("5.4")) return "financiamento";
  return "operacional";
}
