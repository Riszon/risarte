import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OCUPACAO_PADRAO,
  calcularHoraClinica,
  distanciaDaRede,
  farolHora,
  horaClinicaDaRede,
  periodoDaHoraClinica,
  porAtencaoHora,
  totaisHora,
  type HoraClinica,
  type MesDaHoraClinica,
  type UnidadeHora,
} from "@/lib/finance/hora-clinica";
import { destinoNaUnidade, parseNetworkTab } from "@/lib/finance/network-areas";

// A HORA CLÍNICA (pedido do dono, 27/10/2026; 0330). Decisões HC1–HC4:
// custo fixo ÷ (horas de cadeira × ocupação esperada); 3 meses fechados;
// o digitado só sem dados; a depreciação entra.

const ler = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

const periodo = periodoDaHoraClinica("2026-10-27");

// 2 cadeiras × 200 h = 400 h de cadeira por mês (24.000 min); R$ 30.000 de
// custo fixo + R$ 2.000 de depreciação por mês.
const mes = (m: string, p: Partial<MesDaHoraClinica> = {}): MesDaHoraClinica => ({
  mes: m,
  fixoCents: 3_000_000,
  depreciacaoCents: 200_000,
  minutosCadeira: 24_000,
  minutosTrabalhados: 9_600,
  ...p,
});
const tresMeses = (p: Partial<MesDaHoraClinica> = {}) => periodo.meses.map((m) => mes(m, p));

describe("os 3 meses fechados (HC2)", () => {
  it("em 27/10/2026: julho, agosto e setembro", () => {
    expect(periodo).toEqual({ de: "2026-07-01", ate: "2026-09-30", meses: ["2026-07", "2026-08", "2026-09"] });
  });

  it("o mês escolhido no Painel, se já fechou, é o último", () => {
    expect(periodoDaHoraClinica("2026-10-27", "2026-08").meses).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("mês que não fechou (o atual ou um futuro) volta para os 3 anteriores a hoje", () => {
    expect(periodoDaHoraClinica("2026-10-27", "2026-10").meses).toEqual(periodo.meses);
    expect(periodoDaHoraClinica("2026-10-27", "2027-03").meses).toEqual(periodo.meses);
  });

  it("vira o ano", () => {
    expect(periodoDaHoraClinica("2027-02-10")).toEqual({
      de: "2026-11-01",
      ate: "2027-01-31",
      meses: ["2026-11", "2026-12", "2027-01"],
    });
  });
});

describe("a conta (HC1, HC4)", () => {
  it("custo fixo + depreciação ÷ (horas de cadeira × 80%) = R$ 100,00/h", () => {
    const h = calcularHoraClinica({ periodo, meses: tresMeses(), ocupacaoEsperadaPercent: 80, manualCents: 18_000 });
    // 3 × R$ 32.000 = R$ 96.000 ÷ (1.200 h × 80% = 960 h) = R$ 100,00
    expect(h.origem).toBe("calculada");
    expect(h.calculadaCents).toBe(10_000);
    expect(h.efetivaCents).toBe(10_000); // o digitado (R$ 180) NÃO vale
    expect(h.minutosClinicos).toBe(57_600);
  });

  it("a depreciação entra (sem ela a hora seria menor)", () => {
    const sem = calcularHoraClinica({
      periodo,
      meses: tresMeses({ depreciacaoCents: 0 }),
      ocupacaoEsperadaPercent: 80,
      manualCents: 0,
    });
    expect(sem.calculadaCents).toBe(9_375); // R$ 90.000 ÷ 960 h
  });

  it("a hora REAL é pelas horas trabalhadas — comparação, não preço", () => {
    const h = calcularHoraClinica({ periodo, meses: tresMeses(), ocupacaoEsperadaPercent: 80, manualCents: 0 });
    expect(h.ocupacaoRealPercent).toBe(40);
    expect(h.horaRealCents).toBe(20_000); // R$ 96.000 ÷ 480 h
    expect(h.efetivaCents).toBe(10_000);
  });

  it("ocupação fora de 1–100% (ou vazia) vira a padrão de 80%", () => {
    for (const o of [null, 0, 101, Number.NaN]) {
      const h = calcularHoraClinica({ periodo, meses: tresMeses(), ocupacaoEsperadaPercent: o, manualCents: 0 });
      expect(h.ocupacaoEsperadaPercent).toBe(OCUPACAO_PADRAO);
    }
    const cem = calcularHoraClinica({ periodo, meses: tresMeses(), ocupacaoEsperadaPercent: 100, manualCents: 0 });
    expect(cem.calculadaCents).toBe(8_000); // agenda cheia: a menor hora
  });

  it("mês sem custo fixo lançado sai da conta E das horas (não dilui)", () => {
    const meses = [mes("2026-07", { fixoCents: 0, depreciacaoCents: 0 }), mes("2026-08"), mes("2026-09")];
    const h = calcularHoraClinica({ periodo, meses, ocupacaoEsperadaPercent: 80, manualCents: 0 });
    expect(h.mesesUsados).toEqual(["2026-08", "2026-09"]);
    expect(h.calculadaCents).toBe(10_000); // a mesma hora, não 2/3 dela
  });

  it("mês sem hora de cadeira também sai", () => {
    const meses = [mes("2026-07", { minutosCadeira: 0 }), mes("2026-08"), mes("2026-09")];
    expect(calcularHoraClinica({ periodo, meses, ocupacaoEsperadaPercent: 80, manualCents: 0 }).mesesUsados).toHaveLength(2);
  });
});

describe("sem dados vale o digitado, e a tela diz por quê (HC3)", () => {
  it("sem custo fixo: provisória, com o motivo", () => {
    const h = calcularHoraClinica({
      periodo,
      meses: tresMeses({ fixoCents: 0, depreciacaoCents: 0 }),
      ocupacaoEsperadaPercent: 80,
      manualCents: 18_000,
    });
    expect(h.origem).toBe("provisoria");
    expect(h.calculadaCents).toBeNull();
    expect(h.efetivaCents).toBe(18_000);
    expect(h.motivo).toMatch(/Nenhum custo fixo lançado/);
  });

  it("sem agenda: provisória, com o motivo", () => {
    const h = calcularHoraClinica({ periodo, meses: tresMeses({ minutosCadeira: 0 }), ocupacaoEsperadaPercent: 80, manualCents: 18_000 });
    expect(h.motivo).toMatch(/não tem horas de cadeira/);
  });

  it("leitura que falha NÃO vira conta pela metade", () => {
    const h = calcularHoraClinica({
      periodo,
      meses: tresMeses(),
      ocupacaoEsperadaPercent: 80,
      manualCents: 18_000,
      naoLido: ["o custo fixo do Financeiro"],
    });
    expect(h.origem).toBe("provisoria");
    expect(h.efetivaCents).toBe(18_000);
    expect(h.motivo).toMatch(/Não consegui ler o custo fixo/);
  });

  it("sem dados e sem digitado: sem valor (zero, e a tela avisa)", () => {
    const h = calcularHoraClinica({ periodo, meses: tresMeses({ fixoCents: 0, depreciacaoCents: 0 }), ocupacaoEsperadaPercent: 80, manualCents: 0 });
    expect(h.origem).toBe("sem_valor");
    expect(h.efetivaCents).toBe(0);
  });
});

describe("a rede (Painel da rede)", () => {
  const hora = (custoMes: number, cadeiraMes: number, manual = 0, depreciacao = 0): HoraClinica =>
    calcularHoraClinica({
      periodo,
      meses: tresMeses({ fixoCents: custoMes - depreciacao, depreciacaoCents: depreciacao, minutosCadeira: cadeiraMes }),
      ocupacaoEsperadaPercent: 80,
      manualCents: manual,
    });
  const u = (nome: string, h: HoraClinica): UnidadeHora => ({ clinicId: nome, nome, ownership: "franchised", hora: h });
  // Cambé: 1 cadeira, R$ 10.000/mês → 160 h clínicas → R$ 62,50/h
  // Londrina: 4 cadeiras, R$ 64.000/mês (R$ 4.000 de depreciação) → 640 h clínicas → R$ 100,00/h
  const cambe = u("Cambé", hora(1_000_000, 12_000));
  const londrina = u("Londrina", hora(6_400_000, 48_000, 0, 400_000));
  const nova = u("Nova", hora(0, 12_000, 15_000));

  it("a hora da rede é soma em cima, soma embaixo (não a média simples)", () => {
    // (10.000 + 64.000) ÷ (160 + 640) = R$ 92,50 — a média simples daria R$ 81,25
    expect(horaClinicaDaRede([cambe.hora, londrina.hora, nova.hora])).toBe(9_250);
  });

  it("a cor: mais de 10% acima da rede é amarelo; sem conta, cinza", () => {
    const rede = 9_250;
    expect(farolHora(londrina, rede)).toEqual({ farol: "verde", motivo: "Na média da rede" });
    expect(farolHora(cambe, rede)).toEqual({ farol: "verde", motivo: "Hora 32,4% mais barata que a da rede" });
    expect(farolHora(londrina, 8_000).farol).toBe("amarelo");
    expect(farolHora(nova, rede)).toEqual({
      farol: "sem_dado",
      motivo: "Sem dados para calcular — vale o valor digitado (R$ 150,00/h)",
    });
    expect(distanciaDaRede(11_000, 10_000)).toBe(10);
  });

  it("ordem: a mais cara primeiro, as sem conta no fim", () => {
    expect([nova, cambe, londrina].sort(porAtencaoHora).map((x) => x.nome)).toEqual(["Londrina", "Cambé", "Nova"]);
  });

  it("os totais só somam as calculadas", () => {
    const t = totaisHora([cambe, londrina, nova]);
    expect(t.horaCents).toBe(9_250);
    expect(t.calculadas).toBe(2);
    expect(t.custoMensalCents).toBe(7_400_000);
    expect(t.farois).toEqual({ vermelho: 0, amarelo: 0, verde: 2, sem_dado: 1 });
  });

  it("a aba existe e o 'Abrir na unidade' leva ao Ponto de equilíbrio dos MESMOS 3 meses", () => {
    expect(parseNetworkTab("hora")).toBe("hora");
    expect(destinoNaUnidade("hora", "2026-10-01", "2026-10-31", "2026-10-27")).toBe(
      "/financeiro/ponto-de-equilibrio?de=2026-07-01&ate=2026-09-30"
    );
    expect(destinoNaUnidade("hora", "2026-08-01", "2026-08-31", "2026-10-27")).toBe(
      "/financeiro/ponto-de-equilibrio?de=2026-06-01&ate=2026-08-31"
    );
  });
});

describe("o banco e as telas usam a MESMA fonte", () => {
  const sql = ler("supabase/migrations/0330_hora_clinica.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.clinic_fixed_costs_by_month"));
  const pe = ler("supabase/migrations/0228_breakeven_and_bridge.sql");
  const breakeven = pe.slice(pe.indexOf("create or replace function public.breakeven_lines"), pe.indexOf("grant execute on function public.breakeven_lines"));

  it("o custo fixo tem o MESMO recorte do Ponto de equilíbrio", () => {
    for (const filtro of [
      "e.accrual_date between p_from and p_to",
      "e.status in ('settled', 'open')",
      "e.reversal_of is null",
      "e.source_type not in ('receipt_cash', 'payable_cash')",
      "e.account_code not like '6%'",
      "e.account_code not like '5.1%'",
      "e.account_code not like '5.3%'",
      "e.account_code not like '5.4%'",
    ]) {
      expect(breakeven).toContain(filtro);
      expect(fn).toContain(filtro);
    }
    // fixo = comportamento "fixed" do plano de contas; depreciação = 5.2 (HC4)
    expect(breakeven).toMatch(/when max\(a\.cost_behavior\) = 'fixed'\s+then 'fixo'/);
    expect(fn).toContain("(e.account_code like '5.2%' or a.cost_behavior = 'fixed')");
    // receita (1.x) e receita financeira (4.1) nunca entram como custo
    expect(fn).toContain("e.account_code not like '1%'");
    expect(fn).toContain("e.account_code not like '4.1%'");
  });

  it("quem não enxerga a unidade é recusado; sem login não executa", () => {
    expect(fn).toMatch(/if p_clinic is null or not public\.can_read_clinic_data\(p_clinic\) then\s+raise exception 'NOT_ALLOWED'/);
    expect(sql).toMatch(/revoke execute on function public\.clinic_fixed_costs_by_month\(uuid, date, date\) from public, anon, authenticated;/);
  });

  it("Precificação, negociação/venda direta e Painel da rede leem pelo MESMO carregador", () => {
    expect(ler("src/app/(app)/procedimentos/precificacao/page.tsx")).toMatch(/carregarHoraClinica\(supabase, clinicId,/);
    const margem = ler("src/lib/finance/custos-da-margem-db.ts");
    expect(margem).toMatch(/carregarHoraClinica\(supabase, clinicId, \{ hoje: todayInBrazil\(\) \}\)/);
    expect(margem).toMatch(/horaDeCadeiraCents: hora\.efetivaCents/);
    expect(ler("src/app/(app)/financeiro/painel-da-rede/dados-por-area.ts")).toMatch(/carregarHoraClinica\(/);
  });

  it("a tela grava o DIGITADO, nunca a calculada (que envelheceria guardada)", () => {
    const tela = ler("src/app/(app)/procedimentos/precificacao/pricing-simulator-client.tsx");
    expect(tela).toMatch(/chairCostPerHourCents: manualChairCents,/);
    expect(tela).toMatch(/const chairCents = hora \? hora\.efetivaCents : manualChairCents;/);
  });
});
