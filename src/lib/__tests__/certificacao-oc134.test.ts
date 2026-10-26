import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INDICADORES, lerOrigem } from "@/lib/certificacao";

// OC-00134 (26/10/2026): dois itens da certificação contavam o que nenhuma
// tela grava mais — a anamnese antiga (`clinical_anamnesis`, 0 linhas no
// treino desde sempre) e o lançamento `manual` de uma tela "Razão" que não
// existe. A missão ficava impossível sem nada avisar: o Coordenador preenchia
// as fichas de anamnese e via "0 de 15".

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const indicador = (chave: string) => {
  const i = INDICADORES.find((x) => x.chave === chave);
  if (!i) throw new Error(`indicador ${chave} sumiu do catálogo`);
  return i;
};

describe("as anamneses que o Coordenador preenche contam", () => {
  it("a origem são as FICHAS (anamnesis_fills), pela data em que foram preenchidas", () => {
    const i = indicador("anamnese_clinica");
    expect(lerOrigem(i.origem)).toMatchObject({ tabela: "anamnesis_fills", coluna: "filled_by", filtros: [] });
    expect(i.quando).toBe("filled_at");
  });

  it("vale só para quem consegue preencher ficha: o Coordenador", () => {
    expect(indicador("anamnese_clinica").papeis).toEqual(["clinical_coordinator"]);
    // A régua da tela: quem grava a ficha é o Coordenador (e o Admin).
    const acao = ler("src/app/(app)/prontuarios/[id]/anamnesis-actions.ts");
    expect(acao).toMatch(/hasRoleInClinic\(session, cid, \["clinical_coordinator"\]\)/);
  });
});

describe("o lançamento à mão conta onde ele nasce hoje", () => {
  it("Lançamentos no razão = os criados na Conciliação, pela linha do extrato", () => {
    const i = indicador("lancamentos_razao");
    expect(lerOrigem(i.origem)).toMatchObject({
      tabela: "financial_entries",
      coluna: "created_by",
      filtros: [{ coluna: "source_type", valor: "bank_transaction" }],
    });
    expect(i.onde).toContain("Conciliação");
  });
});

describe("as réguas", () => {
  it("nenhum indicador volta a contar o que nada grava", () => {
    for (const i of INDICADORES) {
      const o = lerOrigem(i.origem);
      expect(o.tabela, i.chave).not.toBe("clinical_anamnesis");
      if (o.tabela === "financial_entries") {
        expect(o.filtros.map((f) => f.valor), i.chave).not.toContain("manual");
      }
    }
  });

  it("o check:indicadores avisa o que nunca foi preenchido no treino", () => {
    const script = ler("scripts/conferir-indicadores.mjs");
    expect(script).toContain("NUNCA foram preenchidos no treino");
    expect(script).toMatch(/if \(rows\[0\]\.n === 0\) nuncaUsados\.push/);
  });
});
