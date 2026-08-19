// FIN6.3 — A PONTE LUCRO × CAIXA.
//
// "Deu R$ 20 mil de lucro. Por que o caixa caiu?" É a pergunta que mais confunde
// quem olha os dois relatórios, e a resposta é sempre a mesma coisa: diferenças
// de tempo entre o fato e o dinheiro.
//
// A ponte FECHA POR CONSTRUÇÃO, não por estimativa. O banco classifica cada
// lançamento do período em três baldes — só competência, só caixa, ou os dois —
// e daí sai, exatamente:
//
//     variação do caixa = lucro − (só competência) + (só caixa)
//
// porque a parte que está nos dois lados é literalmente a mesma soma dos dois
// lados da conta. Por isso existe `residualCents`: se ele não for zero, é
// porque um lançamento escapou da classificação, e a tela mostra qual — em vez
// de fechar com uma linha "outros" que esconde erro.

export type BridgeSide = "lucro" | "dre_only" | "cash_only" | "caixa";

export type BridgeRow = {
  side: BridgeSide;
  accountCode: string;
  accountName: string;
  sourceType: string;
  /** Sinal pela direção: entrada soma, saída subtrai. */
  amountCents: number;
};

export type BridgeDetail = {
  accountCode: string;
  accountName: string;
  /** Já com o sinal do caminho lucro → caixa. */
  amountCents: number;
};

export type BridgeStep = {
  key: string;
  label: string;
  /** Já com o sinal do caminho lucro → caixa. */
  amountCents: number;
  details: BridgeDetail[];
};

export type Bridge = {
  lucroCents: number;
  caixaCents: number;
  steps: BridgeStep[];
  /** Tem de ser zero. Diferente de zero = lançamento não classificado. */
  residualCents: number;
};

/** Rótulo do passo, pela conta e pelo lado. Nada cai em "outros". */
function stepFor(
  side: "dre_only" | "cash_only",
  accountCode: string
): { key: string; label: string } {
  const code = accountCode ?? "";
  if (side === "dre_only") {
    if (code.startsWith("5.2")) {
      return { key: "depreciacao", label: "Depreciação — não sai do bolso" };
    }
    if (code.startsWith("1")) {
      return {
        key: "vendas_a_receber",
        label: "Vendas do período ainda não recebidas",
      };
    }
    return {
      key: "despesas_a_pagar",
      label: "Despesas do período ainda não pagas",
    };
  }
  if (code.startsWith("1")) {
    return {
      key: "recebimentos_anteriores",
      label: "Recebimentos de vendas de outros períodos",
    };
  }
  if (code.startsWith("5.1")) {
    return { key: "compra_bens", label: "Compra de bens — não é despesa" };
  }
  if (code.startsWith("5.3")) {
    return { key: "emprestimos", label: "Empréstimos (principal)" };
  }
  if (code.startsWith("5.4")) {
    return { key: "distribuicao", label: "Distribuição de lucros" };
  }
  if (code.startsWith("6")) {
    return { key: "estoque_ativo", label: "Estoque e outros ativos" };
  }
  return {
    key: "pagamentos_anteriores",
    label: "Pagamentos de contas de outros períodos",
  };
}

export function buildBridge(rows: BridgeRow[]): Bridge {
  const lucroCents = rows
    .filter((r) => r.side === "lucro")
    .reduce((s, r) => s + r.amountCents, 0);
  const caixaCents = rows
    .filter((r) => r.side === "caixa")
    .reduce((s, r) => s + r.amountCents, 0);

  const byKey = new Map<string, BridgeStep>();

  for (const r of rows) {
    if (r.side !== "dre_only" && r.side !== "cash_only") continue;
    // Está no lucro e não virou dinheiro → SAI do caminho. Virou dinheiro e não
    // está no lucro → ENTRA. É a única regra de sinal da ponte.
    const signed = r.side === "dre_only" ? -r.amountCents : r.amountCents;
    const { key, label } = stepFor(r.side, r.accountCode);

    const step = byKey.get(key) ?? { key, label, amountCents: 0, details: [] };
    step.amountCents += signed;
    const existing = step.details.find(
      (d) => d.accountCode === r.accountCode
    );
    if (existing) existing.amountCents += signed;
    else
      step.details.push({
        accountCode: r.accountCode,
        accountName: r.accountName || r.accountCode,
        amountCents: signed,
      });
    byKey.set(key, step);
  }

  const steps = [...byKey.values()]
    .filter((s) => s.amountCents !== 0 || s.details.length > 0)
    .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
  for (const s of steps) {
    s.details.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
  }

  const walked =
    lucroCents + steps.reduce((s, st) => s + st.amountCents, 0);

  return {
    lucroCents,
    caixaCents,
    steps,
    residualCents: caixaCents - walked,
  };
}
