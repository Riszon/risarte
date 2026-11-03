import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { linhasDoRelatorio, pdfDoRelatorio, planilhaDoRelatorio } from "@/lib/signatures/relatorio";
import {
  calcularIndicadores,
  diasDeEspera,
  faixaDe,
  linhasDaLista,
  linkDaOrigem,
  quemSegura,
  rotulosDasFaixas,
  textoDoTempo,
  type LinhaDoPainel,
} from "@/lib/signatures/indicadores";

// ZS7 — os números e as listas do painel (uma conta para a tela, o relatório
// e o e-mail mensal). Datas em UTC; o dia conta em Brasília (UTC−3).

let n = 0;
const linha = (over: Partial<LinhaDoPainel>): LinhaDoPainel => ({
  id: `p${++n}`,
  number: `ASS-${String(n).padStart(6, "0")}`,
  clinic_id: "u1",
  clinic_name: "Londrina",
  audience: "patient",
  status: "sent",
  current_stage: "client",
  client_name: "Cliente",
  client_id: "c1",
  company_id: null,
  lead_id: null,
  origin_type: "client",
  origin_id: null,
  sent_at: "2026-10-10T15:00:00Z",
  client_signed_at: null,
  completed_at: null,
  expires_at: null,
  ended_at: null,
  cancel_reason: null,
  refused_reason: null,
  sent_by: "g1",
  sent_by_name: "Gerente",
  cancelled_by_name: null,
  items: [{ title: "TCLE", template_id: "t1", kind: "consent" }],
  ...over,
});

const outubro = { de: "2026-10-01", ate: "2026-10-31" };
const opts = { hoje: "2026-11-02", faixas: [2, 5, 7] };

const linhas: LinhaDoPainel[] = [
  // assinado em outubro: cliente em 4 h, total 2 dias
  linha({ status: "signed", current_stage: "done", sent_at: "2026-10-05T12:00:00Z", client_signed_at: "2026-10-05T16:00:00Z", completed_at: "2026-10-07T12:00:00Z" }),
  // assinado em outubro: cliente em 24 h, total 3 dias, outra unidade
  linha({ clinic_id: "u2", clinic_name: "Cambé", status: "signed", current_stage: "done", sent_at: "2026-10-20T12:00:00Z", client_signed_at: "2026-10-21T12:00:00Z", completed_at: "2026-10-23T12:00:00Z" }),
  // enviado em setembro e assinado em outubro (conta em assinados, não na turma)
  linha({ status: "signed", current_stage: "done", sent_at: "2026-09-28T12:00:00Z", client_signed_at: "2026-10-01T12:00:00Z", completed_at: "2026-10-02T12:00:00Z" }),
  // aguardando o cliente há 1 dia e há 6 dias; aguardando a Risarte há 9 dias
  linha({ sent_at: "2026-11-01T12:00:00Z" }),
  linha({ sent_at: "2026-10-27T12:00:00Z" }),
  linha({ status: "partially_signed", current_stage: "risarte", sent_at: "2026-10-24T12:00:00Z", client_signed_at: "2026-10-25T12:00:00Z" }),
  // encerrados em outubro
  linha({ status: "refused", sent_at: "2026-10-11T12:00:00Z", ended_at: "2026-10-12T12:00:00Z", refused_reason: "Valor errado" }),
  linha({ status: "expired", sent_at: "2026-10-01T12:00:00Z", ended_at: "2026-10-08T12:00:00Z" }),
  linha({ status: "cancelled", sent_at: "2026-10-15T12:00:00Z", ended_at: "2026-10-16T12:00:00Z", cancel_reason: "Paciente desistiu" }),
  linha({ status: "cancelled", sent_at: "2026-10-15T12:00:00Z", ended_at: "2026-10-16T12:00:00Z", cancel_reason: "Paciente desistiu" }),
  // encerrado em setembro: fora de outubro
  linha({ status: "cancelled", sent_at: "2026-09-10T12:00:00Z", ended_at: "2026-09-11T12:00:00Z", cancel_reason: "Outro" }),
];

describe("os números do período (ZS7)", () => {
  const ind = calcularIndicadores(linhas, outubro, opts);

  it("enviados, assinados e a taxa da turma de outubro", () => {
    // enviados em outubro: 2 assinados (05 e 20), 2 aguardando (24 e 27), 1 recusado,
    // 1 vencido e 2 cancelados = 8. O de 28/09 e o de 01/11 ficam fora.
    expect(ind.enviados).toBe(8);
    expect(ind.assinados).toBe(3);
    expect(ind.assinadosDaTurma).toBe(2);
    expect(ind.taxaPercent).toBe(25);
  });

  it("faltam assinar = agora, separado em cliente e equipe", () => {
    expect(ind.faltam).toBe(3);
    expect(ind.faltamCliente).toBe(2);
    expect(ind.faltamEquipe).toBe(1);
  });

  it("recusados, vencidos e cancelados do período (o de setembro não conta)", () => {
    expect([ind.recusados, ind.vencidos, ind.cancelados]).toEqual([1, 1, 2]);
    expect(ind.motivosCancelamento).toEqual([{ motivo: "Paciente desistiu", quantos: 2 }]);
  });

  it("tempo de resposta do cliente e tempo total", () => {
    // clientes que assinaram em outubro: 4 h, 24 h, 72 h (setembro→01/10), 24 h (o da Risarte)
    expect(ind.tempoCliente.quantos).toBe(4);
    expect(ind.tempoCliente.medianaHoras).toBe(24);
    expect(ind.tempoTotal.quantos).toBe(3);
    expect(ind.tempoTotal.medianaHoras).toBe(72);
  });

  it("faixas de espera: até 2, 3 a 5, 6 a 7, mais de 7", () => {
    expect(ind.faixas).toEqual([
      { rotulo: "até 2 dias", quantos: 1 },
      { rotulo: "3 a 5 dias", quantos: 0 },
      { rotulo: "6 a 7 dias", quantos: 1 },
      { rotulo: "mais de 7 dias", quantos: 1 },
    ]);
  });

  it("por unidade e por semana", () => {
    const cambe = ind.porUnidade.find((u) => u.clinicId === "u2")!;
    expect(cambe).toMatchObject({ enviados: 1, assinados: 1, faltam: 0, taxaPercent: 100 });
    const total = ind.serie.reduce((s, w) => s + w.enviados, 0);
    expect(total).toBe(ind.enviados);
    expect(ind.seriePorMes).toBe(false);
    expect(ind.serie[0].inicio <= outubro.de).toBe(true);
    const ano = calcularIndicadores(linhas, { de: "2026-01-01", ate: "2026-11-02" }, opts);
    expect(ano.seriePorMes).toBe(true);
    expect(ano.serie.map((m) => m.inicio)).toHaveLength(11);
    expect(ano.serie.reduce((s, m) => s + m.enviados, 0)).toBe(ano.enviados);
  });
});

describe("as listas que cada número abre (ZS7, pedido do dono)", () => {
  it("cada lista bate com o seu número", () => {
    const ind = calcularIndicadores(linhas, outubro, opts);
    expect(linhasDaLista(linhas, "assinados", outubro, opts)).toHaveLength(ind.assinados);
    expect(linhasDaLista(linhas, "faltam", outubro, opts)).toHaveLength(ind.faltam);
    expect(linhasDaLista(linhas, "recusados", outubro, opts)).toHaveLength(ind.recusados);
    expect(linhasDaLista(linhas, "vencidos", outubro, opts)).toHaveLength(ind.vencidos);
    expect(linhasDaLista(linhas, "cancelados", outubro, opts)).toHaveLength(ind.cancelados);
    expect(linhasDaLista(linhas, "enviados", outubro, opts)).toHaveLength(ind.enviados);
  });

  it("faltam assinar: o que espera há mais tempo primeiro, e filtra pela faixa", () => {
    const todos = linhasDaLista(linhas, "faltam", outubro, opts);
    expect(todos.map((l) => diasDeEspera(l, opts.hoje))).toEqual([9, 6, 1]);
    expect(linhasDaLista(linhas, "faltam", outubro, { ...opts, faixa: 3 }).map((l) => diasDeEspera(l, opts.hoje))).toEqual([9]);
  });

  it("o link da origem: negociação, ficha, empresa ou lead", () => {
    expect(linkDaOrigem({ origin_type: "plan_negotiation", client_id: "c9", company_id: null, lead_id: null })).toEqual({ href: "/apresentacao/c9", rotulo: "Abrir a negociação" });
    expect(linkDaOrigem({ origin_type: "client", client_id: "c9", company_id: null, lead_id: null })?.href).toBe("/prontuarios/c9?aba=documentos");
    expect(linkDaOrigem({ origin_type: "commercial_lead", client_id: null, company_id: "e1", lead_id: "l1" })?.href).toBe("/empresarial/e1?aba=contratos");
    expect(linkDaOrigem({ origin_type: "commercial_lead", client_id: null, company_id: null, lead_id: "l1" })).toEqual({ href: "/empresarial/funil/l1?aba=envio", rotulo: "Abrir a negociação" });
  });

  it("quem segura, as faixas configuráveis e o texto do tempo", () => {
    expect([quemSegura({ current_stage: "client" }), quemSegura({ current_stage: "witnesses" }), quemSegura({ current_stage: "risarte" })]).toEqual(["o cliente", "as testemunhas", "a Risarte"]);
    expect(rotulosDasFaixas([3, 10])).toEqual(["até 3 dias", "4 a 10 dias", "mais de 10 dias"]);
    expect(faixaDe(0, [2, 5, 7])).toBe(0);
    expect(faixaDe(8, [2, 5, 7])).toBe(3);
    expect([textoDoTempo(null), textoDoTempo(3.2), textoDoTempo(36), textoDoTempo(72)]).toEqual(["—", "3 h", "1,5 dia", "3 dias"]);
  });

  it("o dia conta em Brasília: 01/11 01:00 UTC ainda é 31/10", () => {
    const l = linha({ sent_at: "2026-11-01T01:00:00Z" });
    expect(calcularIndicadores([l], outubro, opts).enviados).toBe(1);
  });
});

describe("o relatório sai da mesma conta (ZS7)", { timeout: 60_000 }, () => {
  const dados = (porDocumento: boolean) => ({
    titulo: "Relatório das assinaturas digitais",
    periodo: outubro,
    filtros: "toda a rede",
    ind: calcularIndicadores(linhas, outubro, opts),
    linhas,
    hoje: opts.hoje,
    faixas: opts.faixas,
    porDocumento,
    geradoPor: "Teste",
  });

  it("uma linha por pacote das cinco listas; por documento abre os documentos", () => {
    const ind = calcularIndicadores(linhas, outubro, opts);
    const porPacote = linhasDoRelatorio(dados(false));
    expect(porPacote).toHaveLength(ind.assinados + ind.faltam + ind.recusados + ind.vencidos + ind.cancelados);
    const comDois = [...linhas, linha({ status: "signed", current_stage: "done", sent_at: "2026-10-09T12:00:00Z", completed_at: "2026-10-09T18:00:00Z", items: [
      { title: "Contrato", template_id: "a", kind: "contract" },
      { title: "TCLE", template_id: "b", kind: "consent" },
    ] })];
    const d = { ...dados(true), linhas: comDois };
    expect(linhasDoRelatorio(d).length).toBe(linhasDoRelatorio({ ...d, porDocumento: false }).length + 1);
    expect(porPacote.find((l) => l.lista === "Faltam assinar")?.espera).toMatch(/dia\(s\), esperando (o cliente|a Risarte)/);
  });

  it("o PDF e a planilha abrem", async () => {
    const pdf = await pdfDoRelatorio(dados(false));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const buf = await planilhaDoRelatorio(dados(true));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Documentos"]);
    expect(wb.getWorksheet("Documentos")!.rowCount).toBe(linhasDoRelatorio(dados(true)).length + 1);
  });
});
