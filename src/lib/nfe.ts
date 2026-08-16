// Leitura do XML da NF-e.
//
// O PROBLEMA NÃO É LER A NOTA, É SABER QUE ITEM É AQUELE. O fornecedor escreve
// `RESINA COMP Z350XT A2 4G 3M`; no cadastro está `Resina composta A2`. Nenhuma
// regra de texto faz um virar o outro — e casar por nome é a maneira certa de
// gravar material errado dando baixa em procedimento errado.
//
// Por isso o casamento usa CÓDIGO, nunca nome:
//   1. GTIN — identifica o produto no mundo (atravessa fornecedores).
//   2. CNPJ + código do produto — identifica o item naquele fornecedor.
//   3. Descrição — só para SUGERIR, e a sugestão sempre espera confirmação.
//
// A extração do XML em si é mecânica e roda no navegador (DOMParser nativo, sem
// dependência nova). O que mora aqui e é testado é o que carrega risco: número,
// chave, GTIN e o casamento.

import { roundHalfUp } from "./finance/money";

export type NfeLine = {
  /** `cProd` — código do produto NO FORNECEDOR. */
  supplierCode: string;
  /** `xProd` — a descrição dele. Serve para ler, não para casar. */
  description: string;
  /** `cEAN` — código de barras, quando existe. */
  gtin: string;
  /** `uCom` — unidade comercial do fornecedor (CX, UN, FR). */
  unit: string;
  /** `qCom` — quantidade em unidades DE COMPRA. */
  quantity: number;
  /** `vUn`/`vProd` já convertidos para centavos. */
  unitCostCents: number;
  totalCents: number;
};

export type NfeInvoice = {
  /** `chNFe` — 44 dígitos, identifica a nota no país. */
  key: string;
  number: string;
  issueDate: string;
  supplierCnpj: string;
  supplierName: string;
  totalCents: number;
  lines: NfeLine[];
  /** As duplicatas: é daqui que saem os vencimentos. */
  installments: { dueDate: string; amountCents: number }[];
};

/** Só dígitos — a mesma convenção das máscaras do sistema. */
export function digits(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * A chave da NF-e tem exatamente 44 dígitos. É ela que impede a mesma nota de
 * entrar duas vezes — e uma nota importada em duplicidade dobraria o estoque E
 * a conta a pagar de uma vez só.
 */
export function isValidNfeKey(key: string): boolean {
  return digits(key).length === 44;
}

/**
 * GTIN válido tem 8, 12, 13 ou 14 dígitos E dígito verificador correto.
 *
 * Validar importa: a NF-e aceita "SEM GTIN" no campo, e alguns emissores põem
 * lixo ali. Um GTIN inválido virando chave de casamento amarraria dois produtos
 * diferentes ao mesmo item — o pior erro possível aqui, porque é silencioso.
 */
export function isValidGtin(value: string): boolean {
  const d = digits(value);
  if (![8, 12, 13, 14].includes(d.length)) return false;

  const body = d.slice(0, -1).split("").reverse();
  const check = Number(d[d.length - 1]);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Valor do XML (ponto decimal, sempre) para centavos. */
export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return 0;
  return roundHalfUp(n * 100);
}

export type MatchSource = "gtin" | "fornecedor" | "sugestao" | null;

export type LineMatch = {
  supplierCode: string;
  itemId: string | null;
  matchedBy: MatchSource;
};

/**
 * Casa as linhas da nota com os nossos itens.
 *
 * A ordem é o desenho inteiro: GTIN vence, porque vale entre fornecedores;
 * depois o vínculo daquele fornecedor. A sugestão por descrição NUNCA vira
 * casamento automático — ela só aponta um candidato para alguém confirmar. É a
 * confirmação que cria o vínculo, e é por isso que o sistema acerta mais a cada
 * nota em vez de errar mais.
 */
export function matchLines(
  lines: NfeLine[],
  known: {
    byGtin: Record<string, string>;
    bySupplierCode: Record<string, string>;
  }
): LineMatch[] {
  return lines.map((l) => {
    const gtin = digits(l.gtin);
    if (gtin && isValidGtin(gtin) && known.byGtin[gtin]) {
      return { supplierCode: l.supplierCode, itemId: known.byGtin[gtin], matchedBy: "gtin" };
    }
    const linked = known.bySupplierCode[l.supplierCode];
    if (linked) {
      return { supplierCode: l.supplierCode, itemId: linked, matchedBy: "fornecedor" };
    }
    return { supplierCode: l.supplierCode, itemId: null, matchedBy: null };
  });
}

/** Normaliza para comparar descrição: sem acento, sem pontuação, minúsculo. */
export function normalize(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Candidato por descrição, para a PRIMEIRA vez.
 *
 * Conta quantas palavras da descrição do fornecedor aparecem no nome do item.
 * É grosseiro de propósito: serve para poupar rolagem, não para decidir. Por
 * isso devolve pontuação e exige um mínimo — sugestão fraca demais é pior que
 * sugestão nenhuma, porque convida a confirmar sem olhar.
 */
export function suggestItem(
  description: string,
  items: { id: string; name: string; brand?: string }[]
): { itemId: string; score: number } | null {
  const words = normalize(description).split(" ").filter((w) => w.length >= 3);
  if (words.length === 0) return null;

  let best: { itemId: string; score: number } | null = null;
  for (const item of items) {
    const hay = normalize(`${item.name} ${item.brand ?? ""}`);
    const hits = words.filter((w) => hay.includes(w)).length;
    const score = hits / words.length;
    if (score > (best?.score ?? 0)) best = { itemId: item.id, score };
  }

  // Menos de 40% das palavras batendo não é pista, é ruído.
  return best && best.score >= 0.4 ? best : null;
}

/** Erros que impedem importar. Vazio = a nota pode ser conferida na tela. */
export function invoiceErrors(invoice: NfeInvoice): string[] {
  const errors: string[] = [];
  if (!isValidNfeKey(invoice.key)) {
    errors.push("Não encontrei a chave da NF-e (44 dígitos) neste arquivo.");
  }
  if (digits(invoice.supplierCnpj).length !== 14) {
    errors.push("Não encontrei o CNPJ do fornecedor.");
  }
  if (invoice.lines.length === 0) {
    errors.push("A nota não tem itens.");
  }
  const soma = invoice.lines.reduce((s, l) => s + l.totalCents, 0);
  if (invoice.totalCents > 0 && Math.abs(soma - invoice.totalCents) > 100) {
    // Mais de R$ 1,00 de diferença entre a soma das linhas e o total da nota
    // significa que li o arquivo errado — melhor recusar que gravar torto.
    errors.push(
      "A soma dos itens não bate com o total da nota — confira o arquivo."
    );
  }
  return errors;
}
