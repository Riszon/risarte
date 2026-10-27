import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeMargin, custoDiretoDosItens } from "@/lib/finance/margin";
import { simulatePrice } from "@/lib/finance/pricing-simulator";
import { custosDosItensAceitos, minutosDoItem, type CustosDaMargem } from "@/lib/finance/custos-da-margem";

// A margem da negociação e da venda direta conta a hora de cadeira, o imposto
// e o resto da Precificação (pedido do dono, 27/10/2026; fecha o AP80).

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("a margem da venda é a margem da Precificação", () => {
  it("com os mesmos custos, o mesmo resultado (preço, cadeira, material, lab, repasse, imposto + taxa)", () => {
    for (const preco of [50000, 33333, 120000, 21000]) {
      const custo = { minutes: 45, chairCostPerHourCents: 18000, materialsCents: 3500, labCents: 7000, payoutCents: 9000 };
      const sim = simulatePrice({ cost: custo, taxPercent: 6, acquirerFeePercent: 3, targetMarginPercent: 30, currentPriceCents: preco });
      const venda = computeMargin(
        {
          priceCents: preco,
          payoutCents: custo.payoutCents,
          chairCents: sim.breakdown.chairCents,
          materialCents: custo.materialsCents,
          labCents: custo.labCents,
          proportionalPercent: 9,
        },
        30
      );
      expect(venda.marginCents).toBe(sim.currentMarginCents);
      expect(venda.marginPercent).toBe(sim.currentMarginPercent);
      expect(venda.belowMinimum).toBe(sim.belowTarget);
    }
  });

  it("o imposto acompanha o preço: o desconto corta o imposto junto", () => {
    const cheio = computeMargin({ priceCents: 100000, payoutCents: 20000, proportionalPercent: 10 });
    const comDesconto = computeMargin({ priceCents: 80000, payoutCents: 20000, proportionalPercent: 10 });
    expect(cheio.proportionalCents).toBe(10000);
    expect(comDesconto.proportionalCents).toBe(8000);
  });

  it("sem os custos novos, a conta antiga continua igual", () => {
    const m = computeMargin({ priceCents: 100000, payoutCents: 40000 }, 30);
    expect(m.marginCents).toBe(60000);
    expect(m.chairCents + m.labCents + m.proportionalCents).toBe(0);
  });
});

describe("os custos dos itens", () => {
  it("minutos: o planejado do item; sem ele, o do cadastro × quantidade", () => {
    expect(minutosDoItem(90, 30, 2)).toBe(90);
    expect(minutosDoItem(null, 30, 2)).toBe(60);
    expect(minutosDoItem(0, 30, 1)).toBe(30);
    expect(minutosDoItem(null, null, 3)).toBe(0);
  });

  it("material e lab vezes a quantidade; a cadeira arredonda uma vez, no total", () => {
    const d = custoDiretoDosItens(
      [
        { procedureId: "a", quantidade: 2, minutos: 20 },
        { procedureId: "b", quantidade: 1, minutos: 25 },
        { procedureId: null, quantidade: 1, minutos: 0 },
      ],
      {
        horaDeCadeiraCents: 10000,
        materialDe: (id) => (id === "a" ? { materialCents: 1000, labCents: 0 } : { materialCents: 500, labCents: 3000 }),
      }
    );
    expect(d.minutos).toBe(45);
    expect(d.chairCents).toBe(7500);
    expect(d.materialCents).toBe(2500);
    expect(d.labCents).toBe(3000);
  });

  it("na compra parcial, só os itens ACEITOS custam; sem custos lidos, nulo", () => {
    const c: CustosDaMargem = {
      horaDeCadeiraCents: 6000,
      proportionalPercent: 9,
      porItem: {
        i1: { procedureId: "a", quantidade: 1, minutos: 60 },
        i2: { procedureId: "a", quantidade: 1, minutos: 60 },
      },
      materialPorProcedimento: { a: { materialCents: 1000, labCents: 0 } },
    };
    expect(custosDosItensAceitos(c, ["i1", "i2"])).toEqual({ chairCents: 12000, materialCents: 2000, labCents: 0, proportionalPercent: 9 });
    expect(custosDosItensAceitos(c, ["i1"])).toEqual({ chairCents: 6000, materialCents: 1000, labCents: 0, proportionalPercent: 9 });
    expect(custosDosItensAceitos(null, ["i1"])).toBeNull();
  });
});

describe("as telas usam a conta nova", () => {
  it("o alerta mostra cadeira, material e imposto, e diz quando não leu os custos", () => {
    const alerta = ler("src/components/commercial/margin-alert.tsx");
    expect(alerta).toMatch(/chairCents: custos\?\.chairCents \?\? 0/);
    expect(alerta).toMatch(/proportionalPercent: custos\?\.proportionalPercent \?\? 0/);
    expect(alerta).toMatch(/Não consegui ler os custos da unidade/);
    expect(alerta).not.toMatch(/quando o módulo de Estoque existir/); // texto velho: o Estoque existe
  });

  it("a negociação passa só os itens aceitos; a venda direta, os da venda", () => {
    const painel = ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx");
    expect(painel).toMatch(/custosDosItensAceitos\(\s*custosDaMargem,\s*option\.items\.filter\(\(i\) => !excluded\.has\(i\.id\)\)/);
    for (const p of ["src/app/(app)/apresentacao/[clientId]/page.tsx", "src/app/(app)/comercial/[clientId]/page.tsx"]) {
      expect(ler(p)).toMatch(/custosDaMargem=\{negotiationBlock\.custosDaMargem\}/);
    }
    const vd = ler("src/app/(app)/comercial/venda-direta/page.tsx");
    expect(vd).toMatch(/carregarCustosDaMargem\(/);
    expect(ler("src/app/(app)/comercial/venda-direta/direct-sale-item.tsx")).toMatch(/custos=\{sale\.custosDaMargem \?\? null\}/);
  });

  it("as fontes são as da Precificação", () => {
    const db = ler("src/lib/finance/custos-da-margem-db.ts");
    expect(db).toMatch(/rpc\("cost_settings_for"/);
    expect(db).toMatch(/rpc\("material_costs_for_clinic"/);
    expect(db).toMatch(/Number\(s\?\.tax_percent \?\? 0\) \+ Number\(s\?\.avg_acquirer_fee_percent \?\? 0\)/);
    expect(ler("src/app/(app)/procedimentos/precificacao/page.tsx")).toMatch(/rpc\("cost_settings_for"/);
    // e a Precificação não diz mais que a negociação conta diferente
    expect(ler("src/app/(app)/procedimentos/precificacao/pricing-simulator-client.tsx")).not.toMatch(
      /não inclui a hora de cadeira/
    );
  });
});
