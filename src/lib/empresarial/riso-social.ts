// Risarte Empresarial — AS METAS DO RISO+ SOCIAL (1034, refeitas na 1035).
//
// Pedido (26/10/2026): *"Se a empresa paga para os colaboradores se vai ter a
// possibilidade de participar do Riso+ Social, para indicar pessoas carentes,
// de acordo as metas que forem definidos para a empresa parceira poder
// indicar pessoas carentes."*
//
// 1035 (27/10/2026): *"a meta […] deve ter a possibilidade de em uma unica
// meta ter as condições variáveis, como por exemplo: para indicar 01 pessoa
// carente deve ter pelo menos X titulares ativos e Y tempo de programa
// empresarial."* Decisões do dono, na mesma conversa:
//   1. UMA META = VÁRIAS CONDIÇÕES "PELO MENOS", TODAS AO MESMO TEMPO, e o
//      número de indicações que ela rende.
//   2. RENDE UMA VEZ; com "renova a cada N meses", rende de novo a cada
//      período de N meses de contrato em que as condições continuarem
//      valendo. Várias metas funcionam como degraus.
//   3. AS CONDIÇÕES: titulares ativos, dependentes ativos, tempo de programa,
//      comparecimento às avaliações, gasto em tratamento e mensalidades em dia.
//
// ⚠️ PRÉ-REQUISITO: a empresa paga a mensalidade (tudo ou parte). No "titular
// paga" não há Riso+ Social — e o banco recusa a ficha (1035).
//
// ⚠️ O SISTEMA CONTA, QUEM LIBERA É GENTE. A conta diz o que a meta
// conquistou NO PERÍODO; a liberação é um clique do gestor. Ficha liberada
// nunca é recolhida, mesmo que a condição caia depois.
//
// Puro e em números inteiros: a tela, o documento e o contrato perguntam o
// mesmo, e a resposta não pode depender de quem perguntou.

import type { PaymentModel } from "./constants";

export const TIPOS_DE_CONDICAO = [
  "EMPLOYEE_COUNT",
  "DEPENDENT_COUNT",
  "TIME_IN_PROGRAM",
  "ATTENDANCE",
  "TREATMENT_SPEND",
  "FEES_UP_TO_DATE",
] as const;
export type TipoDeCondicao = (typeof TIPOS_DE_CONDICAO)[number];

export const CONDICAO_ROTULO: Record<TipoDeCondicao, string> = {
  EMPLOYEE_COUNT: "Titulares ativos",
  DEPENDENT_COUNT: "Dependentes ativos",
  TIME_IN_PROGRAM: "Tempo de programa",
  ATTENDANCE: "Comparecimento às avaliações",
  TREATMENT_SPEND: "Gasto em tratamento",
  FEES_UP_TO_DATE: "Mensalidades em dia",
};

/** A unidade do mínimo, para o editor. Mensalidades em dia não tem número. */
export const CONDICAO_UNIDADE: Record<TipoDeCondicao, string> = {
  EMPLOYEE_COUNT: "titulares",
  DEPENDENT_COUNT: "dependentes",
  TIME_IN_PROGRAM: "meses",
  ATTENDANCE: "%",
  TREATMENT_SPEND: "reais",
  FEES_UP_TO_DATE: "",
};

/** O comparecimento é medido nos últimos 12 meses FECHADOS. */
export const JANELA_DO_COMPARECIMENTO = 12;

/**
 * Uma condição "pelo menos". `minimo` muda de sentido com o tipo: titulares,
 * dependentes, meses, percentual (1–100) ou centavos. Em "mensalidades em
 * dia" ele não é usado (vale 0).
 */
export type CondicaoSocial = { tipo: TipoDeCondicao; minimo: number };

export type MetaSocial = {
  /** Estável: é por ele que as fichas liberadas são contadas. */
  id: string;
  condicoes: CondicaoSocial[];
  indicacoes: number;
  /** Nulo = rende uma vez só. */
  renovaMeses: number | null;
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
  dependentesAtivos: number;
  /** Mensalidades do programa vencidas e não pagas. */
  mensalidadesVencidas: number;
  /** "2026-01-15" — o início do contrato (ou o cadastro, sem contrato). */
  inicio: string;
  /** "2026-10-27" — hoje, no relógio brasileiro. */
  hoje: string;
  meses: readonly MesSocial[];
};

export type AvaliacaoDaCondicao = {
  condicao: CondicaoSocial;
  cumpre: boolean;
  /** Como está hoje, em palavras: "45 titulares ativos (mínimo 20)". */
  situacao: string;
};

export type ConquistaDaMeta = {
  meta: MetaSocial;
  condicoes: AvaliacaoDaCondicao[];
  /** Todas as condições valem hoje. */
  cumpre: boolean;
  /** O que a meta rende NESTE período (0 ou `indicacoes`). */
  conquistadas: number;
  /** "aaaa-mm-dd" do começo do período; nulo = meta de uma vez só. */
  periodoDesde: string | null;
  periodo: string;
};

const inteiro = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.floor(v) : 0;
};

const reais = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** "2027-01-15" → "2027-01-14". Conta de calendário, sem relógio. */
function diaAnterior(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Uma meta crua (jsonb ou formulário) → meta. Aceita também o formato da
 * primeira versão da 1034 (`{tipo, a_cada, indicacoes, percentual}`, uma
 * condição só), lido como "pelo menos `a_cada`".
 */
function metaCrua(bruto: unknown, i: number): MetaSocial {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : `meta-${i + 1}`;
  const renova = inteiro(r.renova_meses ?? r.renovaMeses);
  const condicoes: CondicaoSocial[] = Array.isArray(r.condicoes)
    ? r.condicoes.map((c) => {
        const cc = (c ?? {}) as Record<string, unknown>;
        return { tipo: String(cc.tipo ?? "") as TipoDeCondicao, minimo: inteiro(cc.minimo) };
      })
    : r.tipo
      ? [
          {
            tipo: String(r.tipo) as TipoDeCondicao,
            minimo: inteiro(r.tipo === "ATTENDANCE" ? r.percentual : (r.a_cada ?? r.aCada)),
          },
        ]
      : [];
  return {
    id,
    condicoes: condicoes.map((c) => (c.tipo === "FEES_UP_TO_DATE" ? { ...c, minimo: 0 } : c)),
    indicacoes: inteiro(r.indicacoes),
    renovaMeses: renova > 0 ? renova : null,
  };
}

/** As metas como vieram do banco (jsonb) → metas limpas. O que não serve sai. */
export function lerMetas(bruto: unknown): MetaSocial[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map(metaCrua)
    .map((m) => ({ ...m, condicoes: m.condicoes.filter((c) => TIPOS_DE_CONDICAO.includes(c.tipo)) }))
    .filter((m) => m.condicoes.length > 0 && m.indicacoes > 0 && problemasDasMetas([m]).length === 0);
}

/** O formato gravado no banco (snake_case, como os outros jsonb do módulo). */
export function metasParaGravar(metas: readonly MetaSocial[]) {
  return metas.map((m) => ({
    id: m.id,
    indicacoes: m.indicacoes,
    renova_meses: m.renovaMeses,
    condicoes: m.condicoes.map((c) => ({ tipo: c.tipo, minimo: c.minimo })),
  }));
}

/** O que impede gravar as metas. */
export function problemasDasMetas(metas: readonly MetaSocial[]): string[] {
  const p: string[] = [];
  const ids = new Set<string>();
  metas.forEach((m, i) => {
    const nome = `a meta ${i + 1}`;
    if (ids.has(m.id)) p.push(`${nome} repete a identificação de outra — crie de novo`);
    ids.add(m.id);
    if (m.condicoes.length === 0) p.push(`${nome} precisa de ao menos uma condição`);
    if (m.indicacoes <= 0) p.push(`${nome} precisa render ao menos 1 indicação`);
    if (m.renovaMeses != null && !(m.renovaMeses >= 1 && m.renovaMeses <= 120)) {
      p.push(`${nome}: a renovação vai de 1 a 120 meses (ou fica em branco)`);
    }
    const vistos = new Set<string>();
    for (const c of m.condicoes) {
      if (!TIPOS_DE_CONDICAO.includes(c.tipo)) {
        p.push(`${nome} tem uma condição desconhecida`);
        continue;
      }
      const rotulo = CONDICAO_ROTULO[c.tipo];
      if (vistos.has(c.tipo)) p.push(`${nome} tem "${rotulo}" duas vezes — deixe uma`);
      vistos.add(c.tipo);
      if (c.tipo === "ATTENDANCE" && !(c.minimo > 0 && c.minimo <= 100)) {
        p.push(`${nome}: o comparecimento precisa de um percentual entre 1 e 100`);
      } else if (c.tipo !== "FEES_UP_TO_DATE" && c.minimo <= 0) {
        p.push(`${nome}: "${rotulo}" precisa de um mínimo maior que zero`);
      }
    }
  });
  return [...new Set(p)];
}

/**
 * QUEM PARTICIPA: só a empresa que paga (tudo ou parte). No "titular paga"
 * não há parcela da empresa de onde tirar a ficha (briefing §5.6).
 */
export function participaDoSocial(modelo: PaymentModel | null | undefined): boolean {
  return modelo === "COMPANY_PAYS" || modelo === "COMPANY_PARTIAL";
}

/** A condição em palavras: "pelo menos 20 titulares ativos". */
export function rotuloDaCondicao(c: CondicaoSocial): string {
  switch (c.tipo) {
    case "EMPLOYEE_COUNT":
      return `pelo menos ${plural(c.minimo, "titular ativo", "titulares ativos")}`;
    case "DEPENDENT_COUNT":
      return `pelo menos ${plural(c.minimo, "dependente ativo", "dependentes ativos")}`;
    case "TIME_IN_PROGRAM":
      return `pelo menos ${plural(c.minimo, "mês", "meses")} de programa`;
    case "ATTENDANCE":
      return `comparecimento de pelo menos ${c.minimo}% às avaliações e reavaliações nos últimos ${JANELA_DO_COMPARECIMENTO} meses`;
    case "TREATMENT_SPEND":
      return `pelo menos ${reais(c.minimo)} em tratamentos fechados`;
    case "FEES_UP_TO_DATE":
      return "mensalidades do programa em dia";
  }
}

const juntar = (partes: string[]) =>
  partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;

/** A meta em uma frase — para a proposta, o contrato e a tela. */
export function rotuloDaMeta(m: MetaSocial): string {
  const ind = plural(m.indicacoes, "indicação", "indicações");
  const quando = juntar(m.condicoes.map(rotuloDaCondicao));
  const vez =
    m.renovaMeses == null
      ? "uma vez"
      : `a cada ${plural(m.renovaMeses, "mês", "meses")} de contrato em que as condições valerem`;
  return `${ind} ${vez}, com ${quando || "(nenhuma condição)"}`;
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

/** "2026-03-15" + 5 meses → "2026-08-15" (o dia vira o último do mês se faltar). */
export function dataSomada(inicio: string, n: number): string {
  const [a, m, d] = inicio.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dd = Math.min(d || 1, ultimo);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Cada condição medida com os números de hoje. */
export function avaliarCondicao(c: CondicaoSocial, d: DadosDaEmpresa): AvaliacaoDaCondicao {
  switch (c.tipo) {
    case "EMPLOYEE_COUNT": {
      const n = Math.max(0, d.titularesAtivos);
      return {
        condicao: c,
        cumpre: n >= c.minimo,
        situacao: `${plural(n, "titular ativo", "titulares ativos")} (mínimo ${c.minimo})`,
      };
    }
    case "DEPENDENT_COUNT": {
      const n = Math.max(0, d.dependentesAtivos);
      return {
        condicao: c,
        cumpre: n >= c.minimo,
        situacao: `${plural(n, "dependente ativo", "dependentes ativos")} (mínimo ${c.minimo})`,
      };
    }
    case "TIME_IN_PROGRAM": {
      const n = mesesCompletos(d.inicio, d.hoje);
      return {
        condicao: c,
        cumpre: n >= c.minimo,
        situacao: `${plural(n, "mês", "meses")} de programa (mínimo ${c.minimo})`,
      };
    }
    case "ATTENDANCE": {
      // Os últimos 12 meses FECHADOS: o mês corrente ainda não terminou.
      const ate = `${d.hoje.slice(0, 7)}-01`;
      const de = dataSomada(ate, -JANELA_DO_COMPARECIMENTO);
      const janela = d.meses.filter((m) => m.mes >= de && m.mes < ate);
      const total = janela.reduce((s, m) => s + m.avaliacoes, 0);
      const vieram = janela.reduce((s, m) => s + m.comparecimentos, 0);
      // Sem consulta não há comparecimento a medir — não vale como cumprida.
      if (total === 0) {
        return {
          condicao: c,
          cumpre: false,
          situacao: `sem avaliações nos últimos ${JANELA_DO_COMPARECIMENTO} meses (mínimo ${c.minimo}%)`,
        };
      }
      const taxa = Math.floor((vieram / total) * 100);
      return {
        condicao: c,
        cumpre: taxa >= c.minimo,
        situacao: `${taxa}% de comparecimento em ${plural(total, "avaliação", "avaliações")} nos últimos ${JANELA_DO_COMPARECIMENTO} meses (mínimo ${c.minimo}%)`,
      };
    }
    case "TREATMENT_SPEND": {
      const gasto = d.meses.reduce((s, m) => s + Math.max(0, m.gastoCents), 0);
      return {
        condicao: c,
        cumpre: gasto >= c.minimo,
        situacao: `${reais(gasto)} em tratamentos fechados (mínimo ${reais(c.minimo)})`,
      };
    }
    case "FEES_UP_TO_DATE": {
      const n = Math.max(0, d.mensalidadesVencidas);
      return {
        condicao: c,
        cumpre: n === 0,
        situacao:
          n === 0
            ? "nenhuma mensalidade vencida"
            : `${plural(n, "mensalidade vencida", "mensalidades vencidas")} sem pagamento`,
      };
    }
  }
}

/**
 * O QUE CADA META CONQUISTOU NESTE PERÍODO.
 *
 * Meta de uma vez: o período é o contrato inteiro. Meta que renova a cada N
 * meses: o período é o bloco de N meses de contrato em que hoje cai (do 1º ao
 * N-ésimo mês, do N+1 ao 2N, …). Em cada período a meta rende suas
 * indicações se TODAS as condições valem — o que não foi liberado num
 * período que terminou não se acumula para o seguinte.
 */
export function conquistasDasMetas(
  metas: readonly MetaSocial[],
  d: DadosDaEmpresa
): ConquistaDaMeta[] {
  const meses = mesesCompletos(d.inicio, d.hoje);
  return metas.map((meta) => {
    const condicoes = meta.condicoes.map((c) => avaliarCondicao(c, d));
    const cumpre = condicoes.length > 0 && condicoes.every((c) => c.cumpre);
    let periodoDesde: string | null = null;
    let periodo = "uma vez só";
    if (meta.renovaMeses != null) {
      const p = Math.floor(meses / meta.renovaMeses);
      periodoDesde = dataSomada(d.inicio, p * meta.renovaMeses);
      const ate = dataSomada(d.inicio, (p + 1) * meta.renovaMeses);
      periodo = `${p + 1}º período, de ${dataBr(periodoDesde)} a ${dataBr(diaAnterior(ate))}`;
    }
    return {
      meta,
      condicoes,
      cumpre,
      conquistadas: cumpre ? Math.max(0, meta.indicacoes) : 0,
      periodoDesde,
      periodo,
    };
  });
}

/** Uma ficha já liberada: a meta que a rendeu e o dia (Brasil) da liberação. */
export type FichaDaMeta = { metaId: string | null; dia: string };

/**
 * O PAINEL: por meta, o que conquistou no período, quantas já foram
 * liberadas no período e quantas faltam liberar (nunca negativo).
 */
export function painelDasMetas(
  conquistas: readonly ConquistaDaMeta[],
  fichas: readonly FichaDaMeta[]
): (ConquistaDaMeta & { liberadas: number; aLiberar: number })[] {
  return conquistas.map((c) => {
    const liberadas = fichas.filter(
      (f) => f.metaId === c.meta.id && (c.periodoDesde == null || f.dia >= c.periodoDesde)
    ).length;
    return { ...c, liberadas, aLiberar: Math.max(0, c.conquistadas - liberadas) };
  });
}

/**
 * AS METAS DE UM FORMULÁRIO — a proposta e a empresa usam o mesmo editor, que
 * manda tudo num campo só (`metas_json`), já em centavos. Não descarta nada:
 * o que estiver errado aparece em `problemasDasMetas`.
 */
export function metasDoFormulario(campo: (nome: string) => string | null): MetaSocial[] {
  let bruto: unknown;
  try {
    bruto = JSON.parse(campo("metas_json") ?? "[]");
  } catch {
    return [];
  }
  return Array.isArray(bruto) ? bruto.slice(0, 30).map(metaCrua) : [];
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
