import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAIXA,
  contaPadrao,
  contaPrincipal,
  erroDaConta,
  lancamentosDaConta,
  lancamentosSemConta,
  opcoesDeConta,
  portaAusente,
  type ContaDaUnidade,
} from "@/lib/finance/conta-do-dinheiro";
import { summarizeReconciliation } from "@/lib/finance/reconciliation";

// AP51 (0317) — em qual conta o dinheiro entrou ou saiu. A regra mora no
// banco (gatilho `financial_entry_bank_account`); aqui está o espelho que a
// tela usa para preencher o campo e separar a Conciliação por conta.

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const U = "unidade-1";
const conta = (p: Partial<ContaDaUnidade>): ContaDaUnidade => ({
  id: "x",
  clinicId: U,
  alias: "Conta",
  kind: "corrente",
  active: true,
  isDefault: false,
  ...p,
});

describe("a conta principal (L2)", () => {
  it("é a marcada; sem marca, a única conta bancária; senão nenhuma", () => {
    const a = conta({ id: "a", alias: "Banco A" });
    const b = conta({ id: "b", alias: "Banco B", kind: "aplicacao" });
    const cx = conta({ id: "cx", alias: "Caixa (dinheiro)", kind: "caixa" });
    expect(contaPrincipal([a, cx], U)?.id).toBe("a");
    expect(contaPrincipal([a, b, cx], U)).toBeNull();
    expect(contaPrincipal([a, { ...b, isDefault: true }], U)?.id).toBe("b");
    // O Caixa nunca é principal, nem sendo a única conta.
    expect(contaPrincipal([cx], U)).toBeNull();
    // Conta inativa e de outra unidade não contam.
    expect(contaPrincipal([{ ...a, active: false }, conta({ id: "o", clinicId: "outra" })], U)).toBeNull();
  });

  it("dinheiro vem com o Caixa; o resto com a principal; sem principal, o banco decide", () => {
    const a = conta({ id: "a", isDefault: true });
    expect(contaPadrao([a], U, "dinheiro")).toBe(CAIXA);
    expect(contaPadrao([a], U, "pix")).toBe("a");
    expect(contaPadrao([a], U, "cartao")).toBe("a");
    expect(contaPadrao([], U, "pix")).toBe("");
  });
});

describe("as opções do campo", () => {
  it("as contas bancárias (a principal primeiro e marcada) + o Caixa, sempre", () => {
    const o = opcoesDeConta(
      [
        conta({ id: "z", alias: "Z Aplicação", kind: "aplicacao" }),
        conta({ id: "a", alias: "A Corrente", isDefault: true }),
        conta({ id: "cx", alias: "Caixa (dinheiro)", kind: "caixa" }),
      ],
      U
    );
    expect(o.map((x) => x.value)).toEqual(["a", "z", CAIXA]);
    expect(o[0].label).toContain("(principal)");
  });

  it("sem conta que a pessoa enxergue: 'Conta principal da unidade' + Caixa", () => {
    expect(opcoesDeConta([], U)).toEqual([
      { value: "", label: "Conta principal da unidade" },
      { value: CAIXA, label: "Caixa (dinheiro)" },
    ]);
  });
});

describe("a Conciliação por conta", () => {
  const a = conta({ id: "a", isDefault: true });
  const b = conta({ id: "b", kind: "aplicacao" });
  const cx = conta({ id: "cx", kind: "caixa" });
  const contas = [a, b, cx];
  const lanc = [
    { id: "1", bankAccountId: "a" as string | null },
    { id: "2", bankAccountId: "b" },
    { id: "3", bankAccountId: "cx" },
    { id: "4", bankAccountId: null },
  ];

  it("cada conta pega só o que é dela; o sem conta vai para a principal (L3)", () => {
    expect(lancamentosDaConta(lanc, a, contas).map((l) => l.id)).toEqual(["1", "4"]);
    expect(lancamentosDaConta(lanc, b, contas).map((l) => l.id)).toEqual(["2"]);
    expect(lancamentosDaConta(lanc, cx, contas).map((l) => l.id)).toEqual(["3"]);
  });

  it("nenhum lançamento conta em duas contas (a soma das partes é o todo)", () => {
    const total = contas.flatMap((c) => lancamentosDaConta(lanc, c, contas)).length;
    expect(total).toBe(lanc.length);
  });

  it("o defeito do AP51: com duas contas, o saldo de cada uma deixa de somar o da outra", () => {
    const entries = [
      { id: "1", amountCents: 10000, cashDate: "2026-10-01", description: "", accountCode: "1.1.01", reconciled: false, bankAccountId: "a" },
      { id: "2", amountCents: 50000, cashDate: "2026-10-01", description: "", accountCode: "6.3.01", reconciled: false, bankAccountId: "b" },
    ];
    const saldoDe = (c: ContaDaUnidade) =>
      summarizeReconciliation({ openingBalanceCents: 0, transactions: [], entries: lancamentosDaConta(entries, c, contas) }).systemBalanceCents;
    expect(saldoDe(a)).toBe(10000);
    expect(saldoDe(b)).toBe(50000);
  });

  it("sem principal (várias contas), o sem conta não cai em nenhuma — e a tela avisa quantos", () => {
    const semPrincipal = [{ ...a, isDefault: false }, b, cx];
    expect(lancamentosDaConta(lanc, semPrincipal[0], semPrincipal).map((l) => l.id)).toEqual(["1"]);
    expect(lancamentosSemConta(lanc, semPrincipal, U)).toBe(1);
    expect(lancamentosSemConta(lanc, contas, U)).toBe(0);
  });
});

describe("erros e a janela antes da 0317", () => {
  it("traduz os erros da conta e reconhece a porta que ainda não existe", () => {
    expect(erroDaConta("BANK_ACCOUNT_INVALID")).toContain("não é desta unidade");
    expect(erroDaConta("CASH_BOX_NOT_DEFAULT")).toContain("Caixa");
    expect(erroDaConta("OUTRA COISA")).toBeNull();
    expect(portaAusente({ code: "PGRST202", message: "x" })).toBe(true);
    expect(portaAusente({ message: "Could not find the function public.register_payment_receipt_to" })).toBe(true);
    expect(portaAusente({ message: "AMOUNT_OVER_BALANCE" })).toBe(false);
    expect(portaAusente(null)).toBe(false);
  });
});

describe("as réguas do código", () => {
  it("as baixas passam pelas portas com a conta, e voltam à função de sempre só se a porta faltar", () => {
    const receber = ler("src/app/(app)/prontuarios/[id]/receivables-actions.ts");
    expect(receber).toContain('rpc("register_payment_receipt_to"');
    expect(receber).toMatch(/if \(portaAusente\(error\)\) \{\s*\(\{ data: receiptId, error \} = await supabase\.rpc\("register_payment_receipt", args\)\);/);
    const pagar = ler("src/app/(app)/financeiro/payables-actions.ts");
    expect(pagar).toContain('rpc("register_payable_payment_from"');
    expect(pagar).toContain('rpc("pay_stock_purchase_from"');
  });

  it("as janelas de receber e pagar mostram o campo da conta", () => {
    expect(ler("src/app/(app)/prontuarios/[id]/receivables-section.tsx")).toContain('rotulo="Entrou em"');
    expect((ler("src/app/(app)/financeiro/contas-a-pagar/payables-board.tsx").match(/rotulo="Saiu de"/g) ?? []).length).toBe(2);
  });

  it("a Conciliação separa por conta (não soma o razão inteiro em cada uma)", () => {
    const quadro = ler("src/app/(app)/financeiro/conciliacao/reconciliation-board.tsx");
    expect(quadro).toContain("lancamentosDaConta(");
    expect(quadro).not.toMatch(/entries\.filter\(\(e\) => e\.cashDate >= account\.openingDate\)\s*:/);
  });

  it("a escolha da conta vale só para a baixa que a pediu (a porta limpa depois)", () => {
    const sql = ler("supabase/migrations/0317_conta_do_dinheiro.sql");
    const limpezas = sql.match(/perform set_config\('risarte\.conta_do_dinheiro', '', true\);/g) ?? [];
    expect(limpezas.length).toBe(3);
  });
});
