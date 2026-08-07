/**
 * "Hoje" no fuso do Brasil.
 *
 * `new Date().toISOString().slice(0, 10)` devolve a data em **UTC**. Como o
 * Brasil está 3 horas atrás, **depois das 21h o sistema inteiro virava o dia**:
 * uma parcela vencendo hoje aparecia em atraso e a baixa era gravada com a data
 * de amanhã (achado do dono em 06/08/2026, às 21h45).
 *
 * Toda data de negócio — vencimento, recebimento, competência, vigência — é
 * data CIVIL brasileira, não instante em UTC. Este módulo é a única fonte de
 * "hoje" do app; no banco, o equivalente é `public.today_br()`.
 */

export const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

/**
 * A data civil de um instante, num fuso, como "YYYY-MM-DD".
 *
 * `en-CA` formata exatamente nesse padrão — é o jeito de obter a data local
 * sem montar string na mão e sem depender do fuso da máquina.
 */
export function isoDateIn(
  instant: Date,
  timeZone: string = BRAZIL_TIME_ZONE
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Hoje no Brasil, "YYYY-MM-DD". Use SEMPRE isto para datas de negócio. */
export function todayInBrazil(): string {
  return isoDateIn(new Date());
}
