import "server-only";
import ExcelJS from "exceljs";
import {
  celulaParaPlanilha,
  formatoDaColuna,
  letraDaColuna,
  totaisDoRelatorio,
  type RelatorioPronto,
} from "./relatorio";

/**
 * O RELATÓRIO VIRA PLANILHA (relato OC-00009, segunda volta).
 *
 * ⚠️ RODA NO SERVIDOR, e isso é decisão, não acaso. O ExcelJS é grande; no
 * navegador ele entraria no pacote que TODA tela do sistema carrega, para
 * atender um botão que quase ninguém clica. Aqui ele fica numa rota, roda
 * quando alguém pede, e a leitura do banco continua passando pela RLS.
 *
 * ⚠️ E ELE LÊ O MESMO MODELO QUE A PÁGINA DE IMPRESSÃO. A primeira entrega
 * montava a planilha à parte, e foi assim que ela saiu sem formato enquanto o
 * PDF saía com a tela inteira dentro. Uma fonte, duas saídas.
 */

const NAVY = "FF0B1F3A";
const AREIA = "FFF3EFE7";

export async function planilhaDoRelatorio(
  relatorio: RelatorioPronto
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risarte Odontologia";
  wb.created = new Date();

  const ws = wb.addWorksheet("Relatório", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
    views: [{ state: "normal" }],
  });

  const nColunas = relatorio.colunas.length;
  const ultima = letraDaColuna(nColunas);

  // ---- cabeçalho do documento ----------------------------------------------
  const tituloLinha = ws.addRow([relatorio.titulo]);
  tituloLinha.font = { bold: true, size: 16, color: { argb: NAVY } };
  tituloLinha.height = 22;
  ws.mergeCells(`A${tituloLinha.number}:${ultima}${tituloLinha.number}`);

  if (relatorio.subtitulo) {
    const sub = ws.addRow([relatorio.subtitulo]);
    sub.font = { size: 11, color: { argb: "FF555555" } };
    ws.mergeCells(`A${sub.number}:${ultima}${sub.number}`);
  }

  for (const m of relatorio.metadados) {
    const linha = ws.addRow([`${m.rotulo}:`, m.valor]);
    linha.getCell(1).font = { bold: true, size: 10 };
    linha.getCell(2).font = { size: 10 };
  }

  // ---- o juízo, em destaque próprio ----------------------------------------
  if (relatorio.situacao) {
    ws.addRow([]);
    const s = ws.addRow([relatorio.situacao]);
    s.font = { bold: true, size: 11, color: { argb: NAVY } };
    s.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: AREIA },
    };
    ws.mergeCells(`A${s.number}:${ultima}${s.number}`);
  }

  // ---- resumo ---------------------------------------------------------------
  if (relatorio.resumo.length > 0) {
    ws.addRow([]);
    for (const r of relatorio.resumo) {
      const linha = ws.addRow([`${r.rotulo}:`, r.valor]);
      linha.getCell(1).font = { bold: true, size: 10 };
      linha.getCell(2).font = { size: 10 };
    }
  }

  ws.addRow([]);

  // ---- a tabela -------------------------------------------------------------
  const cabecalho = ws.addRow(relatorio.colunas.map((c) => c.titulo));
  cabecalho.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  cabecalho.height = 20;
  cabecalho.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
  });

  const primeiraDaTabela = cabecalho.number;

  for (const linha of relatorio.linhas) {
    const valores = relatorio.colunas.map((c) =>
      celulaParaPlanilha(linha[c.chave], c.tipo)
    );
    const r = ws.addRow(valores);
    r.font = { size: 10 };
    relatorio.colunas.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      const formato = formatoDaColuna(c.tipo);
      if (formato) cell.numFmt = formato;
      cell.alignment = {
        vertical: "top",
        horizontal:
          c.tipo === "dinheiro" || c.tipo === "numero"
            ? "right"
            : c.tipo === "data"
              ? "center"
              : "left",
        wrapText: c.tipo === "texto",
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFDDDDDD" } },
      };
    });
  }

  // ---- total ----------------------------------------------------------------
  const totais = totaisDoRelatorio(relatorio);
  if (Object.keys(totais).length > 0 && relatorio.linhas.length > 0) {
    const valores = relatorio.colunas.map((c, i) =>
      c.somar
        ? c.tipo === "dinheiro"
          ? totais[c.chave] / 100
          : totais[c.chave]
        : i === 0
          ? "TOTAL"
          : null
    );
    const r = ws.addRow(valores);
    r.font = { bold: true, size: 10, color: { argb: NAVY } };
    // ⚠️ PERCORRE AS COLUNAS, NÃO AS CÉLULAS. `eachCell` pula célula vazia — e
    // as colunas que não somam ficavam brancas no meio da faixa pintada, com a
    // linha do total saindo esburacada.
    relatorio.colunas.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      const formato = formatoDaColuna(c.tipo);
      if (formato && typeof cell.value === "number") cell.numFmt = formato;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AREIA } };
      cell.border = { top: { style: "thin", color: { argb: NAVY } } };
      cell.alignment = {
        horizontal:
          c.tipo === "dinheiro" || c.tipo === "numero" ? "right" : "left",
      };
    });
  }

  // ---- notas (os limites declarados) ---------------------------------------
  if (relatorio.notas.length > 0) {
    ws.addRow([]);
    for (const nota of relatorio.notas) {
      const r = ws.addRow([nota]);
      r.font = { size: 9, italic: true, color: { argb: "FF666666" } };
      ws.mergeCells(`A${r.number}:${ultima}${r.number}`);
    }
  }

  // ---- acabamento -----------------------------------------------------------
  ws.columns.forEach((coluna, i) => {
    coluna.width = relatorio.colunas[i]?.largura ?? 18;
  });

  // A linha do cabeçalho fica CONGELADA: numa lista de cobrança com cem
  // pessoas, rolar sem ela transforma as colunas em adivinhação.
  ws.views = [{ state: "frozen", ySplit: primeiraDaTabela }];

  // Filtro automático só quando há o que filtrar — num intervalo vazio o Excel
  // acusa arquivo corrompido.
  if (relatorio.linhas.length > 0) {
    ws.autoFilter = {
      from: { row: primeiraDaTabela, column: 1 },
      to: { row: primeiraDaTabela + relatorio.linhas.length, column: nColunas },
    };
  }

  // O cabeçalho da tabela se repete a cada página impressa da planilha.
  ws.pageSetup.printTitlesRow = `${primeiraDaTabela}:${primeiraDaTabela}`;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
