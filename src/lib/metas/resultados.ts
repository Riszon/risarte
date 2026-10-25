import type { RelatorioPronto } from "@/lib/finance/relatorio";
import { indicadorDe } from "./indicadores";
import { DESFECHO_LABEL, formatarPct, objetivoLabel, ondeDaMeta, type Meta } from "./regras";

/**
 * M5 — O RELATÓRIO DE RESULTADOS das metas encerradas (plano §9e).
 *
 * Puro: recebe as metas (que a RLS já filtrou — R2) e as linhas de
 * `goal_results_report` (0322: percentuais congelados da meta, de cada unidade
 * e de cada pessoa), e monta os quadros. Nenhum valor em R$ entra aqui (D3).
 *
 * ⚠️ "Taxa de atingimento" conta só o que TEM DADO: meta sem dados para apurar
 * (e unidade sem registro) não entra no denominador — senão uma unidade sem
 * movimento pareceria ter falhado.
 */

export type LinhaDoResultado = {
  goal_id: string;
  subject_kind: "goal" | "clinic" | "user";
  subject_id: string;
  pct: number | null;
  achieved: boolean | null;
};

export type Contagem = { metas: number; atingidas: number; comDado: number; taxa: number | null };

export type Resultados = {
  resumo: Contagem & { superMeta: number; naoAtingidas: number; semDados: number };
  porUnidade: (Contagem & { id: string; nome: string; pctMedio: number | null })[];
  porIndicador: (Contagem & { chave: string; rotulo: string })[];
  porObjetivo: (Contagem & { valor: string; rotulo: string })[];
  pessoas: (Contagem & { id: string; nome: string })[];
  lista: { meta: Meta; pct: number | null; onde: string }[];
};

export function taxa(atingidas: number, comDado: number): number | null {
  return comDado > 0 ? Math.round((atingidas / comDado) * 1000) / 10 : null;
}

const atingiu = (m: Meta) => m.outcome === "achieved" || m.outcome === "stretch";

function contar(itens: { ok: boolean | null }[]): Contagem {
  const comDado = itens.filter((x) => x.ok !== null).length;
  const atingidas = itens.filter((x) => x.ok === true).length;
  return { metas: itens.length, atingidas, comDado, taxa: taxa(atingidas, comDado) };
}

function agrupar<T>(itens: T[], chave: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of itens) m.set(chave(x), [...(m.get(chave(x)) ?? []), x]);
  return m;
}

/** Melhor taxa primeiro; empate, quem tem mais metas. Sem dado, no fim. */
function porTaxa<T extends Contagem>(a: T, b: T): number {
  return (b.taxa ?? -1) - (a.taxa ?? -1) || b.metas - a.metas;
}

export function montarResultados(
  metas: Meta[],
  linhas: LinhaDoResultado[],
  nomesDasUnidades: Map<string, string>,
  nomesDasPessoas: Map<string, string>
): Resultados {
  const ids = new Set(metas.map((m) => m.id));
  const daqui = linhas.filter((l) => ids.has(l.goal_id));
  const okDaMeta = (m: Meta) => (m.outcome === "no_data" || m.outcome == null ? null : atingiu(m));
  const pctDaMeta = new Map(daqui.filter((l) => l.subject_kind === "goal").map((l) => [l.goal_id, l.pct]));

  const geral = contar(metas.map((m) => ({ ok: okDaMeta(m) })));
  const resumo = {
    ...geral,
    superMeta: metas.filter((m) => m.outcome === "stretch").length,
    naoAtingidas: metas.filter((m) => m.outcome === "not_achieved").length,
    semDados: metas.filter((m) => okDaMeta(m) === null).length,
  };

  const unidades = agrupar(
    daqui.filter((l) => l.subject_kind === "clinic"),
    (l) => l.subject_id
  );
  const porUnidade = [...unidades].map(([id, ls]) => {
    const pcts = ls.map((l) => l.pct).filter((p): p is number => p != null);
    return {
      id,
      nome: nomesDasUnidades.get(id) ?? "Unidade",
      ...contar(ls.map((l) => ({ ok: l.achieved }))),
      pctMedio: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
    };
  });

  const porIndicador = [...agrupar(metas, (m) => m.indicator)].map(([chave, ms]) => ({
    chave,
    rotulo: indicadorDe(chave)?.rotulo ?? chave,
    ...contar(ms.map((m) => ({ ok: okDaMeta(m) }))),
  }));

  const porObjetivo = [...agrupar(metas, (m) => m.strategic_objective ?? "")].map(([valor, ms]) => ({
    valor,
    rotulo: objetivoLabel(valor || null),
    ...contar(ms.map((m) => ({ ok: okDaMeta(m) }))),
  }));

  const pessoas = [
    ...agrupar(
      daqui.filter((l) => l.subject_kind === "user"),
      (l) => l.subject_id
    ),
  ]
    .map(([id, ls]) => ({ id, nome: nomesDasPessoas.get(id) ?? "Pessoa", ...contar(ls.map((l) => ({ ok: l.achieved }))) }))
    // "Quem mais atinge": mais metas atingidas; empate, melhor taxa.
    .sort((a, b) => b.atingidas - a.atingidas || (b.taxa ?? -1) - (a.taxa ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));

  const lista = [...metas]
    .sort((a, b) => (a.ends_on < b.ends_on ? 1 : a.ends_on > b.ends_on ? -1 : a.name.localeCompare(b.name, "pt-BR")))
    .map((meta) => ({ meta, pct: pctDaMeta.get(meta.id) ?? null, onde: ondeDaMeta(meta, nomesDasUnidades) }));

  return {
    resumo,
    porUnidade: porUnidade.sort(porTaxa),
    porIndicador: porIndicador.sort(porTaxa),
    porObjetivo: porObjetivo.sort(porTaxa),
    pessoas,
    lista,
  };
}

/** A mesma informação, no modelo de relatório do Financeiro (planilha). */
export function relatorioDeResultados(
  r: Resultados,
  a: { de: string; ate: string; deBr: string; ateBr: string; unidade: string | null; geradoPor: string; geradoEm: string }
): RelatorioPronto {
  return {
    titulo: "Resultados das metas",
    subtitulo: `Metas encerradas de ${a.deBr} a ${a.ateBr}`,
    metadados: [
      ...(a.unidade ? [{ rotulo: "Unidade", valor: a.unidade }] : []),
      { rotulo: "Gerado por", valor: a.geradoPor },
      { rotulo: "Gerado em", valor: a.geradoEm },
    ],
    resumo: [
      { rotulo: "Metas encerradas", valor: String(r.resumo.metas) },
      { rotulo: "Atingidas", valor: String(r.resumo.atingidas) },
      { rotulo: "Super Meta", valor: String(r.resumo.superMeta) },
      { rotulo: "Não atingidas", valor: String(r.resumo.naoAtingidas) },
      { rotulo: "Taxa de atingimento", valor: formatarPct(r.resumo.taxa) },
    ],
    situacao: null,
    colunas: [
      { chave: "codigo", titulo: "Código", tipo: "texto", largura: 11 },
      { chave: "meta", titulo: "Meta", tipo: "texto", largura: 34 },
      { chave: "indicador", titulo: "Indicador", tipo: "texto", largura: 28 },
      { chave: "onde", titulo: "Onde", tipo: "texto", largura: 28 },
      { chave: "inicio", titulo: "Início", tipo: "data", largura: 12 },
      { chave: "fim", titulo: "Fim", tipo: "data", largura: 12 },
      { chave: "desfecho", titulo: "Resultado", tipo: "texto", largura: 22 },
      { chave: "pct", titulo: "% da meta", tipo: "texto", largura: 11 },
    ],
    linhas: r.lista.map(({ meta, pct, onde }) => ({
      codigo: meta.code,
      meta: meta.name,
      indicador: indicadorDe(meta.indicator)?.rotulo ?? meta.indicator,
      onde,
      inicio: meta.starts_on,
      fim: meta.ends_on,
      desfecho: meta.outcome ? DESFECHO_LABEL[meta.outcome] : "Apurando",
      pct: formatarPct(pct),
    })),
    notas: [
      "Só percentuais: os valores em R$ ficam na ficha de cada meta, para quem pode vê-los.",
      "Meta mensal: o percentual é a média dos meses, e ela só conta como atingida se atingiu em todos.",
      "A taxa de atingimento conta só as metas com dados para apurar.",
    ],
    nomeDoArquivo: `resultados-das-metas-${a.de}-a-${a.ate}`,
  };
}
