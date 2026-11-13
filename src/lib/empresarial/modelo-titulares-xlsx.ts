import "server-only";
import ExcelJS from "exceljs";
import { DEPENDENT_PLAN_LABELS, DEPENDENT_PLANS, RELATIONSHIP_LABELS, RELATIONSHIPS } from "./constants";
import { LOGO_EMPRESARIAL_PNG_BASE64, LOGO_EMPRESARIAL_PROPORCAO } from "./logo-planilha";
import { ABA_DEPENDENTES, ABA_INSTRUCOES, ABA_TITULARES, LIMITE_DO_PLANO } from "./planilha-titulares";

/**
 * A PLANILHA MODELO DE TITULARES E DEPENDENTES (pedido do dono, 13/11/2026).
 *
 * É o arquivo que vai para a EMPRESA preencher — quem abre é o RH, não a
 * equipe. Por isso: instruções curtas na primeira aba, a logo do Risarte
 * Empresarial no alto, listas no lugar de texto livre e, na aba Dependentes,
 * o titular ESCOLHIDO numa lista ("Nome — CPF") em vez de digitar o CPF dele
 * de novo.
 *
 * ⚠️ RODA NO SERVIDOR (como as planilhas do Financeiro): o ExcelJS não entra
 * no pacote do navegador. A leitura do arquivo devolvido continua no
 * navegador, em `planilha-titulares.ts` — e ela tem de entender o que este
 * gerador escreve (os títulos das colunas e o "Nome — CPF" da lista). A régua
 * `planilha-titulares.test.ts` confere os dois juntos.
 *
 * ⚠️ OS EXEMPLOS FICAM SÓ NA ABA DE INSTRUÇÕES. No modelo antigo eles vinham
 * nas abas de dados, e a empresa que esquecesse de apagar importava a
 * "Maria Silva" como colaboradora.
 */

const AZUL = "FF0A2E57"; // o azul da logo
const VINHO = "FF7A1E3C"; // o "EMPRESARIAL" da logo
const AREIA = "FFF6F2EA";
const CINZA = "FF6B7280";
const AMARELO = "FFFFF7D6";
const BRANCO = "FFFFFFFF";
const VERMELHO_CLARO = "FFFDE2E2";

/** Primeira linha de dados e quantas linhas o modelo prepara (listas e formato). */
export const LINHA_DO_CABECALHO = 5;
export const PRIMEIRA_LINHA = LINHA_DO_CABECALHO + 1;
export const LINHAS_PREPARADAS = 500;
const ULTIMA_LINHA = PRIMEIRA_LINHA + LINHAS_PREPARADAS - 1;

/** Os títulos das colunas. A leitura (`planilha-titulares.ts`) acha por eles. */
export const COLUNAS_TITULARES = ["Nome *", "CPF *", "Telefone *", "E-mail", "Plano de Dependentes"] as const;
export const COLUNAS_DEPENDENTES = [
  "Titular *",
  "CPF do Dependente *",
  "Nome do Dependente",
  "Parentesco",
  "Telefone",
] as const;
/** Colunas preenchidas sozinhas (cinza): a leitura não as usa. */
export const COLUNAS_CALCULADAS_TITULARES = ["Dependentes preenchidos", "Vagas"] as const;
export const COLUNA_DA_CONFERENCIA = "Conferência";
const TITULO_DA_COLUNA_DA_LISTA = "Titular (nome e CPF)";

const borda: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD9D4C7" } },
  left: { style: "thin", color: { argb: "FFD9D4C7" } },
  bottom: { style: "thin", color: { argb: "FFD9D4C7" } },
  right: { style: "thin", color: { argb: "FFD9D4C7" } },
};

function logo(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, alturaPx = 52) {
  const id = wb.addImage({ base64: LOGO_EMPRESARIAL_PNG_BASE64, extension: "png" });
  ws.addImage(id, {
    tl: { col: 0.15, row: 0.25 },
    ext: { width: Math.round(alturaPx * LOGO_EMPRESARIAL_PROPORCAO), height: alturaPx },
    editAs: "absolute",
  });
}

/** As 4 linhas de cima de cada aba de dados: logo, título e a orientação. */
function topo(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  titulo: string,
  orientacao: string,
  ultimaColuna: string
) {
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 22;
  ws.getRow(3).height = 22;
  logo(wb, ws);
  ws.mergeCells(`C1:${ultimaColuna}2`);
  const t = ws.getCell("C1");
  t.value = titulo;
  t.font = { bold: true, size: 15, color: { argb: AZUL } };
  t.alignment = { vertical: "middle", horizontal: "right" };
  ws.mergeCells(`A4:${ultimaColuna}4`);
  const o = ws.getCell("A4");
  o.value = orientacao;
  o.font = { size: 11, color: { argb: VINHO }, italic: true };
  o.alignment = { vertical: "middle", wrapText: true };
  ws.getRow(4).height = 34;
}

function cabecalho(ws: ExcelJS.Worksheet, titulos: readonly string[]) {
  const row = ws.getRow(LINHA_DO_CABECALHO);
  titulos.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: BRANCO }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    c.border = borda;
  });
  row.height = 32;
}

/** Bordas leves e formato de texto nas linhas que a empresa vai preencher. */
function linhasDeDados(ws: ExcelJS.Worksheet, nColunas: number, colunasDeTexto: number[]) {
  for (let r = PRIMEIRA_LINHA; r <= ULTIMA_LINHA; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= nColunas; c++) {
      const cell = row.getCell(c);
      cell.border = borda;
      // CPF e telefone como TEXTO: sem isso o Excel come o zero da frente
      // ("012..." vira 12...) e mostra número grande como 1,11E+10.
      if (colunasDeTexto.includes(c)) cell.numFmt = "@";
    }
  }
}

function listaFixa(valores: readonly string[]): string {
  return `"${valores.join(",")}"`;
}

function abaDeInstrucoes(wb: ExcelJS.Workbook, empresa: string, geradoEm: string) {
  const ws = wb.addWorksheet(ABA_INSTRUCOES, {
    properties: { tabColor: { argb: VINHO } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 4 }, { width: 30 }, { width: 22 }, { width: 14 }, { width: 56 }];
  ws.getRow(1).height = 24;
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 24;
  logo(wb, ws, 60);

  let r = 5;
  const linha = (
    texto: string,
    estilo: Partial<ExcelJS.Font> = {},
    altura?: number,
    de = "B",
    ate = "E"
  ) => {
    ws.mergeCells(`${de}${r}:${ate}${r}`);
    const c = ws.getCell(`${de}${r}`);
    c.value = texto;
    c.font = { size: 11, ...estilo };
    c.alignment = { wrapText: true, vertical: "top" };
    if (altura) ws.getRow(r).height = altura;
    r++;
    return c;
  };

  linha("Cadastro de titulares e dependentes", { bold: true, size: 18, color: { argb: AZUL } }, 28);
  linha(empresa ? `Empresa: ${empresa}` : "Empresa: ____________________", { bold: true, size: 12 }, 20);
  linha(
    `Preencha esta planilha e devolva ao seu consultor do Risarte Empresarial. Modelo gerado em ${geradoEm}.`,
    { color: { argb: CINZA } },
    32
  );
  r++;

  linha("Passo a passo", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  const passos = [
    `Abra a aba “${ABA_TITULARES}” (embaixo, nas abas da planilha) e preencha uma linha para cada colaborador que vai entrar no programa. Comece na primeira linha em branco, logo abaixo dos títulos azuis.`,
    "Na coluna “Plano de Dependentes”, clique na célula e na setinha ▼ e escolha o plano. É ele que diz quantos dependentes o colaborador pode ter: Dependente individual = 1; Dependente familiar = até 3; Familiar + extras = 4 ou mais. Sem dependentes (ou em branco) = o colaborador não aparece na aba Dependentes.",
    `Abra a aba “${ABA_DEPENDENTES}”. Na coluna “Titular”, clique na setinha ▼ e escolha o colaborador (aparecem o nome e o CPF). A lista mostra só quem tem plano com dependentes e ainda tem vaga: quando o plano fica completo, o nome sai da lista. Não precisa digitar o CPF do titular de novo.`,
    "Preencha uma linha para cada dependente: CPF, nome e parentesco (também na setinha ▼). As colunas cinza se preenchem sozinhas: “Vagas” (aba Titulares) mostra quantos dependentes ainda cabem, e “Conferência” fica vermelha se alguém passar do plano.",
    "Salve o arquivo do jeito que veio (Excel, .xlsx) e envie ao consultor. Não mude o nome das abas nem os títulos azuis das colunas — é por eles que o sistema lê a planilha.",
  ];
  passos.forEach((p, i) => {
    ws.getCell(`A${r}`).value = `${i + 1}.`;
    ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: AZUL } };
    ws.getCell(`A${r}`).alignment = { vertical: "top", horizontal: "right" };
    linha(p, {}, p.length > 150 ? 48 : 34);
  });
  r++;

  linha("O que vai em cada coluna", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  const cab = ws.getRow(r);
  ["Aba", "Coluna", "Obrigatório?", "Como preencher"].forEach((t, i) => {
    const c = cab.getCell(i + 2);
    c.value = t;
    c.font = { bold: true, color: { argb: BRANCO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    c.border = borda;
    c.alignment = { vertical: "middle" };
  });
  cab.height = 20;
  r++;
  const tabela: [string, string, string, string][] = [
    [ABA_TITULARES, "Nome", "Sim", "Nome completo do colaborador, sem abreviar."],
    [ABA_TITULARES, "CPF", "Sim", "Os 11 números do CPF, com ou sem pontos e traço. Ex.: 123.456.789-09."],
    [ABA_TITULARES, "Telefone", "Sim", "Celular com DDD (de preferência com WhatsApp). Ex.: (43) 99999-0000."],
    [ABA_TITULARES, "E-mail", "Não", "E-mail do colaborador, se tiver."],
    [
      ABA_TITULARES,
      "Plano de Dependentes",
      "Não",
      "Escolha na lista. Individual = 1 dependente; Familiar = até 3; Familiar + extras = 4 ou mais. Em branco = sem dependentes (não aparece na aba Dependentes).",
    ],
    [ABA_DEPENDENTES, "Titular", "Sim", "Escolha na lista o colaborador de quem a pessoa é dependente (só aparece quem tem plano com dependentes e vaga). Se o titular já foi cadastrado antes e não está nesta planilha, digite o CPF dele."],
    [ABA_DEPENDENTES, "CPF do Dependente", "Sim", "Os 11 números do CPF do dependente (criança também precisa de CPF)."],
    [ABA_DEPENDENTES, "Nome do Dependente", "Recomendado", "Nome completo do dependente."],
    [
      ABA_DEPENDENTES,
      "Parentesco",
      "Recomendado",
      `Escolha na lista: ${RELATIONSHIPS.map((x) => RELATIONSHIP_LABELS[x]).join(", ")}. Em branco = Outro.`,
    ],
    [ABA_DEPENDENTES, "Telefone", "Não", "Telefone do dependente, se tiver."],
  ];
  tabela.forEach(([aba, col, obrig, como], i) => {
    const row = ws.getRow(r);
    [aba, col, obrig, como].forEach((v, j) => {
      const c = row.getCell(j + 2);
      c.value = v;
      c.border = borda;
      c.alignment = { wrapText: true, vertical: "top" };
      if (j === 2 && v === "Sim") c.font = { bold: true, color: { argb: VINHO } };
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AREIA } };
    });
    row.height = como.length > 90 ? 46 : como.length > 55 ? 32 : 18;
    r++;
  });
  r++;

  linha("Exemplo (não copie para as outras abas)", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  linha(`Aba ${ABA_TITULARES}:`, { bold: true });
  const exemploTit = [
    ["Maria Silva", "123.456.789-09", "(43) 99999-0000", DEPENDENT_PLAN_LABELS.NONE],
    ["João Souza", "987.654.321-00", "(43) 98888-0000", DEPENDENT_PLAN_LABELS.FAMILY],
  ];
  for (const ex of exemploTit) {
    const row = ws.getRow(r);
    ex.forEach((v, j) => {
      const c = row.getCell(j + 2);
      c.value = v;
      c.font = { color: { argb: CINZA } };
      c.border = borda;
    });
    r++;
  }
  linha(`Aba ${ABA_DEPENDENTES} (o titular é escolhido na lista):`, { bold: true });
  const exemploDep = [
    ["João Souza — 987.654.321-00", "111.222.333-96", "Ana Souza", RELATIONSHIP_LABELS.SPOUSE],
    ["João Souza — 987.654.321-00", "444.555.666-25", "Pedro Souza", RELATIONSHIP_LABELS.CHILD],
  ];
  for (const ex of exemploDep) {
    const row = ws.getRow(r);
    ex.forEach((v, j) => {
      const c = row.getCell(j + 2);
      c.value = v;
      c.font = { color: { argb: CINZA } };
      c.border = borda;
    });
    r++;
  }
  r++;

  linha("Antes de enviar, confira", { bold: true, size: 13, color: { argb: VINHO } }, 22);
  for (const item of [
    "☐  Todo colaborador tem nome, CPF (11 números) e telefone com DDD.",
    "☐  Ninguém aparece duas vezes na mesma aba.",
    "☐  Todo dependente tem o titular escolhido na lista, e nenhuma linha da aba Dependentes está vermelha.",
    "☐  O plano de cada colaborador combina com quantos dependentes ele tem.",
    "☐  Linhas que sobraram ficaram em branco (não precisa apagar nada).",
  ]) {
    linha(item, {}, 18);
  }
  r++;
  const aviso = linha(
    "Importante: a planilha entra inteira ou não entra. Se alguma linha tiver problema, o sistema não grava nada e mostra, para o consultor, a aba e a linha a corrigir.",
    { bold: true },
    34
  );
  aviso.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARELO } };
  linha(
    "Os dados desta planilha são usados só para o cadastro no programa Risarte Empresarial (LGPD). Envie apenas ao seu consultor.",
    { size: 10, color: { argb: CINZA } },
    30
  );
}

/** "Sem limite" (Familiar + extras) dentro da planilha. */
const SEM_LIMITE = 999;

/** Fórmula do limite de dependentes do plano escrito na célula (em branco = 0). */
function formulaDoLimite(celulaDoPlano: string): string {
  // ⚠️ O mesmo limite de LIMITE_DO_PLANO (planilha-titulares.ts).
  let f = "0";
  for (const plano of [...DEPENDENT_PLANS].reverse()) {
    const limite = LIMITE_DO_PLANO[plano];
    if (limite === 0) continue;
    f = `IF(${celulaDoPlano}="${DEPENDENT_PLAN_LABELS[plano]}",${limite ?? SEM_LIMITE},${f})`;
  }
  return f;
}

function cinza(cell: ExcelJS.Cell) {
  cell.font = { color: { argb: CINZA } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AREIA } };
  cell.border = borda;
}

function montarTitulares(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet(ABA_TITULARES, {
    properties: { tabColor: { argb: AZUL } },
    views: [{ state: "frozen", ySplit: LINHA_DO_CABECALHO, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 38 },
    { width: 18 },
    { width: 18 },
    { width: 30 },
    { width: 24 },
    { width: 14 },
    { width: 30 },
    // H..L: as contas da lista (escondidas).
    { width: 40, hidden: true },
    { width: 8, hidden: true },
    { width: 40, hidden: true },
    { width: 8, hidden: true },
    { width: 40, hidden: true },
  ];
  topo(
    wb,
    ws,
    "Titulares",
    "Uma linha por colaborador. Colunas com * são obrigatórias. Escolha o Plano de Dependentes: é ele que libera o titular na aba Dependentes.",
    "G"
  );
  cabecalho(ws, [...COLUNAS_TITULARES, ...COLUNAS_CALCULADAS_TITULARES]);
  const ocultas = [TITULO_DA_COLUNA_DA_LISTA, "Limite", "Pode receber dependente", "Ordem", "Lista da aba Dependentes"];
  ["H", "I", "J", "K", "L"].forEach((c, i) => {
    ws.getCell(`${c}${LINHA_DO_CABECALHO}`).value = ocultas[i];
  });
  linhasDeDados(ws, COLUNAS_TITULARES.length, [2, 3]);

  const planos = DEPENDENT_PLANS.map((p) => DEPENDENT_PLAN_LABELS[p]);
  const deps = `${ABA_DEPENDENTES}!$A$${PRIMEIRA_LINHA}:$A$${ULTIMA_LINHA}`;
  const i0 = PRIMEIRA_LINHA;
  const iN = ULTIMA_LINHA;
  const f = (formula: string) => ({ formula, result: "" });
  for (let r = i0; r <= iN; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [listaFixa(planos)],
      showInputMessage: true,
      promptTitle: "Plano de Dependentes",
      prompt: "Individual = 1 dependente; Familiar = até 3; Familiar + extras = 4 ou mais. Em branco = sem dependentes.",
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Escolha na lista",
      error: `Use uma das opções: ${planos.join(", ")}.`,
    };
    // H: "Nome — CPF" (⚠️ mesmo formato de textoDaLista, planilha-titulares.ts).
    ws.getCell(`H${r}`).value = f(`IF(OR(TRIM(A${r})="",TRIM(B${r})=""),"",TRIM(A${r})&" — "&TRIM(B${r}))`);
    // I: o limite do plano.
    ws.getCell(`I${r}`).value = f(formulaDoLimite(`E${r}`));
    // F: quantos dependentes já apontam para este titular.
    ws.getCell(`F${r}`).value = f(`IF(H${r}="","",COUNTIF(${deps},H${r}))`);
    // G: as vagas, em português.
    ws.getCell(`G${r}`).value = f(
      `IF(H${r}="","",IF(I${r}=0,IF(F${r}>0,"Passou do limite (sem dependentes)","Sem dependentes"),` +
        `IF(I${r}>=${SEM_LIMITE},F${r}&" preenchido(s) · sem limite",` +
        `IF(F${r}>I${r},"Passou do limite (máximo "&I${r}&")",` +
        `IF(F${r}=I${r},"Completo",(I${r}-F${r})&" de "&I${r}&" livre(s)")))))`
    );
    // J: entra na lista se o plano tem dependente e ainda há vaga.
    ws.getCell(`J${r}`).value = f(`IF(H${r}="","",IF(AND(I${r}>0,N(F${r})<I${r}),H${r},""))`);
    // K e L: a lista compacta (sem buracos), que a validação da aba Dependentes lê.
    ws.getCell(`K${r}`).value = f(`IF(J${r}="","",COUNTIF($J$${i0}:J${r},"?*"))`);
    ws.getCell(`L${r}`).value = f(
      `IFERROR(INDEX($J$${i0}:$J$${iN},MATCH(ROW()-${i0 - 1},$K$${i0}:$K$${iN},0)),"")`
    );
    cinza(ws.getCell(`F${r}`));
    cinza(ws.getCell(`G${r}`));
  }
  ws.addConditionalFormatting({
    ref: `G${i0}:G${iN}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [`LEFT(G${i0},6)="Passou"`],
        style: {
          font: { color: { argb: "FF9B1C1C" }, bold: true },
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: VERMELHO_CLARO } },
        },
      },
    ],
  });
  ws.getCell(`A${LINHA_DO_CABECALHO}`).note = "Nome completo do colaborador, sem abreviar.";
  ws.getCell(`B${LINHA_DO_CABECALHO}`).note = "Os 11 números do CPF, com ou sem pontos e traço.";
  ws.getCell(`C${LINHA_DO_CABECALHO}`).note = "Celular com DDD. Ex.: (43) 99999-0000.";
  ws.getCell(`E${LINHA_DO_CABECALHO}`).note =
    "Individual = 1 dependente; Familiar = até 3; Familiar + extras = 4 ou mais. Em branco = sem dependentes (não aparece na aba Dependentes).";
  ws.getCell(`F${LINHA_DO_CABECALHO}`).note =
    "Preenchido sozinho: quantos dependentes a aba Dependentes tem para este titular.";
  ws.getCell(`G${LINHA_DO_CABECALHO}`).note = "Preenchido sozinho: quantas vagas o plano ainda deixa.";
}

function montarDependentes(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet(ABA_DEPENDENTES, {
    properties: { tabColor: { argb: AZUL } },
    views: [{ state: "frozen", ySplit: LINHA_DO_CABECALHO, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 44 }, { width: 22 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 46 }];
  topo(
    wb,
    ws,
    "Dependentes",
    `Uma linha por dependente. Em “Titular”, clique na setinha ▼: a lista mostra só quem tem plano com dependentes e ainda tem vaga (aba ${ABA_TITULARES}).`,
    "F"
  );
  cabecalho(ws, [...COLUNAS_DEPENDENTES, COLUNA_DA_CONFERENCIA]);
  linhasDeDados(ws, COLUNAS_DEPENDENTES.length, [1, 2, 5]);

  // A lista cresce conforme a aba Titulares é preenchida e encolhe quando o
  // plano de alguém fica completo: é a coluna L (compacta) de lá.
  const i0 = PRIMEIRA_LINHA;
  const iN = ULTIMA_LINHA;
  const faixa = `${ABA_TITULARES}!$L$${i0}:$L$${iN}`;
  const listaDeTitulares = `OFFSET(${ABA_TITULARES}!$L$${i0},0,0,MAX(1,COUNTIF(${faixa},"?*")),1)`;
  const chaves = `${ABA_TITULARES}!$H$${i0}:$H$${iN}`;
  const limites = `${ABA_TITULARES}!$I$${i0}:$I$${iN}`;
  const planosDosTitulares = `${ABA_TITULARES}!$E$${i0}:$E$${iN}`;
  const parentescos = RELATIONSHIPS.map((x) => RELATIONSHIP_LABELS[x]);
  for (let r = i0; r <= iN; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [listaDeTitulares],
      showInputMessage: true,
      promptTitle: "Titular",
      prompt: "Escolha o colaborador na lista. Titular já cadastrado antes, fora desta planilha? Digite o CPF dele.",
      // Sem trava: digitar o CPF de um titular que já está na empresa vale.
      showErrorMessage: false,
    };
    ws.getCell(`D${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [listaFixa(parentescos)],
      showInputMessage: true,
      promptTitle: "Parentesco",
      prompt: "Clique na setinha e escolha.",
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Escolha na lista",
      error: `Use uma das opções: ${parentescos.join(", ")}.`,
    };
    // F: a conferência da linha (o limite do plano do titular).
    const m = `MATCH(A${r},${chaves},0)`;
    const lim = `INDEX(${limites},${m})`;
    const ordem = `COUNTIF($A$${i0}:A${r},A${r})`;
    const cell = ws.getCell(`F${r}`);
    cell.value = {
      formula:
        `IF(TRIM(A${r})="","",IF(ISNA(${m}),"Titular fora desta planilha: o sistema confere ao importar",` +
        `IF(${lim}=0,"O plano do titular é Sem dependentes",` +
        `IF(${ordem}>${lim},"Passou do limite: plano "&INDEX(${planosDosTitulares},${m})&" ("&${lim}&")","OK"))))`,
      result: "",
    };
    cinza(cell);
  }
  // A linha inteira fica vermelha quando passa do limite ou o plano não tem dependente.
  ws.addConditionalFormatting({
    ref: `A${i0}:F${iN}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [`OR(LEFT($F${i0},6)="Passou",LEFT($F${i0},9)="O plano d")`],
        style: {
          font: { color: { argb: "FF9B1C1C" }, bold: true },
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: VERMELHO_CLARO } },
        },
      },
    ],
  });
  ws.getCell(`A${LINHA_DO_CABECALHO}`).note =
    "Escolha na lista o colaborador da aba Titulares (nome e CPF). Só aparece quem tem plano com dependentes e ainda tem vaga.";
  ws.getCell(`B${LINHA_DO_CABECALHO}`).note = "Os 11 números do CPF do dependente.";
  ws.getCell(`F${LINHA_DO_CABECALHO}`).note =
    "Preenchido sozinho: confere se o dependente cabe no plano do titular.";
}

export async function planilhaModeloDeTitulares(opcoes: {
  empresa: string;
  geradoEm: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risarte Empresarial";
  wb.created = new Date();
  // Ao abrir, o Excel recalcula a coluna da lista (as fórmulas vêm sem valor).
  wb.calcProperties = { fullCalcOnLoad: true };
  abaDeInstrucoes(wb, opcoes.empresa, opcoes.geradoEm);
  montarTitulares(wb);
  montarDependentes(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
