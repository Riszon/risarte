import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decidirSplit, entradasDoSplit, modalidadesDoMeio, repasseSimulado, type PlanoDoSplit } from "@/lib/asaas/split";

// 4026 — o pagamento no cartão de débito. As tarifas da produção (21/11/2026):
// crédito à vista 2,39% + R$ 0,29; débito 1,89% + R$ 0,29; taxas da rede 17%.
const CRED = { a: 0.0239, bCents: 29 };
const DEB = { a: 0.0189, bCents: 29 };
const carteira = [{ walletId: "w", percent: 17 }];
const soma = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);

describe("4026 — o split no débito", () => {
  it("o débito usa a tarifa do débito", () => {
    expect(modalidadesDoMeio("DEBIT_CARD")).toEqual(["debito"]);
  });

  it("a tabela aprovada pelo dono: o split do crédito pago no débito repassa a mais", () => {
    const doCredito = entradasDoSplit(carteira, CRED);
    expect(doCredito[0]).toMatchObject({ percentualValue: 17.4162, fixedCents: 5 });
    const casos: [number, number, number][] = [
      // valor, no crédito, no débito (com o split do crédito)
      [10000, 1699, 1708],
      [50000, 8499, 8543],
      [100000, 16999, 17086],
      [300000, 50999, 51261],
    ];
    for (const [v, credito, debito] of casos) {
      expect(soma(repasseSimulado(doCredito, v, CRED))).toBe(credito);
      expect(soma(repasseSimulado(doCredito, v, DEB))).toBe(debito);
    }
  });

  it("corrigido pela tarifa do débito, fica a favor da unidade (−R$ 0,01)", () => {
    const plano: PlanoDoSplit = {
      elegivel: true,
      carteiras: [{ accountId: "raiz", walletId: "w", percent: 17, fees: { royalty: 6, fundo: 2, planejamento: 3, comercial: 6 } }],
      tarifas: [{ modality: "debito", fee_percent: 1.89, fixed_fee_cents: 29, valid_from: "2026-11-20", valid_to: null }],
      hoje: "2026-11-21",
      vencimento: "2026-11-21",
      valorCents: 100000,
      descontoCents: 0,
      meio: "DEBIT_CARD",
      parcelas: 1,
    };
    const d = decidirSplit(plano);
    expect(d.vai).toBe(true);
    if (!d.vai) return;
    expect(d.entradas[0]).toMatchObject({ percentualValue: 17.3274, fixedCents: 5, tariffPercent: 1.89, tariffFixedCents: 29 });
    for (const v of [10000, 50000, 100000, 300000]) {
      const r = soma(repasseSimulado(d.entradas, v, DEB));
      expect(r).toBeLessThanOrEqual(Math.round(v * 0.17));
      expect(Math.round(v * 0.17) - r).toBeLessThanOrEqual(2);
    }
  });

  it("sem a tarifa do débito na conta, não corrige (o crédito cobre)", () => {
    const plano: PlanoDoSplit = {
      elegivel: true,
      carteiras: [{ accountId: "raiz", walletId: "w", percent: 17, fees: { royalty: 17 } }],
      tarifas: [],
      hoje: "2026-11-21",
      vencimento: "2026-11-21",
      valorCents: 100000,
      descontoCents: 0,
      meio: "DEBIT_CARD",
    };
    expect(decidirSplit(plano)).toMatchObject({ vai: false, motivo: "sem_tarifa" });
  });

  it("a migração: âncoras de uma linha só e o crédito fora do resultado (família 6)", () => {
    const sql = readFileSync("supabase/migrations/4026_asa4_pagamento_no_debito.sql", "utf8");
    for (const m of sql.matchAll(/\$(v\d)\$([\s\S]*?)\$\1\$/g)) expect(m[2]).not.toContain("\n");
    expect(sql).toContain("('6.4.01', 'Split a mais a receber da franqueadora'");
    expect(sql).toContain("('6.4.02', 'Split a mais a devolver às unidades'");
    expect(sql).not.toMatch(/'1\.3\.\d\d'.*split_excess/);
  });
});
