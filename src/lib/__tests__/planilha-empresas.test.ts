// 1047 — A PLANILHA DE EMPRESAS (migração das empresas que já estão no
// programa; pedido do dono, 16/11/2026).
//
// O gerador (servidor, ExcelJS) e a leitura (navegador, SheetJS) são peças
// separadas: estas réguas preenchem o modelo GERADO como uma pessoa faria e o
// leem pelo caminho da tela, até a conferência.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { completarPrecos } from "@/lib/empresarial/importacao-empresas-servidor";
import {
  LINHA_DO_CABECALHO_EMPRESAS,
  PRIMEIRA_LINHA_EMPRESAS,
  letraDaColuna,
  planilhaModeloDeEmpresas,
} from "@/lib/empresarial/modelo-empresas-xlsx";
import {
  ABA_EMPRESAS,
  ABA_INSTRUCOES_EMPRESAS,
  ABA_OUTROS_DOCUMENTOS,
  COLUNAS_EMPRESAS,
  COLUNAS_OUTROS_DOCUMENTOS,
  abaDasEmpresas,
  abaDosOutrosDocumentos,
  celulaDaPlanilha,
  conferirPlanilhaDeEmpresas,
  recusaDaImportacaoDeEmpresas,
  textoDaEmpresaNaLista,
  type ChaveDaEmpresa,
  type ContextoDaImportacao,
} from "@/lib/empresarial/planilha-empresas";

const UNIDADES = [
  { id: "00000000-0000-0000-0000-0000000000a1", nome: "Risarte Cambé - Centro" },
  { id: "00000000-0000-0000-0000-0000000000a2", nome: "Risarte Londrina - Centro" },
];
const CONSULTORES = [{ id: "00000000-0000-0000-0000-0000000000c1", nome: "Ana Consultora", email: "ana@example.com" }];
const ctx = (existentes: string[] = []): ContextoDaImportacao => ({
  documentosExistentes: new Set(existentes),
  unidades: UNIDADES,
  consultores: CONSULTORES,
});

const col = (k: ChaveDaEmpresa) => COLUNAS_EMPRESAS.findIndex((c) => c.chave === k) + 1;

type Linha = Partial<Record<ChaveDaEmpresa, string | number | Date>>;

/** O modelo gerado, preenchido como a equipe faria, e lido pelo caminho da tela. */
async function preencherELer(empresas: Linha[], outros: string[][] = [], pular = 0) {
  const buf = await planilhaModeloDeEmpresas({
    geradoEm: "16/11/2026",
    unidades: UNIDADES.map((u) => u.nome),
    consultores: CONSULTORES.map((c) => c.nome),
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(ABA_EMPRESAS)!;
  empresas.forEach((e, i) => {
    for (const [k, v] of Object.entries(e)) {
      ws.getCell(PRIMEIRA_LINHA_EMPRESAS + pular + i, col(k as ChaveDaEmpresa)).value = v as ExcelJS.CellValue;
    }
  });
  const wd = wb.getWorksheet(ABA_OUTROS_DOCUMENTOS)!;
  outros.forEach((o, i) => o.forEach((v, j) => (wd.getCell(PRIMEIRA_LINHA_EMPRESAS + i, j + 1).value = v)));
  const out = await wb.xlsx.writeBuffer();

  // O mesmo que importar-empresas-dialog.tsx faz.
  const lido = XLSX.read(out, { cellDates: true });
  const ler = (nome: string | null): unknown[][] =>
    nome
      ? XLSX.utils
          .sheet_to_json<unknown[]>(lido.Sheets[nome], { header: 1, defval: "", blankrows: true, raw: true })
          .map((l) => l.map(celulaDaPlanilha))
      : [];
  return {
    nomes: lido.SheetNames,
    empresas: ler(abaDasEmpresas(lido.SheetNames)),
    documentos: ler(abaDosOutrosDocumentos(lido.SheetNames)),
  };
}

const basica: Linha = {
  documento: "11.222.333/0001-81",
  razao: "Metalúrgica Exemplo Ltda",
  inicio: new Date(2026, 2, 1),
  quem_paga: "Empresa paga integral",
  mensalidade: "Por titular",
  boletos: "Um boleto único",
  vencimento: 10,
};

describe("o modelo gerado", () => {
  it("tem as abas na ordem e os títulos que a leitura procura", async () => {
    const buf = await planilhaModeloDeEmpresas({ geradoEm: "16/11/2026", unidades: ["A"], consultores: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([ABA_INSTRUCOES_EMPRESAS, ABA_EMPRESAS, ABA_OUTROS_DOCUMENTOS, "Listas"]);
    expect(wb.getWorksheet("Listas")!.state).toBe("hidden");
    const cab = wb.getWorksheet(ABA_EMPRESAS)!.getRow(LINHA_DO_CABECALHO_EMPRESAS);
    COLUNAS_EMPRESAS.forEach((c, i) => expect(cab.getCell(i + 1).value).toBe(c.titulo));
    const cabDoc = wb.getWorksheet(ABA_OUTROS_DOCUMENTOS)!.getRow(LINHA_DO_CABECALHO_EMPRESAS);
    COLUNAS_OUTROS_DOCUMENTOS.forEach((c, i) => expect(cabDoc.getCell(i + 1).value).toBe(c.titulo));
  });

  it("listas: fixas nas escolhas, a de unidades na aba Listas, a de empresas na aba Outros CNPJs", async () => {
    const buf = await planilhaModeloDeEmpresas({ geradoEm: "16/11/2026", unidades: ["A", "B"], consultores: ["C"] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(ABA_EMPRESAS)!;
    const r = PRIMEIRA_LINHA_EMPRESAS;
    expect(ws.getCell(r, col("quem_paga")).dataValidation?.formulae?.[0]).toContain("Empresa paga parcial");
    expect(ws.getCell(r, col("unidade_principal")).dataValidation?.formulae?.[0]).toBe("Listas!$A$2:$A$3");
    expect(ws.getCell(r, col("consultor")).dataValidation?.formulae?.[0]).toBe("Listas!$B$2:$B$2");
    expect(ws.getCell(r, col("documento")).numFmt).toBe("@");
    const lista = wb.getWorksheet(ABA_OUTROS_DOCUMENTOS)!.getCell("A6").dataValidation?.formulae?.[0];
    expect(lista).toMatch(/^OFFSET\(Empresas!\$[A-Z]+\$6,0,0,MAX\(1,COUNTIF/);
  });

  it("nenhuma célula com duas validações (o ExcelJS duplicava as de célula a célula)", async () => {
    const buf = await planilhaModeloDeEmpresas({ geradoEm: "16/11/2026", unidades: ["A"], consultores: ["C"] });
    const zip = await (await import("jszip")).default.loadAsync(buf);
    let medidas = 0;
    for (const nome of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      const xml = await zip.file(nome)!.async("string");
      const faixas = [...xml.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/g)].map((m) => m[1]);
      medidas += faixas.length;
      const colunas = faixas.map((f) => f.replace(/\d+/g, ""));
      expect(new Set(colunas).size, `${nome}: ${faixas.join(" ")}`).toBe(colunas.length);
    }
    // Régua que não acha nada tem de gritar: o modelo TEM validações.
    expect(medidas).toBeGreaterThan(10);
  });

  it("a fórmula da lista de empresas monta o mesmo texto que a leitura entende", async () => {
    const buf = await planilhaModeloDeEmpresas({ geradoEm: "16/11/2026", unidades: [], consultores: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const chave = letraDaColuna(COLUNAS_EMPRESAS.length + 1);
    const f = (wb.getWorksheet(ABA_EMPRESAS)!.getCell(`${chave}6`).value as { formula: string }).formula;
    expect(f).toContain(`&" — "&`);
    expect(textoDaEmpresaNaLista(" Razão ", " 1 ")).toBe("Razão — 1");
  });
});

describe("preencher e importar (o caminho da tela)", () => {
  it("duas empresas certas: tudo mapeado para o banco", async () => {
    const { empresas, documentos } = await preencherELer(
      [
        {
          ...basica,
          fantasia: "Metalex",
          titulares: 40,
          unidade_principal: "Risarte Londrina - Centro",
          unidades: "Todas",
          consultor: "Ana Consultora",
          resp_cpf: "529.982.247-25",
          resp_tel: "43999990000",
          cep: "86010000",
          uf: "pr",
        },
        {
          documento: "22.333.444/0001-90",
          razao: "Cooperativa B",
          inicio: "05/08/2026",
          quem_paga: "Empresa paga parcial",
          subsidio_tipo: "Percentual (%)",
          subsidio_valor: 50,
          mensalidade: "Valor fixo por empresa",
          fixo: 1500.5,
          boletos: "Um boleto por CNPJ",
          vencimento: 5,
          unidades: "Risarte Cambé - Centro",
          unidade_principal: "Risarte Londrina - Centro",
          preco_titular: "R$ 35,00",
          formas: "Boleto, Pix",
        },
      ],
      [["Cooperativa B — 22.333.444/0001-90", "", "22.333.444/0002-71", "Filial"]]
    );
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx());
    expect(r.erros).toEqual([]);
    expect(r.empresas).toHaveLength(2);
    const [a, b] = r.empresas;
    expect(a.linha).toBe(PRIMEIRA_LINHA_EMPRESAS);
    expect(a.empresa).toMatchObject({
      cnpj: "11222333000181",
      legal_name: "Metalúrgica Exemplo Ltda",
      trade_name: "Metalex",
      contract_started_at: "2026-03-01",
      contracted_holders: 40,
      payment_model: "COMPANY_PAYS",
      billing_basis: "PER_EMPLOYEE",
      billing_model: "unico",
      due_day: 10,
      main_clinic_id: UNIDADES[1].id,
      assigned_consultant_id: CONSULTORES[0].id,
      responsible_cpf: "529.982.247-25",
      responsible_phone: "(43) 99999-0000",
      payment_methods: ["BOLETO", "PIX", "CARD"],
      default_max_installments: 24,
      status: "ACTIVE",
      category: "empresa_privada",
    });
    expect(a.empresa.address).toEqual({ zipCode: "86010-000", state: "PR" });
    expect(a.unidades).toEqual([]); // "Todas" = sem restrição
    expect(a.precos).toBeNull(); // sem preço = o da rede
    expect(a.documentos).toEqual([
      { doc_type: "CNPJ", doc_number: "11222333000181", holder_cpf: null, is_primary: true, nickname: "Matriz" },
    ]);

    expect(b.empresa).toMatchObject({
      contract_started_at: "2026-08-05",
      payment_model: "COMPANY_PARTIAL",
      company_subsidy_type: "PERCENT",
      company_subsidy_value: 50,
      billing_basis: "FIXED_PER_COMPANY",
      fixed_monthly_cents: 150050,
      billing_model: "por_cnpj",
      payment_methods: ["BOLETO", "PIX"],
    });
    // A principal entra na parceria quando ela é limitada.
    expect(b.unidades).toEqual([UNIDADES[0].id, UNIDADES[1].id]);
    expect(b.precos).toMatchObject({ holder_fee_cents: 3500, dependent_individual_fee_cents: null });
    expect(b.documentos[1]).toEqual({
      doc_type: "CNPJ",
      doc_number: "22333444000271",
      holder_cpf: null,
      is_primary: false,
      nickname: "Filial",
    });
  });

  it("a linha do erro é a do Excel (linhas em branco contam) e falta o obrigatório", async () => {
    const { empresas, documentos } = await preencherELer([{ razao: "Sem documento" }], [], 2);
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx());
    expect(r.empresas).toEqual([]);
    const linha = PRIMEIRA_LINHA_EMPRESAS + 2;
    const motivos = r.erros.filter((e) => e.linha === linha).map((e) => e.motivo);
    expect(motivos).toEqual(
      expect.arrayContaining([
        "falta o documento principal (CNPJ)",
        "falta o início do contrato",
        "falta quem paga",
        "falta a mensalidade (por titular ou valor fixo)",
        "falta a forma dos boletos",
        "falta o dia do vencimento",
      ])
    );
  });

  it("documento já cadastrado e repetido na planilha são recusados", async () => {
    const { empresas, documentos } = await preencherELer([basica, { ...basica, razao: "Outra" }]);
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx(["11222333000181"]));
    const motivos = r.erros.map((e) => e.motivo);
    expect(motivos).toContain("empresa já cadastrada no sistema (este documento já existe)");
    expect(motivos).toContain(`documento repetido (já está na linha ${PRIMEIRA_LINHA_EMPRESAS})`);
  });

  it("regras que dependem de outra coluna", async () => {
    const { empresas, documentos } = await preencherELer([
      { ...basica, quem_paga: "Empresa paga parcial" },
      { ...basica, documento: "33.444.555/0001-01", mensalidade: "Valor fixo por empresa" },
      { ...basica, documento: "44.555.666/0001-02", boletos: "Um boleto por CNPJ" },
      { ...basica, documento: "55.666.777/0001-03", unidade_principal: "Unidade que não existe", vencimento: 31 },
      { ...basica, documento: "66.777.888/0001-04", inicio: "amanhã", tipo_doc: "CAEPF" },
    ]);
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx());
    const m = (i: number) => r.erros.filter((e) => e.linha === PRIMEIRA_LINHA_EMPRESAS + i).map((e) => e.motivo).join(" | ");
    expect(m(0)).toMatch(/escolha o tipo do subsídio/);
    expect(m(1)).toMatch(/informe o valor fixo mensal/);
    expect(m(2)).toMatch(/precisa de pelo menos mais um documento/);
    expect(m(3)).toMatch(/unidade principal “Unidade que não existe” não existe/);
    expect(m(3)).toMatch(/dia do vencimento: de 1 a 28/);
    expect(m(4)).toMatch(/não é uma data/);
    expect(m(4)).toMatch(/CPF do titular/);
  });

  it("Outros CNPJs: a empresa tem de estar na aba Empresas", async () => {
    const { empresas, documentos } = await preencherELer([basica], [["Fantasma — 99.999.999/0001-99", "", "12.345.678/0001-95"]]);
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx());
    expect(r.erros).toEqual([
      { aba: ABA_OUTROS_DOCUMENTOS, linha: PRIMEIRA_LINHA_EMPRESAS, motivo: "a empresa não está na aba Empresas (escolha na lista)" },
    ]);
  });

  it("planilha sem nenhuma empresa não importa calada", async () => {
    const { empresas, documentos } = await preencherELer([]);
    const r = conferirPlanilhaDeEmpresas(empresas, documentos, ctx());
    expect(r.erros.map((e) => e.motivo)).toEqual(["nenhuma empresa preenchida"]);
  });
});

describe("o servidor e o banco", () => {
  it("o preço deixado em branco é o da rede (a linha da empresa substitui a da rede inteira)", () => {
    const [e] = completarPrecos(
      [
        {
          linha: 6,
          empresa: {} as never,
          documentos: [],
          unidades: [],
          precos: {
            holder_fee_cents: 3500,
            dependent_individual_fee_cents: null,
            dependent_family_fee_cents: null,
            dependent_family_extra_fee_cents: null,
            dependent_mode: "FAMILY_PACKAGE",
          },
        },
      ],
      {
        holder_fee_cents: 3990,
        dependent_individual_fee_cents: 3991,
        dependent_family_fee_cents: 5990,
        dependent_family_extra_fee_cents: 1990,
      }
    );
    expect(e.precos).toMatchObject({ holder_fee_cents: 3500, dependent_individual_fee_cents: 3991, dependent_family_extra_fee_cents: 1990 });
  });

  it("a 1047 grava todo campo que a conferência entrega", () => {
    const sql = readFileSync("supabase/migrations/1047_importar_empresas.sql", "utf8");
    const campos = [
      "cnpj", "legal_name", "trade_name", "state_registration", "category", "status", "contract_started_at",
      "contracted_holders", "contracted_dependents", "employee_count", "main_clinic_id", "payment_model",
      "company_subsidy_type", "company_subsidy_value", "billing_basis", "fixed_monthly_cents", "billing_model",
      "due_day", "payment_methods", "default_max_installments", "grace_period_days", "employee_grace_period_days",
      "responsible_name", "responsible_role", "responsible_cpf", "responsible_email", "responsible_phone",
      "address", "assigned_consultant_id", "notes",
    ];
    for (const c of campos) expect(sql, c).toMatch(new RegExp(`v_c ->>? '${c}'`));
    expect(sql).toContain("raise exception 'DOCUMENT_EXISTS:%'");
    expect(sql).toContain("security invoker");
  });

  it("a recusa do banco, em português", () => {
    expect(recusaDaImportacaoDeEmpresas("DOCUMENT_EXISTS:11222333000181")).toMatch(/já está cadastrado.*Nada foi gravado/);
    expect(recusaDaImportacaoDeEmpresas("x")).toMatch(/Nada foi gravado/);
  });
});
