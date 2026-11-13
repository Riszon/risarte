import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { conferirPlanilha } from "@/lib/empresarial/importacao";
import {
  COLUNA_DA_CONFERENCIA,
  COLUNAS_CALCULADAS_TITULARES,
  COLUNAS_DEPENDENTES,
  COLUNAS_TITULARES,
  LINHA_DO_CABECALHO,
  PRIMEIRA_LINHA,
  planilhaModeloDeTitulares,
} from "@/lib/empresarial/modelo-titulares-xlsx";
import {
  ABA_DEPENDENTES,
  ABA_INSTRUCOES,
  ABA_TITULARES,
  abaDosDependentes,
  abaDosTitulares,
  cpfDoTitular,
  LIMITE_DO_PLANO,
  lerDependentes,
  lerTitulares,
  textoDaLista,
  type Celulas,
} from "@/lib/empresarial/planilha-titulares";

// Pedido do dono (13/11/2026): planilha modelo com instruções, a logo e o
// titular do dependente escolhido numa lista ("Nome — CPF"). O gerador
// (servidor, ExcelJS) e a leitura (navegador, xlsx) são peças separadas: estas
// réguas preenchem o modelo GERADO e o leem pelo caminho da tela.

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

/** O mesmo que a tela faz com o arquivo escolhido (titulares-tab.tsx). */
function lerArquivo(buf: ArrayBuffer | Buffer) {
  const wb = XLSX.read(buf);
  const celulasDa = (nome: string | null): Celulas =>
    nome
      ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], {
          header: 1,
          defval: "",
          blankrows: true,
          raw: false,
        })
      : [];
  const tit = lerTitulares(celulasDa(abaDosTitulares(wb.SheetNames)));
  const dep = lerDependentes(celulasDa(abaDosDependentes(wb.SheetNames)), tit.linhas);
  return { nomes: wb.SheetNames, tit, dep };
}

async function modeloPreenchido(
  titulares: string[][],
  dependentes: string[][],
  pular = 0
) {
  const buf = await planilhaModeloDeTitulares({ empresa: "Padaria do Zé", geradoEm: "13/11/2026" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const t = wb.getWorksheet(ABA_TITULARES)!;
  titulares.forEach((linha, i) =>
    linha.forEach((v, j) => (t.getRow(PRIMEIRA_LINHA + pular + i).getCell(j + 1).value = v))
  );
  const d = wb.getWorksheet(ABA_DEPENDENTES)!;
  dependentes.forEach((linha, i) =>
    linha.forEach((v, j) => (d.getRow(PRIMEIRA_LINHA + i).getCell(j + 1).value = v))
  );
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("o modelo gerado", () => {
  it("abre pelas instruções, tem as três abas e nenhum exemplo nas abas de dados", async () => {
    const buf = await planilhaModeloDeTitulares({ empresa: "Padaria do Zé", geradoEm: "13/11/2026" });
    const { nomes, tit, dep } = lerArquivo(buf);
    expect(nomes).toEqual([ABA_INSTRUCOES, ABA_TITULARES, ABA_DEPENDENTES]);
    expect(tit.achouCabecalho).toBe(true);
    expect(dep.achouCabecalho).toBe(true);
    // Vazio de fábrica: o exemplo mora só na aba de instruções.
    expect(tit.linhas).toEqual([]);
    expect(dep.linhas).toEqual([]);
  });

  it("traz a logo, o nome da empresa e as listas", async () => {
    const buf = await planilhaModeloDeTitulares({ empresa: "Padaria do Zé", geradoEm: "13/11/2026" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    for (const aba of [ABA_INSTRUCOES, ABA_TITULARES, ABA_DEPENDENTES]) {
      expect(wb.getWorksheet(aba)!.getImages().length, aba).toBe(1);
    }
    const instr = wb.getWorksheet(ABA_INSTRUCOES)!;
    const textos: string[] = [];
    instr.eachRow((r) => r.eachCell((c) => textos.push(String(c.value ?? ""))));
    expect(textos.join("\n")).toContain("Empresa: Padaria do Zé");

    const t = wb.getWorksheet(ABA_TITULARES)!;
    expect((t.getRow(LINHA_DO_CABECALHO).values as unknown[]).slice(1, 8)).toEqual([
      ...COLUNAS_TITULARES,
      ...COLUNAS_CALCULADAS_TITULARES,
    ]);
    expect(t.getCell(`E${PRIMEIRA_LINHA}`).dataValidation.type).toBe("list");
    // A coluna escondida monta "Nome — CPF" com o MESMO travessão da leitura.
    const f = (t.getCell(`H${PRIMEIRA_LINHA}`).value as { formula: string }).formula;
    expect(f).toContain(`&" — "&`);
    expect(textoDaLista("A", "1")).toBe("A — 1");
    for (const c of ["H", "I", "J", "K", "L"]) expect(t.getColumn(c).hidden, c).toBe(true);
    // CPF e telefone como texto (o Excel não come o zero da frente).
    expect(t.getCell(`B${PRIMEIRA_LINHA}`).numFmt).toBe("@");

    const d = wb.getWorksheet(ABA_DEPENDENTES)!;
    expect(d.getRow(LINHA_DO_CABECALHO).values).toEqual([undefined, ...COLUNAS_DEPENDENTES, COLUNA_DA_CONFERENCIA]);
    const v = d.getCell(`A${PRIMEIRA_LINHA}`).dataValidation;
    expect(v.type).toBe("list");
    // A lista é a coluna COMPACTA (L): só quem tem plano com dependente e vaga.
    expect(v.formulae?.[0]).toContain(`${ABA_TITULARES}!$L$${PRIMEIRA_LINHA}`);
    // Sem trava: titular já cadastrado antes pode ser digitado pelo CPF.
    expect(v.showErrorMessage ?? false).toBe(false);
    expect(d.getCell(`D${PRIMEIRA_LINHA}`).dataValidation.type).toBe("list");
  });
});

describe("a planilha preenchida volta pelo caminho da tela", () => {
  it("o dependente com o titular escolhido na lista liga ao CPF certo", async () => {
    const buf = await modeloPreenchido(
      [
        ["Maria Silva", "123.456.789-09", "(43) 99999-0000", "", "Sem dependentes"],
        ["João Souza", "987.654.321-00", "(43) 98888-0000", "joao@x.com", "Dependente familiar"],
      ],
      [
        ["João Souza — 987.654.321-00", "111.222.333-96", "Ana Souza", "Cônjuge", ""],
        ["João Souza — 987.654.321-00", "444.555.666-25", "Pedro Souza", "Filho(a)", ""],
      ]
    );
    const { tit, dep } = lerArquivo(buf);
    expect(tit.linhas.map((l) => [l.linha, l.fullName, l.dependentPlan])).toEqual([
      [PRIMEIRA_LINHA, "Maria Silva", "NONE"],
      [PRIMEIRA_LINHA + 1, "João Souza", "FAMILY"],
    ]);
    expect(dep.linhas.map((d) => [d.linha, d.holderCpf, d.relationship])).toEqual([
      [PRIMEIRA_LINHA, "98765432100", "SPOUSE"],
      [PRIMEIRA_LINHA + 1, "98765432100", "CHILD"],
    ]);
    const c = conferirPlanilha(tit.linhas, dep.linhas, new Set());
    expect(c.erros).toEqual([]);
    expect(c.dependentes).toHaveLength(2);
  });

  it("a linha do erro é a linha que o RH vê no Excel, mesmo com linha em branco no meio", async () => {
    const buf = await modeloPreenchido([["Maria Silva", "123", "(43) 99999-0000", "", ""]], [], 3);
    const { tit } = lerArquivo(buf);
    const c = conferirPlanilha(tit.linhas, [], new Set());
    expect(c.erros).toEqual([{ aba: "Titulares", linha: PRIMEIRA_LINHA + 3, motivo: "CPF incompleto" }]);
  });

  it("titular digitado só pelo nome: acha se for único; senão diz para escolher na lista", () => {
    const titulares = [
      { fullName: "João Souza", cpf: "987.654.321-00", phone: "", email: "", dependentPlan: "NONE" },
      { fullName: "Ana Lima", cpf: "111.111.111-11", phone: "", email: "", dependentPlan: "NONE" },
      { fullName: "Ana Lima", cpf: "222.222.222-22", phone: "", email: "", dependentPlan: "NONE" },
    ];
    expect(cpfDoTitular("joão souza", titulares)).toBe("98765432100");
    expect(cpfDoTitular("Ana Lima", titulares)).toBe("");
    const c = conferirPlanilha(
      [],
      [{ holderCpf: "", holderTexto: "Ana Lima", cpf: "44455566625", relationship: "CHILD", linha: 7 }],
      new Set()
    );
    expect(c.erros[0].motivo).toContain("escolha o titular na lista");
  });
});

describe("a planilha do modelo ANTIGO continua entrando", () => {
  it("cabeçalho na linha 1, Titulares primeiro, CPF do titular digitado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Nome", "CPF", "Telefone", "E-mail", "Plano de Dependentes"],
        ["João Souza", "987.654.321-00", "(43) 98888-0000", "", "Dependente familiar"],
      ]),
      "Titulares"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["CPF do Titular", "CPF do Dependente", "Nome", "Parentesco", "Telefone"],
        ["987.654.321-00", "111.222.333-96", "Ana Souza", "esposa", ""],
      ]),
      "Dependentes"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const { tit, dep } = lerArquivo(buf);
    expect(tit.linhas.map((l) => [l.linha, l.cpf])).toEqual([[2, "987.654.321-00"]]);
    expect(dep.linhas.map((d) => [d.linha, d.holderCpf, d.fullName, d.relationship])).toEqual([
      [2, "98765432100", "Ana Souza", "SPOUSE"],
    ]);
  });

  it("a aba é achada pelo nome, nunca pela posição", () => {
    expect(abaDosTitulares([ABA_INSTRUCOES, ABA_TITULARES, ABA_DEPENDENTES])).toBe(ABA_TITULARES);
    expect(abaDosTitulares(["Planilha1"])).toBe("Planilha1");
    expect(abaDosDependentes([ABA_INSTRUCOES, ABA_TITULARES])).toBeNull();
  });
});

describe("o plano do titular limita os dependentes (pedido do dono, 13/11/2026)", () => {
  const tit = (cpf: string, plano: string) => ({
    fullName: "T " + cpf,
    cpf,
    phone: "(43) 99999-0000",
    email: "",
    dependentPlan: plano,
    planoNaPlanilha: true,
  });
  const dep = (holderCpf: string, cpf: string, linha: number) => ({
    holderCpf,
    cpf,
    relationship: "CHILD",
    linha,
  });
  const A = "11111111111";
  const B = "22222222222";
  const C = "33333333333";
  const D = "44444444444";
  const motivos = (c: ReturnType<typeof conferirPlanilha>) => c.erros.map((e) => [e.linha, e.motivo]);

  it("os limites: sem = 0, individual = 1, familiar = 3, familiar + extras = sem limite", () => {
    expect(LIMITE_DO_PLANO).toEqual({ NONE: 0, INDIVIDUAL: 1, FAMILY: 3, FAMILY_EXTRA: null });
  });

  it("recusa dependente de quem é Sem dependentes (ou deixou em branco) e quem passa do plano", () => {
    const c = conferirPlanilha(
      [tit(A, "NONE"), tit(B, "INDIVIDUAL"), tit(C, "FAMILY"), tit(D, "FAMILY_EXTRA")],
      [
        dep(A, "90000000001", 6),
        dep(B, "90000000002", 7),
        dep(B, "90000000003", 8),
        dep(C, "90000000004", 9),
        dep(C, "90000000005", 10),
        dep(C, "90000000006", 11),
        dep(C, "90000000007", 12),
        ...[13, 14, 15, 16, 17].map((l) => dep(D, "9000000001" + (l - 13), l)),
      ],
      new Set()
    );
    expect(motivos(c)).toEqual([
      [6, "o plano do titular na aba Titulares é Sem dependentes (escolha o plano dele)"],
      [8, "passou do limite do plano do titular (Dependente individual: 1 dependente)"],
      [12, "passou do limite do plano do titular (Dependente familiar: até 3 dependentes)"],
    ]);
  });

  it("menos do que o plano deixa entra (Familiar com 1): o sistema registra pela quantidade", () => {
    const c = conferirPlanilha([tit(C, "FAMILY")], [dep(C, "90000000004", 6)], new Set());
    expect(c.erros).toEqual([]);
  });

  it("planilha sem a coluna do plano e titular que já estava na empresa não têm limite aqui", () => {
    const semColuna = { ...tit(A, "NONE"), planoNaPlanilha: false };
    expect(conferirPlanilha([semColuna], [dep(A, "90000000001", 6)], new Set()).erros).toEqual([]);
    expect(conferirPlanilha([], [dep(B, "90000000002", 6)], new Set([B])).erros).toEqual([]);
  });

  it("a leitura marca a coluna do plano quando ela existe", () => {
    const com = lerTitulares([["Nome", "CPF", "Plano de Dependentes"], ["A", A, ""]]);
    expect(com.temColunaDoPlano).toBe(true);
    expect(com.linhas[0]).toMatchObject({ dependentPlan: "NONE", planoNaPlanilha: true });
    const sem = lerTitulares([["Nome", "CPF", "Telefone"], ["A", A, "43999990000"]]);
    expect(sem.linhas[0].planoNaPlanilha).toBe(false);
  });

  it("a fórmula do limite na planilha usa os mesmos números e os mesmos rótulos", async () => {
    const buf = await planilhaModeloDeTitulares({ empresa: "X", geradoEm: "13/11/2026" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const f = (wb.getWorksheet(ABA_TITULARES)!.getCell(`I${PRIMEIRA_LINHA}`).value as { formula: string }).formula;
    expect(f).toBe(
      `IF(E${PRIMEIRA_LINHA}="Dependente individual",1,IF(E${PRIMEIRA_LINHA}="Dependente familiar",3,IF(E${PRIMEIRA_LINHA}="Familiar + extras",999,0)))`
    );
  });
});

describe("as peças presas no lugar", () => {
  it("a tela baixa o modelo do servidor e lê pela peça pura", () => {
    const tela = ler("src/app/(app)/empresarial/[companyId]/titulares-tab.tsx");
    expect(tela).toContain("/modelo-titulares`}");
    expect(tela).toContain("abaDosTitulares(wb.SheetNames)");
    expect(tela).not.toContain("wb.SheetNames[0]");
    expect(tela).not.toContain("aoa_to_sheet");
  });
});
