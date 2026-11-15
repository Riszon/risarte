/**
 * 4017 (19.28) — O TEXTO DO TERMO DE RENEGOCIAÇÃO, montado pelo código (sem
 * modelo cadastrado). Nasce como TEXTO PROVISÓRIO, como os outros modelos das
 * Assinaturas, até a revisão do jurídico.
 */
import type { TemplateBody } from "@/lib/signatures/types";

export type ParcelaAntiga = { seq: number | null; vencimento: string; valor: number; venda: string | null };
export type ParcelaNova = { vencimento: string; valor: number; meio: string; descricao?: string | null };

export type DadosDoTermo = {
  codigo: string | null;
  cliente: string;
  pagador: string | null;
  unidade: string;
  calculadoEm: string;
  prazo: string;
  antigas: ParcelaAntiga[];
  principal: number;
  beneficio: number;
  multa: number;
  juros: number;
  desconto: number;
  novoTotal: number;
  jurosAoMes: number;
  novas: ParcelaNova[];
};

export const MEIO_DO_TERMO: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  cartao: "Cartão de crédito à vista",
  cartao_parcelado_asaas: "Cartão de crédito parcelado",
  cartao_parcelado: "Cartão parcelado (maquininha)",
  dinheiro: "Dinheiro",
  permuta: "Permuta",
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** A frase da 19.28.10, ponto 2 (aprovada): os boletos atuais valem até a assinatura. */
export const FRASE_DA_ESPERA =
  "Até você assinar, os boletos atuais continuam valendo. Se pagar algum deles antes de assinar, o acordo é cancelado e refeito.";

export function corpoDoTermo(d: DadosDoTermo): TemplateBody {
  const quem = d.pagador ? `${d.pagador}, responsável financeiro de ${d.cliente}` : d.cliente;
  const antigas = d.antigas
    .map((p) => `• Parcela ${p.seq ?? "—"}${p.venda ? ` (${p.venda})` : ""}, vencimento ${data(p.vencimento)}: ${brl(p.valor)}`)
    .join("\n");
  const novas = d.novas
    .map((p, i) => `• ${i + 1}ª, vencimento ${data(p.vencimento)}: ${brl(p.valor)} — ${MEIO_DO_TERMO[p.meio] ?? p.meio}${p.descricao ? ` (${p.descricao})` : ""}`)
    .join("\n");
  const linhas = [
    `Valor em aberto: ${brl(d.principal)}`,
    d.beneficio > 0 ? `Benefício de pontualidade perdido: ${brl(d.beneficio)}` : null,
    d.multa > 0 ? `Multa por atraso: ${brl(d.multa)}` : null,
    d.juros > 0 ? `Juros por atraso: ${brl(d.juros)}` : null,
    d.desconto > 0 ? `Desconto concedido: ${brl(d.desconto)}` : null,
    d.desconto < 0 ? `Juros do novo parcelamento: ${brl(-d.desconto)}` : null,
    `Novo total: ${brl(d.novoTotal)}`,
  ].filter(Boolean);
  return {
    preamble:
      `Termo de renegociação${d.codigo ? ` ${d.codigo}` : ""} entre ${d.unidade} e ${quem}. ` +
      `Os valores abaixo foram calculados em ${data(d.calculadoEm)} e não mudam até a assinatura.`,
    sections: [
      { title: "1. As parcelas que este acordo substitui", body: antigas || "—" },
      { title: "2. Os valores", body: linhas.join("\n") },
      {
        title: "3. As novas parcelas",
        body: novas + (d.jurosAoMes > 0 ? `\nJuros do parcelamento: ${d.jurosAoMes.toLocaleString("pt-BR")}% ao mês.` : ""),
      },
      {
        title: "4. Até a assinatura",
        body: `${FRASE_DA_ESPERA}\nEste termo vale para assinatura até ${data(d.prazo)}. Depois dessa data, ele perde a validade e nada muda nas parcelas atuais.`,
      },
      {
        title: "5. Depois da assinatura",
        body:
          "As parcelas do item 1 deixam de valer e os boletos delas são cancelados. As novas parcelas passam a valer nas datas do item 3, com a multa e os juros de atraso de qualquer parcela, se atrasarem.",
      },
    ],
    closing: "E, por estarem de acordo, as partes assinam este termo eletronicamente.",
  };
}
