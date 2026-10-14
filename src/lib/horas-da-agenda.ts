// HORAS POSSÍVEIS × HORAS TRABALHADAS (relato OC-00071, 13/10/2026).
//
// O Planejamento Anual mostrava uma estimativa de horas que só conhecia os dias
// da semana, o almoço, os feriados fechados e os períodos planejados DA
// UNIDADE. A tela dizia, com todas as letras, que horário avulso não entrava —
// e o dono pediu que entrasse, que o fechamento de agenda reduzisse, e que
// existisse o outro lado da conta: quanto foi realmente trabalhado.
//
// As três decisões dele (13/10/2026), que este arquivo implementa:
//
//   1. DUAS CONTAS de horas possíveis: FUNCIONAMENTO (o relógio da unidade: um
//      dia das 08h às 18h vale 10h) e CADEIRA (10h × 2 cadeiras = 20h). A
//      ocupação é sobre as horas de cadeira — sobre o relógio ela passaria de
//      100% toda vez que duas cadeiras atendem ao mesmo tempo.
//   2. HORA TRABALHADA É O TEMPO MARCADO DO ATENDIMENTO CONCLUÍDO, não o
//      relógio "chamou → concluiu". Aquele depende de alguém clicar na hora
//      certa: no treino, metade dos concluídos durou menos de 2 minutos e um
//      durou 11 dias.
//   3. FECHAR A AGENDA reduz quando o alcance é a UNIDADE (tudo) ou a SALA (só
//      aquela cadeira). Fechamento de PROFISSIONAL não reduz — a cadeira
//      continua lá para outro — e aparece numa linha à parte.
//
// ⚠️ A JANELA DO DIA SEGUE A REGRA ESCRITA DA AGENDA (AJ7, `effectiveDayHours`):
// horário avulso num dia NORMAL estende o horário; num dia FECHADO vale só a
// janela do avulso. Dia fechado por período planejado é dia fechado.
//
// Tudo aqui é conta pura, em MINUTOS. Nenhuma leitura de banco, nenhum relógio:
// "hoje" entra por parâmetro.

import { timeToMinutes } from "@/lib/agenda-settings";
import { UNIT_BLOCKING_TYPES, type PlanItemType } from "@/lib/annual-plan";
import type { ClosureScope } from "@/lib/closures";
import { addDaysIso, isoDateIn, startOfDayInBrazil, weekdayOf } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Intervalos (minutos do dia, [início, fim))
// ---------------------------------------------------------------------------

export type Intervalo = readonly [number, number];

/** Junta intervalos que se tocam ou se sobrepõem. Sem isto, dois fechamentos
 *  por cima do mesmo horário descontariam o mesmo horário duas vezes. */
export function unir(lista: readonly Intervalo[]): Intervalo[] {
  const ordenados = lista
    .filter(([a, b]) => b > a)
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const saida: [number, number][] = [];
  for (const [a, b] of ordenados) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else saida.push([a, b]);
  }
  return saida;
}

/** O que há de `a` dentro de `b`. */
export function cruzar(a: readonly Intervalo[], b: readonly Intervalo[]): Intervalo[] {
  const saida: Intervalo[] = [];
  for (const [a1, a2] of unir(a)) {
    for (const [b1, b2] of unir(b)) {
      const ini = Math.max(a1, b1);
      const fim = Math.min(a2, b2);
      if (fim > ini) saida.push([ini, fim]);
    }
  }
  return saida;
}

/** `a` sem o que está em `b`. */
export function tirar(a: readonly Intervalo[], b: readonly Intervalo[]): Intervalo[] {
  let resto = unir(a);
  for (const [b1, b2] of unir(b)) {
    const proximo: Intervalo[] = [];
    for (const [a1, a2] of resto) {
      if (b2 <= a1 || b1 >= a2) {
        proximo.push([a1, a2]);
        continue;
      }
      if (b1 > a1) proximo.push([a1, b1]);
      if (b2 < a2) proximo.push([b2, a2]);
    }
    resto = proximo;
  }
  return resto;
}

export function medir(lista: readonly Intervalo[]): number {
  return unir(lista).reduce((soma, [a, b]) => soma + (b - a), 0);
}

// ---------------------------------------------------------------------------
// O que entra na conta
// ---------------------------------------------------------------------------

export type JornadaDaUnidade = {
  openTime: string;
  closeTime: string;
  weekdays: number[];
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
};

export type HorarioAvulso = { date: string; start: string; end: string };

export type PeriodoPlanejado = {
  type: PlanItemType;
  startsDate: string;
  endsDate: string;
  /** Item lançado pela REDE (franqueadora). */
  isNetwork: boolean;
  /** Item da rede TRAVADO: nem horário avulso abre por cima. */
  locked: boolean;
};

export type FechamentoDeAgenda = {
  startsAt: string;
  endsAt: string;
  scope: ClosureScope;
  roomIds: string[];
  providerIds: string[];
};

export type EntradaDasHoras = {
  de: string;
  ate: string;
  jornada: JornadaDaUnidade;
  /** Decisão de cada feriado: true = atende, false = fecha. Ausente = sem decisão. */
  feriados: ReadonlyMap<string, boolean>;
  planejados: readonly PeriodoPlanejado[];
  avulsos: readonly HorarioAvulso[];
  fechamentos: readonly FechamentoDeAgenda[];
  /** Uma entrada por cadeira ATIVA (o id da sala). */
  cadeiras: readonly string[];
};

/** Por que o dia está como está — a tela conta os dias por motivo. */
export type SituacaoDoDia =
  | "normal"
  | "avulso"
  | "fora_da_semana"
  | "feriado_fechado"
  | "periodo_da_rede"
  | "periodo_da_unidade";

export type DiaDeHoras = {
  date: string;
  situacao: SituacaoDoDia;
  /** O horário avulso mudou a conta deste dia (abriu ou estendeu). */
  temAvulso: boolean;
  /** O que o dia valeria só pela semana configurada (e feriado que atende). */
  potencial: number;
  /** Tirado por feriado fechado. */
  perdidoFeriado: number;
  /** Tirado por período planejado da unidade. */
  perdidoUnidade: number;
  /** Tirado por período planejado da rede. */
  perdidoRede: number;
  /** Acrescentado por horário avulso. */
  ganhoAvulso: number;
  /** Tirado por fechamento de agenda da UNIDADE TODA. */
  fechadoUnidade: number;
  /** = potencial − perdidos + avulso − fechado. Minutos de unidade aberta. */
  funcionamento: number;
  /** Minutos-cadeira tirados por fechamento de SALA. */
  fechadoSala: number;
  /** Minutos-cadeira: funcionamento × cadeiras − fechamento de sala. */
  cadeira: number;
  /** Informativo: minutos × profissional com a agenda fechada. NÃO reduz nada. */
  fechadoProfissional: number;
};

function janela(inicio: string, fim: string): Intervalo[] {
  const a = timeToMinutes(inicio);
  const b = timeToMinutes(fim);
  return b > a ? [[a, b]] : [];
}

function almoco(j: JornadaDaUnidade): Intervalo[] {
  return j.lunchEnabled ? janela(j.lunchStart, j.lunchEnd) : [];
}

function cobre(p: PeriodoPlanejado, date: string): boolean {
  return date >= p.startsDate && date <= p.endsDate;
}

/** O trecho de um fechamento (instantes) que cai dentro deste dia brasileiro. */
function trechoNoDia(f: FechamentoDeAgenda, inicioDoDiaMs: number): Intervalo | null {
  const ini = (new Date(f.startsAt).getTime() - inicioDoDiaMs) / 60_000;
  const fim = (new Date(f.endsAt).getTime() - inicioDoDiaMs) / 60_000;
  if (Number.isNaN(ini) || Number.isNaN(fim)) return null;
  const a = Math.max(0, ini);
  const b = Math.min(1440, fim);
  return b > a ? [a, b] : null;
}

export function horasDoDia(date: string, e: Omit<EntradaDasHoras, "de" | "ate">): DiaDeHoras {
  const j = e.jornada;
  const decisao = e.feriados.get(date);
  const daSemana = j.weekdays.includes(weekdayOf(date));
  const lanche = almoco(j);
  const normal = tirar(janela(j.openTime, j.closeTime), lanche);
  const potencial = daSemana || decisao === true ? medir(normal) : 0;

  const avulso = e.avulsos.find((a) => a.date === date) ?? null;
  const bloqueios = e.planejados.filter(
    (p) => UNIT_BLOCKING_TYPES.includes(p.type) && cobre(p, date)
  );
  const redeTravada = bloqueios.some((p) => p.isNetwork && p.locked);
  const daRede = bloqueios.some((p) => p.isNetwork);

  let situacao: SituacaoDoDia;
  let abertos: Intervalo[] = [];
  let perdidoFeriado = 0;
  let perdidoUnidade = 0;
  let perdidoRede = 0;
  let ganhoAvulso = 0;

  if (decisao === false) {
    // Feriado decidido como "não atende" fecha tudo — a agenda recusa antes de
    // olhar o horário avulso.
    situacao = potencial > 0 ? "feriado_fechado" : "fora_da_semana";
    perdidoFeriado = potencial;
  } else if (redeTravada || (bloqueios.length > 0 && !avulso)) {
    situacao =
      potencial === 0 ? "fora_da_semana" : daRede ? "periodo_da_rede" : "periodo_da_unidade";
    if (daRede) perdidoRede = potencial;
    else perdidoUnidade = potencial;
  } else if (bloqueios.length > 0 && avulso) {
    // Período planejado com horário avulso por cima: o dia era FECHADO, então
    // vale só a janela do avulso.
    situacao = "avulso";
    if (daRede) perdidoRede = potencial;
    else perdidoUnidade = potencial;
    abertos = tirar(janela(avulso.start, avulso.end), lanche);
    ganhoAvulso = medir(abertos);
  } else if (potencial > 0) {
    situacao = "normal";
    if (avulso) {
      // Dia normal: o avulso ESTENDE (começa antes / termina depois).
      const ini = Math.min(timeToMinutes(j.openTime), timeToMinutes(avulso.start));
      const fim = Math.max(timeToMinutes(j.closeTime), timeToMinutes(avulso.end));
      abertos = tirar([[ini, fim]], lanche);
      ganhoAvulso = medir(abertos) - potencial;
    } else {
      abertos = normal;
    }
  } else if (avulso) {
    situacao = "avulso";
    abertos = tirar(janela(avulso.start, avulso.end), lanche);
    ganhoAvulso = medir(abertos);
  } else {
    situacao = "fora_da_semana";
  }

  // Fechamentos de agenda — só interessam se o dia abriu.
  let fechadoUnidade = 0;
  let fechadoSala = 0;
  let fechadoProfissional = 0;
  let aposUnidade = abertos;
  if (abertos.length > 0 && e.fechamentos.length > 0) {
    const inicio = startOfDayInBrazil(date).getTime();
    const daUnidade: Intervalo[] = [];
    const porSala = new Map<string, Intervalo[]>();
    const porPessoa = new Map<string, Intervalo[]>();
    for (const f of e.fechamentos) {
      const trecho = trechoNoDia(f, inicio);
      if (!trecho) continue;
      if (f.scope === "unit") daUnidade.push(trecho);
      else if (f.scope === "rooms") {
        for (const id of f.roomIds) porSala.set(id, [...(porSala.get(id) ?? []), trecho]);
      } else {
        for (const id of f.providerIds) porPessoa.set(id, [...(porPessoa.get(id) ?? []), trecho]);
      }
    }
    fechadoUnidade = medir(cruzar(abertos, daUnidade));
    aposUnidade = tirar(abertos, daUnidade);
    for (const id of e.cadeiras) {
      const dela = porSala.get(id);
      if (dela) fechadoSala += medir(cruzar(aposUnidade, dela));
    }
    for (const trechos of porPessoa.values()) {
      fechadoProfissional += medir(cruzar(aposUnidade, trechos));
    }
  }

  const funcionamento = medir(aposUnidade);
  return {
    date,
    situacao,
    temAvulso: ganhoAvulso !== 0 || (situacao === "avulso" && avulso !== null),
    potencial,
    perdidoFeriado,
    perdidoUnidade,
    perdidoRede,
    ganhoAvulso,
    fechadoUnidade,
    funcionamento,
    fechadoSala,
    cadeira: funcionamento * e.cadeiras.length - fechadoSala,
    fechadoProfissional,
  };
}

/** Um dia calculado para cada data do período (inclusive nas duas pontas). */
export function horasPossiveis(e: EntradaDasHoras): DiaDeHoras[] {
  const dias: DiaDeHoras[] = [];
  for (let d = e.de; d <= e.ate; d = addDaysIso(d, 1)) dias.push(horasDoDia(d, e));
  return dias;
}

export type ResumoDasHoras = {
  dias: number;
  /** Dias em que a unidade abre (funcionamento > 0). */
  diasAbertos: number;
  diasFeriadoFechado: number;
  diasPeriodoUnidade: number;
  diasPeriodoRede: number;
  diasComAvulso: number;
  potencial: number;
  perdidoFeriado: number;
  perdidoUnidade: number;
  perdidoRede: number;
  ganhoAvulso: number;
  fechadoUnidade: number;
  funcionamento: number;
  fechadoSala: number;
  cadeira: number;
  fechadoProfissional: number;
};

export function resumir(dias: readonly DiaDeHoras[]): ResumoDasHoras {
  const r: ResumoDasHoras = {
    dias: dias.length,
    diasAbertos: 0,
    diasFeriadoFechado: 0,
    diasPeriodoUnidade: 0,
    diasPeriodoRede: 0,
    diasComAvulso: 0,
    potencial: 0,
    perdidoFeriado: 0,
    perdidoUnidade: 0,
    perdidoRede: 0,
    ganhoAvulso: 0,
    fechadoUnidade: 0,
    funcionamento: 0,
    fechadoSala: 0,
    cadeira: 0,
    fechadoProfissional: 0,
  };
  for (const d of dias) {
    if (d.funcionamento > 0) r.diasAbertos += 1;
    if (d.perdidoFeriado > 0) r.diasFeriadoFechado += 1;
    if (d.perdidoUnidade > 0) r.diasPeriodoUnidade += 1;
    if (d.perdidoRede > 0) r.diasPeriodoRede += 1;
    if (d.temAvulso) r.diasComAvulso += 1;
    r.potencial += d.potencial;
    r.perdidoFeriado += d.perdidoFeriado;
    r.perdidoUnidade += d.perdidoUnidade;
    r.perdidoRede += d.perdidoRede;
    r.ganhoAvulso += d.ganhoAvulso;
    r.fechadoUnidade += d.fechadoUnidade;
    r.funcionamento += d.funcionamento;
    r.fechadoSala += d.fechadoSala;
    r.cadeira += d.cadeira;
    r.fechadoProfissional += d.fechadoProfissional;
  }
  return r;
}

// ---------------------------------------------------------------------------
// O outro lado: o que foi agendado e o que foi trabalhado
// ---------------------------------------------------------------------------

export type AtendimentoDaAgenda = {
  startsAt: string;
  endsAt: string;
  status: string;
  attendance: string | null;
  isOnline: boolean;
};

/**
 * - `concluido`: atendimento feito — é a HORA TRABALHADA.
 * - `falta`: não compareceu. `desistencia`: chegou e foi embora.
 * - `cancelado`: desmarcado — o horário voltou a ficar livre, não conta.
 * - `marcado`: ainda sem desfecho.
 */
export type DesfechoDoAtendimento =
  | "concluido"
  | "falta"
  | "desistencia"
  | "cancelado"
  | "marcado";

export function desfechoDe(a: Pick<AtendimentoDaAgenda, "status" | "attendance">): DesfechoDoAtendimento {
  if (a.attendance === "done" || a.status === "completed") return "concluido";
  if (a.attendance === "gave_up") return "desistencia";
  if (a.status === "no_show") return "falta";
  if (a.status === "cancelled") return "cancelado";
  return "marcado";
}

/** O tempo MARCADO na agenda, em minutos. Fim antes do início vale zero. */
export function minutosMarcados(a: Pick<AtendimentoDaAgenda, "startsAt" | "endsAt">): number {
  const ini = new Date(a.startsAt).getTime();
  const fim = new Date(a.endsAt).getTime();
  if (Number.isNaN(ini) || Number.isNaN(fim) || fim <= ini) return 0;
  return Math.round((fim - ini) / 60_000);
}

export type HorasDosAtendimentos = {
  /** Na cadeira, tudo que não foi cancelado: concluído + marcado + falta + desistência. */
  agendadas: number;
  /** Na cadeira, concluídos — pelo tempo marcado. */
  trabalhadas: number;
  faltas: number;
  /** Marcado em dia que já passou e ninguém registrou o desfecho. */
  semDesfecho: number;
  canceladas: number;
  /** Atendimento online não usa cadeira: fica fora da ocupação. */
  onlineAgendadas: number;
  onlineTrabalhadas: number;
  quantidade: number;
  concluidos: number;
};

export function horasVazias(): HorasDosAtendimentos {
  return {
    agendadas: 0,
    trabalhadas: 0,
    faltas: 0,
    semDesfecho: 0,
    canceladas: 0,
    onlineAgendadas: 0,
    onlineTrabalhadas: 0,
    quantidade: 0,
    concluidos: 0,
  };
}

/** O dia BRASILEIRO em que o atendimento começa. */
export function diaDoAtendimento(a: Pick<AtendimentoDaAgenda, "startsAt">): string {
  return isoDateIn(new Date(a.startsAt));
}

/**
 * Soma os atendimentos de `de` a `ate` (dias brasileiros, inclusive).
 * `hoje` separa o que já devia ter desfecho do que ainda vai acontecer.
 */
export function horasDosAtendimentos(
  atendimentos: readonly AtendimentoDaAgenda[],
  p: { de: string; ate: string; hoje: string }
): HorasDosAtendimentos {
  const r = horasVazias();
  for (const a of atendimentos) {
    const dia = diaDoAtendimento(a);
    if (dia < p.de || dia > p.ate) continue;
    const min = minutosMarcados(a);
    const desfecho = desfechoDe(a);
    if (desfecho === "cancelado") {
      r.canceladas += min;
      continue;
    }
    r.quantidade += 1;
    if (a.isOnline) {
      r.onlineAgendadas += min;
      if (desfecho === "concluido") r.onlineTrabalhadas += min;
      if (desfecho === "concluido") r.concluidos += 1;
      continue;
    }
    r.agendadas += min;
    if (desfecho === "concluido") {
      r.trabalhadas += min;
      r.concluidos += 1;
    } else if (desfecho === "falta" || desfecho === "desistencia") {
      r.faltas += min;
    } else if (dia < p.hoje) {
      r.semDesfecho += min;
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Ocupação, período e exibição
// ---------------------------------------------------------------------------

/**
 * Parte ÷ todo, em percentual com uma casa. Sem horas possíveis não existe
 * ocupação: devolve `null`, e a tela mostra um traço — "0%" diria que a
 * unidade abriu e ninguém foi atendido.
 */
export function ocupacao(parte: number, todo: number): number | null {
  if (!(todo > 0)) return null;
  return Math.round((parte / todo) * 1000) / 10;
}

export function formatarOcupacao(p: number | null): string {
  if (p === null) return "—";
  return `${p.toFixed(1).replace(".", ",")}%`;
}

const MILHAR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Minutos em horas: "7h30" enquanto couber; acima de 100 horas, "1.234h". */
export function formatarHoras(minutos: number): string {
  const sinal = minutos < 0 ? "−" : "";
  const m = Math.abs(Math.round(minutos));
  if (m >= 6000) return `${sinal}${MILHAR.format(Math.round(m / 60))}h`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(resto).padStart(2, "0")}`;
}

/** O período mais longo que a tela aceita: dois anos cheios. */
export const MAXIMO_DE_DIAS = 731;

export type PeriodoDasHoras = {
  de: string;
  ate: string;
  /** O período pedido era maior que o máximo e foi encurtado. */
  encurtado: boolean;
  /** Nada foi pedido (ou veio inválido): vale o ano inteiro. */
  padrao: boolean;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v: unknown): v is string {
  return typeof v === "string" && DATA.test(v) && !Number.isNaN(weekdayOf(v)) && addDaysIso(v, 0) === v;
}

/**
 * O período da conta. Sem `de`/`ate` válidos, o ano inteiro. Datas trocadas
 * são destrocadas; período maior que dois anos é encurtado a partir do início
 * — e a tela avisa, em vez de mostrar em silêncio um total de outro período.
 */
export function lerPeriodo(p: { de?: unknown; ate?: unknown }, ano: number): PeriodoDasHoras {
  const inicioDoAno = `${ano}-01-01`;
  const fimDoAno = `${ano}-12-31`;
  const temDe = dataValida(p.de);
  const temAte = dataValida(p.ate);
  if (!temDe && !temAte) return { de: inicioDoAno, ate: fimDoAno, encurtado: false, padrao: true };
  let de = temDe ? (p.de as string) : inicioDoAno;
  let ate = temAte ? (p.ate as string) : fimDoAno;
  if (de > ate) {
    if (temDe && temAte) [de, ate] = [ate, de];
    else if (temDe) ate = de;
    else de = ate;
  }
  const limite = addDaysIso(de, MAXIMO_DE_DIAS - 1);
  if (ate > limite) return { de, ate: limite, encurtado: true, padrao: false };
  return { de, ate, encurtado: false, padrao: false };
}

export type MesDeHoras = {
  /** "2026-09" */
  mes: string;
  possiveis: ResumoDasHoras;
  /** Só os dias do mês até hoje (inclusive). */
  possiveisAteHoje: ResumoDasHoras;
  atendimentos: HorasDosAtendimentos;
};

/** A mesma conta, mês a mês — para a tabela de detalhe. */
export function porMes(
  dias: readonly DiaDeHoras[],
  atendimentos: readonly AtendimentoDaAgenda[],
  hoje: string
): MesDeHoras[] {
  const meses = new Map<string, DiaDeHoras[]>();
  for (const d of dias) {
    const m = d.date.slice(0, 7);
    meses.set(m, [...(meses.get(m) ?? []), d]);
  }
  return [...meses.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, lista]) => ({
      mes,
      possiveis: resumir(lista),
      possiveisAteHoje: resumir(lista.filter((d) => d.date <= hoje)),
      atendimentos: horasDosAtendimentos(atendimentos, {
        de: lista[0].date,
        ate: lista[lista.length - 1].date,
        hoje,
      }),
    }));
}

// ---------------------------------------------------------------------------
// O quadro que a tela mostra
// ---------------------------------------------------------------------------

export type QuadroDeHoras = {
  /** O período inteiro. */
  total: ResumoDasHoras;
  /** Só os dias do período até hoje (inclusive) — é contra eles que se mede o realizado. */
  ateHoje: ResumoDasHoras;
  /** `null` = os atendimentos não puderam ser lidos. Nunca vira zero. */
  agenda: HorasDosAtendimentos | null;
  /** Agendadas na cadeira ÷ horas de cadeira do período. */
  ocupacaoDaAgenda: number | null;
  /** Trabalhadas ÷ horas de cadeira dos dias até hoje. */
  ocupacaoRealizada: number | null;
  meses: MesDeHoras[];
  /** O período já começou (tem dia até hoje). */
  comecou: boolean;
  /** O período já acabou (todo dia é passado ou hoje). */
  terminou: boolean;
};

export function montarQuadro(
  dias: readonly DiaDeHoras[],
  atendimentos: readonly AtendimentoDaAgenda[] | null,
  hoje: string
): QuadroDeHoras {
  const total = resumir(dias);
  const passados = dias.filter((d) => d.date <= hoje);
  const ateHoje = resumir(passados);
  const de = dias[0]?.date ?? hoje;
  const ate = dias[dias.length - 1]?.date ?? hoje;
  const agenda = atendimentos ? horasDosAtendimentos(atendimentos, { de, ate, hoje }) : null;
  return {
    total,
    ateHoje,
    agenda,
    ocupacaoDaAgenda: agenda ? ocupacao(agenda.agendadas, total.cadeira) : null,
    // Concluído é sempre passado: a trabalhada do período É a trabalhada até hoje.
    ocupacaoRealizada: agenda ? ocupacao(agenda.trabalhadas, ateHoje.cadeira) : null,
    meses: porMes(dias, atendimentos ?? [], hoje),
    comecou: passados.length > 0,
    terminou: passados.length === dias.length,
  };
}
