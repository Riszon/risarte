import { describe, expect, it } from "vitest";
import { filtroDoEndereco, filtroEmPalavras, filtroParaOEndereco, relatorioDaListaDeDividas } from "@/lib/finance/dividas-exportacao";
import { FILTROS_VAZIOS, type DebtListRow } from "@/lib/finance/dividas";
import { totaisDoRelatorio } from "@/lib/finance/relatorio";

// LEVANTAMENTO DE DÍVIDAS, FASE 7: exportar a lista (Excel e PDF, um modelo só).
const linha = (o: Partial<DebtListRow>): DebtListRow => ({
  id: "d", code: "DV-1", clinicId: "L", clinicName: "Londrina", supplierId: "s", supplierName: "Banco", supplierKind: null,
  categoryId: "c1", subcategoryId: null, natureCode: null, tagIds: [], status: "inadimplente", dueDate: "2025-12-01",
  originalCents: 1000, updatedCents: 1500, priority: null, ownerUserId: null, origin: "A", contractNumber: "C-9", description: null,
  installmentLabel: null, needsSplit: false, bundledCount: 1, groupCode: null, nextAction: null, nextActionOn: null,
  negativada: true, protestada: false, judicial: false, propostaCents: null, propostaValidade: null, custasCents: 0, lastCheckedOn: null,
  ...o,
});

describe("o filtro viaja no endereço", () => {
  it("ida e volta; só as chaves conhecidas; ordem inválida vira vencimento", () => {
    const q = filtroParaOEndereco({ ...FILTROS_VAZIOS, devedor: "L", situacao: "inadimplente" }, "valor");
    const p = Object.fromEntries(new URLSearchParams(q));
    expect(filtroDoEndereco(p)).toEqual({ filtros: { ...FILTROS_VAZIOS, devedor: "L", situacao: "inadimplente" }, ordem: "valor" });
    expect(filtroDoEndereco({ f: JSON.stringify({ intruso: "x", busca: 3 }), o: "drop table" })).toEqual({ filtros: FILTROS_VAZIOS, ordem: "vencimento" });
    expect(filtroDoEndereco({ f: "{não é json" }).filtros).toEqual(FILTROS_VAZIOS);
  });
  it("em palavras, com os nomes", () => {
    expect(filtroEmPalavras({ ...FILTROS_VAZIOS, devedor: "L", situacao: "inadimplente" }, (_c, v) => (v === "L" ? "Londrina" : v))).toBe(
      "Devedor: Londrina · Situação: Inadimplente"
    );
    expect(filtroEmPalavras(FILTROS_VAZIOS, (_c, v) => v)).toBe("Nenhum (todas as dívidas)");
  });
});

describe("o relatório da lista", () => {
  const r = relatorioDaListaDeDividas({
    linhas: [linha({ id: "a", saldoCents: 800, propostaCents: 600, acordo: { id: "x", codigo: "AD-00001", situacao: "em_andamento" } }), linha({ id: "b", code: "DV-2", saldoCents: 200 })],
    filtroEmPalavras: "Nenhum (todas as dívidas)",
    ordem: "vencimento",
    nomeDaCategoria: () => "Bancos",
    geradoEm: "15/11/2026",
    geradoPor: "Teste",
  });
  it("o devido é o da regra única; totais do rodapé somam o que está no documento", () => {
    expect(r.linhas.map((l) => [l.code, l.devido, l.desconto, l.acordo, l.restricoes])).toEqual([
      ["DV-1", 800, "25%", "AD-00001", "negativada"],
      ["DV-2", 200, null, null, "negativada"],
    ]);
    expect(totaisDoRelatorio(r)).toEqual({ original: 2000, devido: 1000, proposta: 600 });
    expect(r.resumo.find((x) => x.rotulo === "Total devido")?.valor).toContain("10,00");
  });
});
