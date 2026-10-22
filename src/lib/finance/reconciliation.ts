// FIN4a — conciliação bancária. Leitura do extrato (OFX e CSV) e casamento
// com os lançamentos do razão.
//
// O leitor é a parte arriscada do FIN4: banco brasileiro exporta CSV de mil
// jeitos, com vírgula ou ponto e vírgula, data em dd/mm/aaaa e valor em
// 1.234,56. Por isso ele vive aqui, isolado e testado — nunca dentro de tela.

export type BankTxKind = "credit" | "debit";

export type ParsedBankTx = {
  /** Identificador do banco (OFX). Sem ele, a proteção é data+valor+texto. */
  fitId: string | null;
  /** YYYY-MM-DD. */
  postedAt: string;
  /** Centavos COM SINAL: negativo = saída da conta. */
  amountCents: number;
  description: string;
  kind: BankTxKind;
};

export type ParseResult = {
  transactions: ParsedBankTx[];
  /** Linhas que não deu para ler — o usuário precisa saber, não sumir. */
  skipped: number;
  errors: string[];
  /**
   * A conta que o próprio arquivo diz pertencer (`BANKACCTFROM` do OFX).
   * É o que impede importar o extrato do banco A na conta B — o erro que
   * duplicou lançamento no teste do dono (05/08/2026).
   */
  statementAccountId: string | null;
};

// ---------------------------------------------------------------------------
// Valores e datas
// ---------------------------------------------------------------------------
/**
 * Valor em centavos, com sinal. Aceita os formatos que aparecem de verdade:
 * `-150.00`, `1.234,56`, `1,234.56`, `R$ 90,00`, `(150,00)` (parênteses = saída).
 *
 * A regra do separador decimal: quando há ponto E vírgula, **o último manda**.
 * Com só um deles, é decimal se sobrarem 1 ou 2 dígitos; senão é milhar
 * (`1.234` é mil duzentos e trinta e quatro, não um vírgula dois).
 */
export function parseAmountCents(raw: string): number | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  const negativeByParens = /^\(.*\)$/.test(text);
  if (negativeByParens) text = text.slice(1, -1);

  text = text.replace(/R\$/gi, "").replace(/\s/g, "");
  const negative = negativeByParens || text.includes("-");
  text = text.replace(/[-+]/g, "");
  if (!/[\d]/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const after = text.length - text.lastIndexOf(sep) - 1;
    decimalSep = after > 0 && after <= 2 ? sep : null;
  }

  let intPart: string;
  let decPart = "";
  if (decimalSep) {
    const idx = text.lastIndexOf(decimalSep);
    intPart = text.slice(0, idx);
    decPart = text.slice(idx + 1);
  } else {
    intPart = text;
  }
  intPart = intPart.replace(/[^\d]/g, "");
  decPart = decPart.replace(/[^\d]/g, "").padEnd(2, "0").slice(0, 2);
  if (!intPart && !decPart) return null;

  const cents = Number(intPart || "0") * 100 + Number(decPart || "0");
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * A data existe no calendário? "2026-14-10" (dia e mês trocados) e
 * "2026-02-30" não existem — e o banco recusa a importação INTEIRA por uma
 * linha assim, com uma mensagem que a tela não sabe explicar (OC-00103).
 * Melhor a linha ficar de fora, contada entre as ignoradas.
 */
function dataQueExiste(y: string, m: string, d: string): string | null {
  const [ano, mes, dia] = [Number(y), Number(m), Number(d)];
  const x = new Date(Date.UTC(ano, mes - 1, dia));
  if (x.getUTCFullYear() !== ano || x.getUTCMonth() !== mes - 1 || x.getUTCDate() !== dia) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

/** Data em YYYY-MM-DD a partir de dd/mm/aaaa, aaaa-mm-dd ou aaaammdd (OFX). */
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return dataQueExiste(iso[1], iso[2], iso[3]);

  const br = text.match(/^(\d{2})[/.](\d{2})[/.](\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return dataQueExiste(year, br[2], br[1]);
  }

  // OFX: 20260804 ou 20260804120000[-3:BRT]
  const ofx = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) return dataQueExiste(ofx[1], ofx[2], ofx[3]);

  return null;
}

/**
 * Tira da descrição os caracteres invisíveis de controle (o nulo, sobretudo):
 * o banco recusa o nulo e derrubaria a importação inteira por ele (OC-00103).
 */
export function limparDescricao(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out += c < 32 || (c >= 127 && c < 160) ? " " : ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * O texto do arquivo, na codificação em que ele veio (OC-00103). Banco
 * brasileiro costuma exportar em Latin-1 (windows-1252), mas o Inter exporta
 * em UTF-8 — e ler UTF-8 como Latin-1 estraga todo acento ("Transferência"
 * vira "TransferÃªncia"). Tenta UTF-8 a sério (recusa qualquer byte inválido);
 * se não for, é Latin-1. Um arquivo Latin-1 com acento quase nunca é UTF-8
 * válido por acaso.
 */
export function decodeStatement(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// OFX
// ---------------------------------------------------------------------------
function tagValue(block: string, tag: string): string {
  // OFX raramente fecha as tags: o valor vai até o fim da linha ou a próxima tag.
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

/**
 * Lê um extrato OFX. É o formato preferido porque traz `FITID` — o
 * identificador único do lançamento no banco, que impede duplicar quando o
 * mesmo arquivo é importado de novo.
 */
export function parseOfx(content: string): ParseResult {
  const transactions: ParsedBankTx[] = [];
  const errors: string[] = [];
  let skipped = 0;

  // De qual conta é este extrato — o próprio arquivo diz.
  const from = content.match(/<BANKACCTFROM>[\s\S]*?(?=<\/BANKACCTFROM>|<BANKTRANLIST>)/i);
  const statementAccountId = from
    ? tagValue(from[0], "ACCTID").replace(/\D/g, "") || null
    : null;

  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  if (blocks.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      errors: ["Não encontrei lançamentos neste arquivo OFX."],
      statementAccountId,
    };
  }

  for (const block of blocks) {
    const postedAt = parseDate(tagValue(block, "DTPOSTED"));
    const amountCents = parseAmountCents(tagValue(block, "TRNAMT"));
    if (!postedAt || amountCents === null || amountCents === 0) {
      skipped += 1;
      continue;
    }
    const memo = tagValue(block, "MEMO") || tagValue(block, "NAME");
    transactions.push({
      fitId: tagValue(block, "FITID") || null,
      postedAt,
      amountCents,
      description: limparDescricao(memo) || "(sem descrição)",
      kind: amountCents < 0 ? "debit" : "credit",
    });
  }

  if (skipped > 0) {
    errors.push(`${skipped} lançamento(s) sem data ou valor foram ignorados.`);
  }
  return { transactions, skipped, errors, statementAccountId };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Sem acento e em minúsculas — cabeçalho de CSV varia demais para comparar cru. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Lê um extrato CSV. Sem `FITID`, a proteção contra duplicidade passa a ser
 * data + valor + descrição — por isso o OFX é preferido quando existe.
 *
 * Descobre o separador (`;` ou `,`) e as colunas pelo cabeçalho (data,
 * histórico/descrição, valor). Sem cabeçalho reconhecível, assume a ordem
 * data · descrição · valor. Banco que separa entrada e saída em duas colunas
 * (crédito/débito) também é aceito.
 */
export function parseCsv(content: string): ParseResult {
  const transactions: ParsedBankTx[] = [];
  const errors: string[] = [];
  let skipped = 0;

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      errors: ["Arquivo vazio."],
      statementAccountId: null,
    };
  }

  // O separador é o que aparece mais na primeira linha com conteúdo.
  const sep = (lines[0].match(/;/g)?.length ?? 0) >=
    (lines[0].match(/,/g)?.length ?? 0)
    ? ";"
    : ",";

  let dateCol = 0;
  let descCol = 1;
  let valueCol = 2;
  let creditCol = -1;
  let debitCol = -1;
  let startRow = 0;

  const header = splitCsvLine(lines[0], sep).map(normalize);
  const looksLikeHeader = header.some((h) => h.includes("data"));
  if (looksLikeHeader) {
    startRow = 1;
    header.forEach((h, i) => {
      if (h.includes("data") && dateCol === 0) dateCol = i;
      if (
        h.includes("histor") ||
        h.includes("descri") ||
        h.includes("lancamento") ||
        h.includes("memo")
      ) {
        descCol = i;
      }
      if (h.includes("credito") || h.includes("entrada")) creditCol = i;
      else if (h.includes("debito") || h.includes("saida")) debitCol = i;
      else if (h.includes("valor") || h.includes("montante")) valueCol = i;
    });
    if (!header.some((h) => h.includes("data"))) dateCol = 0;
  }

  for (let i = startRow; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], sep);
    if (cols.length < 2) {
      skipped += 1;
      continue;
    }
    const postedAt = parseDate(cols[dateCol] ?? "");
    let amountCents: number | null = null;

    if (creditCol >= 0 || debitCol >= 0) {
      const credit = parseAmountCents(cols[creditCol] ?? "") ?? 0;
      const debit = parseAmountCents(cols[debitCol] ?? "") ?? 0;
      amountCents = Math.abs(credit) - Math.abs(debit);
    } else {
      amountCents = parseAmountCents(cols[valueCol] ?? "");
    }

    if (!postedAt || amountCents === null || amountCents === 0) {
      skipped += 1;
      continue;
    }
    transactions.push({
      fitId: null,
      postedAt,
      amountCents,
      description: limparDescricao(cols[descCol] ?? "") || "(sem descrição)",
      kind: amountCents < 0 ? "debit" : "credit",
    });
  }

  if (skipped > 0) {
    errors.push(
      `${skipped} linha(s) sem data ou valor foram ignoradas (cabeçalho, saldo, totais).`
    );
  }
  // CSV não diz de qual conta é — por isso a trava contra importar o mesmo
  // extrato em duas contas depende da checagem no banco.
  return { transactions, skipped, errors, statementAccountId: null };
}

/** Escolhe o leitor pelo conteúdo, não pela extensão do arquivo. */
export function parseStatement(content: string): ParseResult & {
  format: "ofx" | "csv";
} {
  const isOfx = /<STMTTRN>/i.test(content) || /<OFX>/i.test(content);
  return isOfx
    ? { ...parseOfx(content), format: "ofx" }
    : { ...parseCsv(content), format: "csv" };
}

// ---------------------------------------------------------------------------
// Casamento com o razão
// ---------------------------------------------------------------------------
export type LedgerEntry = {
  id: string;
  /** Centavos COM SINAL, do ponto de vista da conta: negativo = saída. */
  amountCents: number;
  cashDate: string;
  description: string;
  accountCode: string;
  reconciled: boolean;
  /** AP51: a conta em que o dinheiro está (nulo = antes da 0317 / sem conta). */
  bankAccountId?: string | null;
};

export type MatchCandidate = {
  entry: LedgerEntry;
  /** 0 a 100 — quanto maior, mais provável. */
  score: number;
  sameDay: boolean;
};

const MATCH_WINDOW_DAYS = 5;

function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(
    Math.round(
      (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000
    )
  );
}

/**
 * Sugere o lançamento que corresponde à linha do extrato.
 *
 * **O valor tem de bater exatamente** — conciliação não é aproximação. O que
 * varia é a data: o banco registra no dia em que compensou, e o sistema no dia
 * em que a pessoa deu baixa. Por isso a janela de {@link MATCH_WINDOW_DAYS}
 * dias, com o mesmo dia valendo mais.
 */
export function suggestMatches(
  tx: Pick<ParsedBankTx, "amountCents" | "postedAt" | "description">,
  entries: LedgerEntry[]
): MatchCandidate[] {
  return entries
    .filter((e) => !e.reconciled && e.amountCents === tx.amountCents)
    .map((e) => {
      const distance = daysApart(e.cashDate, tx.postedAt);
      const sameDay = distance === 0;
      // Texto parecido desempata quando há duas contas do mesmo valor no dia.
      const a = normalize(e.description);
      const b = normalize(tx.description);
      const textual =
        a && b && (a.includes(b) || b.includes(a)) ? 15 : 0;
      return {
        entry: e,
        sameDay,
        score: Math.max(0, 100 - distance * 12) + textual,
      };
    })
    .filter((c) => daysApart(c.entry.cashDate, tx.postedAt) <= MATCH_WINDOW_DAYS)
    .sort((x, y) => y.score - x.score);
}

export const RECONCILIATION_STATUSES = [
  "pendente",
  "conciliado",
  "ignorado",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const RECONCILIATION_STATUS_LABELS: Record<
  ReconciliationStatus,
  string
> = {
  pendente: "Pendente",
  conciliado: "Conciliado",
  ignorado: "Ignorado",
};

export type ReconciliationSummary = {
  /** Saldo do banco: abertura + tudo que o extrato trouxe. */
  bankBalanceCents: number;
  /** Saldo do sistema: abertura + lançamentos com caixa na conta. */
  systemBalanceCents: number;
  /** Banco − sistema. Zero = fechado. */
  differenceCents: number;
  pendingCount: number;
  reconciledCount: number;
  ignoredCount: number;
  /** Lançamentos do sistema que o extrato não trouxe. */
  unmatchedEntryCount: number;
};

// ---------------------------------------------------------------------------
// Uma linha, vários lançamentos — e a transferência (OC-00108)
// ---------------------------------------------------------------------------
/**
 * A conta das aplicações e transferências entre contas da própria clínica
 * (resgate, aplicação, transferência). Grupo 6: fica FORA da DRE — não é
 * receita nem despesa; no fluxo de caixa conta como investimento (0301).
 */
export const CONTA_DE_TRANSFERENCIA = "6.3.01";

/**
 * Os lançamentos que podem entrar numa conciliação de VÁRIOS: ainda sem par,
 * até `dias` da data da linha (o depósito da maquininha cai dias depois da
 * venda). Os mais perto da data primeiro.
 */
export function candidatosParaVarios(
  tx: Pick<ParsedBankTx, "postedAt">,
  entries: LedgerEntry[],
  dias = 7
): LedgerEntry[] {
  return entries
    .filter((e) => !e.reconciled && daysApart(e.cashDate, tx.postedAt) <= dias)
    .sort(
      (a, b) =>
        daysApart(a.cashDate, tx.postedAt) - daysApart(b.cashDate, tx.postedAt) ||
        a.cashDate.localeCompare(b.cashDate)
    );
}

/**
 * A soma dos escolhidos do ponto de vista da conta: entradas − saídas. É o
 * que tem de bater com a linha — o depósito líquido do cartão = recebimentos
 * − taxas. O banco confere a mesma conta (`reconcile_bank_transaction_multi`).
 */
export function somaDosLancamentos(escolhidos: Pick<LedgerEntry, "amountCents">[]): number {
  return escolhidos.reduce((s, e) => s + e.amountCents, 0);
}

// ---------------------------------------------------------------------------
// A conciliação e as contas a pagar — e em que mês o lançamento entra (OC-00110)
// ---------------------------------------------------------------------------
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * O mês da DRE em que entra o lançamento criado pela linha do extrato: o mês
 * da LINHA, não o de hoje (a competência nasce na data do extrato). Foi o que
 * gerou o relato: lançado em outubro, com extrato de setembro, procurado na
 * DRE de outubro.
 */
export function mesDaDre(iso: string): string {
  const [ano, mes] = iso.split("-");
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

/** Uma conta a pagar ainda em aberto, como a conciliação precisa dela. */
export type ContaEmAberto = {
  id: string;
  description: string;
  supplierName: string | null;
  accountCode: string;
  dueDate: string;
  /** O que falta pagar (positivo). */
  balanceCents: number;
};

/**
 * As contas a pagar que essa linha de SAÍDA pode quitar: em aberto e com o
 * saldo EXATO da linha. Valor diferente (multa, juros, pagamento parcial) não
 * entra — paga-se em Contas a pagar e casa-se por "Vários". O banco confere a
 * mesma regra (`pay_payable_from_bank_transaction`, 0302). As de vencimento
 * mais perto da data da linha primeiro.
 */
export function contasDoValor(
  tx: Pick<ParsedBankTx, "postedAt" | "amountCents">,
  contas: ContaEmAberto[]
): ContaEmAberto[] {
  if (tx.amountCents >= 0) return [];
  return contas
    .filter((c) => c.balanceCents > 0 && c.balanceCents === -tx.amountCents)
    .sort(
      (a, b) =>
        daysApart(a.dueDate, tx.postedAt) - daysApart(b.dueDate, tx.postedAt) ||
        a.dueDate.localeCompare(b.dueDate)
    );
}

export function summarizeReconciliation(input: {
  openingBalanceCents: number;
  transactions: { amountCents: number; status: ReconciliationStatus }[];
  entries: LedgerEntry[];
}): ReconciliationSummary {
  let bank = input.openingBalanceCents;
  let pending = 0;
  let reconciled = 0;
  let ignored = 0;

  for (const t of input.transactions) {
    // Ignorado não entra no saldo do banco: é linha que o usuário disse que
    // não pertence a esta conciliação (linha repetida, lançamento que o banco
    // desfez). Transferência entre contas próprias NÃO vem para cá: ela tem
    // botão próprio e fica no saldo (OC-00108).
    if (t.status === "ignorado") {
      ignored += 1;
      continue;
    }
    bank += t.amountCents;
    if (t.status === "conciliado") reconciled += 1;
    else pending += 1;
  }

  const system =
    input.openingBalanceCents +
    input.entries.reduce((s, e) => s + e.amountCents, 0);

  return {
    bankBalanceCents: bank,
    systemBalanceCents: system,
    differenceCents: bank - system,
    pendingCount: pending,
    reconciledCount: reconciled,
    ignoredCount: ignored,
    unmatchedEntryCount: input.entries.filter((e) => !e.reconciled).length,
  };
}
