import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  AJUDA_DIVIDAS,
  AJUDA_PROTESTOS,
  LINHAS_DO_MODELO,
  PRIMEIRA_LINHA_AVULSA,
  montarPlanilhaModelo,
} from "@/lib/finance/dividas-planilha-modelo";
import { CAMPOS_DIVIDAS, CAMPOS_PROTESTOS, mapeamentoPadrao } from "@/lib/finance/dividas-importacao";

// A planilha-modelo (refeita em 15/11/2026, pedido do dono): "Protestada? = Sim"
// na aba Dívidas leva a dívida sozinha para a aba Protestos; lá só se preenche
// o que é do protesto. A régua confere o arquivo gerado, célula a célula.

const listas = { devedores: ["Unidade A", "Unidade B"], categorias: ["Empréstimos"], naturezas: ["Financeira"] };

async function abrir() {
  const buf = await montarPlanilhaModelo(listas);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { wb, buf };
}

function colunaDe(ws: ExcelJS.Worksheet, titulo: string): string {
  const row = ws.getRow(1);
  for (let i = 1; i <= ws.columnCount; i++) if (row.getCell(i).value === titulo) return ws.getColumn(i).letter;
  throw new Error(`coluna "${titulo}" não achada`);
}

function formula(c: ExcelJS.Cell): string | null {
  const v = c.value as { formula?: string } | null;
  return v && typeof v === "object" && "formula" in v ? (v.formula ?? null) : null;
}

describe("planilha-modelo das dívidas", () => {
  const padrao = mapeamentoPadrao();
  const D = padrao.colunas.dividas;
  const P = padrao.colunas.protestos;

  it("abre no Como preencher; as abas têm os títulos do modelo padrão (é por eles que a importação acha as colunas)", async () => {
    const { wb } = await abrir();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Como preencher", "Dívidas", "Protestos", "Listas"]);
    const titulos = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1);
    expect(titulos(wb.getWorksheet("Dívidas")!)).toEqual(CAMPOS_DIVIDAS.filter((c) => D[c.campo]).map((c) => D[c.campo]));
    expect(titulos(wb.getWorksheet("Protestos")!)).toEqual(CAMPOS_PROTESTOS.filter((c) => P[c.campo]).map((c) => P[c.campo]));
  });

  it("todo campo tem a explicação (nota do título e tabela do Como preencher)", () => {
    for (const c of CAMPOS_DIVIDAS) if (D[c.campo]) expect(AJUDA_DIVIDAS[c.campo], c.campo).toBeDefined();
    for (const c of CAMPOS_PROTESTOS) if (P[c.campo]) expect(AJUDA_PROTESTOS[c.campo], c.campo).toBeDefined();
  });

  it("o nº (#) da dívida é a 1ª coluna e se preenche sozinho quando a linha tem dados", async () => {
    const { wb } = await abrir();
    const wd = wb.getWorksheet("Dívidas")!;
    expect(colunaDe(wd, D.chave)).toBe("A");
    expect(formula(wd.getCell("A2"))).toMatch(/^IF\(COUNTA\(B2:[A-Z]+2\)=0,"",ROW\(\)-1\)$/);
    expect(formula(wd.getCell(`A${LINHAS_DO_MODELO + 1}`))).toContain(`ROW()-1`);
  });

  it("Protestos: a linha N espelha a dívida da linha N marcada \"Protestada? = Sim\"; o espelho é travado, o resto livre", async () => {
    const { wb } = await abrir();
    const wd = wb.getWorksheet("Dívidas")!;
    const wp = wb.getWorksheet("Protestos")!;
    const prot = colunaDe(wd, D.protestada);
    const cond = `'Dívidas'!$${prot}7="Sim"`;
    const espelhados: [string, string | null][] = [
      ["devedor", D.devedor],
      ["credor", D.credor],
      ["cartorio", D.cartorio],
      ["custas", D.custas],
      ["vinculada", D.chave],
      ["ja_esta", null],
    ];
    for (const [campo, origem] of espelhados) {
      const cell = wp.getCell(`${colunaDe(wp, P[campo])}7`);
      const f = formula(cell);
      expect(f, campo).toContain(cond);
      if (origem) expect(f, campo).toContain(`'Dívidas'!$${colunaDe(wd, origem)}7`);
      else expect(f).toBe(`IF(${cond},"Sim","")`);
      // Travada é o padrão do Excel (o arquivo nem grava): basta não estar solta.
      expect(cell.protection?.locked, campo).not.toBe(false);
    }
    // O valor protestado já vem com o da dívida, mas é da pessoa.
    const valor = wp.getCell(`${colunaDe(wp, P.valor)}7`);
    expect(formula(valor)).toContain(`'Dívidas'!$${colunaDe(wd, D.valor_atualizado)}7`);
    expect(valor.protection?.locked).toBe(false);
    for (const campo of ["quantidade", "protocolo", "data", "anuencia", "observacoes"]) {
      const cell = wp.getCell(`${colunaDe(wp, P[campo])}7`);
      expect(formula(cell), campo).toBeNull();
      expect(cell.protection?.locked, campo).toBe(false);
    }
    // O ExcelJS lê a proteção mas não a declara no tipo.
    expect((wp as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet).toBe(true);
  });

  it("Protestos: a parte livre (protestos fora da aba Dívidas) é toda editável e sem fórmula", async () => {
    const { wb } = await abrir();
    const wp = wb.getWorksheet("Protestos")!;
    expect(PRIMEIRA_LINHA_AVULSA).toBeGreaterThan(LINHAS_DO_MODELO + 1);
    for (const c of CAMPOS_PROTESTOS) {
      if (!P[c.campo]) continue;
      const cell = wp.getCell(`${colunaDe(wp, P[c.campo])}${PRIMEIRA_LINHA_AVULSA}`);
      expect(formula(cell), c.campo).toBeNull();
      expect(cell.protection?.locked, c.campo).toBe(false);
    }
  });

  it("como a importação lê (xlsx): o modelo em branco não traz nenhuma linha de dado", async () => {
    const { buf } = await abrir();
    const wb = XLSX.read(buf, { cellDates: true });
    for (const nome of ["Dívidas", "Protestos"]) {
      const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null });
      const cheias = m.slice(1).filter((r) => (r ?? []).some((v) => v !== null && String(v).trim() !== ""));
      expect(cheias, nome).toHaveLength(0);
    }
  });
});
