import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { conferirPlanilha } from "@/lib/empresarial/importacao";
import {
  COLUNA_DO_PAGADOR,
  LINHA_DO_CABECALHO,
  PRIMEIRA_LINHA,
  planilhaModeloDeTitulares,
} from "@/lib/empresarial/modelo-titulares-xlsx";
import {
  conferirPagador,
  descricaoDaCobrancaAParte,
  documentoLegivel,
  pagadorDaCobranca,
  PAGADOR_NA_PLANILHA,
} from "@/lib/empresarial/pagador-dos-dependentes";
import { ABA_TITULARES, abaDosTitulares, lerTitulares, type Celulas } from "@/lib/empresarial/planilha-titulares";

// 1049 — QUEM PAGA OS DEPENDENTES (pedido do dono, 18/11/2026): a escolha
// mora no titular (Empresa / o próprio titular / outro pagador com CPF ou
// CNPJ); quem não paga pela empresa ganha uma cobrança à parte, gerada no
// mesmo clique da mensalidade da empresa.

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const CPF = "52998224725";
const CNPJ = "11222333000181";

describe("a escolha (conferirPagador)", () => {
  it("Empresa e Titular não pedem mais nada", () => {
    expect(conferirPagador({ pagador: "EMPRESA" })).toEqual({
      ok: true,
      valor: { pagador: "EMPRESA", nome: null, documento: null, email: null, celular: null },
    });
    expect(conferirPagador({ pagador: "titular", nome: "x", documento: "y" })).toEqual({
      ok: true,
      valor: { pagador: "TITULAR", nome: null, documento: null, email: null, celular: null },
    });
  });

  it("Outro pagador exige nome e um CPF ou CNPJ válido, e grava só os números", () => {
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: "529.982.247-25", email: "Ana@Ex.com" })).toEqual({
      ok: true,
      valor: { pagador: "OUTRO", nome: "Ana", documento: CPF, email: "ana@ex.com", celular: null },
    });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Loja", documento: "11.222.333/0001-81", celular: "(43) 99999-0000" })).toMatchObject({
      ok: true,
      valor: { documento: CNPJ },
    });
    expect(conferirPagador({ pagador: "OUTRO", nome: "", documento: CPF })).toMatchObject({ ok: false });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: "52998224700" })).toMatchObject({
      ok: false,
      motivo: expect.stringContaining("CPF"),
    });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: "11222333000100" })).toMatchObject({
      ok: false,
      motivo: expect.stringContaining("CNPJ"),
    });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: "123" })).toMatchObject({ ok: false });
    expect(conferirPagador({ pagador: "QUALQUER" })).toMatchObject({ ok: false });
  });

  // ASA5 (4023, decisão 12a): o Asaas precisa de para onde mandar a cobrança.
  it("Outro pagador exige o e-mail ou o celular, e confere os dois", () => {
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: CPF })).toMatchObject({
      ok: false,
      motivo: expect.stringContaining("e-mail ou o celular"),
    });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: CPF, email: "sem-arroba" })).toMatchObject({ ok: false });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: CPF, celular: "9999" })).toMatchObject({ ok: false });
    expect(conferirPagador({ pagador: "OUTRO", nome: "Ana", documento: CPF, celular: "43 99999-0000" })).toMatchObject({
      ok: true,
      valor: { celular: "43999990000", email: null },
    });
  });
});

describe("em nome de quem sai a cobrança à parte (pagadorDaCobranca)", () => {
  const base = {
    full_name: "Maria Silva",
    cpf: "529.982.247-25",
    dependents_payer: "EMPRESA",
    dependents_payer_name: null,
    dependents_payer_document: null,
  };
  it("Empresa: nenhuma (os dependentes vão na cobrança da empresa)", () => {
    expect(pagadorDaCobranca(base)).toBeNull();
  });
  it("Titular: no nome e no CPF dele", () => {
    expect(pagadorDaCobranca({ ...base, dependents_payer: "TITULAR" })).toEqual({ nome: "Maria Silva", documento: CPF });
  });
  it("Titular sem CPF: cai na empresa em vez de sumir", () => {
    expect(pagadorDaCobranca({ ...base, dependents_payer: "TITULAR", cpf: null })).toBeNull();
  });
  it("Outro: no nome e no documento informados", () => {
    expect(
      pagadorDaCobranca({
        ...base,
        dependents_payer: "OUTRO",
        dependents_payer_name: "Loja do Zé",
        dependents_payer_document: CNPJ,
      })
    ).toEqual({ nome: "Loja do Zé", documento: CNPJ });
  });
  it("textos que a equipe lê", () => {
    expect(documentoLegivel(CPF)).toBe("CPF 529.982.247-25");
    expect(documentoLegivel(CNPJ)).toBe("CNPJ 11.222.333/0001-81");
    expect(descricaoDaCobrancaAParte("Mensalidade 11/2026", " Maria ")).toBe(
      "Mensalidade 11/2026 — dependentes de Maria"
    );
  });
});

describe("a planilha de titulares (decisão 4)", () => {
  async function preenchido(pagador: string) {
    const buf = await planilhaModeloDeTitulares({ empresa: "Padaria do Zé", geradoEm: "18/11/2026" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const t = wb.getWorksheet(ABA_TITULARES)!;
    const r = t.getRow(PRIMEIRA_LINHA);
    ["Maria Silva", "529.982.247-25", "(43) 99999-0000", "", "Dependente familiar"].forEach(
      (v, j) => (r.getCell(j + 1).value = v)
    );
    r.getCell(13).value = pagador;
    return { wb, buf: (await wb.xlsx.writeBuffer()) as ArrayBuffer };
  }
  function lerArquivo(buf: ArrayBuffer) {
    const wb = XLSX.read(buf);
    const nome = abaDosTitulares(wb.SheetNames)!;
    const celulas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], {
      header: 1,
      defval: "",
      blankrows: true,
      raw: false,
    }) as Celulas;
    return lerTitulares(celulas);
  }

  it("a coluna M tem o título que a leitura procura e a lista Empresa / Titular", async () => {
    const { wb } = await preenchido("");
    const t = wb.getWorksheet(ABA_TITULARES)!;
    expect(t.getCell(`M${LINHA_DO_CABECALHO}`).value).toBe(COLUNA_DO_PAGADOR);
    const v = t.getCell(`M${PRIMEIRA_LINHA}`).dataValidation;
    expect(v.type).toBe("list");
    expect(v.formulae?.[0]).toBe(`"${PAGADOR_NA_PLANILHA.EMPRESA},${PAGADOR_NA_PLANILHA.TITULAR}"`);
    // Leitura e gerador andam juntos (planilha-titulares.ts).
    expect(ler("src/lib/empresarial/planilha-titulares.ts")).toContain(`"${COLUNA_DO_PAGADOR.toLowerCase()}"`);
  });

  it("Titular na planilha chega à importação como TITULAR; em branco, EMPRESA", async () => {
    for (const [escrito, esperado] of [
      ["Titular", "TITULAR"],
      ["", "EMPRESA"],
      ["Empresa", "EMPRESA"],
    ] as const) {
      const tit = lerArquivo((await preenchido(escrito)).buf);
      const c = conferirPlanilha(tit.linhas, [], new Set());
      expect(c.erros, escrito).toEqual([]);
      expect(c.titulares[0].dependentsPayer, escrito).toBe(esperado);
    }
  });

  it("outro valor é erro da linha (Outro pagador só pela tela)", () => {
    const c = conferirPlanilha(
      [
        {
          fullName: "Maria Silva",
          cpf: CPF,
          phone: "(43) 99999-0000",
          email: "",
          dependentPlan: "FAMILY",
          pagadorDosDependentes: "Outro",
          linha: 6,
        },
      ],
      [],
      new Set()
    );
    expect(c.erros[0]).toMatchObject({ linha: 6, motivo: expect.stringContaining("quem paga os dependentes") });
  });
});

describe("o banco (1049) e o caminho do app", () => {
  const sql = ler("supabase/migrations/1049_pagador_dos_dependentes.sql");

  it("documento nulo não escapa da regra (check aceita NULL)", () => {
    expect(sql).toContain("coalesce(dependents_payer_document, '') ~ '^([0-9]{11}|[0-9]{14})$'");
    expect(sql).toContain("coalesce(payer_document, '') ~ '^([0-9]{11}|[0-9]{14})$'");
  });

  it("a trava do mês conta o pagador e a planilha grava a coluna", () => {
    expect(sql).toMatch(/\(company_id, company_document_id, employee_id, reference_month\)\s+nulls not distinct/);
    expect(sql).toContain("insert into empresarial.employees (company_id, cpf, full_name, phone, email, dependent_plan, dependents_payer)");
    expect(sql).toMatch(/revoke all on function empresarial\.importar_titulares\(uuid, jsonb, jsonb\) from public, anon, authenticated/);
  });

  it("a importação manda a coluna ao banco", () => {
    expect(ler("src/app/(app)/empresarial/[companyId]/employee-actions.ts")).toContain(
      "dependents_payer: t.dependentsPayer"
    );
  });

  it("salvar a escolha: só quem cuida dos titulares, conferida pela mesma regra", () => {
    const src = ler("src/app/(app)/empresarial/[companyId]/employee-actions.ts");
    const fn = src.slice(src.indexOf("export async function salvarPagadorDosDependentes"));
    const corpo = fn.slice(0, fn.indexOf("\nexport ", 10) > 0 ? fn.indexOf("\nexport ", 10) : undefined);
    expect(corpo).toContain("canManageEmployees");
    expect(corpo).toContain("conferirPagador");
    expect(corpo).toContain(`.eq("company_id", companyId)`);
  });

  it("a mensalidade da empresa e a em lote gravam de quem é a cobrança à parte", () => {
    for (const p of [
      "src/app/(app)/empresarial/[companyId]/billing-actions.ts",
      "src/app/(app)/empresarial/cobrancas/actions.ts",
    ]) {
      const src = ler(p);
      expect(src, p).toContain("employee_id");
      expect(src, p).toContain("payer_document");
    }
    // A conta: os dependentes saem da cobrança da empresa e vão para a à parte.
    const conta = ler("src/lib/empresarial/cobranca-servidor.ts");
    expect(conta).toContain("pagadorDaCobranca(");
    expect(conta).toContain("aParte");
  });
});
