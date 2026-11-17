/**
 * VD3-2 (0415) — O TEXTO DO TERMO DA VENDA DIRETA, montado pelo código (sem
 * modelo cadastrado), como o termo de renegociação (4017). Nasce como TEXTO
 * PROVISÓRIO (o PDF sai com a marca) até a revisão do dono / do jurídico
 * (decisão V3, docs/comercial/VENDA-DIRETA-V3-PLANO.md §7).
 *
 * Regra pura: testada em `venda-direta-termo.test.ts`.
 */
import type { TemplateBody } from "@/lib/signatures/types";
import { MEIO_DO_TERMO } from "@/lib/renegociacao/termo-texto";

export type ItemDoTermo = {
  descricao: string;
  quantidade: number;
  /** Valor final do item (já com o benefício do programa), em centavos. */
  valor: number;
};

export type ParcelaDoTermo = { vencimento: string; valor: number; meio: string | null };

export type DadosDoTermoDaVenda = {
  codigo: string | null;
  cliente: string;
  /** Quem assina no lugar do cliente (menor de idade): o responsável. */
  responsavel: string | null;
  unidade: string;
  /** 'aaaa-mm-dd'. */
  data: string;
  itens: ItemDoTermo[];
  subtotal: number;
  descontoDoPrograma: number;
  programa: string | null;
  desconto: number;
  acrescimo: number;
  total: number;
  meio: string | null;
  parcelas: ParcelaDoTermo[];
  cidade: string | null;
};

const brl = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** O meio em palavras (os mesmos rótulos do termo de renegociação). */
export function meioPorExtenso(meio: string | null): string {
  if (!meio) return "—";
  return MEIO_DO_TERMO[meio] ?? meio;
}

export function corpoDoTermoDaVenda(d: DadosDoTermoDaVenda): TemplateBody {
  const quem = d.responsavel
    ? `${d.responsavel}, responsável por ${d.cliente}`
    : d.cliente;
  const itens = d.itens
    .map(
      (i) =>
        `• ${i.descricao}${i.quantidade > 1 ? ` (×${i.quantidade})` : ""}: ${brl(i.valor)}`
    )
    .join("\n");
  const valores = [
    `Valor dos procedimentos: ${brl(d.subtotal)}`,
    d.descontoDoPrograma > 0
      ? `Benefício do programa${d.programa ? ` ${d.programa}` : ""}: − ${brl(d.descontoDoPrograma)}`
      : null,
    d.desconto > 0 ? `Desconto: − ${brl(d.desconto)}` : null,
    d.acrescimo > 0 ? `Acréscimo: ${brl(d.acrescimo)}` : null,
    `Total: ${brl(d.total)}`,
  ].filter(Boolean);
  const pagamento =
    d.total <= 0
      ? "Sem valor a pagar: o programa cobre os procedimentos."
      : d.parcelas.length <= 1
        ? `À vista, em ${meioPorExtenso(d.parcelas[0]?.meio ?? d.meio)}${d.parcelas[0] ? `, com vencimento em ${dataBr(d.parcelas[0].vencimento)}` : ""}.`
        : d.parcelas
            .map(
              (p, i) =>
                `• ${i + 1}ª parcela, vencimento ${dataBr(p.vencimento)}: ${brl(p.valor)} — ${meioPorExtenso(p.meio ?? d.meio)}`
            )
            .join("\n");
  return {
    preamble:
      `Termo de venda direta${d.codigo ? ` ${d.codigo}` : ""} entre ${d.unidade} e ${quem}, ` +
      `em ${dataBr(d.data)}. Venda feita na unidade, sem plano de tratamento.`,
    sections: [
      { title: "1. Os procedimentos", body: itens || "—" },
      { title: "2. Os valores", body: valores.join("\n") },
      { title: "3. A forma de pagamento", body: pagamento },
      {
        title: "4. A execução",
        body:
          "Os procedimentos são feitos pela equipe da unidade, no atendimento marcado ou no mesmo dia. " +
          "Qualquer procedimento a mais é combinado à parte, com novo termo.",
      },
      {
        title: "5. A desistência",
        body:
          "Se desistir antes da execução, o valor pago é devolvido, descontado o que já tiver sido feito. " +
          "Depois de executado, o procedimento não é devolvido.",
      },
      {
        title: "6. O atraso",
        body:
          "A parcela paga com atraso tem a multa e os juros previstos na regra da unidade.",
      },
      {
        title: "7. O foro",
        body: `Fica eleito o foro da comarca de ${d.cidade?.trim() || "sede da unidade"} para resolver qualquer questão deste termo.`,
      },
    ],
    closing: "E, por estarem de acordo, as partes assinam este termo eletronicamente.",
  };
}

export type SituacaoDoTermo =
  /** Sem termo enviado (ou o último acabou sem assinatura). */
  | "sem_termo"
  /** Enviado, esperando o cliente. */
  | "aguardando"
  | "assinado_digital"
  | "assinado_papel"
  /** A venda foi assinada antes da 0415 (sem origem) ou é de R$ 0,00. */
  | "assinado";

/** Em que ponto o termo está — a caixa "Termo" do caixa se desenha por isto. */
export function situacaoDoTermo(v: {
  contractSigned: boolean;
  contractSignedSource: string | null;
  packageStatus: string | null;
}): SituacaoDoTermo {
  if (v.contractSigned) {
    if (v.contractSignedSource === "assinatura_digital") return "assinado_digital";
    if (v.contractSignedSource === "papel") return "assinado_papel";
    return "assinado";
  }
  if (v.packageStatus && ["draft", "sent", "partially_signed"].includes(v.packageStatus))
    return "aguardando";
  return "sem_termo";
}

/** Por que o último termo acabou sem assinatura (para a frase da tela). */
export function fimDoTermo(packageStatus: string | null): string | null {
  if (packageStatus === "refused") return "O cliente recusou o termo na ZapSign.";
  if (packageStatus === "expired") return "O link do termo venceu sem assinatura.";
  if (packageStatus === "cancelled") return "O termo foi cancelado.";
  return null;
}
