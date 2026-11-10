// QUEM FEZ E QUANDO, no próprio lançamento do Financeiro (0372).
//
// Pedido do dono (09/11/2026): todo lançamento mostra quem lançou e quem deu
// baixa. Uma regra só de texto para todas as telas — Contas a pagar, pagas,
// Recebíveis, Conciliação, Caixa, DRE e Fechamento —, para a mesma situação
// nunca ser dita de dois jeitos.
//
// Decisão do dono sobre o que não tem autor:
//   * lançamento que o SISTEMA fez (rotina, taxa da rede, PPR+, Empresarial)
//     → "pelo sistema";
//   * lançamento antigo, de antes de o registro existir → "autor não
//     registrado". Nunca deixar em branco: em branco parece defeito da tela.

import { formatBrDateTime } from "@/lib/dates";

export const SEM_AUTOR = "autor não registrado";
export const PELO_SISTEMA = "pelo sistema";

export type Ato = {
  /** "Lançada", "Paga", "Cancelada", "Casada com o extrato"… */
  rotulo: string;
  /** Nome de quem fez; nulo quando não há pessoa registrada. */
  nome: string | null;
  /** Instante (timestamptz) em que foi registrado. */
  quando?: string | null;
  /** O ato é de rotina do sistema: sem pessoa é o esperado. */
  automatico?: boolean;
};

/** "Fulano", "pelo sistema" ou "autor não registrado". */
export function autorDoAto(nome: string | null | undefined, automatico = false): string {
  const n = (nome ?? "").trim();
  if (n) return n;
  return automatico ? PELO_SISTEMA : SEM_AUTOR;
}

/** "Lançada por Fulano em 09/11/2026 às 14:32" (ou "Lançada pelo sistema em …"). */
export function textoDoAto(a: Ato): string {
  const quem = autorDoAto(a.nome, a.automatico);
  const por = quem === PELO_SISTEMA ? quem : `por ${quem}`;
  const quando = a.quando ? ` em ${quandoFoi(a.quando)}` : "";
  return `${a.rotulo} ${por}${quando}`;
}

/** "09/11/2026 às 14:32" — no relógio de Brasília. */
export function quandoFoi(instante: string): string {
  return formatBrDateTime(instante).replace(", ", " às ");
}

/** Vários atos numa linha: "Lançada por … · Autorizada por … · Paga por …". */
export function linhaDeAtos(atos: (Ato | null | undefined | false)[]): string {
  return atos.filter((a): a is Ato => Boolean(a)).map(textoDoAto).join(" · ");
}

/** Só o primeiro nome — para a lista, onde o espaço é curto. */
export function nomeCurto(nome: string | null | undefined, automatico = false): string {
  const quem = autorDoAto(nome, automatico);
  if (quem === PELO_SISTEMA || quem === SEM_AUTOR) return quem;
  return quem.split(/\s+/)[0];
}

/**
 * Lançamentos do razão que nascem de ROTINA, sem pessoa (0232/0233 taxas da
 * rede, 0370 PPR+, 1040 Empresarial): sem autor é o esperado → "pelo sistema".
 */
export const ORIGENS_AUTOMATICAS = new Set([
  "network_fee_revenue",
  "ppr_charge",
  "emp_billing",
  "emp_rislife",
]);

export function origemAutomatica(sourceType: string | null | undefined): boolean {
  return ORIGENS_AUTOMATICAS.has(sourceType ?? "");
}

/**
 * AP129 — QUEM DEU A BAIXA numa mensalidade (Ortodontia) ou cobrança
 * (Empresarial), no mesmo texto do Financeiro.
 *
 * `nomes` nulo = a tela não conseguiu ler os nomes (a migração ainda não
 * rodou neste banco, ou a leitura falhou): não diz nada, em vez de afirmar
 * "autor não registrado" sobre algo que não leu.
 * `semPessoa` = a baixa pode vir de rotina (webhook do banco): sem nome é
 * "pelo sistema".
 */
export function textoDaBaixa(
  nomes: Record<string, string | null> | null,
  id: string,
  quando: string | null,
  semPessoa = false
): string | null {
  if (!nomes) return null;
  return textoDoAto({ rotulo: "Baixa", nome: nomes[id] ?? null, quando, automatico: semPessoa });
}
