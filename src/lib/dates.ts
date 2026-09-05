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

// =============================================================================
// RELÓGIO DE PAREDE × INSTANTE  (o defeito de 05/09/2026)
// =============================================================================
//
// `new Date("2026-09-05T14:00:00")` — sem fuso na string — é lido no fuso da
// MÁQUINA. No computador do dono a máquina está em Brasília e dá 14:00 no
// Brasil; na Vercel a máquina está em UTC e o mesmo texto vira 14:00Z, que é
// **11:00 no Brasil**.
//
// As consequências, todas as três encontradas juntas:
//
// 1. Agendar ou REMARCAR para as próximas 3 horas era recusado com "data/horário
//    no passado" — o horário digitado nascia 3 horas atrás. Foi o que o dono
//    achou no ambiente de teste.
// 2. O agendamento que passava era GRAVADO 3 horas antes do que se digitou.
// 3. Os horários livres das próximas 3 horas sumiam da lista de opções.
//
// E o pior: no computador do dono nada disso acontece. O defeito só existe onde
// o sistema roda de verdade — que é a forma mais cara de defeito.
//
// A regra, então: **hora de negócio é relógio de parede brasileiro**, e a
// conversão para instante é sempre explícita, por estas funções. Nunca
// `new Date("...T...")` sem fuso em código de servidor.

/**
 * Quanto o relógio de parede do fuso está adiantado (ou atrasado) em relação ao
 * UTC, naquele instante, em minutos. São Paulo hoje devolve −180.
 *
 * Vem do `Intl` e não de um número fixo: se o Brasil voltar a ter horário de
 * verão, um `-3` cravado no código erraria por uma hora durante meses, e a
 * agenda erraria junto sem ninguém entender por quê.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const p: Record<string, string> = {};
  for (const { type, value } of partes) p[type] = value;

  // `hour12: false` devolve "24" à meia-noite em alguns ambientes; o resto da
  // conta ficaria um dia à frente.
  const hora = Number(p.hour) % 24;
  const comoSeFosseUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hora,
    Number(p.minute),
    Number(p.second)
  );
  return (comoSeFosseUtc - instant.getTime()) / 60_000;
}

/**
 * O instante correspondente a uma data + hora **do relógio brasileiro**.
 *
 * Devolve `Date` inválido (como `new Date("x")`) quando a entrada não presta —
 * quem chama já testa `Number.isNaN(getTime())`, e inventar um horário aqui
 * seria pior do que recusar.
 */
export function instantFromBrazil(
  isoDate: string,
  time = "00:00",
  timeZone: string = BRAZIL_TIME_ZONE
): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) return new Date(NaN);

  const parede = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]),
    Number(t[2]),
    Number(t[3] ?? 0)
  );
  if (Number.isNaN(parede)) return new Date(NaN);

  // Duas passadas: o deslocamento depende do instante, e o instante depende do
  // deslocamento. Sem horário de verão a primeira já acerta; com ele, a segunda
  // corrige a hora da virada. Mais que duas não muda nada.
  const primeira = new Date(parede - zoneOffsetMinutes(new Date(parede), timeZone) * 60_000);
  return new Date(parede - zoneOffsetMinutes(primeira, timeZone) * 60_000);
}

/** O instante em que começa aquele dia civil brasileiro (00:00 no Brasil). */
export function startOfDayInBrazil(isoDate: string): Date {
  return instantFromBrazil(isoDate, "00:00");
}

/** O começo do dia brasileiro de HOJE. */
export function startOfTodayInBrazil(): Date {
  return startOfDayInBrazil(todayInBrazil());
}

/**
 * O começo do dia brasileiro em que este instante caiu.
 *
 * Substitui `d.setHours(0, 0, 0, 0)`, que zera o relógio da MÁQUINA: no
 * servidor em UTC isso dá 21h do dia anterior no Brasil.
 */
export function startOfDayOf(instant: Date): Date {
  return startOfDayInBrazil(isoDateIn(instant));
}

/** Soma (ou subtrai) dias numa data civil "AAAA-MM-DD", sem passar por fuso. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!d) return isoDate;
  const base = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * O dia da semana (0 = domingo) de uma data civil, por aritmética pura.
 *
 * Não passa por fuso nenhum de propósito: "que dia da semana é 05/09/2026" tem
 * uma resposta só, e fazê-la depender de relógio é convidar o erro de volta.
 */
export function weekdayOf(isoDate: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!d) return NaN;
  return new Date(
    Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))
  ).getUTCDay();
}

// -----------------------------------------------------------------------------
// EXIBIÇÃO
// -----------------------------------------------------------------------------
//
// `data.toLocaleString("pt-BR")` formata no fuso da MÁQUINA. No navegador da
// equipe isso dá certo por acaso (o computador está em Brasília); no SERVIDOR
// da Vercel dá 3 horas a mais — foi assim que a tela de Auditoria mostrou
// "15:07" às 12:07 (achado do dono em 05/09/2026, com o relógio novo da barra
// lateral ao lado, marcando a hora certa).
//
// Regra: **toda formatação de data/hora leva `timeZone` explícito**. Não é só
// para o servidor — deixar explícito também protege quem abrir o sistema de um
// computador configurado em outro fuso.

/** Formata um instante SEMPRE no horário de Brasília. */
export function formatInBrazil(
  instant: Date | string | number,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: BRAZIL_TIME_ZONE,
  }).format(new Date(instant));
}

/** "05/09/2026" */
export const formatBrDate = (instant: Date | string | number) =>
  formatInBrazil(instant, { day: "2-digit", month: "2-digit", year: "numeric" });

/** "12:07" */
export const formatBrTime = (instant: Date | string | number) =>
  formatInBrazil(instant, { hour: "2-digit", minute: "2-digit", hour12: false });

/** "05/09/2026, 12:07" */
export const formatBrDateTime = (instant: Date | string | number) =>
  formatInBrazil(instant, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** O relógio de parede brasileiro agora: `{ date: "2026-09-05", time: "14:32" }`. */
export function brazilClock(instant: Date = new Date()): {
  date: string;
  time: string;
} {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const p: Record<string, string> = {};
  for (const { type, value } of partes) p[type] = value;
  const hora = String(Number(p.hour) % 24).padStart(2, "0");
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hora}:${p.minute}` };
}
