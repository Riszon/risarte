import "server-only";
import ExcelJS from "exceljs";
import { LOGO_EMPRESARIAL_PNG_BASE64, LOGO_EMPRESARIAL_PROPORCAO } from "./logo-planilha";
import {
  ABA_EMPRESAS,
  ABA_INSTRUCOES_EMPRESAS,
  ABA_OUTROS_DOCUMENTOS,
  COLUNAS_EMPRESAS,
  COLUNAS_OUTROS_DOCUMENTOS,
  ROTULO_BOLETOS,
  ROTULO_MENSALIDADE,
  TODAS_AS_UNIDADES,
  type Coluna,
} from "./planilha-empresas";
import { PAYMENT_MODEL_LABELS } from "./constants";

/**
 * A PLANILHA MODELO DE EMPRESAS (migração; pedido do dono, 16/11/2026).
 *
 * Quem preenche é a EQUIPE da Risarte, levando para o sistema as empresas que
 * já estão no programa. Titulares e dependentes NÃO entram aqui: cada empresa
 * importada recebe depois a planilha própria deles.
 *
 * ⚠️ Os títulos, as listas e o texto da lista de empresas ("Razão — CNPJ")
 * vêm de `planilha-empresas.ts`, a mesma fonte que a leitura usa. A régua
 * `planilha-empresas.test.ts` gera este arquivo e o lê de volta.
 *
 * ⚠️ OS EXEMPLOS FICAM SÓ NA ABA DE INSTRUÇÕES (lição da planilha de
 * titulares: exemplo esquecido na aba de dados vira cadastro).
 */

const AZUL = "FF0A2E57";
const VINHO = "FF7A1E3C";
const AREIA = "FFF6F2EA";
const CINZA = "FF6B7280";
const AMARELO = "FFFFF7D6";
const BRANCO = "FFFFFFFF";

export const LINHA_DO_CABECALHO_EMPRESAS = 5;
export const PRIMEIRA_LINHA_EMPRESAS = LINHA_DO_CABECALHO_EMPRESAS + 1;
export const LINHAS_DE_EMPRESAS = 300;
const ULTIMA = PRIMEIRA_LINHA_EMPRESAS + LINHAS_DE_EMPRESAS - 1;
const ABA_LISTAS = "Listas";

const borda: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD9D4C7" } },
  left: { style: "thin", color: { argb: "FFD9D4C7" } },
  bottom: { style: "thin", color: { argb: "FFD9D4C7" } },
  right: { style: "thin", color: { argb: "FFD9D4C7" } },
};

/** 1 → A, 27 → AA. */
export function letraDaColuna(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const colDe = (chave: string) => letraDaColuna(COLUNAS_EMPRESAS.findIndex((c) => c.chave === chave) + 1);

function logo(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, alturaPx = 52) {
  const id = wb.addImage({ base64: LOGO_EMPRESARIAL_PNG_BASE64, extension: "png" });
  ws.addImage(id, {
    tl: { col: 0.15, row: 0.25 },
    ext: { width: Math.round(alturaPx * LOGO_EMPRESARIAL_PROPORCAO), height: alturaPx },
    editAs: "absolute",
  });
}

function topo(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, titulo: string, orientacao: string, ultima: string) {
  for (const r of [1, 2, 3]) ws.getRow(r).height = 22;
  logo(wb, ws);
  ws.mergeCells(`D1:${ultima}2`);
  const t = ws.getCell("D1");
  t.value = titulo;
  t.font = { bold: true, size: 15, color: { argb: AZUL } };
  t.alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(`A4:${ultima}4`);
  const o = ws.getCell("A4");
  o.value = orientacao;
  o.font = { size: 11, color: { argb: VINHO }, italic: true };
  o.alignment = { vertical: "middle", wrapText: true };
  ws.getRow(4).height = 34;
}

function cabecalho<K extends string>(ws: ExcelJS.Worksheet, colunas: readonly Coluna<K>[]) {
  const row = ws.getRow(LINHA_DO_CABECALHO_EMPRESAS);
  colunas.forEach((col, i) => {
    const c = row.getCell(i + 1);
    c.value = col.titulo;
    c.font = { bold: true, color: { argb: BRANCO }, size: 11 };
    // Obrigatória em vinho, as outras em azul: o * e a cor dizem a mesma coisa.
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.obrigatorio === "Sim" ? VINHO : AZUL } };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    c.border = borda;
    if (col.ajuda) c.note = col.ajuda;
  });
  row.height = 46;
}

const listaFixa = (valores: readonly string[]) => `"${valores.join(",")}"`;

/**
 * UMA validação por COLUNA (a faixa inteira), nunca uma por célula.
 *
 * ⚠️ Validação célula a célula sai DUPLICADA do ExcelJS: ele ordena os
 * endereços como texto ("Z10" antes de "Z6"), junta Z10:Z305 e depois cria
 * outra Z6:Z305 por cima — duas regras na mesma célula, que o Excel pode
 * tratar como arquivo a reparar. Com a faixa como endereço, o ExcelJS grava a
 * regra como veio (régua em planilha-empresas.test.ts).
 */
type ComValidacoes = { dataValidations: { add(endereco: string, v: ExcelJS.DataValidation): void } };

function validarFaixa(ws: ExcelJS.Worksheet, faixa: string, v: ExcelJS.DataValidation) {
  (ws as unknown as ComValidacoes).dataValidations.add(faixa, v);
}

function validacaoDa<K extends string>(
  col: Coluna<K>,
  listas: { unidades: string; consultores: string }
): ExcelJS.DataValidation | null {
  if (col.lista) {
    const formula =
      col.lista === "unidades" ? listas.unidades : col.lista === "consultores" ? listas.consultores : listaFixa(col.lista);
    return {
      type: "list",
      allowBlank: true,
      formulae: [formula],
      showInputMessage: true,
      promptTitle: col.titulo.replace(" *", ""),
      prompt: col.ajuda.slice(0, 250),
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Escolha na lista",
      error: "Clique na setinha ▼ e escolha uma das opções.",
    };
  }
  if (col.chave === "vencimento") {
    return {
      type: "whole",
      operator: "between",
      allowBlank: true,
      formulae: [1, 28],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Dia do vencimento",
      error: "Um dia de 1 a 28.",
    };
  }
  if (col.formato === "data") {
    return {
      type: "date",
      operator: "greaterThan",
      allowBlank: true,
      formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Data",
      error: "Digite a data como dd/mm/aaaa.",
    };
  }
  return null;
}

/** As validações (uma por coluna) e o formato de cada célula. */
function prepararLinhas<K extends string>(
  ws: ExcelJS.Worksheet,
  colunas: readonly Coluna<K>[],
  ate: number,
  listas: { unidades: string; consultores: string }
) {
  colunas.forEach((col, i) => {
    const letra = letraDaColuna(i + 1);
    for (let r = PRIMEIRA_LINHA_EMPRESAS; r <= ate; r++) {
      const cell = ws.getCell(`${letra}${r}`);
      cell.border = borda;
      if (col.formato === "texto") cell.numFmt = "@";
      if (col.formato === "data") cell.numFmt = "dd/mm/yyyy";
      if (col.formato === "dinheiro") cell.numFmt = "#,##0.00";
    }
    const v = validacaoDa(col, listas);
    if (v) validarFaixa(ws, `${letra}${PRIMEIRA_LINHA_EMPRESAS}:${letra}${ate}`, v);
  });
}

function faixasDasListas(nUnidades: number, nConsultores: number) {
  const faixa = (col: string, n: number) => `${ABA_LISTAS}!$${col}$2:$${col}$${Math.max(2, n + 1)}`;
  return { unidades: faixa("A", nUnidades), consultores: faixa("B", nConsultores) };
}

function abaDeListas(wb: ExcelJS.Workbook, unidades: readonly string[], consultores: readonly string[]) {
  const ws = wb.addWorksheet(ABA_LISTAS, { state: "hidden" });
  ws.getCell("A1").value = "Unidades";
  ws.getCell("B1").value = "Consultores";
  unidades.forEach((u, i) => (ws.getCell(`A${i + 2}`).value = u));
  consultores.forEach((c, i) => (ws.getCell(`B${i + 2}`).value = c));
}

function abaDeInstrucoes(wb: ExcelJS.Workbook, geradoEm: string, unidades: readonly string[]) {
  const ws = wb.addWorksheet(ABA_INSTRUCOES_EMPRESAS, {
    properties: { tabColor: { argb: VINHO } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 4 }, { width: 22 }, { width: 30 }, { width: 13 }, { width: 62 }];
  for (const r of [1, 2, 3]) ws.getRow(r).height = 24;
  logo(wb, ws, 60);

  let r = 5;
  const linha = (txt: string, estilo: Partial<ExcelJS.Font> = {}, altura?: number) => {
    ws.mergeCells(`B${r}:E${r}`);
    const c = ws.getCell(`B${r}`);
    c.value = txt;
    c.font = { size: 11, ...estilo };
    c.alignment = { wrapText: true, vertical: "top" };
    if (altura) ws.getRow(r).height = altura;
    r++;
    return c;
  };

  linha("Cadastro das empresas do programa (migração)", { bold: true, size: 18, color: { argb: AZUL } }, 28);
  linha(
    `Para levar ao sistema as empresas que JÁ fazem parte do Risarte Empresarial. Uso interno da equipe. Modelo gerado em ${geradoEm}.`,
    { color: { argb: CINZA } },
    32
  );
  r++;

  linha("Passo a passo", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  const passos = [
    `Abra a aba “${ABA_EMPRESAS}” e preencha UMA LINHA POR EMPRESA, a partir da primeira linha em branco abaixo dos títulos. Os títulos em vinho (com *) são obrigatórios; passe o mouse no título para ver a explicação.`,
    "O documento principal é o CNPJ da matriz — é por ele que a empresa é reconhecida. Se a empresa tem filiais ou outros documentos, eles vão na aba Outros CNPJs.",
    `Nas colunas com setinha ▼, clique na célula e escolha na lista (quem paga, mensalidade, boletos, unidade, consultor…). Não digite por cima.`,
    `Preços: preencha só o que foi combinado diferente da rede. Em branco, a empresa paga o preço padrão da rede — e usa os benefícios padrão da rede (ajuste fino depois, na ficha da empresa).`,
    `Empresa com mais de um CNPJ (ou que paga “Um boleto por CNPJ”): abra a aba “${ABA_OUTROS_DOCUMENTOS}”, escolha a empresa na setinha ▼ da coluna Empresa (a lista mostra as empresas já preenchidas) e digite o outro CNPJ. Uma linha por documento.`,
    "Salve (Excel, .xlsx) e importe em Empresarial → Importar empresas. Não mude o nome das abas nem os títulos das colunas.",
    "Depois de importar, cadastre os titulares e dependentes de cada empresa pela planilha própria deles (ficha da empresa → aba Titulares → Importar Excel).",
  ];
  passos.forEach((p, i) => {
    ws.getCell(`A${r}`).value = `${i + 1}.`;
    ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: AZUL } };
    ws.getCell(`A${r}`).alignment = { vertical: "top", horizontal: "right" };
    linha(p, {}, p.length > 160 ? 48 : 34);
  });
  r++;

  linha("O que vai em cada coluna", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  const cab = ws.getRow(r);
  ["Grupo", "Coluna", "Obrigatório?", "Como preencher"].forEach((t, i) => {
    const c = cab.getCell(i + 2);
    c.value = t;
    c.font = { bold: true, color: { argb: BRANCO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.border = borda;
  });
  r++;
  const tabela: [string, string, string, string][] = [
    ...COLUNAS_EMPRESAS.map((c) => [`${ABA_EMPRESAS} · ${c.grupo}`, c.titulo.replace(" *", ""), c.obrigatorio, c.ajuda || "—"] as [string, string, string, string]),
    ...COLUNAS_OUTROS_DOCUMENTOS.map((c) => [ABA_OUTROS_DOCUMENTOS, c.titulo.replace(" *", ""), c.obrigatorio, c.ajuda] as [string, string, string, string]),
  ];
  tabela.forEach(([grupo, col, obrig, como], i) => {
    const row = ws.getRow(r);
    [grupo, col, obrig, como].forEach((v, j) => {
      const c = row.getCell(j + 2);
      c.value = v;
      c.border = borda;
      c.alignment = { wrapText: true, vertical: "top" };
      if (j === 2 && v === "Sim") c.font = { bold: true, color: { argb: VINHO } };
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AREIA } };
    });
    row.height = como.length > 120 ? 46 : como.length > 60 ? 32 : 18;
    r++;
  });
  r++;

  linha("Exemplo (não copie para as outras abas)", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  const exemplo: [string, string][] = [
    ["Documento principal (CNPJ)", "12.345.678/0001-95"],
    ["Razão social", "Metalúrgica Exemplo Ltda"],
    ["Início do contrato", "01/03/2026"],
    ["Titulares contratados", "40"],
    ["Unidade principal", unidades[0] ?? "Risarte Londrina - Centro"],
    ["Unidades da parceria", TODAS_AS_UNIDADES],
    ["Quem paga", PAYMENT_MODEL_LABELS.COMPANY_PAYS],
    ["Mensalidade", ROTULO_MENSALIDADE.PER_EMPLOYEE],
    ["Boletos", ROTULO_BOLETOS.unico],
    ["Dia do vencimento", "10"],
    ["Preço por titular (R$)", "(em branco = preço da rede)"],
  ];
  for (const [k, v] of exemplo) {
    const row = ws.getRow(r);
    row.getCell(3).value = k;
    row.getCell(4).value = v;
    ws.mergeCells(`D${r}:E${r}`);
    for (const j of [3, 4]) {
      row.getCell(j).font = { color: { argb: CINZA } };
      row.getCell(j).border = borda;
    }
    r++;
  }
  r++;

  linha("Fica de fora desta planilha (de propósito)", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  for (const item of [
    "•  Titulares e dependentes — planilha própria, por empresa, depois da importação.",
    "•  Benefícios por procedimento, faixas de preço e divisão RisLife × Risarte — a empresa usa os padrões da rede; o que for diferente se ajusta na ficha.",
    "•  Cobrança de implantação — não é gerada: as empresas já estão no programa. A mensalidade segue o ciclo normal.",
  ]) {
    linha(item, {}, 30);
  }
  r++;

  linha("Antes de importar, confira", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  for (const item of [
    "☐  Toda empresa tem documento principal, razão social, início do contrato, quem paga, mensalidade, boletos e dia do vencimento.",
    "☐  Nenhuma empresa aparece duas vezes, e nenhuma já está cadastrada no sistema.",
    "☐  “Empresa paga parcial” tem o subsídio (tipo e valor); “Valor fixo por empresa” tem o valor fixo mensal.",
    "☐  “Um boleto por CNPJ” tem os outros CNPJs na aba Outros CNPJs.",
  ]) {
    linha(item, {}, 30);
  }
  r++;
  const aviso = linha(
    "Importante: a planilha entra inteira ou não entra. Se alguma linha tiver problema, o sistema não grava nada e mostra a aba e a linha a corrigir.",
    { bold: true },
    34
  );
  aviso.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARELO } };
}

function montarEmpresas(wb: ExcelJS.Workbook, listas: { unidades: string; consultores: string }) {
  const n = COLUNAS_EMPRESAS.length;
  const ultima = letraDaColuna(n);
  const ws = wb.addWorksheet(ABA_EMPRESAS, {
    properties: { tabColor: { argb: AZUL } },
    views: [{ state: "frozen", ySplit: LINHA_DO_CABECALHO_EMPRESAS, xSplit: 4, showGridLines: false }],
  });
  ws.columns = [
    ...COLUNAS_EMPRESAS.map((c) => ({ width: c.largura })),
    // As contas da lista de empresas da aba Outros CNPJs (escondidas).
    { width: 40, hidden: true },
    { width: 8, hidden: true },
    { width: 40, hidden: true },
  ];
  topo(
    wb,
    ws,
    "Empresas",
    "Uma linha por empresa. Títulos em vinho (*) são obrigatórios. Passe o mouse no título para ver como preencher. Titulares e dependentes NÃO entram aqui.",
    ultima
  );
  cabecalho(ws, COLUNAS_EMPRESAS);
  prepararLinhas(ws, COLUNAS_EMPRESAS, ULTIMA, listas);

  // A lista "Razão — Documento" (compacta, sem buracos), lida pela aba Outros CNPJs.
  const doc = colDe("documento");
  const razao = colDe("razao");
  const kChave = letraDaColuna(n + 1);
  const kOrdem = letraDaColuna(n + 2);
  const kLista = letraDaColuna(n + 3);
  ws.getCell(`${kChave}${LINHA_DO_CABECALHO_EMPRESAS}`).value = "Empresa (razão e documento)";
  ws.getCell(`${kOrdem}${LINHA_DO_CABECALHO_EMPRESAS}`).value = "Ordem";
  ws.getCell(`${kLista}${LINHA_DO_CABECALHO_EMPRESAS}`).value = "Lista da aba Outros CNPJs";
  const i0 = PRIMEIRA_LINHA_EMPRESAS;
  for (let r = i0; r <= ULTIMA; r++) {
    // ⚠️ O mesmo formato de `textoDaEmpresaNaLista` (planilha-empresas.ts).
    ws.getCell(`${kChave}${r}`).value = {
      formula: `IF(OR(TRIM(${doc}${r})="",TRIM(${razao}${r})=""),"",TRIM(${razao}${r})&" — "&TRIM(${doc}${r}))`,
      result: "",
    };
    ws.getCell(`${kOrdem}${r}`).value = {
      formula: `IF(${kChave}${r}="","",COUNTIF($${kChave}$${i0}:${kChave}${r},"?*"))`,
      result: "",
    };
    ws.getCell(`${kLista}${r}`).value = {
      formula: `IFERROR(INDEX($${kChave}$${i0}:$${kChave}$${ULTIMA},MATCH(ROW()-${i0 - 1},$${kOrdem}$${i0}:$${kOrdem}$${ULTIMA},0)),"")`,
      result: "",
    };
  }
  return { colunaDaLista: kLista };
}

function montarOutrosDocumentos(wb: ExcelJS.Workbook, colunaDaLista: string) {
  const ws = wb.addWorksheet(ABA_OUTROS_DOCUMENTOS, {
    properties: { tabColor: { argb: AZUL } },
    views: [{ state: "frozen", ySplit: LINHA_DO_CABECALHO_EMPRESAS, showGridLines: false }],
  });
  ws.columns = COLUNAS_OUTROS_DOCUMENTOS.map((c) => ({ width: c.largura }));
  topo(
    wb,
    ws,
    "Outros CNPJs",
    "Filiais e outros documentos. Em “Empresa”, clique na setinha ▼: a lista mostra as empresas preenchidas na aba Empresas.",
    letraDaColuna(COLUNAS_OUTROS_DOCUMENTOS.length)
  );
  cabecalho(ws, COLUNAS_OUTROS_DOCUMENTOS);
  const faixa = `${ABA_EMPRESAS}!$${colunaDaLista}$${PRIMEIRA_LINHA_EMPRESAS}:$${colunaDaLista}$${ULTIMA}`;
  const lista = `OFFSET(${ABA_EMPRESAS}!$${colunaDaLista}$${PRIMEIRA_LINHA_EMPRESAS},0,0,MAX(1,COUNTIF(${faixa},"?*")),1)`;
  prepararLinhas(ws, COLUNAS_OUTROS_DOCUMENTOS, ULTIMA, { unidades: "", consultores: "" });
  validarFaixa(ws, `A${PRIMEIRA_LINHA_EMPRESAS}:A${ULTIMA}`, {
    type: "list",
    allowBlank: true,
    formulae: [lista],
    showInputMessage: true,
    promptTitle: "Empresa",
    prompt: "Escolha a empresa da aba Empresas.",
    // Sem trava: digitar o documento da empresa também vale.
    showErrorMessage: false,
  });
}

export async function planilhaModeloDeEmpresas(opcoes: {
  geradoEm: string;
  /** Nomes das unidades que podem ser parceiras (a lista da Unidade principal). */
  unidades: readonly string[];
  /** Nomes dos consultores RisLife. */
  consultores: readonly string[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risarte Empresarial";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  abaDeInstrucoes(wb, opcoes.geradoEm, opcoes.unidades);
  // A aba (escondida) das listas vem por último; as validações só a citam
  // pelo nome, então a ordem de criação não importa.
  const listas = faixasDasListas(opcoes.unidades.length, opcoes.consultores.length);
  const { colunaDaLista } = montarEmpresas(wb, listas);
  montarOutrosDocumentos(wb, colunaDaLista);
  abaDeListas(wb, opcoes.unidades, opcoes.consultores);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
