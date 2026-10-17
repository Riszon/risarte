// O RELATÓRIO DE CONTAS PAGAS (relato OC-00110).
//
// A tela de Contas a pagar filtra pelo VENCIMENTO — é a pergunta "o que tenho
// de pagar?". O relatório responde a outra: "o que eu paguei, e quando?". Por
// isso o período aqui é a DATA DO PAGAMENTO, e cada linha é um pagamento (uma
// conta paga em duas vezes aparece duas vezes, cada uma no seu dia).
//
// Puro e testado: nada de banco, nada de React. Quem carrega é
// `src/app/(app)/financeiro/contas-a-pagar/pagas/dados.ts`; o PDF e a planilha
// leem o mesmo modelo (`relatorio.ts`).

import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { fileName } from "@/lib/print";
import { rotuloDaForma } from "@/lib/finance/formas-de-pagar";
import type { RelatorioPronto } from "@/lib/finance/relatorio";

export type PagamentoDeConta = {
  paidAt: string;
  supplierName: string | null;
  description: string;
  documentNumber: string | null;
  accountCode: string;
  accountName: string | null;
  dueDate: string | null;
  amountCents: number;
  /** Multa + juros pagos junto. */
  chargesCents: number;
  /** Desconto por pontualidade: abate a conta, mas NÃO sai do caixa. */
  discountCents: number;
  paymentMethod: string | null;
  /** O pagamento já foi casado com uma linha do extrato na Conciliação. */
  reconciled: boolean;
};

/** Saiu do caixa: o valor mais multa e juros. O desconto não é dinheiro. */
export function totalPago(p: Pick<PagamentoDeConta, "amountCents" | "chargesCents">): number {
  return p.amountCents + p.chargesCents;
}

const dataLegivel = (iso: string) => formatBrDate(`${iso}T12:00:00`);

export function rotuloDoPeriodoPago(de: string, ate: string): string {
  return `Pagamento de ${dataLegivel(de)} a ${dataLegivel(ate)}`;
}

export function relatorioDeContasPagas(input: {
  pagamentos: PagamentoDeConta[];
  unidade: string;
  de: string;
  ate: string;
  quem: string | null;
}): RelatorioPronto {
  const brl = (c: number) =>
    (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // O mais antigo primeiro: é a ordem do extrato do banco, com o qual se confere.
  const pagamentos = [...input.pagamentos].sort(
    (a, b) => a.paidAt.localeCompare(b.paidAt) || a.description.localeCompare(b.description)
  );
  const total = pagamentos.reduce((s, p) => s + totalPago(p), 0);
  const conciliados = pagamentos.filter((p) => p.reconciled).length;

  return {
    titulo: "Relatório de contas pagas",
    subtitulo: "Uma linha por pagamento, pela data em que foi pago",
    metadados: [
      { rotulo: "Unidade", valor: input.unidade },
      { rotulo: "Período", valor: rotuloDoPeriodoPago(input.de, input.ate) },
      { rotulo: "Gerado em", valor: formatBrDateTime(new Date()) },
      ...(input.quem ? [{ rotulo: "Gerado por", valor: input.quem }] : []),
    ],
    resumo: [
      { rotulo: "Pagamentos", valor: String(pagamentos.length) },
      { rotulo: "Total pago", valor: brl(total) },
      {
        rotulo: "Conferidos com o banco",
        valor: pagamentos.length === 0 ? "—" : `${conciliados} de ${pagamentos.length}`,
      },
    ],
    situacao: null,
    colunas: [
      { chave: "pagoEm", titulo: "Pago em", tipo: "data", largura: 12 },
      { chave: "fornecedor", titulo: "Fornecedor", tipo: "texto", largura: 26 },
      { chave: "descricao", titulo: "Descrição", tipo: "texto", largura: 34 },
      { chave: "conta", titulo: "Conta", tipo: "texto", largura: 28 },
      { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 12 },
      { chave: "forma", titulo: "Forma", tipo: "texto", largura: 14 },
      { chave: "valor", titulo: "Valor", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "encargos", titulo: "Multa e juros", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "desconto", titulo: "Desconto", tipo: "dinheiro", somar: true, largura: 12 },
      { chave: "total", titulo: "Total pago", tipo: "dinheiro", somar: true, largura: 14 },
      { chave: "banco", titulo: "Banco", tipo: "texto", largura: 14 },
    ],
    linhas: pagamentos.map((p) => ({
      pagoEm: p.paidAt,
      fornecedor: p.supplierName,
      descricao: p.documentNumber ? `${p.description} (doc. ${p.documentNumber})` : p.description,
      conta: p.accountName ? `${p.accountCode} · ${p.accountName}` : p.accountCode,
      vencimento: p.dueDate,
      forma: rotuloDaForma(p.paymentMethod),
      valor: p.amountCents,
      // ⚠️ Vazio é traço, nunca zero: zero diria "pagou multa de R$ 0,00".
      encargos: p.chargesCents > 0 ? p.chargesCents : null,
      desconto: p.discountCents > 0 ? p.discountCents : null,
      total: totalPago(p),
      banco: p.reconciled ? "Conciliado" : "Não conciliado",
    })),
    notas: [
      "O período é pela DATA DO PAGAMENTO, não pelo vencimento — a tela de Contas a pagar filtra pelo vencimento, que responde outra pergunta.",
      "Cada linha é um pagamento: conta paga em duas vezes aparece duas vezes. Pagamento estornado não entra.",
      "Total pago = valor + multa e juros: é o que saiu do caixa. O desconto por pontualidade abate a conta, mas não é dinheiro saindo.",
      "Banco \"Conciliado\" = o pagamento já foi casado com a linha do extrato na Conciliação. \"Não conciliado\" ainda não foi conferido com o banco.",
      "Na DRE, a despesa entra pela competência da conta (quando ela foi lançada), não pela data do pagamento.",
    ],
    nomeDoArquivo: fileName("risarte", "contas-pagas", input.unidade),
  };
}
