import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMAS_DE_PAGAR, formaDaNota } from "@/lib/finance/formas-de-pagar";
import { montarParcelas, somaFecha, somarMeses } from "@/lib/finance/parcelas-da-nota";

// Relato OC-00109 (16/10/2026): as contas a pagar de uma nota importada
// pareciam "o total dividido pelas linhas". Eram as 12 DUPLICATAS do próprio
// XML (cartão, a prazo). O texto não dizia que eram parcelas — e escrevia
// "itemns". Decisões do dono: o texto diz "parcela 1/12 (17 itens)"; dá para
// pagar a nota inteira de uma vez; e, ao importar, trocar as parcelas.

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("as parcelas de uma nota importada", () => {
  const daNota = [{ dueDate: "2026-10-22", amountCents: 164800 }];

  it("como veio na nota: as duplicatas do XML, sem mexer", () => {
    expect(montarParcelas({ modo: "nota", totalCents: 164800, daNota, data: "", vezes: 0 })).toEqual({ ok: true, parcelas: daNota });
  });

  it("à vista: uma parcela, no dia do pagamento, com o total", () => {
    expect(montarParcelas({ modo: "avista", totalCents: 164800, daNota, data: "2026-10-16", vezes: 0 })).toEqual({
      ok: true,
      parcelas: [{ dueDate: "2026-10-16", amountCents: 164800 }],
    });
  });

  it("em 12 vezes: o mesmo da nota do relato (11 × 137,33 + 137,37)", () => {
    const r = montarParcelas({ modo: "vezes", totalCents: 164800, daNota, data: "2026-10-22", vezes: 12 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parcelas.map((p) => p.amountCents)).toEqual([...Array(11).fill(13733), 13737]);
    expect(r.parcelas[0].dueDate).toBe("2026-10-22");
    expect(r.parcelas[11].dueDate).toBe("2027-09-22");
    expect(somaFecha(r.parcelas, 164800)).toBe(true);
  });

  it("vencimento mês a mês não pula mês: dia 31 vira o último dia do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-01-31", 2)).toBe("2026-03-31");
    expect(somarMeses("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("recusa o que não dá para lançar", () => {
    expect(montarParcelas({ modo: "avista", totalCents: 164800, daNota, data: "", vezes: 0 }).ok).toBe(false);
    expect(montarParcelas({ modo: "vezes", totalCents: 164800, daNota, data: "2026-02-30", vezes: 3 }).ok).toBe(false);
    expect(montarParcelas({ modo: "vezes", totalCents: 164800, daNota, data: "2026-10-22", vezes: 1 }).ok).toBe(false);
    expect(montarParcelas({ modo: "vezes", totalCents: 0, daNota, data: "2026-10-22", vezes: 2 }).ok).toBe(false);
  });

  it("a soma tem de fechar com o total da nota", () => {
    expect(somaFecha([{ dueDate: "2026-10-22", amountCents: 100 }], 101)).toBe(false);
  });
});

describe("a forma de pagamento", () => {
  it("vem da própria nota (<tPag>) como sugestão", () => {
    expect(formaDaNota("03")).toBe("cartao"); // a nota do relato: cartão de crédito
    expect(formaDaNota("15")).toBe("boleto");
    expect(formaDaNota("17")).toBe("pix");
    expect(formaDaNota("01")).toBe("dinheiro");
    expect(formaDaNota("99")).toBeNull(); // "outros": sem palpite
    expect(formaDaNota(null)).toBeNull();
  });

  it("a lista é uma só: Contas a pagar e a importação usam a mesma", () => {
    const quadro = ler("src/app/(app)/financeiro/contas-a-pagar/payables-board.tsx");
    expect(quadro).toContain("const METHODS = FORMAS_DE_PAGAR;");
    expect(ler("src/app/(app)/estoque/nfe-import.tsx")).toContain("FORMAS_DE_PAGAR.map(");
  });

  it("o banco conhece exatamente as mesmas formas (0300)", () => {
    const sql = ler("supabase/migrations/0300_parcelas_da_nota.sql");
    const i = sql.indexOf("function public.stock_purchase_payable_description(");
    const corpo = sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)));
    const doBanco = [...corpo.matchAll(/when '(\w+)' then/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual(FORMAS_DE_PAGAR.map((f) => f.value).sort());
  });
});

describe("o texto da conta diz que é parcela (0300)", () => {
  const sql = ler("supabase/migrations/0300_parcelas_da_nota.sql");

  it("'parcela 1/12' e '17 itens' — não mais 'itemns'", () => {
    expect(sql).toContain("then ' · parcela ' || p_parcela || '/' || p_parcelas else '' end");
    expect(sql).toContain("case when p_itens = 1 then ' item' else ' itens' end");
    expect(sql).not.toMatch(/else 'ns' end/);
  });

  it("a compra grava cada parcela com a regra única, e as antigas são reescritas", () => {
    expect(sql).toMatch(/p_description => public\.stock_purchase_payable_description\(\s*p_invoice_number, v_i::int, v_n, v_inst->>'paymentMethod', v_count\)/);
    expect(sql).toMatch(/update public\.payables p\s+set description = public\.stock_purchase_payable_description/);
  });
});

describe("pagar a nota inteira", () => {
  const sql = ler("supabase/migrations/0300_parcelas_da_nota.sql");
  const i = sql.indexOf("create or replace function public.pay_stock_purchase(");
  const corpo = sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)));

  it("passa pela MESMA porta do botão Pagar, parcela a parcela, com permissão", () => {
    expect(corpo).toContain("if not public.can_manage_payables(v_purchase.clinic_id) then");
    expect(corpo).toContain("perform public.register_payable_payment(");
    expect(corpo).toContain("status in ('aberta', 'parcial')");
    expect(sql).toContain("revoke execute on function public.pay_stock_purchase(uuid, date, text, text, text) from public, anon, authenticated;");
  });

  it("o botão aparece na parcela de nota com mais de uma em aberto, para quem lança", () => {
    const quadro = ler("src/app/(app)/financeiro/contas-a-pagar/payables-board.tsx");
    expect(quadro).toMatch(/canManage &&\s+v\.stockPurchaseId &&\s+v\.isOpen &&\s+v\.status !== "aguardando_autorizacao" &&\s+\(abertasPorNota\.get\(v\.stockPurchaseId\)\?\.length \?\? 0\) > 1/);
    expect(quadro).toContain("await payStockPurchase({");
  });
});

describe("a importação manda as parcelas escolhidas", () => {
  const tela = ler("src/app/(app)/estoque/nfe-import.tsx");

  it("com a forma de pagamento, e só se a soma fechar", () => {
    expect(tela).toContain("installments: parcelas.map((p) => ({ ...p, paymentMethod: forma || null })),");
    expect(tela).toContain("disabled={isPending || pending > 0 || !!erroDasParcelas}");
    expect(tela).toContain('paymentMethod: formaDaNota(txt(doc, "tPag")),');
  });

  it("o servidor confere data e valor de cada parcela", () => {
    expect(ler("src/app/(app)/estoque/actions.ts")).toContain("Confira as parcelas: cada uma precisa de data e valor.");
  });
});
