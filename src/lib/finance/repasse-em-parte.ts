// AP141 (0398): procedimento interrompido pelo cancelamento da venda é pago
// em parte, proporcional às sessões concluídas. A linha do repasse guarda
// quantas foram feitas e quantas o procedimento tinha.

/** "pago em parte: 2 de 3 sessões" — ou null quando o procedimento foi pago inteiro. */
export function textoDoPagoEmParte(
  feitas: number | null | undefined,
  total: number | null | undefined
): string | null {
  if (feitas == null || total == null || total <= 0 || feitas >= total) return null;
  return `pago em parte: ${feitas} de ${total} sessões (venda cancelada)`;
}
