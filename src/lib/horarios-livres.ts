// OS PRÓXIMOS HORÁRIOS LIVRES DA AGENDA — a conta pura, sem banco.
//
// Extraída de `getNextAvailableSlots` (`agenda/actions.ts`) em 04/11/2026
// (AP104, plano `docs/sdr/PLANO-CORRECOES-SECAO-2.md` §5a) para que ela pudesse
// ser PROVADA com o relógio da máquina em UTC — que é onde o sistema roda de
// verdade (Vercel), e onde o defeito de 05/09/2026 viveu sem ninguém ver.
//
// A action continua lendo o banco e traduzindo as linhas; aqui entra só o que
// já foi lido (configuração efetiva, fechamentos, dias avulsos, decisões de
// feriado, itens do plano anual, agendamentos ocupados) e o `agora`, e sai a
// lista de horários. Duas réguas para o mesmo dia é como uma oferece o que a
// outra recusa — por isso a validação (`checkAgendaRules`) e esta lista usam
// as mesmas funções puras (`situacaoDoPlanoNoDia`, `closureBlocks`).

import { timeToMinutes, type AgendaSettings, type OnlineAgendaSettings } from "@/lib/agenda-settings";
import { closureBlocks, type AgendaClosure } from "@/lib/closures";
import { situacaoDoPlanoNoDia, type PlanItem } from "@/lib/annual-plan";
import { addDaysIso, instantFromBrazil, isoDateIn, startOfDayInBrazil, weekdayOf } from "@/lib/dates";

export type AvailableSlot = { date: string; time: string };

/** Um agendamento como a lista o enxerga (as colunas que a action lê). */
export type AgendamentoOcupado = {
  provider_user_id: string | null;
  room_id: string | null;
  client_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  type: string;
};

/** Quantos dias à frente a lista procura. */
export const DIAS_DA_JANELA = 45;

/** "minutes since midnight" → "HH:MM". */
export function minutesToHHMM(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/**
 * A janela em que a lista procura: de HOJE (dia civil BRASILEIRO em que
 * `agora` caiu) até 45 dias à frente. A action usa os mesmos limites para
 * filtrar o banco; a conta usa `hojeIso` para andar no calendário.
 *
 * ⚠️ AP104 (provado em 04/11/2026 com o relógio em UTC): a janela nascia em
 * `new Date(ano, mês, dia)` — a meia-noite da MÁQUINA — e o dia da semana
 * vinha de `day.getDay()`. Na Vercel, a partir das 21h de Brasília, o dia da
 * semana conferido era o do dia SEGUINTE ao da data oferecida: numa sexta à
 * noite a lista oferecia DOMINGO às 08:00 (conferiu "segunda", ofereceu
 * "domingo"). Hoje o dia é civil brasileiro, e o dia da semana é aritmética
 * (`weekdayOf`), que não depende de relógio nenhum.
 */
export function janelaDosHorarios(agora: Date): {
  hojeIso: string;
  inicio: Date;
  fim: Date;
  inicioIso: string;
  fimIso: string;
} {
  const hojeIso = isoDateIn(agora);
  const inicio = startOfDayInBrazil(hojeIso);
  const fim = startOfDayInBrazil(addDaysIso(hojeIso, DIAS_DA_JANELA));
  return {
    hojeIso,
    inicio,
    fim,
    inicioIso: inicio.toISOString(),
    fimIso: fim.toISOString(),
  };
}

export type EntradaDosHorarios = {
  agora: Date;
  /** Configuração efetiva da unidade (`resolveAgendaSettings`). */
  cfg: AgendaSettings;
  /** 0268: no ONLINE manda a jornada do consultor (nula fora do online). */
  jornadaOnline: OnlineAgendaSettings | null;
  isOnline: boolean;
  providerUserId: string | null;
  roomId: string | null;
  clientId: string | null;
  /** Já normalizados pela action (mínimo 15 min; 1 a 30 horários). */
  durationMin: number;
  limit: number;
  closures: AgendaClosure[];
  /** Dia avulso: "AAAA-MM-DD" → janela em minutos. */
  openDayHours: Map<string, { open: number; close: number }>;
  /** Decisão de feriado: "AAAA-MM-DD" → atende? */
  holidayDecision: Map<string, boolean>;
  /** Agendamentos da unidade na janela (os cancelados/faltas são descartados aqui). */
  appts: AgendamentoOcupado[];
  itensDoPlano: PlanItem[];
};

/**
 * Os próximos horários livres de uma unidade, respeitando dias e horário de
 * funcionamento, almoço, dias avulsos, feriados decididos, fechamentos de
 * agenda, plano anual e as agendas do profissional / sala / cliente escolhidos.
 */
export function horariosLivres(e: EntradaDosHorarios): AvailableSlot[] {
  const {
    cfg,
    jornadaOnline,
    isOnline,
    providerUserId,
    roomId,
    clientId,
    durationMin,
    limit,
    closures,
    openDayHours,
    holidayDecision,
    itensDoPlano,
  } = e;
  const { hojeIso } = janelaDosHorarios(e.agora);

  const active = (s: string) => s !== "cancelled" && s !== "no_show";
  const appts = e.appts.filter((a) => active(a.status));

  const lunchStart = cfg.lunchEnabled ? timeToMinutes(cfg.lunchStart) : -1;
  const lunchEnd = cfg.lunchEnabled ? timeToMinutes(cfg.lunchEnd) : -1;
  const nowMs = e.agora.getTime();
  const slots: AvailableSlot[] = [];

  for (let d = 0; d < DIAS_DA_JANELA && slots.length < limit; d++) {
    const dateOnly = addDaysIso(hojeIso, d);
    const hd = holidayDecision.get(dateOnly);
    // O feriado é da unidade; o consultor remoto não fecha por causa dele.
    if (hd === false && !jornadaOnline) continue;
    const isWeekdayOpen = (jornadaOnline ?? cfg).weekdays.includes(weekdayOf(dateOnly));
    // Dia avulso é ato da unidade (abrir a porta num sábado): não muda a
    // jornada de quem atende de casa.
    const special = jornadaOnline ? undefined : openDayHours.get(dateOnly);
    const dayOpen = isWeekdayOpen || Boolean(special) || (hd === true && !jornadaOnline);
    if (!dayOpen) continue;
    // AP41: a mesma régua da validação. Férias / período da rede travado:
    // ninguém marca. Período da unidade: fechado — só abre com dia avulso, e
    // aí vale só a janela dele.
    const plano = situacaoDoPlanoNoDia(itensDoPlano, dateOnly, providerUserId || null, isOnline);
    if (plano.bloqueia) continue;
    if (plano.fechaODia && !special) continue;
    // AJ7: dia avulso num dia NORMAL estende (une); em dia fechado usa a própria.
    const normalOpenMin = timeToMinutes((jornadaOnline ?? cfg).openTime);
    const normalCloseMin = timeToMinutes((jornadaOnline ?? cfg).closeTime);
    const isNormalDay = (isWeekdayOpen || hd === true) && !plano.fechaODia;
    const openMin = special
      ? isNormalDay
        ? Math.min(normalOpenMin, special.open)
        : special.open
      : normalOpenMin;
    const closeMin = special
      ? isNormalDay
        ? Math.max(normalCloseMin, special.close)
        : special.close
      : normalCloseMin;

    for (let m = openMin; m + durationMin <= closeMin && slots.length < limit; m += 15) {
      // Skip the lunch break (not online).
      if (
        cfg.lunchEnabled &&
        !isOnline &&
        m < lunchEnd &&
        m + durationMin > lunchStart
      ) {
        continue;
      }
      const startMs = instantFromBrazil(dateOnly, minutesToHHMM(m)).getTime();
      const endMs = startMs + durationMin * 60_000;
      // Sem a conversão certa, os horários das próximas 3 horas sumiam da lista
      // de opções — eles nasciam no passado.
      if (startMs < nowMs) continue;

      const closed = closures.some((c) =>
        closureBlocks(c, {
          startMs,
          endMs,
          roomId: isOnline ? null : roomId,
          providerId: providerUserId,
        })
      );
      if (closed) continue;

      const overlap = (s: string, en: string) =>
        startMs < new Date(en).getTime() && endMs > new Date(s).getTime();
      if (
        providerUserId &&
        appts.some(
          (a) =>
            a.provider_user_id === providerUserId &&
            a.type !== "urgency" &&
            a.type !== "emergency" &&
            overlap(a.starts_at, a.ends_at)
        )
      )
        continue;
      if (
        !isOnline &&
        roomId &&
        appts.some((a) => a.room_id === roomId && overlap(a.starts_at, a.ends_at))
      )
        continue;
      if (
        clientId &&
        appts.some((a) => a.client_id === clientId && overlap(a.starts_at, a.ends_at))
      )
        continue;

      slots.push({ date: dateOnly, time: minutesToHHMM(m) });
    }
  }
  return slots;
}
