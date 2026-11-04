import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outraVendaEmTratamento, type VendaDoCliente } from "@/lib/vendas-do-cliente";

// AP107 (decisões do dono, 04/11/2026; K1–K3 em docs/comercial/AP63-AP64-PLANO.md
// §7): um cancelamento POR VENDA; cancelar só o complemento mantém o cliente na
// Fase 5; cancelar o plano original NÃO cancela o complemento, e o cliente só
// vai à Fase 6/7 quando não sobra tratamento. Provado no treino (ensaio da
// 0360, transação desfeita, 19/19; sem a 0360, 2 reprovam).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const venda = (negociacaoId: string, planoId: string, extra: Partial<VendaDoCliente> = {}): VendaDoCliente => ({
  negociacaoId, planoId, codigo: null, situacao: "aceita", fechada: true, cancelada: false, rotulo: "Plano original", ...extra,
});

describe("AP107 — outra venda em tratamento", () => {
  const original = venda("n1", "p1");
  const complemento = venda("n2", "p2", { rotulo: "Complemento 1" });

  it("cancelar o complemento com o original em tratamento: não pede destino", () => {
    expect(outraVendaEmTratamento([original, complemento], "n2", new Set(["p1"]))).toBe(true);
  });

  it("K3: cancelar o original com o complemento em tratamento: não pede destino", () => {
    expect(outraVendaEmTratamento([original, complemento], "n1", new Set(["p2"]))).toBe(true);
  });

  it("a outra venda sem sessão por fazer (terminou) não segura a fase", () => {
    expect(outraVendaEmTratamento([original, complemento], "n2", new Set())).toBe(false);
  });

  it("venda cancelada ou não fechada não conta", () => {
    expect(outraVendaEmTratamento([original, venda("n3", "p3", { cancelada: true })], "n1", new Set(["p3"]))).toBe(false);
    expect(outraVendaEmTratamento([original, venda("n3", "p3", { fechada: false })], "n1", new Set(["p3"]))).toBe(false);
  });
});

describe("AP107 — o banco (0360) e a tela", () => {
  const sql = ler("supabase/migrations/0360_cancelar_uma_venda_sem_encerrar_o_tratamento.sql");

  it("a regra do banco é a mesma da tela", () => {
    const i = sql.indexOf("create or replace function public._outra_venda_em_tratamento(");
    const corpo = sql.slice(i, sql.indexOf("$$;", i));
    for (const trecho of ["n.id <> p_negotiation_id", "n.status = 'aceita'", "s.closed_at is not null", "s.cancelled_at is null", "ts.status in ('pending', 'scheduled')"]) {
      expect(corpo, trecho).toContain(trecho);
    }
  });

  it("abrir e efetivar só pedem destino / mudam a fase / marcam o cartão sem outra venda em tratamento", () => {
    expect(sql).toContain("if v_closed and not v_outra then");
    expect(sql).toContain("if v_c.destination is not null and not v_outra then");
    expect(sql).toMatch(/if not v_outra then\s+update public\.commercial_cards set\s+stage = 'cancelado'/);
  });

  it("o prontuário mostra um cartão por venda, com a regra", () => {
    const p = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(p).toContain("vendasDoCliente.map((v) => (");
    expect(p).toContain("exigeDestino={v.fechada && !outraVendaEmTratamento(vendasDoCliente, v.negociacaoId, planosComSessaoAberta)}");
    expect(p).not.toContain("cancellableNeg");
    expect(ler("src/app/(app)/prontuarios/[id]/cancel-plan-card.tsx")).toContain("const pedeDestino = exigeDestino ?? wasClosed;");
  });
});
