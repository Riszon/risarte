import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  destinoNaUnidade,
  distanciaDaMedia,
  escreverMarca,
  farolCaixa,
  farolDre,
  farolPagar,
  farolReceber,
  lerMarca,
  linhaDeCaixa,
  margemDaRede,
  parseNetworkTab,
  periodoDoMes,
  porAtencaoCaixa,
  porAtencaoDre,
  porAtencaoPagar,
  totaisCaixa,
  totaisDre,
  totaisPagar,
  voltaParaRede,
  type UnidadeCaixa,
  type UnidadeDre,
  type UnidadePagar,
  type UnidadeReceber,
} from "@/lib/finance/network-areas";
import { buildCashFlow } from "@/lib/finance/cash-flow";

// OC-00121 — o Painel da rede por área. As cores e as frases saem daqui; os
// números de cada unidade saem das mesmas funções da tela da unidade.

const SRC = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const pagar = (p: Partial<UnidadePagar>): UnidadePagar => ({
  clinicId: "u",
  nome: "Unidade",
  ownership: "franchised",
  aPagarCents: 0,
  vencidoCents: 0,
  vencidoQuantidade: 0,
  aAutorizarQuantidade: 0,
  aAutorizarCents: 0,
  venceNoMesCents: 0,
  pagoNoMesCents: 0,
  ...p,
});

const receber = (p: Partial<UnidadeReceber>): UnidadeReceber => ({
  clinicId: "u",
  nome: "Unidade",
  ownership: "franchised",
  abertoCents: 0,
  vencidoCents: 0,
  vencidoQuantidade: 0,
  abertoQuantidade: 0,
  taxaPercent: null,
  limitePercent: null,
  aVencer: [0, 0, 0, 0],
  atrasadas: [0, 0, 0, 0],
  recebidoNoMesCents: 0,
  ...p,
});

const dre = (p: Partial<UnidadeDre>): UnidadeDre => ({
  clinicId: "u",
  nome: "Unidade",
  ownership: "franchised",
  receitaBrutaCents: 0,
  receitaLiquidaCents: 0,
  resultadoCents: 0,
  ...p,
});

describe("o mês escolhido (K4)", () => {
  it("vira o período do mês inteiro, com o último dia certo", () => {
    expect(periodoDoMes(2026, 2, "2026-10-22")).toMatchObject({ de: "2026-02-01", ate: "2026-02-28" });
    expect(periodoDoMes(2028, 2, "2026-10-22").ate).toBe("2028-02-29");
    expect(periodoDoMes(2026, 10, "2026-10-22")).toMatchObject({ de: "2026-10-01", ate: "2026-10-31" });
  });

  it("endereço com mês fora do lugar vira o mês de hoje, nunca 13/2026", () => {
    expect(periodoDoMes(2026, 13, "2026-10-22")).toMatchObject({ ano: 2026, mes: 10, de: "2026-10-01" });
    expect(periodoDoMes(Number.NaN, 5, "2026-10-22")).toMatchObject({ mes: 10 });
  });

  it("aba desconhecida abre a Visão geral", () => {
    expect(parseNetworkTab("dre")).toBe("dre");
    expect(parseNetworkTab("qualquer")).toBe("visao");
    expect(parseNetworkTab(undefined)).toBe("visao");
  });
});

describe("Contas a pagar: a cor e a frase", () => {
  it("conta vencida é vermelho, e a frase diz quanto e quantas", () => {
    const f = farolPagar(pagar({ aPagarCents: 50000, vencidoCents: 12000, vencidoQuantidade: 2 }));
    expect(f.farol).toBe("vermelho");
    expect(f.motivo).toContain("120,00");
    expect(f.motivo).toContain("2 contas");
  });

  it("esperando autorização (sem vencido) é amarelo", () => {
    expect(farolPagar(pagar({ aPagarCents: 9000, aAutorizarQuantidade: 1, aAutorizarCents: 9000 })).farol).toBe("amarelo");
  });

  it("unidade sem conta nem pagamento é SEM DADO, não verde — calada não é em dia", () => {
    expect(farolPagar(pagar({})).farol).toBe("sem_dado");
    expect(farolPagar(pagar({ pagoNoMesCents: 100 })).farol).toBe("verde");
  });

  it("a ordem: vermelho primeiro, e dentro dele o maior vencido", () => {
    const us = [
      pagar({ clinicId: "a", nome: "A", aPagarCents: 10 }),
      pagar({ clinicId: "b", nome: "B", vencidoCents: 100, vencidoQuantidade: 1, aPagarCents: 100 }),
      pagar({ clinicId: "c", nome: "C", vencidoCents: 900, vencidoQuantidade: 1, aPagarCents: 900 }),
      pagar({ clinicId: "d", nome: "D" }),
    ];
    expect([...us].sort(porAtencaoPagar).map((u) => u.clinicId)).toEqual(["c", "b", "a", "d"]);
    expect(totaisPagar(us)).toMatchObject({ vencidoCents: 1000, farois: { vermelho: 2, verde: 1, sem_dado: 1 } });
  });
});

describe("Recebíveis: a mesma régua dos Recebíveis da rede", () => {
  it("acima do limite é vermelho; vencido dentro dele, amarelo; nada a receber, sem dado", () => {
    expect(farolReceber(receber({ abertoCents: 1000, vencidoCents: 500, taxaPercent: 50, limitePercent: 10 })).farol).toBe("vermelho");
    expect(farolReceber(receber({ abertoCents: 1000, vencidoCents: 50, taxaPercent: 5, limitePercent: 10 })).farol).toBe("amarelo");
    expect(farolReceber(receber({ abertoCents: 1000, taxaPercent: 0 })).farol).toBe("verde");
    expect(farolReceber(receber({})).farol).toBe("sem_dado");
  });
});

describe("Fluxo de caixa: a linha sai da série DIÁRIA da unidade", () => {
  const base = { clinicId: "u", nome: "U", ownership: "franchised" as const };
  const mes = { from: "2026-10-01", to: "2026-10-31" };

  it("um buraco no dia 8 coberto no dia 25 continua vermelho — e diz o dia", () => {
    const diario = buildCashFlow({
      rows: [
        { day: "2026-10-08", kind: "realizado", activity: "operacional", inflowCents: 0, outflowCents: 30000 },
        { day: "2026-10-25", kind: "previsto", activity: "operacional", inflowCents: 90000, outflowCents: 0 },
      ],
      from: mes.from,
      to: mes.to,
      groupBy: "dia",
      openingCents: 10000,
    });
    const u = linhaDeCaixa(base, diario, 10000);
    expect(u.saldoFinalCents).toBe(70000);
    expect(u.primeiroNegativo).toEqual({ dia: "2026-10-08", saldoCents: -20000 });
    const f = farolCaixa(u);
    expect(f.farol).toBe("vermelho");
    expect(f.motivo).toContain("08/10");
  });

  it("sair mais do que entra com o saldo aguentando é amarelo", () => {
    const diario = buildCashFlow({
      rows: [{ day: "2026-10-10", kind: "realizado", activity: "operacional", inflowCents: 1000, outflowCents: 5000 }],
      from: mes.from,
      to: mes.to,
      groupBy: "dia",
      openingCents: 100000,
    });
    expect(farolCaixa(linhaDeCaixa(base, diario, 100000)).farol).toBe("amarelo");
  });

  it("leitura que falhou é sem dado com o aviso — nunca zero com cara de saúde", () => {
    const falhou: UnidadeCaixa = {
      ...base,
      saldoInicialCents: 0,
      entradasCents: 0,
      saidasCents: 0,
      saldoFinalCents: 0,
      primeiroNegativo: null,
      falhou: true,
    };
    expect(farolCaixa(falhou)).toMatchObject({ farol: "sem_dado", motivo: expect.stringContaining("Não foi possível") });
    // E ela não entra nas somas.
    const ok = { ...falhou, falhou: false, entradasCents: 500, saldoFinalCents: 500 };
    expect(totaisCaixa([falhou, ok]).entradasCents).toBe(500);
  });

  it("dentro do vermelho, quem fica negativo PRIMEIRO vem antes", () => {
    const neg = (id: string, dia: string): UnidadeCaixa => ({
      ...base,
      clinicId: id,
      saldoInicialCents: 0,
      entradasCents: 0,
      saidasCents: 1,
      saldoFinalCents: -1,
      primeiroNegativo: { dia, saldoCents: -1 },
    });
    const us = [neg("tarde", "2026-10-20"), neg("cedo", "2026-10-03")];
    expect([...us].sort(porAtencaoCaixa).map((u) => u.clinicId)).toEqual(["cedo", "tarde"]);
    expect(totaisCaixa(us).negativas).toBe(2);
  });
});

describe("DRE (K3): margem contra a média da rede", () => {
  it("a margem da rede é PONDERADA pela receita — não a média simples das margens", () => {
    const pequena = dre({ receitaLiquidaCents: 10000, resultadoCents: 5000 }); // 50%
    const grande = dre({ receitaLiquidaCents: 1000000, resultadoCents: 100000 }); // 10%
    const m = margemDaRede([pequena, grande])!;
    expect(m).toBeCloseTo(105000 / 1010000, 6); // ~10,4%, e não 30%
  });

  it("prejuízo é vermelho; abaixo da média além da faixa, amarelo; dentro dela, na média; acima, puxa para cima", () => {
    const media = 0.2;
    expect(farolDre(dre({ receitaLiquidaCents: 1000, resultadoCents: -1 }), media).farol).toBe("vermelho");
    const baixo = farolDre(dre({ receitaLiquidaCents: 1000, resultadoCents: 150 }), media);
    expect(baixo.farol).toBe("amarelo");
    expect(baixo.motivo).toContain("para baixo");
    expect(farolDre(dre({ receitaLiquidaCents: 1000, resultadoCents: 190 }), media).motivo).toContain("Na média");
    const alto = farolDre(dre({ receitaLiquidaCents: 1000, resultadoCents: 300 }), media);
    expect(alto).toMatchObject({ farol: "verde", motivo: expect.stringContaining("para cima") });
    expect(distanciaDaMedia(dre({ receitaLiquidaCents: 1000, resultadoCents: 300 }), media)).toBe(10);
  });

  it("sem receita: prejuízo é vermelho; sem nada, sem dado", () => {
    expect(farolDre(dre({ resultadoCents: -500 }), 0.1).farol).toBe("vermelho");
    expect(farolDre(dre({}), 0.1).farol).toBe("sem_dado");
  });

  it("a ordem põe a pior margem primeiro dentro da mesma cor", () => {
    const us = [
      dre({ clinicId: "a", nome: "A", receitaLiquidaCents: 1000, resultadoCents: 400 }),
      dre({ clinicId: "b", nome: "B", receitaLiquidaCents: 1000, resultadoCents: -10 }),
      dre({ clinicId: "c", nome: "C", receitaLiquidaCents: 1000, resultadoCents: 50 }),
    ];
    const t = totaisDre(us);
    expect([...us].sort(porAtencaoDre(t.margem)).map((u) => u.clinicId)).toEqual(["b", "c", "a"]);
  });
});

describe("abrir na unidade (K2): destino e volta", () => {
  it("cada aba leva ao relatório do mesmo assunto e do mesmo período", () => {
    expect(destinoNaUnidade("dre", "2026-10-01", "2026-10-31")).toBe("/financeiro/dre?de=2026-10-01&ate=2026-10-31");
    expect(destinoNaUnidade("caixa", "2026-10-01", "2026-10-31")).toBe("/financeiro/fluxo-de-caixa?de=2026-10-01&ate=2026-10-31");
    expect(destinoNaUnidade("pagar", "2026-10-01", "2026-10-31")).toBe("/financeiro/contas-a-pagar");
    expect(destinoNaUnidade("visao", "2026-10-01", "2026-10-31")).toBe("/financeiro");
  });

  it("Recebíveis vai SEM período: lá ele filtra pelo vencimento e esconderia o atrasado", () => {
    expect(destinoNaUnidade("receber", "2026-10-01", "2026-10-31")).toBe("/financeiro/recebiveis");
  });

  it("data fora do formato não entra no endereço", () => {
    expect(destinoNaUnidade("dre", "x", "2026-10-31")).toBe("/financeiro/dre");
  });

  it("a volta leva à mesma aba e ao mesmo mês", () => {
    expect(voltaParaRede("painel", "caixa", "2026-09-01", "2026-09-30")).toBe(
      "/financeiro/painel-da-rede?aba=caixa&ano=2026&mes=9"
    );
    expect(voltaParaRede("consolidado", "dre", "2026-01-01", "2026-03-31")).toBe(
      "/financeiro/consolidado?de=2026-01-01&ate=2026-03-31"
    );
  });

  it("a marca do cookie ida e volta; adulterada não vale", () => {
    const m = {
      clinicId: "0b6a4c58-2f3e-4f8a-9c1d-1234567890ab",
      redeId: "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
      origem: "painel" as const,
      aba: "dre" as const,
      de: "2026-10-01",
      ate: "2026-10-31",
    };
    expect(lerMarca(escreverMarca(m))).toEqual(m);
    expect(lerMarca(escreverMarca({ ...m, clinicId: "nao-e-uuid" }))).toBeNull();
    // Sem a franqueadora de origem, a marca não vale (marca antiga, de 5 partes).
    expect(lerMarca(escreverMarca(m).split("|").slice(0, 5).join("|"))).toBeNull();
    expect(lerMarca(escreverMarca(m).replace("painel", "http://fora"))).toBeNull();
    expect(lerMarca(undefined)).toBeNull();
  });
});

describe("as réguas do código", () => {
  it("a rede usa as MESMAS contas da unidade (sem função nova no banco)", () => {
    const dados = ler("app/(app)/financeiro/painel-da-rede/dados-por-area.ts");
    for (const f of ["viewPayable(", "summarizePayables(", "buildCashFlow(", '"cash_flow_series"', '"cash_balance_before"', '"network_units_summary"', '"network_receivables"']) {
      expect(dados, f).toContain(f);
    }
    // Lista de unidades no .in() vai em lotes (o endereço tem tamanho).
    expect(dados).not.toMatch(/\.in\("clinic_id", ids\)/);
  });

  it("abrir na unidade só entra numa unidade do seletor de quem pediu", () => {
    const acao = ler("app/(app)/financeiro/abrir-na-unidade-actions.ts");
    expect(acao).toContain("session.clinics.find((c) => c.id === input.clinicId)");
    expect(acao).toContain('unidade.type === "franchisor"');
    expect(acao).toContain("isFinanceFranchisor(session)");
    // A volta vai para a franqueadora de onde se saiu (o treino tem duas).
    expect(acao).toContain("c.id === marca?.redeId");
  });
});

describe("as frases", () => {
  it("prejuízo não repete o sinal (\"Prejuízo de -R$\" lê como lucro)", () => {
    const f = farolDre(dre({ resultadoCents: -512590 }), 0.1);
    expect(f.motivo).toContain("Prejuízo de R$");
    expect(f.motivo).not.toContain("-R$");
  });
});

describe("OC-00122 — quanto a unidade representa da rede", () => {
  it("é a parte do total, arredondada para a frase", async () => {
    const { participacao, fmtParticipacao } = await import("@/lib/finance/network-areas");
    expect(participacao(1250000, 2070000)).toBeCloseTo(0.6039, 3);
    expect(fmtParticipacao(participacao(1250000, 2070000))).toBe("60% da rede");
    expect(fmtParticipacao(participacao(1, 100000))).toBe("<1% da rede");
    expect(fmtParticipacao(participacao(0, 100000))).toBe("0% da rede");
  });

  it("rede sem nada na coluna, ou valor negativo, não vira percentual", async () => {
    const { participacao, fmtParticipacao } = await import("@/lib/finance/network-areas");
    expect(participacao(0, 0)).toBeNull();
    expect(participacao(-500, 1000)).toBeNull();
    expect(fmtParticipacao(null)).toBe("");
  });

  it("as quatro abas são tabela com a linha Rede nas mesmas colunas", () => {
    const tela = ler("app/(app)/financeiro/painel-da-rede/areas.tsx");
    expect(tela).toContain("<table");
    expect(tela).toContain("Rede ({unidades.length})");
    // A coluna do nome fica fixa ao rolar de lado (celular).
    expect(tela).toMatch(/sticky left-0/);
    expect((tela.match(/<TabelaDaArea/g) ?? []).length).toBe(4);
  });
});
