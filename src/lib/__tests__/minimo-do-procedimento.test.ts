import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { procedimentosAbaixoDoMinimo, type ItemComMinimo } from "@/lib/procedimentos/grupos";

// O MÍNIMO DO PROCEDIMENTO TRAVA A NEGOCIAÇÃO (0327, pedido do dono,
// 27/10/2026). PM1: item que o grupo precificou segue o grupo. PM2: vale o
// menor entre o mínimo da rede e o preço do item.

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

const P = { id: "p", nome: "Adequação do meio bucal", minimoCents: 80000 };
const item = (x: Partial<ItemComMinimo> = {}): ItemComMinimo => ({
  procedimento: P,
  quantidade: 1,
  precoCents: 100000,
  beneficioCents: 0,
  incluido: true,
  isentoPeloGrupo: false,
  ...x,
});

describe("a conta (a mesma do ensaio da 0327)", () => {
  const doisDentes = [item(), item()]; // preço 200.000, mínimo 160.000

  it("sem desconto e exatamente no mínimo: passa; um centavo abaixo: pede", () => {
    expect(procedimentosAbaixoDoMinimo(doisDentes, 0, 200000)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo(doisDentes, -40000, 200000)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo(doisDentes, -40001, 200000)).toEqual([
      // O MESMO texto que o banco grava.
      "Adequação do meio bucal abaixo do mínimo: R$ 1.599,99 (mínimo R$ 1.600,00)",
    ]);
  });

  it("PM2: preço da unidade abaixo do mínimo da rede vira o piso", () => {
    const q = [item({ procedimento: { id: "q", nome: "Ajuste de Bordas Incisais", minimoCents: 60000 }, precoCents: 50000 })];
    expect(procedimentosAbaixoDoMinimo(q, 0, 50000)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo(q, -1000, 250000)).toEqual([
      "Ajuste de Bordas Incisais abaixo do mínimo: R$ 498,00 (mínimo R$ 500,00)",
    ]);
  });

  it("PM1: o item que o grupo precificou não responde ao mínimo do procedimento", () => {
    expect(procedimentosAbaixoDoMinimo([item({ precoCents: 10, isentoPeloGrupo: true })], -5, 10)).toEqual([]);
  });

  it("benefício do programa não conta; item fora e procedimento sem mínimo também não", () => {
    expect(procedimentosAbaixoDoMinimo([item({ beneficioCents: 30000 })], -50000, 100)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo([item({ incluido: false, precoCents: 1 })], 0, 0)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo([item({ procedimento: { ...P, minimoCents: null } })], -99999, 100000)).toEqual([]);
    expect(procedimentosAbaixoDoMinimo([item({ procedimento: null })], -99999, 100000)).toEqual([]);
  });
});

describe("o banco e a tela seguem a mesma regra", () => {
  const sql = ler("supabase/migrations/0327_minimo_do_procedimento.sql");

  it("a regra da negociação chama os DOIS mínimos antes de gravar", () => {
    const ev = sql.slice(sql.indexOf("create or replace function public.evaluate_negotiation_rules"));
    const pacote = ev.indexOf("public._negotiation_package_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable)");
    const proc = ev.indexOf("public._negotiation_procedure_floor(p_negotiation_id, v_neg.adjustment_cents, v_discountable)");
    expect(pacote).toBeGreaterThan(0);
    expect(proc).toBeGreaterThan(pacote);
    expect(proc).toBeLessThan(ev.indexOf("update public.plan_negotiations set"));
  });

  it("PM1 e PM2 estão no banco, e a regra interna não é chamável", () => {
    expect(sql).toContain("least(p.min_price_cents, i.unit_price_cents) as minimo_unit");
    expect(sql).toContain("and (i.list_price_cents is not null or g.min_price_percent is not null))");
    expect(sql).toContain("'%s abaixo do mínimo: %s (mínimo %s)'");
    expect(sql).toMatch(/revoke execute on function public\._negotiation_procedure_floor\(uuid, integer, integer\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\._negotiation_procedure_floor/);
  });

  it("o painel avisa antes de salvar, com a mesma isenção do grupo", () => {
    const painel = ler("src/app/(app)/apresentacao/[clientId]/negotiation-panel.tsx");
    expect(painel).toMatch(/\.\.\.procedimentosAbaixoDoMinimo\(/);
    expect(painel).toMatch(/i\.pacote && \(i\.precoDeTabelaCents != null \|\| i\.pacote\.minimoPercent != null\)/);
    const loader = ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts");
    expect(loader).toMatch(/select\("id, name, min_price_cents"\)/);
  });
});
