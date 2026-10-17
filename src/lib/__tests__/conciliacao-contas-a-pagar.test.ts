import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contasDoValor, mesDaDre, type ContaEmAberto } from "@/lib/finance/reconciliation";
import { relatorioDeContasPagas, totalPago, type PagamentoDeConta } from "@/lib/finance/contas-pagas";
import { totaisDoRelatorio } from "@/lib/finance/relatorio";

// Relato OC-00110 (16/10/2026): "realizei a conciliação, mas não entrou no
// DRE" e "não encontrei relatório de contas pagas". As 3 linhas lançadas
// estavam na DRE — de SETEMBRO, o mês do extrato; o print era de outubro. O
// conserto disso é o TEXTO (a tela diz o mês). Decisões do dono: pagar conta a
// pagar pela conciliação (+ aviso contra lançar de novo) e o relatório de
// contas pagas pela data do pagamento.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const MIGRACAO = ler("supabase/migrations/0302_pagar_conta_pela_conciliacao.sql");

const conta = (id: string, balanceCents: number, dueDate: string): ContaEmAberto => ({
  id,
  description: id,
  supplierName: null,
  accountCode: "3.3.03",
  dueDate,
  balanceCents,
});

describe("em que mês o lançamento entra na DRE", () => {
  it("é o mês da LINHA do extrato, não o de hoje", () => {
    expect(mesDaDre("2026-09-02")).toBe("setembro de 2026");
    expect(mesDaDre("2026-03-31")).toBe("março de 2026");
    expect(mesDaDre("2027-12-01")).toBe("dezembro de 2027");
  });
});

describe("as contas a pagar que a linha pode quitar", () => {
  const contas = [
    conta("longe", 22600, "2026-07-01"),
    conta("perto", 22600, "2026-09-03"),
    conta("outro-valor", 22700, "2026-09-02"),
    conta("quitada", 0, "2026-09-02"),
  ];

  it("só o saldo EXATO, as de vencimento mais perto primeiro", () => {
    expect(contasDoValor({ postedAt: "2026-09-02", amountCents: -22600 }, contas).map((c) => c.id)).toEqual(["perto", "longe"]);
  });

  it("linha de ENTRADA não paga conta", () => {
    expect(contasDoValor({ postedAt: "2026-09-02", amountCents: 22600 }, contas)).toEqual([]);
  });
});

describe("o banco paga e concilia de uma vez (0302)", () => {
  it("usa a MESMA baixa de Contas a pagar e o MESMO Casar — não um caminho novo para o dinheiro", () => {
    expect(MIGRACAO).toContain("v_pagamento := public.register_payable_payment(");
    expect(MIGRACAO).toContain("perform public.reconcile_bank_transaction(p_transaction_id, v_lancamento);");
    // A data do pagamento é a do extrato.
    expect(MIGRACAO).toMatch(/-v_tx\.amount_cents,\s+v_tx\.posted_at,/);
  });

  it("só saída, só pendente, só o saldo exato, só quem concilia", () => {
    expect(MIGRACAO).toContain("if not public.can_reconcile(v_tx.clinic_id) then raise exception 'NOT_ALLOWED'; end if;");
    expect(MIGRACAO).toContain("if v_tx.status <> 'pendente' then raise exception 'NOT_PENDING'; end if;");
    expect(MIGRACAO).toContain("if v_tx.amount_cents >= 0 then raise exception 'NOT_AN_OUTFLOW'; end if;");
    expect(MIGRACAO).toContain("if v_saldo <> -v_tx.amount_cents then raise exception 'AMOUNT_MISMATCH'; end if;");
    expect(MIGRACAO).toContain("if v_p.clinic_id <> v_tx.clinic_id then raise exception 'CLINIC_MISMATCH'; end if;");
  });

  it("não abre para quem não está logado", () => {
    expect(MIGRACAO).toContain("revoke execute on function public.pay_payable_from_bank_transaction(uuid, uuid, text) from public, anon, authenticated;");
  });
});

describe("a tela da conciliação", () => {
  const tela = ler("src/app/(app)/financeiro/conciliacao/reconciliation-board.tsx");
  const pagina = ler("src/app/(app)/financeiro/conciliacao/page.tsx");

  it("diz em que mês da DRE o lançamento entra — na janela e na confirmação", () => {
    expect(tela).toContain("Na DRE, entra em {mesDaDre(creatingFor.postedAt)}");
    expect(tela).toContain("toast.success(`Lançado e conciliado — entra na DRE de ${mes}.`);");
  });

  it("oferece Pagar conta e avisa no Lançar quando há conta a pagar do mesmo valor", () => {
    expect(tela).toContain("Pagar conta ({contas.length})");
    expect(tela).toContain("Existe conta a pagar em aberto deste valor.");
    expect(tela).toContain("contasDoValor(creatingFor, openPayables)");
    expect(tela).toMatch(/disabled=\{isPending \|\| !pagarSel\}\s+onClick=\{payIt\}/);
  });

  it("lê as contas em ABERTO da unidade", () => {
    expect(pagina).toContain('.in("status", ["aberta", "parcial"])');
    // O saldo da tela é o do banco: o desconto por pontualidade também abate.
    expect(pagina).toContain("pagamentos:payable_payments!payable_payments_payable_id_fkey ( discount_cents, reversed, reversal_of )");
    expect(pagina).toMatch(/\.filter\(\(x\) => !x\.reversed && x\.reversal_of === null\)\s+\.reduce\(\(soma, x\) => soma \+ Number\(x\.discount_cents/);
  });
});

const pg = (o: Partial<PagamentoDeConta>): PagamentoDeConta => ({
  paidAt: "2026-10-10",
  supplierName: "Fornecedor",
  description: "Conta",
  documentNumber: null,
  accountCode: "3.3.03",
  accountName: "Material de escritório",
  dueDate: "2026-10-05",
  amountCents: 10000,
  chargesCents: 0,
  discountCents: 0,
  paymentMethod: "pix",
  reconciled: false,
  ...o,
});

describe("o relatório de contas pagas", () => {
  it("total pago = valor + multa e juros; o desconto NÃO é dinheiro saindo", () => {
    expect(totalPago(pg({ amountCents: 10000, chargesCents: 480, discountCents: 500 }))).toBe(10480);
  });

  it("pela data do pagamento, do mais antigo; soma no rodapé; banco conferido", () => {
    const r = relatorioDeContasPagas({
      pagamentos: [
        pg({ paidAt: "2026-10-12", amountCents: 5000, reconciled: true }),
        pg({ paidAt: "2026-10-01", amountCents: 10000, chargesCents: 480 }),
      ],
      unidade: "Unidade X",
      de: "2026-10-01",
      ate: "2026-10-31",
      quem: null,
    });
    expect(r.linhas.map((l) => l.pagoEm)).toEqual(["2026-10-01", "2026-10-12"]);
    expect(totaisDoRelatorio(r).total).toBe(15480);
    expect(r.resumo).toContainEqual({ rotulo: "Conferidos com o banco", valor: "1 de 2" });
    expect(r.metadados.find((m) => m.rotulo === "Período")?.valor).toMatch(/^Pagamento de /);
    // Vazio é traço, nunca zero.
    expect(r.linhas[1].encargos).toBeNull();
    expect(r.linhas[1].banco).toBe("Conciliado");
  });

  it("estorno não entra, e a leitura que falha não vira relatório pela metade", () => {
    const dados = ler("src/app/(app)/financeiro/contas-a-pagar/pagas/dados.ts");
    expect(dados).toContain('.eq("reversed", false)');
    expect(dados).toContain('.is("reversal_of", null)');
    expect(dados).toContain('.gte("paid_at", de)');
    expect(dados).toMatch(/if \(!lidos\.ok\) \{[\s\S]*?return \{ falhou: true \};/);
    expect(dados).toMatch(/if \(!caixa\.ok\) \{[\s\S]*?return \{ falhou: true \};/);
  });

  it("a tela de Contas a pagar leva ao relatório", () => {
    expect(ler("src/app/(app)/financeiro/contas-a-pagar/page.tsx")).toContain("<RelatorioDePagas hoje={today} />");
    expect(ler("src/app/(app)/financeiro/contas-a-pagar/relatorio-de-pagas.tsx")).toContain('base="/financeiro/contas-a-pagar/pagas"');
  });
});
