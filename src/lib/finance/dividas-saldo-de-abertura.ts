// O SALDO DE ABERTURA DO PASSIVO (0406, fase 3 do Levantamento de Dívidas).
//
// Para o contador: por CNPJ, todas as dívidas de origem A (anteriores à
// implantação do riSZon), com credor, categoria e conta. É o que entra no
// balanço de abertura — e o que NÃO passa pela DRE (5.5.01 / 5.3.01).
//
// Puro e testado: a página de impressão e a planilha leem o mesmo modelo.

import type { RelatorioPronto } from "./relatorio";

export type DividaDoSaldo = {
  code: string;
  credor: string;
  documentoDoCredor: string | null;
  categoria: string | null;
  conta: string;
  nomeDaConta: string | null;
  contrato: string | null;
  emissao: string | null;
  vencimento: string;
  originalCents: number | null;
  /** O valor na implantação (atualizado), senão o original. */
  saldoCents: number;
  pagoCents: number;
  noFinanceiro: boolean;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Soma por chave, do maior para o menor (empate: pela chave). */
export function somaPor<T>(itens: T[], chave: (t: T) => string, valor: (t: T) => number): { chave: string; total: number }[] {
  const m = new Map<string, number>();
  for (const t of itens) m.set(chave(t), (m.get(chave(t)) ?? 0) + valor(t));
  return [...m.entries()]
    .map(([k, total]) => ({ chave: k, total }))
    .sort((a, b) => b.total - a.total || a.chave.localeCompare(b.chave));
}

export function relatorioDoSaldoDeAbertura(input: {
  devedor: string;
  cnpj: string | null;
  implantacao: string | null;
  dividas: DividaDoSaldo[];
  geradoEm: string;
  geradoPor: string;
  formatarData: (iso: string) => string;
}): RelatorioPronto {
  const d = input.dividas;
  const total = d.reduce((a, x) => a + x.saldoCents, 0);
  const pago = d.reduce((a, x) => a + x.pagoCents, 0);
  const porConta = somaPor(d, (x) => (x.nomeDaConta ? `${x.conta} · ${x.nomeDaConta}` : x.conta), (x) => x.saldoCents);
  const porCategoria = somaPor(d, (x) => x.categoria ?? "Sem categoria", (x) => x.saldoCents);
  const semTitulo = d.filter((x) => !x.noFinanceiro).length;
  const slug = input.devedor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return {
    titulo: "Saldo de abertura do passivo",
    subtitulo: `${input.devedor}${input.cnpj ? ` · CNPJ ${input.cnpj}` : ""}`,
    metadados: [
      { rotulo: "Implantação do riSZon", valor: input.implantacao ? input.formatarData(input.implantacao) : "não definida" },
      { rotulo: "Gerado em", valor: input.geradoEm },
      { rotulo: "Gerado por", valor: input.geradoPor },
    ],
    resumo: [
      { rotulo: "Dívidas anteriores à implantação", valor: String(d.length) },
      { rotulo: "Saldo na implantação", valor: brl(total) },
      ...porConta.map((c) => ({ rotulo: `Conta ${c.chave}`, valor: brl(c.total) })),
      ...porCategoria.map((c) => ({ rotulo: `Categoria ${c.chave}`, valor: brl(c.total) })),
      { rotulo: "Pago desde a implantação", valor: brl(pago) },
    ],
    situacao:
      semTitulo > 0
        ? `${semTitulo} ${semTitulo === 1 ? "dívida ainda não está" : "dívidas ainda não estão"} no Contas a Pagar da unidade.`
        : null,
    colunas: [
      { chave: "code", titulo: "Código", tipo: "texto", largura: 10 },
      { chave: "credor", titulo: "Credor", tipo: "texto", largura: 30 },
      { chave: "documento", titulo: "CNPJ/CPF do credor", tipo: "texto", largura: 20 },
      { chave: "categoria", titulo: "Categoria", tipo: "texto", largura: 22 },
      { chave: "conta", titulo: "Conta", tipo: "texto", largura: 28 },
      { chave: "contrato", titulo: "Contrato", tipo: "texto", largura: 16 },
      { chave: "emissao", titulo: "Emissão", tipo: "data", largura: 12 },
      { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 12 },
      { chave: "original", titulo: "Valor original", tipo: "dinheiro", somar: true, largura: 15 },
      { chave: "saldo", titulo: "Saldo na implantação", tipo: "dinheiro", somar: true, largura: 17 },
      { chave: "pago", titulo: "Pago depois", tipo: "dinheiro", somar: true, largura: 14 },
    ],
    linhas: [...d]
      .sort((a, b) => a.conta.localeCompare(b.conta) || a.credor.localeCompare(b.credor) || a.vencimento.localeCompare(b.vencimento))
      .map((x) => ({
        code: x.code,
        credor: x.credor,
        documento: x.documentoDoCredor,
        categoria: x.categoria,
        conta: x.nomeDaConta ? `${x.conta} · ${x.nomeDaConta}` : x.conta,
        contrato: x.contrato,
        emissao: x.emissao,
        vencimento: x.vencimento,
        original: x.originalCents,
        saldo: x.saldoCents,
        pago: x.pagoCents || null,
      })),
    notas: [
      "Só dívidas de origem A (anteriores à implantação). Não entram dívidas novas (B) nem vinculadas (C), nem as excluídas.",
      "O saldo de implantação não passa pela DRE: só juros, multa, descontos e custas posteriores entram no resultado.",
      "Contas e valores a validar com o contador.",
    ],
    nomeDoArquivo: `saldo-de-abertura-${slug || "devedor"}`,
  };
}
