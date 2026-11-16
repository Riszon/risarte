// A PLANILHA-MODELO DA IMPORTAÇÃO DE DÍVIDAS (0407; refeita em 15/11/2026,
// pedido do dono).
//
// O que ela faz:
//   * aba "Como preencher" ABRE PRIMEIRO: o passo a passo e, coluna por
//     coluna, o que pôr, se é obrigatório e um exemplo;
//   * aba "Dívidas": uma linha por dívida; o nº (#) se preenche sozinho
//     quando a linha tem dados; cada título de coluna tem uma nota;
//   * aba "Protestos": a linha N espelha a dívida da linha N quando ela está
//     "Protestada? = Sim" — devedor, credor, cartório, custas, "Já está" e o
//     nº vêm de lá (cinza, travados: não se digita duas vezes); só se preenche
//     o que é do protesto (quantidade, valor, protocolo, data, anuência,
//     observações). No fim, um bloco LIVRE para protestos que não estão na
//     aba Dívidas.
//
// ⚠️ OS TÍTULOS DAS COLUNAS SÃO OS DO MODELO PADRÃO (`mapeamentoPadrao`): é por
// eles que a importação acha cada campo. Mudou um aqui, muda lá (régua em
// `dividas-planilha-modelo.test.ts`). As fórmulas usam nomes do Excel em
// inglês (IF, COUNTA, ROW): é assim que o arquivo guarda, e o Excel em
// português mostra SE, CONT.VALORES, LIN.

import ExcelJS from "exceljs";
import { CAMPOS_DIVIDAS, CAMPOS_PROTESTOS, mapeamentoPadrao } from "./dividas-importacao";

/** Linhas de dívida (e de protesto espelhado) que a planilha prepara. */
export const LINHAS_DO_MODELO = 500;
/** Protestos que não estão na aba Dívidas: depois do espelho e de uma faixa. */
export const PRIMEIRA_LINHA_AVULSA = LINHAS_DO_MODELO + 3;
export const LINHAS_AVULSAS = 200;

export type ListasDoModelo = { devedores: string[]; categorias: string[]; naturezas: string[] };

type Ajuda = { oque: string; obrigatorio: string; exemplo: string };

/** O que pôr em cada coluna da aba Dívidas (nota do título e "Como preencher"). */
export const AJUDA_DIVIDAS: Record<string, Ajuda> = {
  chave: { oque: "Número da dívida. Preenchido sozinho quando a linha tem dados — é ele que liga o protesto à dívida.", obrigatorio: "Automático", exemplo: "1" },
  devedor: { oque: "Quem deve: a unidade ou a franqueadora (escolha na lista).", obrigatorio: "Sim (ou o CNPJ do devedor)", exemplo: "Risarte Londrina - Centro" },
  devedor_razao: { oque: "Razão social de quem deve. Só para conferência.", obrigatorio: "Não", exemplo: "Risarte Odontologia Londrina LTDA" },
  devedor_cnpj: { oque: "CNPJ de quem deve. É por ele que o riSZon acha o devedor (o dígito é conferido).", obrigatorio: "Recomendado", exemplo: "32.042.156/0001-21" },
  credor: { oque: "A quem se deve: banco, fornecedor, órgão público. Tributo: o órgão (Receita Federal, PGFN, Estado, Município).", obrigatorio: "Sim", exemplo: "Banco Exemplo S.A." },
  credor_cnpj: { oque: "CNPJ do credor com os 14 dígitos — ou só a raiz (8 dígitos), se é o que se tem (fica a pendência de completar).", obrigatorio: "Não", exemplo: "12.345.678/0001-90" },
  categoria: { oque: "O tipo da dívida (escolha na lista).", obrigatorio: "Não (recomendado)", exemplo: "Empréstimos e financiamentos" },
  subcategoria: { oque: "Detalhe da categoria, em texto livre. Tributo: o tipo do débito (Simples, INSS…).", obrigatorio: "Não", exemplo: "Capital de giro" },
  natureza: { oque: "Financeira, operacional, tributária ou trabalhista (lista). Sem ela, vem da categoria.", obrigatorio: "Não", exemplo: "Financeira" },
  situacao: { oque: "Como a dívida está hoje (lista). \"Grupo de dívidas\" = uma linha que junta várias do mesmo credor.", obrigatorio: "Não", exemplo: "Conta atrasada" },
  descricao: { oque: "De onde veio a dívida, em poucas palavras.", obrigatorio: "Não", exemplo: "Boletos da compra de resina" },
  contrato: { oque: "Nº do contrato, título ou nota. Ajuda a achar repetidas.", obrigatorio: "Não", exemplo: "CCB 4455-1" },
  vencimento: { oque: "O vencimento REAL (dd/mm/aaaa). A data em que a dívida foi levantada vai em \"Data de referência do valor\".", obrigatorio: "Sim", exemplo: "10/04/2025" },
  valor_original: { oque: "O valor da dívida quando nasceu, em reais.", obrigatorio: "Um dos dois valores", exemplo: "1.000,00" },
  valor_atualizado: { oque: "Quanto se deve hoje, com juros e multa, em reais.", obrigatorio: "Um dos dois valores", exemplo: "1.300,50" },
  data_referencia: { oque: "Em que dia o valor atualizado foi conferido.", obrigatorio: "Não", exemplo: "22/10/2026" },
  proposta: { oque: "Quanto o credor aceita para quitar, se já houver proposta.", obrigatorio: "Não", exemplo: "600,00" },
  proposta_condicao: { oque: "A condição da proposta, como veio (à vista, parcelas…).", obrigatorio: "Não", exemplo: "À vista no Pix" },
  proposta_validade: { oque: "Até quando a proposta vale.", obrigatorio: "Não", exemplo: "30/12/2026" },
  negativada: { oque: "Sim se o nome está no Serasa/SPC por esta dívida.", obrigatorio: "Não", exemplo: "Sim" },
  protestada: { oque: "Sim se a dívida foi protestada em cartório. Marcando Sim, ela aparece SOZINHA na aba Protestos (mesma linha).", obrigatorio: "Não", exemplo: "Sim" },
  cartorio: { oque: "Só se protestada: o cartório (nome, cidade/UF). Vai junto para a aba Protestos.", obrigatorio: "Não", exemplo: "1º Tabelionato de Protesto - Londrina/PR" },
  custas: { oque: "Só se protestada: quanto custa cancelar o protesto. Vai junto para a aba Protestos.", obrigatorio: "Não", exemplo: "55,10" },
  origem: { oque: "A = de antes da implantação do riSZon (saldo de implantação, fora da DRE); B = nova, ainda não lançada (despesa); C = já está no Contas a Pagar (só vincula).", obrigatorio: "Recomendado", exemplo: "A - Anterior à implantação" },
  fonte: { oque: "De onde veio a informação (Serasa, extrato, credor…).", obrigatorio: "Não", exemplo: "Serasa Limpa Nome (22/10/2026)" },
  observacoes: { oque: "Pendências e lembretes. Viram a observação da dívida.", obrigatorio: "Não", exemplo: "Conferir o contrato" },
  quantidade: { oque: "Só para \"Grupo de dívidas\": quantas dívidas a linha junta.", obrigatorio: "Não", exemplo: "3" },
};

/** O que pôr em cada coluna da aba Protestos. */
export const AJUDA_PROTESTOS: Record<string, Ajuda & { daDivida?: boolean }> = {
  devedor: { oque: "Vem da aba Dívidas. Na parte livre (no fim), escolha na lista.", obrigatorio: "Sim", exemplo: "Risarte Londrina - Centro", daDivida: true },
  credor: { oque: "Vem da aba Dívidas. Na parte livre, quem protestou.", obrigatorio: "Sim", exemplo: "Banco Exemplo S.A.", daDivida: true },
  quantidade: { oque: "Quantos títulos foram protestados.", obrigatorio: "Não", exemplo: "1" },
  valor: { oque: "O valor protestado. Já vem com o valor da dívida — troque se o protestado for outro.", obrigatorio: "Sim", exemplo: "1.300,50" },
  cartorio: { oque: "Vem da aba Dívidas (preencha lá). Na parte livre, o cartório.", obrigatorio: "Não", exemplo: "1º Tabelionato de Protesto - Londrina/PR", daDivida: true },
  protocolo: { oque: "Nº do protocolo ou do título no cartório.", obrigatorio: "Não", exemplo: "PRT-2025-0012" },
  data: { oque: "Data do protesto (dd/mm/aaaa).", obrigatorio: "Não", exemplo: "05/03/2025" },
  custas: { oque: "Vem da aba Dívidas (preencha lá). Na parte livre, as custas para cancelar.", obrigatorio: "Não", exemplo: "55,10", daDivida: true },
  anuencia: { oque: "Carta de anuência do credor: Pendente, Solicitada ou Recebida.", obrigatorio: "Não", exemplo: "Pendente" },
  ja_esta: { oque: "Vem preenchido (Sim) para as dívidas da aba Dívidas. Na parte livre: Não (vira dívida nova) ou Verificar (a conferência pergunta).", obrigatorio: "Automático", exemplo: "Sim", daDivida: true },
  vinculada: { oque: "O nº (#) da dívida, vem sozinho. Na parte livre, deixe em branco.", obrigatorio: "Automático", exemplo: "1", daDivida: true },
  observacoes: { oque: "Qualquer detalhe do protesto.", obrigatorio: "Não", exemplo: "Anuência pedida por e-mail" },
};

const AZUL = "FF0B1F3A";
const CINZA = "FFE5E7EB";
const AMARELO = "FFFFF4CC";
const AZUL_CLARO = "FFE0F2FE";

function letra(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export async function montarPlanilhaModelo(listas: ListasDoModelo): Promise<ArrayBuffer> {
  const padrao = mapeamentoPadrao();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risarte Odontologia";
  wb.created = new Date();
  // As fórmulas vão sem resultado guardado: o Excel calcula tudo ao abrir.
  wb.calcProperties = { fullCalcOnLoad: true };

  const escolhas = {
    Devedor: listas.devedores,
    Categoria: listas.categorias,
    Natureza: listas.naturezas,
    Situação: ["Em aberto", "Conta atrasada", "Dívida negativada", "Grupo de dívidas", "Dívida ativa", "Em negociação"],
    "Sim/Não": ["Sim", "Não"],
    "Origem do lançamento": ["A - Anterior à implantação", "B - Nova (após implantação)", "C - Já lançada no Contas a Pagar"],
    "Já está na aba Dívidas?": ["Sim", "Não", "Verificar"],
    "Carta de anuência": ["Pendente", "Solicitada", "Recebida"],
  };
  type Lista = keyof typeof escolhas;
  const nomes = Object.keys(escolhas) as Lista[];
  const faixa = (n: Lista) => {
    const col = letra(nomes.indexOf(n) + 1);
    return `Listas!$${col}$2:$${col}$${Math.max(2, escolhas[n].length + 1)}`;
  };

  // A primeira aba é a que abre: o "Como preencher".
  const wc = wb.addWorksheet("Como preencher", { properties: { tabColor: { argb: "FFD4A017" } } });
  const wd = wb.addWorksheet("Dívidas", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  const wp = wb.addWorksheet("Protestos", { views: [{ state: "frozen", ySplit: 1 }] });
  const wl = wb.addWorksheet("Listas");

  const cabecalho = (ws: ExcelJS.Worksheet, titulos: string[]) => {
    ws.addRow(titulos);
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    r.alignment = { vertical: "middle", wrapText: true };
    r.height = 36;
    titulos.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, Math.min(42, c.length + 4))));
  };

  // ------------------------------------------------------------- Dívidas
  const colD = padrao.colunas.dividas;
  const camposD = CAMPOS_DIVIDAS.filter((c) => colD[c.campo]);
  cabecalho(wd, camposD.map((c) => colD[c.campo]));
  const posD: Record<string, string> = Object.fromEntries(camposD.map((c, i) => [c.campo, letra(i + 1)]));
  const ultimaD = letra(camposD.length);
  const fechadasD: Record<string, Lista> = {
    devedor: "Devedor", categoria: "Categoria", natureza: "Natureza", situacao: "Situação",
    negativada: "Sim/Não", protestada: "Sim/Não", origem: "Origem do lançamento",
  };
  const datasD = ["vencimento", "data_referencia", "proposta_validade"];
  const valoresD = ["valor_original", "valor_atualizado", "proposta", "custas"];
  camposD.forEach((c, i) => {
    const h = wd.getCell(1, i + 1);
    const a = AJUDA_DIVIDAS[c.campo];
    if (a) h.note = `${a.oque}\nObrigatório: ${a.obrigatorio}.\nExemplo: ${a.exemplo}`;
    if (c.obrigatorio) h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A1F2B" } };
  });
  for (let r = 2; r <= LINHAS_DO_MODELO + 1; r++) {
    for (const c of camposD) {
      const cell = wd.getCell(`${posD[c.campo]}${r}`);
      if (c.campo === "chave") {
        // O nº se preenche sozinho quando a linha tem dados (dá para digitar por cima).
        cell.value = { formula: `IF(COUNTA(B${r}:${ultimaD}${r})=0,"",ROW()-1)` };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
        continue;
      }
      if (fechadasD[c.campo]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [faixa(fechadasD[c.campo])] };
      if (datasD.includes(c.campo)) cell.numFmt = "dd/mm/yyyy";
      if (valoresD.includes(c.campo)) cell.numFmt = '"R$" #,##0.00';
    }
  }

  // ------------------------------------------------------------ Protestos
  const colP = padrao.colunas.protestos;
  const camposP = CAMPOS_PROTESTOS.filter((c) => colP[c.campo]);
  cabecalho(wp, camposP.map((c) => colP[c.campo]));
  const posP: Record<string, string> = Object.fromEntries(camposP.map((c, i) => [c.campo, letra(i + 1)]));
  camposP.forEach((c, i) => {
    const h = wp.getCell(1, i + 1);
    const a = AJUDA_PROTESTOS[c.campo];
    if (a) h.note = `${a.oque}\nObrigatório: ${a.obrigatorio}.\nExemplo: ${a.exemplo}`;
  });
  wp.getCell("A1").note =
    `${AJUDA_PROTESTOS.devedor.oque}\n\nCOMO FUNCIONA ESTA ABA: a linha N espelha a dívida da linha N da aba Dívidas quando ela está "Protestada? = Sim". ` +
    `O que é cinza vem de lá — mude na aba Dívidas. Preencha só o que é branco/amarelo. ` +
    `Protesto que NÃO está na aba Dívidas: a partir da linha ${PRIMEIRA_LINHA_AVULSA}, tudo livre.`;

  const D = "'Dívidas'!";
  const daDivida = (campo: string, r: number) => `IF(${D}$${posD[campo]}${r}="","",${D}$${posD[campo]}${r})`;
  const marcada = (r: number) => `${D}$${posD.protestada}${r}="Sim"`;
  const espelho: Record<string, (r: number) => string> = {
    devedor: (r) => `IF(${marcada(r)},${daDivida("devedor", r)},"")`,
    credor: (r) => `IF(${marcada(r)},${daDivida("credor", r)},"")`,
    cartorio: (r) => `IF(${marcada(r)},${daDivida("cartorio", r)},"")`,
    custas: (r) => `IF(${marcada(r)},${daDivida("custas", r)},"")`,
    ja_esta: (r) => `IF(${marcada(r)},"Sim","")`,
    vinculada: (r) => `IF(${marcada(r)},${daDivida("chave", r)},"")`,
  };
  // O valor protestado já vem com o da dívida, mas é editável.
  const valorSugerido = (r: number) =>
    `IF(${marcada(r)},IF(${D}$${posD.valor_atualizado}${r}<>"",${D}$${posD.valor_atualizado}${r},${daDivida("valor_original", r)}),"")`;
  const fechadasP: Record<string, Lista> = { devedor: "Devedor", ja_esta: "Já está na aba Dívidas?", anuencia: "Carta de anuência" };

  const formatar = (cell: ExcelJS.Cell, campo: string) => {
    if (campo === "data") cell.numFmt = "dd/mm/yyyy";
    if (campo === "valor" || campo === "custas") cell.numFmt = '"R$" #,##0.00';
  };
  for (let r = 2; r <= LINHAS_DO_MODELO + 1; r++) {
    for (const c of camposP) {
      const cell = wp.getCell(`${posP[c.campo]}${r}`);
      formatar(cell, c.campo);
      if (espelho[c.campo]) {
        cell.value = { formula: espelho[c.campo](r) };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
        cell.font = { color: { argb: "FF4B5563" } };
        cell.protection = { locked: true };
        continue;
      }
      if (c.campo === "valor") cell.value = { formula: valorSugerido(r) };
      if (fechadasP[c.campo]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [faixa(fechadasP[c.campo])] };
      cell.protection = { locked: false };
    }
  }
  // Onde há protesto espelhado, o que falta preencher fica amarelo.
  const livres = camposP.filter((c) => !espelho[c.campo]).map((c) => posP[c.campo]);
  for (const col of livres) {
    wp.addConditionalFormatting({
      ref: `${col}2:${col}${LINHAS_DO_MODELO + 1}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`$${posP.ja_esta}2="Sim"`],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: AMARELO } } },
        },
      ],
    });
  }
  // A faixa entre o espelho e a parte livre (sem texto: a importação a pula).
  const faixaRow = wp.getRow(LINHAS_DO_MODELO + 2);
  for (let i = 1; i <= camposP.length; i++) {
    faixaRow.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
  }
  faixaRow.height = 8;
  // A parte livre: protestos que não estão na aba Dívidas.
  for (let r = PRIMEIRA_LINHA_AVULSA; r < PRIMEIRA_LINHA_AVULSA + LINHAS_AVULSAS; r++) {
    for (const c of camposP) {
      const cell = wp.getCell(`${posP[c.campo]}${r}`);
      formatar(cell, c.campo);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_CLARO } };
      if (fechadasP[c.campo]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [faixa(fechadasP[c.campo])] };
      cell.protection = { locked: false };
    }
  }
  wp.getCell(`A${PRIMEIRA_LINHA_AVULSA}`).note =
    "PROTESTOS QUE NÃO ESTÃO NA ABA DÍVIDAS — daqui para baixo, tudo livre. " +
    "Em \"Já está na aba Dívidas?\": Não (vira dívida nova, protestada) ou Verificar (a conferência pergunta). Deixe o nº da dívida em branco.";
  // Trava sem senha: o que vem da aba Dívidas não se digita aqui. (Revisão →
  // Desproteger planilha, se um dia precisar.)
  await wp.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
    insertRows: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
  });

  // --------------------------------------------------------------- Listas
  cabecalho(wl, nomes);
  const maior = Math.max(...nomes.map((n) => escolhas[n].length));
  for (let i = 0; i < maior; i++) wl.addRow(nomes.map((n) => escolhas[n][i] ?? null));

  // --------------------------------------------------------- Como preencher
  wc.getColumn(1).width = 34;
  wc.getColumn(2).width = 78;
  wc.getColumn(3).width = 22;
  wc.getColumn(4).width = 34;
  const titulo = (t: string) => {
    const r = wc.addRow([t]);
    r.font = { bold: true, size: 13, color: { argb: AZUL } };
    r.height = 22;
    wc.addRow([]);
  };
  const texto = (t: string, negrito = false) => {
    const r = wc.addRow([t]);
    wc.mergeCells(`A${r.number}:D${r.number}`);
    r.alignment = { wrapText: true, vertical: "top" };
    r.font = { bold: negrito };
    r.height = Math.max(18, Math.ceil(t.length / 150) * 16);
  };
  const tabela = (ajuda: Record<string, Ajuda & { daDivida?: boolean }>, campos: { campo: string }[], cols: Record<string, string>) => {
    const h = wc.addRow(["Coluna", "O que colocar", "Obrigatório", "Exemplo"]);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    for (const c of campos) {
      const a = ajuda[c.campo];
      if (!a || !cols[c.campo]) continue;
      const r = wc.addRow([cols[c.campo], a.oque, a.obrigatorio, a.exemplo]);
      r.alignment = { wrapText: true, vertical: "top" };
      r.height = Math.max(18, Math.ceil(a.oque.length / 85) * 15);
      if (a.daDivida) r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
      if (/^Sim/.test(a.obrigatorio)) r.getCell(3).font = { bold: true, color: { argb: "FF7A1F2B" } };
    }
    wc.addRow([]);
  };

  const t1 = wc.addRow(["COMO PREENCHER A PLANILHA DE DÍVIDAS"]);
  t1.font = { bold: true, size: 16, color: { argb: AZUL } };
  t1.height = 26;
  texto("Esta planilha leva as dívidas da rede para o Levantamento de Dívidas do riSZon (Financeiro → Rede → Levantamento de Dívidas → Importar planilha). Nada é gravado antes de você conferir, linha a linha, na tela — e dá para desfazer a importação enquanto nada foi pago.");
  wc.addRow([]);

  titulo("Passo a passo");
  for (const p of [
    "1. Na aba Dívidas, uma linha por dívida. Comece na linha 2; não mude os títulos da linha 1 (é por eles que o riSZon acha cada coluna). Passe o mouse no título para ver o que pôr.",
    "2. O mínimo de cada linha: Credor, Data de vencimento e um valor (original ou atualizado). O devedor é achado pelo CNPJ; sem CNPJ, pelo nome da lista.",
    "3. Dívida protestada? Marque \"Protestada?\" = Sim e preencha ali o Cartório e as Custas. Ela aparece sozinha na aba Protestos, na mesma linha.",
    "4. Na aba Protestos, complete só o que é do protesto (as células amarelas): quantidade de títulos, valor protestado (já vem com o da dívida), protocolo, data, carta de anuência e observações. O que está cinza vem da aba Dívidas — para mudar, mude lá.",
    `5. Protesto que NÃO está na aba Dívidas? Use a parte livre no fim da aba Protestos, a partir da linha ${PRIMEIRA_LINHA_AVULSA} (fundo azul claro): preencha tudo e marque "Já está na aba Dívidas?" = Não (vira uma dívida nova, protestada) ou Verificar (a conferência pergunta).`,
    "6. Salve o arquivo (.xlsx) e importe. Na conferência, cada linha aparece com ✔ certa, ⚠ aviso ou ✖ erro, e dá para corrigir ou ignorar na tela antes de gravar.",
  ])
    texto(p);
  wc.addRow([]);

  titulo("Aba Dívidas — coluna por coluna");
  tabela(AJUDA_DIVIDAS, camposD, colD);

  titulo("Aba Protestos — coluna por coluna (cinza = vem da aba Dívidas)");
  tabela(AJUDA_PROTESTOS, camposP, colP);

  titulo("Cuidados que evitam erro na conferência");
  for (const p of [
    "• Datas em dd/mm/aaaa (ou como data do Excel). Valores em reais, com vírgula nos centavos: 1.234,56.",
    "• Vencimento é o vencimento real da dívida. Se várias linhas têm o vencimento igual ao dia do levantamento, a conferência avisa: provavelmente é a data de referência, não o vencimento.",
    "• Confira o CNPJ do devedor: o riSZon confere o dígito (cuidado com o \"arrastar\" do Excel, que muda o final do número).",
    "• Proposta maior que o valor atualizado é aceita, mas a conferência avisa.",
    "• Não precisa calcular desconto, economia nem valor estimado: o riSZon calcula.",
    "• Mesma dívida em duas linhas, ou já cadastrada no riSZon: a conferência mostra e sugere ignorar a repetida.",
    "• A aba Listas guarda as escolhas das colunas de lista. Não apague.",
  ])
    texto(p);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
