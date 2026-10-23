import { addDaysIso } from "@/lib/dates";
import { indicadorDe, type Indicador } from "./indicadores";
import {
  alvoDoSujeito,
  diasEntre,
  farol as calcularFarol,
  fracaoEsperada,
  percentual,
  percentualDaMedida,
  periodoCorrente,
  periodosMensais,
  projecao as calcularProjecao,
  situacaoEfetiva,
  valorDe,
  type Alvo,
  type Congelado,
  type Farol,
  type Fotografia,
  type Medicao,
  type Meta,
  type Pausa,
  type SituacaoExibida,
} from "./regras";

/**
 * O RESUMO DE UMA META — tudo o que o cartão do painel e a ficha mostram, a
 * partir da meta, da medição do banco e das pausas. Puro, com teste
 * (`metas.test.ts`).
 *
 * As três formas de "percentual da meta":
 *   * COLETIVA (ou ambas): o número de todos contra o alvo coletivo;
 *   * INDIVIDUAL: a MÉDIA dos participantes, cada um limitado a 100% — quem
 *     passou muito do alvo não esconde quem ficou para trás;
 *   * MENSAL encerrada: meses atingidos ÷ meses (a soma do trimestre contra
 *     um alvo POR MÊS não significaria nada).
 */
export type ResumoDaMeta = {
  situacao: SituacaoExibida;
  indicador: Indicador | null;
  /** A fotografia que vale agora: a final congelada, senão a do período. */
  foto: Fotografia | null;
  pct: number | null;
  /** Onde fica a Super Meta na mesma régua (ex.: 120). */
  pctSuper: number | null;
  valor: number | null;
  alvo: number | null;
  /** Valores em R$ escondidos para quem vê (D3). */
  escondido: boolean;
  esperado: number;
  farol: Farol;
  projecao: number | null;
  diasRestantes: number | null;
  /** Meta individual: quantos já atingiram o próprio alvo. */
  pessoas: { atingiram: number; total: number } | null;
  /** Meta mensal: os meses congelados. */
  meses: { from: string; to: string; atingiu: boolean | null; pct: number | null }[];
  /** "Mês de outubro", "Período inteiro". */
  rotuloDoPeriodo: string;
  erro: string | null;
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeDoMes(iso: string): string {
  return MESES[Number(iso.slice(5, 7)) - 1] ?? "";
}

/** Percentual de cada participante (zero para quem não fez nada ainda). */
export function percentuaisDasPessoas(
  meta: Meta,
  foto: Fotografia,
  alvos: Alvo[],
  participantes: string[] | null
): { id: string; pct: number | null; valor: number | null; alvo: number | null }[] {
  const ind = indicadorDe(meta.indicator);
  const porId = new Map(foto.by_user.map((u) => [u.id, u]));
  const ids = participantes ?? foto.by_user.map((u) => u.id);
  return ids.map((id) => {
    const m = porId.get(id);
    const alvo = alvoDoSujeito(meta, "user", id, foto.n_participants, alvos);
    if (!m) {
      // Quem não aparece não fez nada: zero na soma; sem dado na taxa.
      const pct = ind?.tipo === "sum" ? percentual(meta.direction, 0, alvo) : null;
      return { id, pct, valor: ind?.tipo === "sum" ? 0 : null, alvo };
    }
    return {
      id,
      pct: percentualDaMedida(m, meta.direction, alvo),
      valor: m.pct !== undefined ? null : valorDe(m),
      alvo,
    };
  });
}

export function resumirMeta(
  meta: Meta,
  medicao: Medicao | null,
  pausas: Pausa[],
  hoje: string,
  alvos: Alvo[] = [],
  erro: string | null = null
): ResumoDaMeta {
  const situacao = situacaoEfetiva(meta, hoje);
  const indicador = indicadorDe(meta.indicator);
  const final = medicao?.frozen.find((f) => f.kind === "final") ?? null;
  const periodos: Congelado[] = medicao?.frozen.filter((f) => f.kind === "period") ?? [];
  const foto = medicao?.live ?? final?.snapshot ?? null;
  const escondido = Boolean(medicao?.money_hidden);
  const mensalEncerrada = meta.periodicity === "monthly" && Boolean(final);

  const pctDoColetivo = (f: Fotografia | null) =>
    f ? percentualDaMedida(f.total, meta.direction, meta.target_value, meta.baseline_value) : null;
  const pctDasPessoas = (f: Fotografia | null) => {
    if (!f) return null;
    if (f.n_participants === 0) return null;
    const lista = percentuaisDasPessoas(meta, f, alvos, null);
    // Os participantes que não aparecem na medição contam como zero.
    const faltam = Math.max(0, f.n_participants - lista.length);
    const soma = lista.reduce((s, p) => s + Math.min(100, p.pct ?? 0), 0);
    return soma / (lista.length + faltam);
  };

  const meses = meta.periodicity === "monthly"
    ? periodosMensais(meta.starts_on, meta.ends_on).map((p) => {
        const c = periodos.find((x) => x.from === p.from) ?? null;
        return {
          ...p,
          atingiu: c ? c.achieved : null,
          pct: c
            ? meta.target_mode === "individual"
              ? pctDasPessoas(c.snapshot)
              : pctDoColetivo(c.snapshot)
            : null,
        };
      })
    : [];

  let pct: number | null;
  if (mensalEncerrada) {
    const fechados = meses.filter((m) => m.atingiu !== null);
    pct = fechados.length ? (fechados.filter((m) => m.atingiu).length / meses.length) * 100 : null;
  } else if (meta.target_mode === "individual") {
    pct = pctDasPessoas(foto);
  } else {
    pct = pctDoColetivo(foto);
  }

  const pctSuper =
    meta.stretch_value != null && meta.target_mode !== "individual" && !mensalEncerrada
      ? percentual(meta.direction, meta.stretch_value, meta.target_value, meta.baseline_value)
      : null;

  const periodo = periodoCorrente(meta, hoje);
  const ativa = situacao === "active" || situacao === "paused";
  const esperado = ativa ? fracaoEsperada(periodo, hoje, pausas) : situacao === "scheduled" ? 0 : 1;
  const tipo = indicador?.tipo ?? "sum";
  const farol = situacao === "active" && !mensalEncerrada ? calcularFarol(tipo, pct, esperado) : "neutro";
  const projecao = situacao === "active" ? calcularProjecao(tipo, pct, esperado) : null;

  let pessoas: ResumoDaMeta["pessoas"] = null;
  if (meta.target_mode !== "collective" && foto) {
    if (final && meta.periodicity !== "monthly" && final.people_total != null) {
      pessoas = { atingiram: final.people_achieved ?? 0, total: final.people_total };
    } else {
      const lista = percentuaisDasPessoas(meta, foto, alvos, null);
      pessoas = {
        atingiram: lista.filter((p) => (p.pct ?? 0) >= 100).length,
        total: Math.max(foto.n_participants, lista.length),
      };
    }
  }

  const rotuloDoPeriodo =
    meta.periodicity === "monthly"
      ? mensalEncerrada
        ? "Meses atingidos"
        : `Mês de ${nomeDoMes(periodo.from)}`
      : "Período inteiro";

  return {
    situacao,
    indicador,
    foto,
    pct,
    pctSuper,
    valor: foto && !escondido ? valorDe(foto.total) : null,
    alvo: meta.target_mode === "individual" ? null : meta.target_value,
    escondido,
    esperado,
    farol,
    projecao,
    diasRestantes: ativa || situacao === "scheduled" ? diasEntre(hoje, meta.ends_on) : null,
    pessoas,
    meses,
    rotuloDoPeriodo,
    erro,
  };
}

/**
 * A série do gráfico realizado × esperado, dia a dia, em % da meta. Só para
 * indicador que SOMA e com alvo coletivo: uma taxa não acumula, e a média de
 * pessoas não tem "esperado" de um número só.
 */
export function serieDoGrafico(
  meta: Meta,
  foto: Fotografia | null,
  periodo: { from: string; to: string },
  hoje: string,
  pausas: Pausa[]
): { dia: string; realizado: number | null; esperado: number }[] {
  const ind = indicadorDe(meta.indicator);
  if (!foto || ind?.tipo !== "sum" || meta.target_mode === "individual" || !meta.target_value) return [];
  const ate = hoje < periodo.to ? hoje : periodo.to;
  if (ate < periodo.from) return [];
  const porDia = new Map(foto.by_day.map((d) => [d.day, d]));
  const out: { dia: string; realizado: number | null; esperado: number }[] = [];
  let acumulado = 0;
  for (let d = periodo.from, n = 0; d <= ate && n < 400; d = addDaysIso(d, 1), n++) {
    const e = porDia.get(d);
    // Valor escondido (D3) vem como percentual do alvo, já somável.
    if (e) acumulado += e.pct !== undefined ? Number(e.pct ?? 0) : (Number(e.num ?? 0) / meta.target_value) * 100;
    out.push({ dia: d, realizado: acumulado, esperado: fracaoEsperada(periodo, d, pausas) * 100 });
  }
  return out;
}
