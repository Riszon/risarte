// LEVANTAMENTO DE DÍVIDAS — QUALIDADE DOS DADOS (sugestão 1, fase 4).
//
// O que falta completar nas dívidas, para o levantamento ficar confiável:
// a importação traz o que a planilha tinha, e a planilha da rede tinha
// lacunas (pendências 8, 13 e 15). Código puro e testado; a tela só mostra.

import { normalizar } from "@/lib/finance/dividas-importacao";

export type DividaDaQualidade = {
  id: string;
  code: string;
  clinicId: string;
  supplierId: string;
  status: string;
  contractNumber: string | null;
  originalCents: number | null;
  updatedRefDate: string | null;
  dueDate: string;
  categoryId: string | null;
  natureCode: string | null;
  needsSplit: boolean;
  lastCheckedOn: string | null;
};

export type ProblemaDeQualidade =
  | "sem_contrato"
  | "sem_valor_original"
  | "cnpj_incompleto"
  | "a_classificar"
  | "vencimento_do_levantamento"
  | "desdobrar"
  | "conferencia_velha";

export const PROBLEMAS: { codigo: ProblemaDeQualidade; rotulo: string; explicacao: string }[] = [
  { codigo: "cnpj_incompleto", rotulo: "Credor sem CNPJ completo", explicacao: "O credor está com só a raiz do CNPJ (8 dígitos) ou sem CNPJ. Complete no cadastro do fornecedor." },
  { codigo: "a_classificar", rotulo: "\"A classificar\"", explicacao: "Sem categoria, com a categoria \"A classificar\" ou sem natureza." },
  { codigo: "vencimento_do_levantamento", rotulo: "Vencimento igual à data do levantamento", explicacao: "O vencimento é o mesmo dia da referência do valor: provavelmente é a data em que a dívida foi levantada, não o vencimento real." },
  { codigo: "sem_contrato", rotulo: "Sem nº de contrato ou título", explicacao: "O número ajuda a achar duplicidade e a falar com o credor." },
  { codigo: "sem_valor_original", rotulo: "Sem valor original", explicacao: "Só o valor atualizado foi informado." },
  { codigo: "desdobrar", rotulo: "Grupo para desdobrar", explicacao: "A linha reúne várias dívidas do mesmo credor; desdobre quando souber cada uma." },
  { codigo: "conferencia_velha", rotulo: "Sem conferência recente", explicacao: "Nunca conferida no Serasa/credor, ou conferida há mais tempo que o prazo da configuração." },
];

/** Situações em que a dívida acabou: não pedem mais conferência. */
const ENCERRADAS = new Set(["quitada_encerrada", "baixada"]);

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 86400000);

export function problemasDaDivida(
  d: DividaDaQualidade,
  ctx: { documentoDoCredor: Map<string, string | null>; nomeDaCategoria: Map<string, string>; hoje: string; prazoDaConferencia: number }
): ProblemaDeQualidade[] {
  if (ENCERRADAS.has(d.status)) return [];
  const p: ProblemaDeQualidade[] = [];
  const doc = (ctx.documentoDoCredor.get(d.supplierId) ?? "").replace(/\D/g, "");
  if (doc.length !== 14 && doc.length !== 11) p.push("cnpj_incompleto");
  const cat = d.categoryId ? ctx.nomeDaCategoria.get(d.categoryId) : null;
  if (!cat || normalizar(cat) === "a classificar" || !d.natureCode) p.push("a_classificar");
  if (d.updatedRefDate && d.updatedRefDate === d.dueDate) p.push("vencimento_do_levantamento");
  if (!d.contractNumber?.trim()) p.push("sem_contrato");
  if (d.originalCents === null || d.originalCents <= 0) p.push("sem_valor_original");
  if (d.needsSplit) p.push("desdobrar");
  if (!d.lastCheckedOn || diasEntre(d.lastCheckedOn, ctx.hoje) > ctx.prazoDaConferencia) p.push("conferencia_velha");
  return p;
}

/** Por problema, as dívidas que o têm (na ordem de `PROBLEMAS`). */
export function qualidadeDosDados(
  dividas: DividaDaQualidade[],
  ctx: Parameters<typeof problemasDaDivida>[1]
): { codigo: ProblemaDeQualidade; rotulo: string; explicacao: string; ids: string[] }[] {
  const por = new Map<ProblemaDeQualidade, string[]>();
  for (const d of dividas) for (const p of problemasDaDivida(d, ctx)) por.set(p, [...(por.get(p) ?? []), d.id]);
  return PROBLEMAS.map((x) => ({ ...x, ids: por.get(x.codigo) ?? [] }));
}
