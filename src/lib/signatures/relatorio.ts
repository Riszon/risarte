import "server-only";

import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { formatBrDate, formatBrDateTime, formatIsoDateBr } from "@/lib/dates";
import { embedFonts, logoPng } from "./pdf/fonts";
import { GOLD, MUTED, NAVY, PageWriter, drawFooters } from "./pdf/text";
import {
  ROTULO_DA_LISTA,
  diasDeEspera,
  linhasDaLista,
  quemSegura,
  textoDoTempo,
  type Indicadores,
  type LinhaDoPainel,
  type ListaDoPainel,
  type Periodo,
} from "./indicadores";
import { PACKAGE_STATUS_LABEL } from "./status";
import type { PackageStatus } from "./types";

/**
 * O RELATÓRIO DAS ASSINATURAS (ZS7): PDF com a identidade da Risarte e
 * planilha Excel. Os dois saem da MESMA conta do painel (`calcularIndicadores`
 * e `linhasDaLista`) sobre a MESMA leitura — o relatório é o que a tela
 * mostrou. "Por documento" abre uma linha por documento do pacote.
 *
 * Sem dado de saúde: número do pacote, nome de quem assina pelo cliente (já
 * na capa do PDF enviado), documentos, unidade, datas e situação.
 */

export type DadosDoRelatorio = {
  titulo: string;
  periodo: Periodo;
  filtros: string;
  ind: Indicadores;
  linhas: LinhaDoPainel[];
  hoje: string;
  faixas: number[];
  porDocumento: boolean;
  geradoPor: string | null;
};

const LISTAS_DO_RELATORIO: ListaDoPainel[] = ["assinados", "faltam", "recusados", "vencidos", "cancelados"];

type LinhaDaPlanilha = {
  lista: string;
  pacote: string;
  cliente: string;
  publico: string;
  documento: string;
  unidade: string;
  enviadoEm: string;
  enviadoPor: string;
  situacao: string;
  concluidoEm: string;
  espera: string;
  motivo: string;
};

export function linhasDoRelatorio(d: DadosDoRelatorio): LinhaDaPlanilha[] {
  const out: LinhaDaPlanilha[] = [];
  for (const lista of LISTAS_DO_RELATORIO) {
    for (const l of linhasDaLista(d.linhas, lista, d.periodo, { hoje: d.hoje, faixas: d.faixas })) {
      const base = {
        lista: ROTULO_DA_LISTA[lista],
        pacote: l.number,
        cliente: l.client_name ?? "",
        publico: l.audience === "company" ? "Empresa" : "Paciente",
        unidade: l.clinic_name ?? "",
        enviadoEm: formatBrDate(l.sent_at),
        enviadoPor: l.sent_by_name ?? "",
        situacao: PACKAGE_STATUS_LABEL[l.status as PackageStatus] ?? l.status,
        concluidoEm: l.completed_at ? formatBrDate(l.completed_at) : l.ended_at ? formatBrDate(l.ended_at) : "",
        espera: lista === "faltam" ? `${diasDeEspera(l, d.hoje)} dia(s), esperando ${quemSegura(l)}` : "",
        motivo: l.cancel_reason ?? l.refused_reason ?? "",
      };
      const docs = l.items.length ? l.items : [{ title: "", template_id: null, kind: null }];
      if (d.porDocumento) for (const it of docs) out.push({ ...base, documento: it.title });
      else out.push({ ...base, documento: docs.map((i) => i.title).filter(Boolean).join(" + ") });
    }
  }
  return out;
}

function resumo(d: DadosDoRelatorio): [string, string][] {
  const i = d.ind;
  return [
    ["Enviados", String(i.enviados)],
    ["Assinados", `${i.assinados}${i.taxaPercent == null ? "" : ` (${i.taxaPercent.toLocaleString("pt-BR")}% dos enviados no período)`}`],
    ["Faltam assinar (agora)", `${i.faltam} — ${i.faltamCliente} esperando o cliente, ${i.faltamEquipe} esperando a equipe`],
    ["Recusados", String(i.recusados)],
    ["Vencidos", String(i.vencidos)],
    ["Cancelados", String(i.cancelados)],
    ["Tempo de resposta do cliente", i.tempoCliente.quantos ? `mediana ${textoDoTempo(i.tempoCliente.medianaHoras)} · média ${textoDoTempo(i.tempoCliente.mediaHoras)}` : "—"],
    ["Tempo total até concluir", i.tempoTotal.quantos ? `mediana ${textoDoTempo(i.tempoTotal.medianaHoras)} · média ${textoDoTempo(i.tempoTotal.mediaHoras)}` : "—"],
  ];
}

export async function pdfDoRelatorio(d: DadosDoRelatorio): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(d.titulo);
  doc.setProducer("riSZon");
  doc.setCreator("riSZon");
  const fonts = await embedFonts(doc);
  const w = new PageWriter(doc, fonts, { margins: { top: 56 } });

  const logo = await doc.embedPng(logoPng());
  const largura = 180;
  const altura = (logo.height / logo.width) * largura;
  w.page.drawImage(logo, { x: w.margins.left, y: w.y - altura, width: largura, height: altura });
  w.y -= altura + 24;
  w.paragraph(d.titulo, { font: fonts.bold, size: 18, color: NAVY, spaceAfter: 4 });
  w.paragraph(`${formatIsoDateBr(d.periodo.de)} a ${formatIsoDateBr(d.periodo.ate)} · ${d.filtros}`, { size: 10, color: MUTED, spaceAfter: 2 });
  w.paragraph(`Gerado em ${formatBrDateTime(new Date())}${d.geradoPor ? ` por ${d.geradoPor}` : ""}`, { size: 9, color: MUTED, spaceAfter: 10 });
  w.rule(GOLD);
  w.space(6);

  w.heading("Números do período", { size: 12 });
  for (const [rotulo, valor] of resumo(d)) w.paragraph(`${rotulo}: ${valor}`, { size: 10, spaceAfter: 2 });
  w.space(6);

  w.heading("Faltam assinar, por tempo de espera", { size: 12 });
  w.paragraph(d.ind.faixas.map((x) => `${x.rotulo}: ${x.quantos}`).join("   ·   "), { size: 10, spaceAfter: 6 });

  if (d.ind.motivosCancelamento.length) {
    w.heading("Motivos de cancelamento", { size: 12 });
    for (const m of d.ind.motivosCancelamento) w.paragraph(`${m.motivo}: ${m.quantos}`, { size: 10, spaceAfter: 2 });
    w.space(4);
  }

  if (d.ind.porUnidade.length > 1) {
    w.heading("Por unidade", { size: 12 });
    for (const u of d.ind.porUnidade) {
      w.paragraph(
        `${u.nome}: ${u.enviados} enviado(s), ${u.assinados} assinado(s), ${u.faltam} faltando${u.taxaPercent == null ? "" : `, taxa ${u.taxaPercent.toLocaleString("pt-BR")}%`}`,
        { size: 10, spaceAfter: 2 }
      );
    }
    w.space(4);
  }

  const linhas = linhasDoRelatorio(d);
  for (const lista of LISTAS_DO_RELATORIO) {
    const daLista = linhas.filter((l) => l.lista === ROTULO_DA_LISTA[lista]);
    w.heading(`${ROTULO_DA_LISTA[lista]} (${daLista.length})`, { size: 12, spaceBefore: 8 });
    if (daLista.length === 0) {
      w.paragraph("Nenhum.", { size: 9, color: MUTED, spaceAfter: 4 });
      continue;
    }
    for (const l of daLista) {
      const partes = [
        `${l.pacote} · ${l.cliente || "—"} (${l.publico.toLowerCase()})`,
        l.documento,
        `${l.unidade} · enviado em ${l.enviadoEm}${l.enviadoPor ? ` por ${l.enviadoPor}` : ""}`,
        l.concluidoEm && lista !== "faltam" ? `${lista === "assinados" ? "concluído" : "encerrado"} em ${l.concluidoEm}` : "",
        l.espera,
        l.motivo ? `motivo: ${l.motivo}` : "",
      ].filter(Boolean);
      w.ensure(40);
      w.paragraph(partes.join(" — "), { size: 9, spaceAfter: 4 });
    }
  }

  drawFooters(doc, fonts, `${d.titulo} · ${formatIsoDateBr(d.periodo.de)} a ${formatIsoDateBr(d.periodo.ate)}`);
  return doc.save();
}

export async function planilhaDoRelatorio(d: DadosDoRelatorio): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "riSZon";
  const r = wb.addWorksheet("Resumo");
  r.columns = [{ width: 36 }, { width: 70 }];
  r.addRow([d.titulo]).font = { bold: true, size: 14 };
  r.addRow([`${formatIsoDateBr(d.periodo.de)} a ${formatIsoDateBr(d.periodo.ate)}`, d.filtros]);
  r.addRow([]);
  for (const linha of resumo(d)) r.addRow(linha);
  r.addRow([]);
  r.addRow(["Faltam assinar, por tempo de espera"]).font = { bold: true };
  for (const x of d.ind.faixas) r.addRow([x.rotulo, x.quantos]);
  if (d.ind.porUnidade.length > 1) {
    r.addRow([]);
    r.addRow(["Unidade", "Enviados / Assinados / Faltam / Taxa"]).font = { bold: true };
    for (const u of d.ind.porUnidade) r.addRow([u.nome, `${u.enviados} / ${u.assinados} / ${u.faltam} / ${u.taxaPercent == null ? "—" : `${u.taxaPercent}%`}`]);
  }

  const p = wb.addWorksheet(d.porDocumento ? "Documentos" : "Pacotes");
  p.columns = [
    { header: "Lista", key: "lista", width: 16 },
    { header: "Pacote", key: "pacote", width: 13 },
    { header: "Cliente / empresa", key: "cliente", width: 32 },
    { header: "Público", key: "publico", width: 10 },
    { header: d.porDocumento ? "Documento" : "Documentos", key: "documento", width: 48 },
    { header: "Unidade", key: "unidade", width: 24 },
    { header: "Enviado em", key: "enviadoEm", width: 12 },
    { header: "Enviado por", key: "enviadoPor", width: 24 },
    { header: "Situação", key: "situacao", width: 20 },
    { header: "Concluído / encerrado em", key: "concluidoEm", width: 14 },
    { header: "Espera", key: "espera", width: 30 },
    { header: "Motivo", key: "motivo", width: 36 },
  ];
  p.getRow(1).font = { bold: true };
  p.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of linhasDoRelatorio(d)) p.addRow(l);
  p.autoFilter = { from: "A1", to: "L1" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
