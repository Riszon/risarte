import { describe, expect, it } from "vitest";
import { problemasDaDivida, qualidadeDosDados, type DividaDaQualidade } from "@/lib/finance/dividas-qualidade";

const ctx = {
  documentoDoCredor: new Map<string, string | null>([["ok", "11222333000181"], ["raiz", "11222333"], ["sem", null]]),
  nomeDaCategoria: new Map([["emp", "Empréstimos e financiamentos"], ["acl", "A classificar"]]),
  hoje: "2026-11-14",
  prazoDaConferencia: 60,
};
const boa: DividaDaQualidade = {
  id: "1", code: "DV-1", clinicId: "c", supplierId: "ok", status: "inadimplente", contractNumber: "123", originalCents: 100,
  updatedRefDate: "2026-10-20", dueDate: "2025-01-10", categoryId: "emp", natureCode: "financeira", needsSplit: false, lastCheckedOn: "2026-11-01",
};

describe("qualidade dos dados", () => {
  it("dívida completa não tem problema", () => {
    expect(problemasDaDivida(boa, ctx)).toEqual([]);
  });

  it("cada lacuna da planilha vira um problema", () => {
    expect(problemasDaDivida({ ...boa, supplierId: "raiz" }, ctx)).toEqual(["cnpj_incompleto"]);
    expect(problemasDaDivida({ ...boa, supplierId: "sem" }, ctx)).toEqual(["cnpj_incompleto"]);
    expect(problemasDaDivida({ ...boa, categoryId: "acl" }, ctx)).toEqual(["a_classificar"]);
    expect(problemasDaDivida({ ...boa, natureCode: null }, ctx)).toEqual(["a_classificar"]);
    expect(problemasDaDivida({ ...boa, dueDate: "2026-10-20" }, ctx)).toEqual(["vencimento_do_levantamento"]);
    expect(problemasDaDivida({ ...boa, contractNumber: " " }, ctx)).toEqual(["sem_contrato"]);
    expect(problemasDaDivida({ ...boa, originalCents: null }, ctx)).toEqual(["sem_valor_original"]);
    expect(problemasDaDivida({ ...boa, needsSplit: true }, ctx)).toEqual(["desdobrar"]);
    expect(problemasDaDivida({ ...boa, lastCheckedOn: null }, ctx)).toEqual(["conferencia_velha"]);
    expect(problemasDaDivida({ ...boa, lastCheckedOn: "2026-09-15" }, ctx)).toEqual([]); // 60 dias: no prazo
    expect(problemasDaDivida({ ...boa, lastCheckedOn: "2026-09-14" }, ctx)).toEqual(["conferencia_velha"]); // 61
  });

  it("encerrada ou baixada não pede nada", () => {
    expect(problemasDaDivida({ ...boa, status: "baixada", contractNumber: null }, ctx)).toEqual([]);
  });

  it("agrupa por problema, na ordem da tela", () => {
    const r = qualidadeDosDados([boa, { ...boa, id: "2", needsSplit: true, contractNumber: null }], ctx);
    expect(r.find((x) => x.codigo === "desdobrar")?.ids).toEqual(["2"]);
    expect(r.find((x) => x.codigo === "sem_contrato")?.ids).toEqual(["2"]);
    expect(r[0].codigo).toBe("cnpj_incompleto");
  });
});
