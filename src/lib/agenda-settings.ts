// Per-unit agenda configuration (B2/B3): working hours, open weekdays and the
// number of chairs, in the cascade pattern (network default → unit override).

export type AgendaSettingRow = {
  clinic_id: string | null;
  open_time: string; // "HH:MM[:SS]"
  close_time: string;
  weekdays: number[]; // 0 = Sunday … 6 = Saturday
  chairs: number;
  lunch_enabled?: boolean | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  /** H3.4: minutos de espera que disparam o alerta de espera longa. */
  waiting_alert_minutes?: number | null;
};

export type AgendaSettings = {
  openTime: string; // "HH:MM"
  closeTime: string;
  weekdays: number[];
  chairs: number;
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  waitingAlertMinutes: number;
};

export const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export const AGENDA_DEFAULTS: AgendaSettings = {
  openTime: "08:00",
  closeTime: "18:00",
  weekdays: [1, 2, 3, 4, 5, 6],
  chairs: 3,
  lunchEnabled: false,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  waitingAlertMinutes: 20,
};

/** "HH:MM:SS" → "HH:MM". */
export function hhmm(time: string): string {
  return (time ?? "").slice(0, 5);
}

/** Effective settings for a clinic: unit override > network default > code default. */
export function resolveAgendaSettings(
  rows: AgendaSettingRow[],
  clinicId: string | null
): AgendaSettings {
  const override = clinicId
    ? rows.find((r) => r.clinic_id === clinicId)
    : undefined;
  const network = rows.find((r) => r.clinic_id === null);
  const row = override ?? network;
  if (!row) return AGENDA_DEFAULTS;
  return {
    openTime: hhmm(row.open_time) || AGENDA_DEFAULTS.openTime,
    closeTime: hhmm(row.close_time) || AGENDA_DEFAULTS.closeTime,
    weekdays:
      row.weekdays && row.weekdays.length > 0
        ? row.weekdays
        : AGENDA_DEFAULTS.weekdays,
    chairs: row.chairs ?? AGENDA_DEFAULTS.chairs,
    lunchEnabled: row.lunch_enabled ?? AGENDA_DEFAULTS.lunchEnabled,
    lunchStart: hhmm(row.lunch_start ?? "") || AGENDA_DEFAULTS.lunchStart,
    lunchEnd: hhmm(row.lunch_end ?? "") || AGENDA_DEFAULTS.lunchEnd,
    waitingAlertMinutes:
      row.waiting_alert_minutes ??
      network?.waiting_alert_minutes ??
      AGENDA_DEFAULTS.waitingAlertMinutes,
  };
}

export function timeToMinutes(time: string): number {
  const [h, m] = hhmm(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * AJ7: janela de atendimento efetiva de um dia. Sem "dia avulso" = horário
 * normal. Num dia NORMAL com dia avulso = EXTENSÃO (une o horário normal com o
 * avulso — começa antes / termina depois). Num dia FECHADO com dia avulso =
 * usa só a janela do avulso (abre um dia que não atende normalmente).
 */
export function effectiveDayHours(
  normalOpen: string,
  normalClose: string,
  openDay: { start: string; end: string } | null,
  isNormalDay: boolean
): { open: string; close: string } {
  if (!openDay) return { open: hhmm(normalOpen), close: hhmm(normalClose) };
  const start = hhmm(openDay.start);
  const end = hhmm(openDay.end);
  if (!isNormalDay) return { open: start, close: end };
  const open =
    timeToMinutes(start) < timeToMinutes(normalOpen) ? start : hhmm(normalOpen);
  const close =
    timeToMinutes(end) > timeToMinutes(normalClose) ? end : hhmm(normalClose);
  return { open, close };
}

// ---------------------------------------------------------------------------
// A AGENDA DO ATENDIMENTO ONLINE (0268) — relato OC-00072
// ---------------------------------------------------------------------------
// A apresentação comercial é online: não usa sala, não usa cadeira e não
// depende de a unidade estar aberta. O consultor trabalha remoto e atende
// VÁRIAS unidades — a unidade pode estar fechada num sábado enquanto ele
// trabalha normalmente. Por isso a jornada dele é uma configuração própria, e
// não a da unidade.
//
// Cascata igual à da unidade, trocando "clínica" por "pessoa": linha com
// `user_id` nulo é o padrão da REDE; linha com `user_id` é a exceção daquele
// consultor. Campo a campo — quem só muda o horário mantém os dias da rede.

export type OnlineAgendaRow = {
  user_id: string | null;
  open_time: string | null;
  close_time: string | null;
  weekdays: number[] | null;
};

export type OnlineAgendaSettings = {
  openTime: string;
  closeTime: string;
  weekdays: number[];
  /** De onde veio o que está valendo — a tela diz isto a quem configura. */
  origem: "consultor" | "rede" | "padrao";
};

/** Mais largo que o da unidade: quem atende remoto alcança o cliente fora do
 *  horário comercial, que é quando o cliente consegue conversar. */
export const ONLINE_AGENDA_DEFAULTS: OnlineAgendaSettings = {
  openTime: "08:00",
  closeTime: "20:00",
  weekdays: [1, 2, 3, 4, 5, 6],
  origem: "padrao",
};

export function resolveOnlineAgenda(
  rows: OnlineAgendaRow[],
  userId: string | null
): OnlineAgendaSettings {
  const doConsultor = userId ? rows.find((r) => r.user_id === userId) : undefined;
  const daRede = rows.find((r) => r.user_id === null);

  // ⚠️ CAMPO A CAMPO, não linha a linha. Se a linha do consultor só define o
  // horário, os dias continuam vindo da rede — senão mudar a rede nunca mais
  // alcançaria quem tem exceção (a lição da `finance_settings`, 0230).
  const escolher = <T>(a: T | null | undefined, b: T | null | undefined, c: T): T =>
    a ?? b ?? c;

  const open = hhmm(
    escolher(doConsultor?.open_time, daRede?.open_time, ONLINE_AGENDA_DEFAULTS.openTime)
  );
  const close = hhmm(
    escolher(doConsultor?.close_time, daRede?.close_time, ONLINE_AGENDA_DEFAULTS.closeTime)
  );
  const dias =
    (doConsultor?.weekdays?.length ? doConsultor.weekdays : null) ??
    (daRede?.weekdays?.length ? daRede.weekdays : null) ??
    ONLINE_AGENDA_DEFAULTS.weekdays;

  return {
    openTime: open || ONLINE_AGENDA_DEFAULTS.openTime,
    closeTime: close || ONLINE_AGENDA_DEFAULTS.closeTime,
    weekdays: dias,
    origem: doConsultor ? "consultor" : daRede ? "rede" : "padrao",
  };
}
