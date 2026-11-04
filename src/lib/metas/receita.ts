import type { ChaveIndicador } from "./indicadores";

/**
 * 0365 (P3): A COMPOSIÇÃO DA RECEITA BRUTA que a ficha da meta mostra.
 *
 * A receita bruta tem QUATRO linhas que não se repetem — procedimentos
 * (particular), procedimentos (Empresarial), ortodontia (a parte de orto dos
 * procedimentos + as mensalidades) e as mensalidades do PPR+ — e uma linha À
 * PARTE, que não soma: tudo o que os clientes do Empresarial pagaram.
 *
 * Os números vêm de `goal_revenue_breakdown` (0365), que só responde a quem vê
 * o dinheiro da meta (D3). A conta das linhas é a MESMA dos indicadores — as
 * peças `_goal_receipts_split`, `_goal_ortho_paid` e `_goal_ppr_paid`.
 */

/** As metas cuja ficha mostra a composição. */
export const INDICADORES_DA_RECEITA_BRUTA: ChaveIndicador[] = [
  "gross_revenue",
  "revenue_private",
  "revenue_empresarial",
  "revenue_empresarial_all",
  "ortho_revenue",
  "ortho_revenue_share",
  "ppr_revenue",
  "ppr_revenue_share",
];

export function mostraComposicao(indicador: string): boolean {
  return (INDICADORES_DA_RECEITA_BRUTA as string[]).includes(indicador);
}

export type LinhaDaComposicao = { chave: string; rotulo: string; cents: number; pct: number | null; nivel: 0 | 1 };

export type Composicao = {
  linhas: LinhaDaComposicao[];
  total: number;
  /** A linha à parte: não entra no total. */
  empresarialTodos: { cents: number; pct: number | null };
};

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);

/** As linhas do banco (`line`, `cents`) no formato da ficha. Linha que falta vale zero. */
export function composicaoDaReceita(rows: { line: string; cents: number | string | null }[]): Composicao {
  const v = (k: string) => Number(rows.find((r) => r.line === k)?.cents ?? 0) || 0;
  const particular = v("private");
  const empresarial = v("empresarial");
  const orthoProc = v("ortho_procedures");
  const orthoMensal = v("ortho_monthly");
  const ppr = v("ppr");
  const total = particular + empresarial + orthoProc + orthoMensal + ppr;
  const linha = (chave: string, rotulo: string, cents: number, nivel: 0 | 1 = 0): LinhaDaComposicao => ({
    chave,
    rotulo,
    cents,
    pct: pct(cents, total),
    nivel,
  });
  return {
    linhas: [
      linha("private", "Procedimentos — particular", particular),
      linha("empresarial", "Procedimentos — Empresarial", empresarial),
      linha("ortho", "Ortodontia", orthoProc + orthoMensal),
      linha("ortho_procedures", "procedimentos de ortodontia", orthoProc, 1),
      linha("ortho_monthly", "mensalidades e contenções", orthoMensal, 1),
      linha("ppr", "PPR+ — mensalidades", ppr),
    ],
    total,
    empresarialTodos: { cents: v("empresarial_all"), pct: pct(v("empresarial_all"), total) },
  };
}

/**
 * P5: a especialidade que as Metas usam para achar a ORTODONTIA nos
 * procedimentos — espelho de `_goal_ortho_specialty()` (0365). Renomear ou
 * excluir a especialidade (Procedimentos → Especialidades) faz estas partes
 * pararem de achar; a tela de Especialidades avisa com esta lista.
 */
export const ESPECIALIDADE_DA_ORTODONTIA = "Ortodontia";

export const ONDE_A_ORTODONTIA_E_USADA = [
  "Metas: a parte de procedimentos da \"Receita de ortodontia\" e do \"% da receita de ortodontia\"",
  "Metas: a parte de procedimentos da \"Inadimplência da ortodontia\"",
  "Metas: a linha Ortodontia da receita bruta (e, por tabela, as linhas de procedimentos particular e Empresarial)",
  "Metas com recorte \"Ortodontia\" em vendas, procedimentos executados e produção",
  "Modelos de meta com o recorte \"Ortodontia\" (ex.: \"Ortodontia no trimestre\")",
];
