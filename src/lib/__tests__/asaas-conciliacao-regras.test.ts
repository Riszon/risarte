// A regra da conciliação das cobranças com o Asaas (4022, spec 21.2 item 4).
import { describe, expect, it } from "vitest";
import { conciliar, type CobrancaDoAsaas, type CobrancaDoRiszon } from "@/lib/asaas/conciliacao-regras";

const A = (id: string, status: string, value: number, extra: Partial<CobrancaDoAsaas> = {}): CobrancaDoAsaas => ({
  id, status, value, deleted: false, externalReference: null, dateCreated: "2026-11-18", ...extra,
});
const R = (id: string, pay: string, status: string, value_cents: number): CobrancaDoRiszon => ({
  id, asaas_payment_id: pay, status, value_cents, is_external: false,
});
const rodar = (asaas: CobrancaDoAsaas[], riszon: CobrancaDoRiszon[], naoAchadas: string[] = []) =>
  conciliar({ asaas, riszon, conhecidos: new Set(riszon.map((c) => c.asaas_payment_id!)), naoAchadas: new Set(naoAchadas) });

describe("a conciliação das cobranças", () => {
  it("paga no Asaas (inclusive recebida em dinheiro no painel) e aberta no riSZon", () => {
    for (const st of ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]) {
      const r = rodar([A("p1", st, 100)], [R("c1", "p1", "vencida", 10000)]);
      expect(r.divergencias.map((d) => d.kind)).toEqual(["paga_no_asaas"]);
    }
  });

  it("valor diferente só com as duas pontas em aberto", () => {
    expect(rodar([A("p1", "PENDING", 99)], [R("c1", "p1", "emitida", 10000)]).divergencias.map((d) => d.kind)).toEqual(["valor_diferente"]);
  });

  it("paga com o desconto de pontualidade não é divergência (o Asaas grava o valor com desconto)", () => {
    const r = rodar([A("p1", "RECEIVED", 167.2)], [R("c1", "p1", "liquidada", 17600)]);
    expect(r.divergencias).toEqual([]);
    expect(r.conferidas.asaas).toContain("p1"); // conferida: a divergência antiga fecha sozinha
  });

  it("criada fora do riSZon; apagada, deixa de ser divergência", () => {
    expect(rodar([A("x", "PENDING", 7.77)], []).divergencias.map((d) => d.kind)).toEqual(["fora_do_riszon"]);
    const apagada = rodar([A("x", "PENDING", 7.77, { deleted: true })], []);
    expect(apagada.divergencias).toEqual([]);
    expect(apagada.conferidas.asaas).toContain("x");
  });

  it("cancelada de um lado só, e a que não existe no Asaas", () => {
    expect(rodar([A("p1", "PENDING", 100, { deleted: true })], [R("c1", "p1", "emitida", 10000)]).divergencias[0].kind).toBe("cancelada_so_no_asaas");
    expect(rodar([A("p1", "PENDING", 100)], [R("c1", "p1", "cancelada", 10000)]).divergencias[0].kind).toBe("cancelada_so_no_riszon");
    expect(rodar([], [R("c1", "p1", "emitida", 10000)], ["p1"]).divergencias[0].kind).toBe("sem_no_asaas");
  });

  it("vencida no Asaas e liquidada no riSZon é situação diferente", () => {
    expect(rodar([A("p1", "OVERDUE", 600)], [R("c1", "p1", "liquidada", 60000)]).divergencias[0].kind).toBe("situacao_diferente");
  });
});
