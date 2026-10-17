// AS FORMAS DE PAGAR UMA CONTA (OC-00109). Uma lista só, usada pela baixa em
// Contas a pagar e pela importação da nota fiscal — dois nomes para a mesma
// forma viram duas formas no relatório. O banco conhece os mesmos códigos
// (`stock_purchase_payable_description`, 0300).

export const FORMAS_DE_PAGAR = [
  { value: "pix", label: "PIX" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "debito_automatico", label: "Débito automático" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
] as const;

export type FormaDePagar = (typeof FORMAS_DE_PAGAR)[number]["value"];

export function rotuloDaForma(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return FORMAS_DE_PAGAR.find((f) => f.value === valor)?.label ?? valor;
}

/**
 * A forma de pagamento que a própria NF-e declara (`<tPag>`, tabela da SEFAZ),
 * traduzida para as nossas. É SUGESTÃO para quem importa — a pessoa confere.
 * Código que não temos (crédito loja, vale, "sem pagamento", "outros") não
 * sugere nada: melhor a caixa vazia que um palpite com cara de certeza.
 */
export function formaDaNota(tPag: string | null | undefined): FormaDePagar | null {
  switch ((tPag ?? "").trim()) {
    case "01":
      return "dinheiro";
    case "03": // cartão de crédito
    case "04": // cartão de débito
      return "cartao";
    case "15":
      return "boleto";
    case "16": // depósito bancário
    case "18": // transferência bancária / carteira digital
      return "transferencia";
    case "17":
      return "pix";
    default:
      return null;
  }
}
