import { describe, expect, it } from "vitest";
import {
  FILTRO_INICIAL,
  aging,
  distribuicao,
  evolucaoMensal,
  evolucaoPorCategoria,
  fotosDoFiltro,
  indicadoresDoPainel,
  linhasDoPainel,
  saudeFinanceira,
  dividasDoCartao,
  acordosDoCartao,
  dreDoDevedor,
  type FotoDoMes,
} from "@/lib/finance/dividas-painel";
import type { DebtListRow } from "@/lib/finance/dividas";

// LEVANTAMENTO DE DÍVIDAS, FASE 6: as contas do Painel.

const linha = (o: Partial<DebtListRow>): DebtListRow => ({
  id: "d", code: "DV-1", clinicId: "L", clinicName: "Londrina", supplierId: "s", supplierName: "Banco", supplierKind: null,
  categoryId: "c1", subcategoryId: null, natureCode: "financeira", tagIds: [], status: "a_vencer", dueDate: "2026-12-01",
  originalCents: 1000, updatedCents: null, priority: null, ownerUserId: null, origin: "A", contractNumber: null, description: null,
  installmentLabel: null, needsSplit: false, bundledCount: 1, groupCode: null, nextAction: null, nextActionOn: null,
  negativada: false, protestada: false, judicial: false, propostaCents: null, propostaValidade: null, custasCents: 0, lastCheckedOn: null,
  ...o,
});
const HOJE = "2026-11-15";

describe("o filtro do painel", () => {
  const rows = [
    linha({ id: "a", clinicId: "L", tagIds: ["t"] }),
    linha({ id: "b", clinicId: "C", status: "contestada" }),
    linha({ id: "c", clinicId: "L", status: "baixada" }),
  ];
  it("baixada nunca conta; devedor, etiqueta e contestadas filtram", () => {
    expect(linhasDoPainel(rows, FILTRO_INICIAL).map((r) => r.id)).toEqual(["a", "b"]);
    expect(linhasDoPainel(rows, { ...FILTRO_INICIAL, devedor: "L" }).map((r) => r.id)).toEqual(["a"]);
    expect(linhasDoPainel(rows, { ...FILTRO_INICIAL, etiqueta: "t" }).map((r) => r.id)).toEqual(["a"]);
    expect(linhasDoPainel(rows, { ...FILTRO_INICIAL, semContestadas: true }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("os cards", () => {
  const rows = [
    linha({ id: "a", status: "inadimplente", saldoCents: 5000, negativada: true, propostaCents: 3000, custasCents: 200 }),
    linha({ id: "b", status: "em_atraso", saldoCents: 2000, protestada: true, clinicId: "C", clinicName: "Cambé" }),
    linha({ id: "c", status: "judicial", saldoCents: 1000, judicial: true }),
    linha({ id: "q", status: "quitada_encerrada", saldoCents: 0, pagoCents: 9000, negativada: true }),
  ];
  const acordos = [
    { clinicId: "L", situacao: "em_andamento", dividas: ["a"], descontoCents: 700, abertas: [{ faltaCents: 100, vencimento: "2026-11-20" }, { faltaCents: 100, vencimento: "2027-01-20" }] },
    { clinicId: "L", situacao: "quebrado", dividas: ["a"], descontoCents: 999, abertas: [{ faltaCents: 50, vencimento: "2026-10-01" }] },
    { clinicId: "L", situacao: "cumprido", dividas: ["q"], descontoCents: 300, abertas: [] },
    { clinicId: "X", situacao: "em_andamento", dividas: ["fora"], descontoCents: 5, abertas: [{ faltaCents: 9, vencimento: "2026-11-16" }] },
  ];
  const i = indicadoresDoPainel(rows, acordos, HOJE);
  it("devido pela regra única, contestada/judicial à parte (D17), sem proposta não é desconto", () => {
    expect(i.totais.devidoCents).toBe(8000);
    expect(i.totais.contestadaJudicialCents).toBe(1000);
    expect(i.totais.economiaCents).toBe(2000);
    expect(i.totais.semPropostaCents).toBe(3000);
    expect(i.totais.custoTotalCents).toBe(3000 + 3000 + 200);
  });
  it("restrições contam só o que não está quitado; CNPJs com restrição", () => {
    expect(i.negativadas).toEqual({ quantidade: 1, valorCents: 5000 });
    expect(i.inadimplentes.valorCents).toBe(5000);
    expect(i.emAtraso.valorCents).toBe(2000);
    expect(i.cnpjsComRestricao.map((c) => [c.nome, c.negativadas, c.protestadas, c.judiciais])).toEqual([
      ["Cambé", 0, 1, 0],
      ["Londrina", 1, 0, 1],
    ]);
  });
  it("acordos: saldo e 30 dias dos que valem (só os das dívidas do filtro); economia só dos que valem ou cumpriram", () => {
    expect(i.acordos).toEqual({ quantidade: 2, saldoCents: 250, proximos30Cents: 150, quebrados: 1 });
    expect(i.economiaObtidaCents).toBe(1000);
    expect(i.quitadoCents).toBe(9000);
  });
});

describe("distribuição e aging", () => {
  it("passa do máximo: o resto vira UMA fatia Outros", () => {
    const rows = Array.from({ length: 5 }, (_, k) => linha({ id: String(k), supplierId: `s${k}`, saldoCents: (k + 1) * 100 }));
    const d = distribuicao(rows, (r) => r.supplierId, (k) => k.toUpperCase(), 3);
    expect(d.map((f) => [f.rotulo, f.valorCents])).toEqual([["S4", 500], ["S3", 400], ["Outros (3)", 600]]);
  });
  it("aging pelo título mais antigo em aberto; o que não venceu fica fora", () => {
    const rows = [
      linha({ id: "a", dueDate: "2025-01-01", vencimentoAberto: "2026-11-01", saldoCents: 100 }),
      linha({ id: "b", dueDate: "2025-01-01", saldoCents: 200 }),
      linha({ id: "c", dueDate: "2026-12-01", saldoCents: 300 }),
    ];
    const a = aging(rows, HOJE);
    expect(a.find((x) => x.faixa === "1-30")?.valorCents).toBe(100);
    expect(a.find((x) => x.faixa === "365+")?.valorCents).toBe(200);
    expect(a.reduce((t, x) => t + x.valorCents, 0)).toBe(300);
  });
});

describe("a evolução mensal: o passado vem da fotografia", () => {
  const foto = (o: Partial<FotoDoMes>): FotoDoMes => ({
    mes: "2026-10-01", debtId: "a", clinicId: "L", status: "inadimplente", categoryId: "c1", tagIds: [],
    saldoCents: 1000, pagoNoMesCents: 0, novaNoMes: false, atualizadoCents: null, ...o,
  });
  const fotos = [
    foto({ mes: "2026-09-01", saldoCents: 1500, novaNoMes: true, atualizadoCents: 1500 }),
    foto({ mes: "2026-10-01", saldoCents: 1000, pagoNoMesCents: 500 }),
    foto({ mes: "2026-10-01", debtId: "b", clinicId: "C", categoryId: "c2", saldoCents: 400, status: "baixada" }),
  ];
  it("meses fechados da foto; o corrente ao vivo, sem o pago (fecha no dia 1º)", () => {
    const rows = [linha({ id: "a", saldoCents: 800, criadaEm: "2026-11-03T10:00:00Z", originalCents: 800 })];
    const s = evolucaoMensal(fotosDoFiltro(fotos, FILTRO_INICIAL), rows, "2026-11-01");
    expect(s).toEqual([
      { mes: "2026-09-01", saldoCents: 1500, pagoCents: 0, novasCents: 1500, aoVivo: false },
      { mes: "2026-10-01", saldoCents: 1000, pagoCents: 500, novasCents: 0, aoVivo: false },
      { mes: "2026-11-01", saldoCents: 800, pagoCents: null, novasCents: 800, aoVivo: true },
    ]);
  });
  it("sem foto nenhuma: só o mês corrente (a tela diz \"sem histórico\")", () => {
    expect(evolucaoMensal([], [], "2026-11-01")).toHaveLength(1);
  });
  it("o filtro vale para o passado também", () => {
    expect(fotosDoFiltro(fotos, { ...FILTRO_INICIAL, devedor: "C" })).toHaveLength(0);
  });
  it("por categoria: as maiores de agora e \"Outras\"", () => {
    const rows = [linha({ id: "a", categoryId: "c1", saldoCents: 800 }), linha({ id: "x", categoryId: "c3", saldoCents: 50 }), linha({ id: "y", categoryId: "c4", saldoCents: 40 })];
    const e = evolucaoPorCategoria(fotosDoFiltro(fotos, FILTRO_INICIAL), rows, "2026-11-01", (id) => id.toUpperCase(), 2);
    expect(e.meses).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(e.series.map((x) => [x.rotulo, x.valores])).toEqual([
      ["C1", [1500, 1000, 800]],
      ["Outras (2)", [0, 0, 90]],
    ]);
  });
});

describe("saúde financeira (4.6)", () => {
  const rows = [
    linha({ id: "a", clinicId: "L", saldoCents: 60000 }),
    linha({ id: "b", clinicId: "C", saldoCents: 30000 }),
  ];
  const acordos = [{ clinicId: "L", situacao: "em_andamento", dividas: ["a"], descontoCents: 0, abertas: [], parcelasDoMesCents: 5000 }];
  const dre = new Map([["L", { receitaBrutaCents: 90000, custoFinanceiroCents: 1200, meses: 3 }]]);
  const nomes = new Map([["L", "Londrina"], ["C", "Cambé"]]);
  const s = saudeFinanceira(rows, acordos, dre, nomes);
  it("meses de receita = devido ÷ receita média; comprometimento = parcelas do mês ÷ receita média", () => {
    const l = s.linhas.find((x) => x.clinicId === "L")!;
    expect(l.receitaMediaCents).toBe(30000);
    expect(l.mesesDeReceita).toBe(2);
    expect(l.comprometimento).toBeCloseTo(5000 / 30000);
    expect(l.custoFinanceiroCents).toBe(1200);
  });
  it("sem DRE é \"sem dados\", nunca zero; a rede divide só quem tem receita pela própria receita", () => {
    const c = s.linhas.find((x) => x.clinicId === "C")!;
    expect([c.receitaMediaCents, c.mesesDeReceita, c.comprometimento, c.custoFinanceiroCents]).toEqual([null, null, null, null]);
    expect(s.rede.devidoCents).toBe(90000);
    expect(s.rede.mesesDeReceita).toBe(2);
  });
  it("custo financeiro vem da 4.2.01 (gasto positivo)", () => {
    const d = dreDoDevedor([{ accountCode: "4.2.01", block: "resultado_financeiro", amountCents: -800 }, { accountCode: "1.1.01", block: "receita_bruta", amountCents: 5000 }], 3, () => 5000);
    expect(d).toEqual({ receitaBrutaCents: 5000, custoFinanceiroCents: 800, meses: 3 });
  });
});

describe("o que forma cada número do Painel (clique no cartão)", () => {
  const rows = [
    linha({ id: "a", status: "inadimplente", saldoCents: 5000, negativada: true, propostaCents: 3000, custasCents: 200 }),
    linha({ id: "b", status: "em_atraso", saldoCents: 2000, protestada: true, clinicId: "C", clinicName: "Cambé" }),
    linha({ id: "c", status: "judicial", saldoCents: 1000, judicial: true }),
    linha({ id: "q", status: "quitada_encerrada", saldoCents: 0, pagoCents: 9000, negativada: true }),
  ];
  const acordos = [
    { clinicId: "L", situacao: "em_andamento", dividas: ["a"], descontoCents: 700, abertas: [{ faltaCents: 100, vencimento: "2026-11-20" }] },
    { clinicId: "L", situacao: "quebrado", dividas: ["a"], descontoCents: 999, abertas: [] },
    { clinicId: "L", situacao: "cumprido", dividas: ["q"], descontoCents: 300, abertas: [] },
    { clinicId: "L", situacao: "desfeito", dividas: ["a"], descontoCents: 50, abertas: [] },
  ];
  const ind = indicadoresDoPainel(rows, acordos, HOJE);
  const soma = (c: Parameters<typeof dividasDoCartao>[0]) => dividasDoCartao(c, rows).reduce((t, r) => t + (r.saldoCents ?? 0), 0);
  it("a lista de cada cartão soma o número do cartão", () => {
    expect(soma("devido")).toBe(ind.totais.devidoCents);
    expect(soma("sem_proposta")).toBe(ind.totais.semPropostaCents);
    expect(soma("inadimplentes")).toBe(ind.inadimplentes.valorCents);
    expect(soma("em_atraso")).toBe(ind.emAtraso.valorCents);
    expect(soma("negativadas")).toBe(ind.negativadas.valorCents);
    expect(dividasDoCartao("quitado", rows).reduce((t, r) => t + (r.pagoCents ?? 0), 0)).toBe(ind.quitadoCents);
  });
  it("restrição por CNPJ; acordos valendo e os que deram economia", () => {
    expect(dividasDoCartao("restricao", rows, "C").map((r) => r.id)).toEqual(["b"]);
    expect(acordosDoCartao("acordos", acordos, rows).map((a) => a.situacao)).toEqual(["em_andamento", "quebrado"]);
    expect(acordosDoCartao("economia_obtida", acordos, rows).reduce((t, a) => t + a.descontoCents, 0)).toBe(ind.economiaObtidaCents);
  });
});
