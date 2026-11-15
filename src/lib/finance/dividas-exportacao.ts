// LEVANTAMENTO DE DÍVIDAS — FASE 7: EXPORTAR A LISTA (Excel e PDF).
//
// Uma fonte, duas saídas (o mesmo modelo do Saldo de abertura e dos outros
// relatórios: `RelatorioPronto`). A lista exportada é EXATAMENTE a da tela:
// as mesmas linhas (`linhasDaLista`, com o saldo da regra única), o mesmo
// filtro (`filtrarDividas`) e a mesma ordem (`ordenarDividas`). Os totais do
// resumo são os do rodapé da tela (`totaisDaLista`).
//
// Puro e testado.

import type { RelatorioPronto } from "./relatorio";
import {
  AGING_LABELS,
  FILTROS_VAZIOS,
  ORDENACAO_LABELS,
  ORIGIN_SHORT,
  PRIORITY_LABELS,
  STATUS_LABELS,
  descontoDaProposta,
  totaisDaLista,
  valorDevido,
  type AgingBand,
  type DebtFilters,
  type DebtListRow,
  type DebtStatus,
  type Ordenacao,
} from "./dividas";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O filtro e a ordem viajam no endereço (o botão da tela monta; a rota lê). */
export function filtroParaOEndereco(f: DebtFilters, ordem: Ordenacao): string {
  const usados = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
  const q = new URLSearchParams();
  if (Object.keys(usados).length) q.set("f", JSON.stringify(usados));
  q.set("o", ordem);
  return q.toString();
}

/** Lê de volta, aceitando só as chaves conhecidas (o resto é ignorado). */
export function filtroDoEndereco(params: Record<string, string | string[] | undefined>): { filtros: DebtFilters; ordem: Ordenacao } {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  let lidos: Record<string, unknown> = {};
  try {
    const j = JSON.parse(um(params.f) || "{}");
    if (j && typeof j === "object") lidos = j as Record<string, unknown>;
  } catch {
    lidos = {};
  }
  const filtros = { ...FILTROS_VAZIOS };
  for (const k of Object.keys(FILTROS_VAZIOS) as (keyof DebtFilters)[]) {
    if (typeof lidos[k] === "string") filtros[k] = (lidos[k] as string).slice(0, 200);
  }
  const o = um(params.o);
  const ordem = (o in ORDENACAO_LABELS ? o : "vencimento") as Ordenacao;
  return { filtros, ordem };
}

/** O filtro em palavras, para o cabeçalho do documento. */
export function filtroEmPalavras(f: DebtFilters, nome: (campo: keyof DebtFilters, valor: string) => string): string {
  const partes: string[] = [];
  const rot: Partial<Record<keyof DebtFilters, string>> = {
    busca: "Busca", devedor: "Devedor", credor: "Credor", tipoDoCredor: "Tipo do credor", categoria: "Categoria",
    subcategoria: "Subcategoria", natureza: "Natureza", etiqueta: "Etiqueta", situacao: "Situação", faixa: "Atraso",
    prioridade: "Prioridade", responsavel: "Responsável", restricao: "Restrição", proposta: "Proposta",
  };
  for (const k of Object.keys(rot) as (keyof DebtFilters)[]) {
    if (!f[k]) continue;
    let v = f[k];
    if (k === "situacao") v = STATUS_LABELS[v as DebtStatus] ?? v;
    else if (k === "faixa") v = v === "a_vencer" ? "ainda não venceu" : (AGING_LABELS[v as AgingBand] ?? v);
    else if (k === "prioridade") v = PRIORITY_LABELS[v as keyof typeof PRIORITY_LABELS] ?? v;
    else if (k !== "busca") v = nome(k, v);
    partes.push(`${rot[k]}: ${v}`);
  }
  if (f.vencimentoDe || f.vencimentoAte) partes.push(`Vencimento: ${f.vencimentoDe || "…"} a ${f.vencimentoAte || "…"}`);
  if (f.conferir === "1") partes.push("Só as que pedem conferência");
  return partes.length ? partes.join(" · ") : "Nenhum (todas as dívidas)";
}

function restricoes(r: DebtListRow): string | null {
  const x = [r.negativada && "negativada", r.protestada && "protestada", r.judicial && "judicial"].filter(Boolean);
  return x.length ? x.join(", ") : null;
}

export function relatorioDaListaDeDividas(input: {
  linhas: DebtListRow[];
  filtroEmPalavras: string;
  ordem: Ordenacao;
  nomeDaCategoria: (id: string | null) => string | null;
  geradoEm: string;
  geradoPor: string;
}): RelatorioPronto {
  const t = totaisDaLista(input.linhas);
  return {
    titulo: "Levantamento de Dívidas",
    subtitulo: `${input.linhas.length} dívida${input.linhas.length === 1 ? "" : "s"}`,
    metadados: [
      { rotulo: "Filtro", valor: input.filtroEmPalavras },
      { rotulo: "Ordem", valor: ORDENACAO_LABELS[input.ordem] },
      { rotulo: "Gerado em", valor: input.geradoEm },
      { rotulo: "Gerado por", valor: input.geradoPor },
    ],
    resumo: [
      { rotulo: "Total devido", valor: brl(t.devidoCents) },
      { rotulo: "Contestado ou judicial (incluído no total)", valor: brl(t.contestadaJudicialCents) },
      { rotulo: "Propostas atuais", valor: brl(t.propostasCents) },
      { rotulo: "Economia potencial (só onde há proposta)", valor: brl(t.economiaCents) },
      { rotulo: "Sem proposta", valor: brl(t.semPropostaCents) },
      { rotulo: "Estimado para regularizar", valor: brl(t.estimadoCents) },
      { rotulo: "Custo total para regularizar (com custas)", valor: brl(t.custoTotalCents) },
    ],
    situacao: null,
    colunas: [
      { chave: "code", titulo: "Código", tipo: "texto", largura: 10 },
      { chave: "devedor", titulo: "Devedor", tipo: "texto", largura: 26 },
      { chave: "credor", titulo: "Credor", tipo: "texto", largura: 28 },
      { chave: "categoria", titulo: "Categoria", tipo: "texto", largura: 22 },
      { chave: "contrato", titulo: "Contrato / parcela", tipo: "texto", largura: 18 },
      { chave: "situacao", titulo: "Situação", tipo: "texto", largura: 18 },
      { chave: "origem", titulo: "Origem", tipo: "texto", largura: 22 },
      { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 12 },
      { chave: "original", titulo: "Valor original", tipo: "dinheiro", somar: true, largura: 15 },
      { chave: "devido", titulo: "Devido", tipo: "dinheiro", somar: true, largura: 15 },
      { chave: "proposta", titulo: "Proposta", tipo: "dinheiro", somar: true, largura: 15 },
      { chave: "desconto", titulo: "Desconto", tipo: "texto", largura: 9 },
      { chave: "restricoes", titulo: "Restrições", tipo: "texto", largura: 22 },
      { chave: "acordo", titulo: "Acordo", tipo: "texto", largura: 10 },
    ],
    linhas: input.linhas.map((r) => {
      const devido = valorDevido(r);
      const d = descontoDaProposta(devido, r.propostaCents);
      return {
        code: r.code,
        devedor: r.clinicName,
        credor: r.supplierName,
        categoria: input.nomeDaCategoria(r.categoryId),
        contrato: [r.contractNumber, r.installmentLabel].filter(Boolean).join(" · ") || null,
        situacao: STATUS_LABELS[r.status],
        origem: ORIGIN_SHORT[r.origin],
        vencimento: r.dueDate,
        original: r.originalCents,
        devido,
        proposta: r.propostaCents,
        desconto: d === null ? null : d < 0 ? "maior" : `${Math.round(d * 100)}%`,
        restricoes: restricoes(r),
        acordo: r.acordo?.codigo ?? null,
      };
    }),
    notas: [
      "Devido = o que falta pagar nos títulos da dívida (com acordo, a parte dela nas parcelas); sem título, o valor atualizado ou o original.",
      "Economia e desconto só contam dívidas com proposta ativa: dívida sem proposta não é desconto de 100%.",
      "Os mesmos filtros, a mesma ordem e os mesmos totais da tela no momento em que foi gerado.",
    ],
    nomeDoArquivo: "levantamento-de-dividas",
  };
}
