// A leitura que alimenta "Horas possíveis × horas trabalhadas" (OC-00071).
//
// ⚠️ LEITURA QUE FALHA NÃO VIRA ZERO. Cada consulta que não respondeu entra em
// `naoLido`, e a tela recusa a conta dizendo o que faltou. Um "0 horários
// avulsos" por falha de leitura seria justamente o defeito do relato de volta,
// agora sem ninguém para perceber.
//
// A conta em si mora em `src/lib/horas-da-agenda.ts` (pura, com teste).

import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { resolveAgendaSettings, type AgendaSettingRow } from "@/lib/agenda-settings";
import type { PlanItemType } from "@/lib/annual-plan";
import type { ClosureScope } from "@/lib/closures";
import { addDaysIso, startOfDayInBrazil } from "@/lib/dates";
import {
  horasPossiveis,
  type AtendimentoDaAgenda,
  type DiaDeHoras,
  type EntradaDasHoras,
  type FechamentoDeAgenda,
} from "@/lib/horas-da-agenda";
import { lerTodasAsPaginas } from "@/lib/paginar";

type Banco = Awaited<ReturnType<typeof createClient>>;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

/** As linhas, ou a anotação de que aquela leitura falhou. */
function linhasDe<T>(r: Resposta<T>, oQue: string, naoLido: string[]): T[] {
  if (r.error || r.data === null) {
    if (r.error) console.error(`horas da agenda — ${oQue}:`, r.error.message);
    naoLido.push(oQue);
    return [];
  }
  return r.data;
}

export type BaseDasHoras = {
  /** Tudo o que a conta precisa, menos o período. `null` quando algo não foi lido. */
  entrada: Omit<EntradaDasHoras, "de" | "ate"> | null;
  /** Quantas cadeiras entraram na conta. */
  cadeiras: number;
  /**
   * A unidade não tem sala cadastrada: o número veio da configuração da agenda
   * (`chairs`), o mesmo que a agenda usa para a capacidade. A tela diz isso —
   * mostrar a origem do número faz parte do número.
   */
  cadeirasPelaConfiguracao: boolean;
  /** O que não deu para ler (em português, para a tela). Vazio = leu tudo. */
  naoLido: string[];
};

/**
 * Lê a jornada, as cadeiras, os feriados decididos, os períodos planejados (da
 * unidade E da rede), os horários avulsos e os fechamentos que tocam o
 * intervalo `de`..`ate`.
 */
export async function lerBaseDasHoras(
  supabase: Banco,
  clinicId: string,
  de: string,
  ate: string
): Promise<BaseDasHoras> {
  const naoLido: string[] = [];
  const inicio = startOfDayInBrazil(de).toISOString();
  const fim = startOfDayInBrazil(addDaysIso(ate, 1)).toISOString();

  const [jornada, salas, feriados, planejados, avulsos, fechamentos] = await Promise.all([
    supabase
      .from("clinic_agenda_settings")
      .select("clinic_id, open_time, close_time, weekdays, chairs, lunch_enabled, lunch_start, lunch_end")
      .returns<AgendaSettingRow[]>(),
    supabase
      .from("clinic_rooms")
      .select("id, name, sort_order")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name")
      .returns<{ id: string; name: string; sort_order: number }[]>(),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinicId)
      .gte("holiday_date", de)
      .lte("holiday_date", ate)
      .returns<{ holiday_date: string; will_attend: boolean }[]>(),
    // Da unidade E da rede (clinic_id nulo): o recesso da rede fecha a agenda
    // da unidade do mesmo jeito — a estimativa antiga não o enxergava.
    supabase
      .from("agenda_plan_items")
      .select("clinic_id, type, locked, starts_date, ends_date")
      .or(`clinic_id.eq.${clinicId},clinic_id.is.null`)
      .lte("starts_date", ate)
      .gte("ends_date", de)
      .returns<
        {
          clinic_id: string | null;
          type: PlanItemType;
          locked: boolean | null;
          starts_date: string;
          ends_date: string;
        }[]
      >(),
    supabase
      .from("agenda_open_days")
      .select("date, start_time, end_time")
      .eq("clinic_id", clinicId)
      .gte("date", de)
      .lte("date", ate)
      .order("date")
      .returns<{ date: string; start_time: string | null; end_time: string | null }[]>(),
    lerTodasAsPaginas<{
      id: string;
      starts_at: string;
      ends_at: string;
      scope: ClosureScope;
      agenda_closure_rooms: { room_id: string }[] | null;
      agenda_closure_providers: { user_id: string }[] | null;
    }>((a, b) =>
      supabase
        .from("agenda_closures")
        .select(
          "id, starts_at, ends_at, scope, agenda_closure_rooms ( room_id ), agenda_closure_providers ( user_id )"
        )
        .eq("clinic_id", clinicId)
        .lt("starts_at", fim)
        .gt("ends_at", inicio)
        .order("starts_at")
        .order("id")
        .range(a, b)
    ),
  ]);

  const linhasDaJornada = linhasDe(jornada, "o horário de atendimento", naoLido);
  const linhasDasSalas = linhasDe(salas, "as cadeiras da unidade", naoLido);
  const linhasDosFeriados = linhasDe(feriados, "as decisões de feriado", naoLido);
  const linhasDoPlano = linhasDe(planejados, "os períodos planejados", naoLido);
  const linhasDosAvulsos = linhasDe(avulsos, "os horários avulsos", naoLido);
  let linhasDosFechamentos: FechamentoDeAgenda[] = [];
  if (fechamentos.ok) {
    linhasDosFechamentos = fechamentos.linhas.map((f) => ({
      startsAt: f.starts_at,
      endsAt: f.ends_at,
      scope: f.scope,
      roomIds: (f.agenda_closure_rooms ?? []).map((r) => r.room_id),
      providerIds: (f.agenda_closure_providers ?? []).map((p) => p.user_id),
    }));
  } else {
    console.error("horas da agenda — fechamentos:", fechamentos.error.message);
    naoLido.push("os fechamentos de agenda");
  }

  if (naoLido.length > 0) {
    return { entrada: null, cadeiras: 0, cadeirasPelaConfiguracao: false, naoLido };
  }

  const cfg = resolveAgendaSettings(linhasDaJornada, clinicId);
  // Unidade sem sala cadastrada: vale o número de cadeiras da configuração.
  // Sem sala não há fechamento por sala a descontar — os nomes são só marcadores.
  const semSalas = linhasDasSalas.length === 0;
  const idsDasCadeiras = semSalas
    ? Array.from({ length: Math.max(0, cfg.chairs) }, (_, i) => `sem-sala-${i + 1}`)
    : linhasDasSalas.map((s) => s.id);
  return {
    entrada: {
      jornada: {
        openTime: cfg.openTime,
        closeTime: cfg.closeTime,
        weekdays: cfg.weekdays,
        lunchEnabled: cfg.lunchEnabled,
        lunchStart: cfg.lunchStart,
        lunchEnd: cfg.lunchEnd,
      },
      feriados: new Map(linhasDosFeriados.map((f) => [f.holiday_date, f.will_attend])),
      planejados: linhasDoPlano.map((p) => ({
        type: p.type,
        startsDate: p.starts_date,
        endsDate: p.ends_date,
        isNetwork: p.clinic_id === null,
        locked: p.locked === true,
      })),
      avulsos: linhasDosAvulsos.map((a) => ({
        date: a.date,
        start: (a.start_time ?? "08:00").slice(0, 5),
        end: (a.end_time ?? "18:00").slice(0, 5),
      })),
      fechamentos: linhasDosFechamentos,
      cadeiras: idsDasCadeiras,
    },
    cadeiras: idsDasCadeiras.length,
    cadeirasPelaConfiguracao: semSalas,
    naoLido,
  };
}

/** Os dias calculados de `de` a `ate`, a partir de uma base já lida. */
export function diasDoPeriodo(
  entrada: Omit<EntradaDasHoras, "de" | "ate">,
  de: string,
  ate: string
): DiaDeHoras[] {
  return horasPossiveis({ ...entrada, de, ate });
}

/**
 * Os atendimentos da unidade que COMEÇAM entre `de` e `ate` (dias brasileiros).
 * Devolve `null` quando a leitura falha — a tela mostra as horas possíveis e
 * diz que não conseguiu ler o lado trabalhado.
 *
 * ⚠️ Em páginas: a API corta em 1.000 linhas sem avisar (AP35), e um ano de
 * agenda de uma unidade passa disso.
 */
export async function lerAtendimentosDoPeriodo(
  supabase: Banco,
  clinicId: string,
  de: string,
  ate: string
): Promise<AtendimentoDaAgenda[] | null> {
  const inicio = startOfDayInBrazil(de).toISOString();
  const fim = startOfDayInBrazil(addDaysIso(ate, 1)).toISOString();
  const lido = await lerTodasAsPaginas<{
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    attendance: string | null;
    is_online: boolean | null;
  }>((a, b) =>
    supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, attendance, is_online")
      .eq("clinic_id", clinicId)
      .gte("starts_at", inicio)
      .lt("starts_at", fim)
      .order("starts_at")
      .order("id")
      .range(a, b)
  );
  if (!lido.ok) {
    console.error("horas da agenda — atendimentos:", lido.error.message);
    return null;
  }
  return lido.linhas.map((a) => ({
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
    attendance: a.attendance,
    isOnline: a.is_online === true,
  }));
}
