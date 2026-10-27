// Risarte Empresarial — AS METAS DO RISO+ SOCIAL (1034, dono em 26/10/2026).
//
// Pedido: *"Se a empresa paga para os colaboradores se vai ter a possibilidade
// de participar do Riso+ Social, para indicar pessoas carentes, de acordo as
// metas que forem definidos para a empresa parceira poder indicar pessoas
// carentes."*
//
// As QUATRO metas do briefing (§5.6), cada uma rendendo indicações:
//   - a cada N titulares ativos .................... K indicações
//   - a cada N meses de programa ................... K indicações
//   - a cada período de N meses com comparecimento
//     às avaliações/reavaliações ≥ P% .............. K indicações
//   - a cada R$ X em tratamento fechado ............ K indicações
//
// ⚠️ O SISTEMA CONTA, QUEM LIBERA É GENTE (decisão do dono). A conta diz
// quantas indicações a empresa CONQUISTOU; a liberação é um clique do gestor.
// Ficha liberada nunca é recolhida, mesmo que a conta caia depois (titulares
// que saíram, por exemplo) — o que foi prometido e liberado fica.
//
// Puro e em números inteiros: a tela, o documento e o contrato perguntam o
// mesmo, e a resposta não pode depender de quem perguntou.

import type { PaymentModel } from "./constants";

export const TIPOS_DE_META = [
  "EMPLOYEE_COUNT",
  "TIME_IN_PROGRAM",
  "ATTENDANCE",
  "TREATMENT_SPEND",
] as const;
export type TipoDeMeta = (typeof TIPOS_DE_META)[number];

export const META_ROTULO: Record<TipoDeMeta, string> = {
  EMPLOYEE_COUNT: "Titulares ativos",
  TIME_IN_PROGRAM: "Tempo no programa",
  ATTENDANCE: "Comparecimento às avaliações",
  TREATMENT_SPEND: "Gasto em tratamento",
};

/**
 * Uma meta. `aCada` muda de sentido com o tipo:
 *   EMPLOYEE_COUNT → titulares; TIME_IN_PROGRAM e ATTENDANCE → meses;
 *   TREATMENT_SPEND → centavos.
 * `percentual` só existe no comparecimento.
 */
export type MetaSocial = {
  tipo: TipoDeMeta;
  aCada: number;
  indicacoes: number;
  percentual?: number | null;
};

/** O mês e seus números, como a `empresarial.social_metrics` devolve. */
export type MesSocial = {
  /** "2026-03-01" — o primeiro dia do mês. */
  mes: string;
  avaliacoes: number;
  comparecimentos: number;
  gastoCents: number;
};

export type DadosDaEmpresa = {
  titularesAtivos: number;
  /** "2026-01-15" — o início do contrato (ou o cadastro, sem contrato). */
  inicio: string;
  /** "2026-10-27" — hoje, no relógio brasileiro. */
  hoje: string;
  meses: readonly MesSocial[];
};

export type ConquistaDaMeta = {
  meta: MetaSocial;
  conquistadas: number;
  /** A régua em palavras: "45 titulares ativos — 2 vezes 20". */
  explicacao: string;
};

const inteiro = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.floor(v) : 0;
};

const reais = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** As metas como vieram do banco (jsonb) → metas limpas. O que não serve sai. */
export function lerMetas(bruto: unknown): MetaSocial[] {
  if (!Array.isArray(bruto)) return [];
  const out: MetaSocial[] = [];
  for (const m of bruto) {
    const r = m as Record<string, unknown>;
    const tipo = String(r?.tipo ?? "") as TipoDeMeta;
    if (!TIPOS_DE_META.includes(tipo)) continue;
    const meta: MetaSocial = {
      tipo,
      aCada: inteiro(r.a_cada ?? r.aCada),
      indicacoes: inteiro(r.indicacoes),
      percentual: tipo === "ATTENDANCE" ? inteiro(r.percentual) : null,
    };
    if (meta.aCada > 0 && meta.indicacoes > 0) out.push(meta);
  }
  return out;
}

/** O formato gravado no banco (snake_case, como os outros jsonb do módulo). */
export function metasParaGravar(metas: readonly MetaSocial[]) {
  return metas.map((m) => ({
    tipo: m.tipo,
    a_cada: m.aCada,
    indicacoes: m.indicacoes,
    ...(m.tipo === "ATTENDANCE" ? { percentual: m.percentual ?? 0 } : {}),
  }));
}

/** O que impede gravar as metas. */
export function problemasDasMetas(metas: readonly MetaSocial[]): string[] {
  const p: string[] = [];
  const vistos = new Set<TipoDeMeta>();
  for (const m of metas) {
    if (vistos.has(m.tipo)) p.push(`há duas metas de "${META_ROTULO[m.tipo]}" — junte as duas`);
    vistos.add(m.tipo);
    if (m.aCada <= 0) p.push(`"${META_ROTULO[m.tipo]}" precisa de um "a cada" maior que zero`);
    if (m.indicacoes <= 0) p.push(`"${META_ROTULO[m.tipo]}" precisa render ao menos 1 indicação`);
    if (m.tipo === "ATTENDANCE" && !((m.percentual ?? 0) > 0 && (m.percentual ?? 0) <= 100)) {
      p.push("o comparecimento precisa de um percentual entre 1 e 100");
    }
  }
  return [...new Set(p)];
}

/**
 * QUEM PARTICIPA: só a empresa que paga (tudo ou parte). No "titular paga"
 * não há parcela da empresa de onde tirar a ficha (briefing §5.6).
 */
export function participaDoSocial(modelo: PaymentModel | null | undefined): boolean {
  return modelo === "COMPANY_PAYS" || modelo === "COMPANY_PARTIAL";
}

/** A meta em uma frase — para a proposta, o contrato e a tela. */
export function rotuloDaMeta(m: MetaSocial): string {
  const ind = `${m.indicacoes} indicaç${m.indicacoes === 1 ? "ão" : "ões"}`;
  switch (m.tipo) {
    case "EMPLOYEE_COUNT":
      return `${ind} a cada ${m.aCada} titulares ativos`;
    case "TIME_IN_PROGRAM":
      return `${ind} a cada ${m.aCada} ${m.aCada === 1 ? "mês" : "meses"} de programa`;
    case "ATTENDANCE":
      return `${ind} a cada ${m.aCada} ${m.aCada === 1 ? "mês" : "meses"} com comparecimento de pelo menos ${m.percentual ?? 0}% às avaliações e reavaliações`;
    case "TREATMENT_SPEND":
      return `${ind} a cada ${reais(m.aCada)} em tratamentos fechados`;
  }
}

/** Meses COMPLETOS entre duas datas "aaaa-mm-dd" (o dia conta). */
export function mesesCompletos(inicio: string, hoje: string): number {
  const [ai, mi, di] = inicio.split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  if (!ai || !ah) return 0;
  let meses = (ah - ai) * 12 + (mh - mi);
  if (dh < di) meses -= 1;
  return Math.max(0, meses);
}

/** "2026-03-15" + 5 meses → "2026-08-01" (o mês, não o dia). */
function mesSomado(inicio: string, n: number): string {
  const [a, m] = inicio.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

/**
 * QUANTAS INDICAÇÕES CADA META CONQUISTOU, com a régua escrita.
 *
 * O comparecimento é medido em PERÍODOS FECHADOS de N meses a partir do início
 * do contrato: o período em andamento ainda não terminou, e premiar meio
 * período seria premiar uma promessa. Período sem avaliação nenhuma não rende
 * — sem consulta não há comparecimento a medir.
 */
export function conquistasDasMetas(
  metas: readonly MetaSocial[],
  d: DadosDaEmpresa
): ConquistaDaMeta[] {
  const meses = mesesCompletos(d.inicio, d.hoje);
  const gasto = d.meses.reduce((s, m) => s + Math.max(0, m.gastoCents), 0);

  return metas.map((meta) => {
    const k = Math.max(0, meta.indicacoes);
    const n = Math.max(1, meta.aCada);
    switch (meta.tipo) {
      case "EMPLOYEE_COUNT": {
        const vezes = Math.floor(Math.max(0, d.titularesAtivos) / n);
        return {
          meta,
          conquistadas: vezes * k,
          explicacao: `${d.titularesAtivos} titulares ativos — ${vezes} vez(es) ${n}`,
        };
      }
      case "TIME_IN_PROGRAM": {
        const vezes = Math.floor(meses / n);
        return {
          meta,
          conquistadas: vezes * k,
          explicacao: `${meses} ${meses === 1 ? "mês" : "meses"} de programa — ${vezes} período(s) de ${n}`,
        };
      }
      case "TREATMENT_SPEND": {
        const vezes = Math.floor(gasto / n);
        return {
          meta,
          conquistadas: vezes * k,
          explicacao: `${reais(gasto)} em tratamentos fechados — ${vezes} vez(es) ${reais(n)}`,
        };
      }
      case "ATTENDANCE": {
        const fechados = Math.floor(meses / n);
        const alvo = Math.max(0, meta.percentual ?? 0);
        let bons = 0;
        const taxas: string[] = [];
        for (let p = 0; p < fechados; p += 1) {
          const de = mesSomado(d.inicio, p * n);
          const ate = mesSomado(d.inicio, (p + 1) * n);
          const doPeriodo = d.meses.filter((m) => m.mes >= de && m.mes < ate);
          const total = doPeriodo.reduce((s, m) => s + m.avaliacoes, 0);
          const vieram = doPeriodo.reduce((s, m) => s + m.comparecimentos, 0);
          if (total === 0) {
            taxas.push("sem avaliações");
            continue;
          }
          const taxa = Math.round((vieram / total) * 100);
          taxas.push(`${taxa}%`);
          if (taxa >= alvo) bons += 1;
        }
        return {
          meta,
          conquistadas: bons * k,
          explicacao:
            fechados === 0
              ? `nenhum período de ${n} meses fechado ainda`
              : `${bons} de ${fechados} período(s) com ${alvo}% ou mais (${taxas.join(", ")})`,
        };
      }
    }
  });
}

/**
 * O PAINEL: por meta, quantas foram conquistadas, quantas já liberadas, e
 * quantas faltam liberar. A liberação de cada meta é contada pelas fichas com
 * o mesmo gatilho (`social_tokens.trigger_type`).
 */
export function painelDasMetas(
  conquistas: readonly ConquistaDaMeta[],
  liberadasPorTipo: Partial<Record<TipoDeMeta, number>>
): (ConquistaDaMeta & { liberadas: number; aLiberar: number })[] {
  return conquistas.map((c) => {
    const liberadas = liberadasPorTipo[c.meta.tipo] ?? 0;
    return { ...c, liberadas, aLiberar: Math.max(0, c.conquistadas - liberadas) };
  });
}

/**
 * AS METAS DE UM FORMULÁRIO — a proposta e a empresa usam o mesmo editor.
 * Campos: `meta_tipo_i`, `meta_acada_i` (no gasto, em REAIS), `meta_ind_i`,
 * `meta_pct_i`. Linha sem tipo é linha vazia e sai.
 */
export function metasDoFormulario(campo: (nome: string) => string | null): MetaSocial[] {
  const lista: MetaSocial[] = [];
  for (let i = 0; i < 20; i += 1) {
    const tipo = (campo(`meta_tipo_${i}`) ?? "") as TipoDeMeta;
    if (!TIPOS_DE_META.includes(tipo)) continue;
    const bruto = (campo(`meta_acada_${i}`) ?? "").trim();
    const aCada =
      tipo === "TREATMENT_SPEND"
        ? Math.round(
            (Number.parseFloat(bruto.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0) * 100
          )
        : Number.parseInt(bruto.replace(/\D/g, ""), 10) || 0;
    lista.push({
      tipo,
      aCada,
      indicacoes: Number.parseInt((campo(`meta_ind_${i}`) ?? "").replace(/\D/g, ""), 10) || 0,
      percentual:
        tipo === "ATTENDANCE"
          ? Number.parseInt((campo(`meta_pct_${i}`) ?? "").replace(/\D/g, ""), 10) || 0
          : null,
    });
  }
  return lista;
}

const MEIO_ROTULO: Record<string, string> = { BOLETO: "boleto", PIX: "Pix", CARD: "cartão" };

/**
 * O PAGAMENTO DO TRATAMENTO em uma frase (1034) — documento e contrato.
 * Nulo nos dois = a proposta não definiu: vale o padrão (os três, 24x).
 */
export function textoDoPagamento(
  metodos: readonly string[] | null | undefined,
  parcelas: number | null | undefined
): string {
  const lista = (metodos && metodos.length > 0 ? metodos : ["BOLETO", "PIX", "CARD"])
    .map((m) => MEIO_ROTULO[m])
    .filter(Boolean);
  const meios =
    lista.length <= 1 ? (lista[0] ?? "") : `${lista.slice(0, -1).join(", ")} e ${lista.at(-1)}`;
  const n = parcelas ?? 24;
  const frase = n > 1 ? `${meios}, com parcelamento em até ${n}x` : `${meios}, à vista`;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}
