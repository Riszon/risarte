import { addDaysIso, instantFromBrazil, todayInBrazil } from "@/lib/dates";

/**
 * O PRAZO DO LINK DE ASSINATURA (AP154, revisão de 11/11/2026): termina às
 * 23:59 do relógio de Brasília, `dias` dias depois de hoje (no Brasil).
 *
 * Antes era `setUTCHours(23, 59)`: 23:59 em UTC = 20:59 aqui — o paciente que
 * assinava à noite, no último dia, já encontrava o link vencido. O mesmo
 * instante vai à ZapSign (`date_limit_to_sign`) e à rotina diária
 * (`expires_at`), então os dois lados vencem juntos.
 */
export function prazoDeAssinatura(dias: number, hoje: string = todayInBrazil()): Date {
  return instantFromBrazil(addDaysIso(hoje, Math.max(1, Math.round(dias))), "23:59");
}
