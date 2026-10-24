import { describe, expect, it } from "vitest";
import { indicadorDe } from "@/lib/metas/indicadores";
import {
  abaDa,
  alvoDoSujeito,
  atingiu,
  baseParaOPeriodo,
  daBanco,
  diasEntre,
  ehLimite,
  farol,
  fracaoEsperada,
  formatarValor,
  fraseSmart,
  janelaAtual,
  paraBanco,
  percentual,
  percentualDaMedida,
  periodoCorrente,
  periodosMensais,
  projecao,
  resolverParticipantes,
  seloAtingivel,
  situacaoEfetiva,
  valorDe,
} from "@/lib/metas/regras";
import type { Meta, Medicao } from "@/lib/metas/regras";
import { resumirMeta, serieDoGrafico } from "@/lib/metas/resumo";

describe("valor de uma medida (espelho de _goal_value)", () => {
  it("soma: o número", () => expect(valorDe({ num: 12, den: null })).toBe(12));
  it("taxa: num ÷ den", () => expect(valorDe({ num: 1900, den: 19 })).toBe(100));
  it("taxa sem denominador = sem dado, nunca zero", () => expect(valorDe({ num: 0, den: 0 })).toBeNull());
  it("sem medida = sem dado", () => expect(valorDe(null)).toBeNull());
});

describe("percentual da barra", () => {
  it("aumentar: realizado ÷ alvo, e passa de 100", () => {
    expect(percentual("increase", 11250, 15000)).toBe(75);
    expect(percentual("increase", 19200, 15000)).toBe(128);
  });
  it("reduzir com base: quanto já caiu ÷ quanto precisava cair (exemplo do plano)", () => {
    // inadimplência de 8% para 5%; hoje 6,5% → 50%
    expect(percentual("decrease", 6.5, 5, 8)).toBeCloseTo(50);
    expect(percentual("decrease", 4, 5, 8)).toBeCloseTo(133.33, 1);
  });
  it("reduzir piorando não fica negativo", () => {
    expect(percentual("decrease", 9, 5, 8)).toBe(0);
  });
  it("reduzir sem base: dentro = 100%", () => {
    expect(percentual("decrease", 4, 5)).toBe(100);
    expect(percentual("decrease", 10, 5)).toBe(50);
  });
  it("sem valor ou sem alvo = sem percentual", () => {
    expect(percentual("increase", null, 10)).toBeNull();
    expect(percentual("increase", 3, null)).toBeNull();
  });
  it("valor escondido (D3) usa o percentual que o banco mandou", () => {
    expect(percentualDaMedida({ pct: 87 }, "increase", 999)).toBe(87);
    expect(percentualDaMedida({ pct: null }, "increase", 999)).toBeNull();
  });
  it("atingiu respeita a direção", () => {
    expect(atingiu("increase", 10, 10)).toBe(true);
    expect(atingiu("decrease", 5.1, 5)).toBe(false);
    expect(atingiu("increase", null, 5)).toBeNull();
  });
});

describe("situação e abas", () => {
  const m = { status: "scheduled" as const, starts_on: "2026-11-01", ends_on: "2026-11-30" };
  it("a iniciar vira ativa no dia do início, sem esperar a rotina", () => {
    expect(situacaoEfetiva(m, "2026-10-31")).toBe("scheduled");
    expect(situacaoEfetiva(m, "2026-11-01")).toBe("active");
  });
  it("prazo vencido aparece como 'apurando' até a rotina congelar", () => {
    expect(situacaoEfetiva({ ...m, status: "active" }, "2026-12-01")).toBe("closing");
    expect(situacaoEfetiva({ ...m, status: "paused" }, "2026-12-01")).toBe("closing");
    expect(abaDa("closing")).toBe("finalizadas");
  });
  it("cancelada e rascunho não mudam com a data", () => {
    expect(situacaoEfetiva({ ...m, status: "cancelled" }, "2027-01-01")).toBe("cancelled");
    expect(situacaoEfetiva({ ...m, status: "draft" }, "2027-01-01")).toBe("draft");
  });
});

describe("datas", () => {
  it("dias com as duas pontas", () => {
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(31);
    expect(diasEntre("2026-10-02", "2026-10-01")).toBe(0);
  });
  it("meses de uma meta mensal, com as pontas parciais", () => {
    expect(periodosMensais("2026-10-15", "2026-12-10")).toEqual([
      { from: "2026-10-15", to: "2026-10-31" },
      { from: "2026-11-01", to: "2026-11-30" },
      { from: "2026-12-01", to: "2026-12-10" },
    ]);
    expect(periodosMensais("2026-12-20", "2027-01-05")).toEqual([
      { from: "2026-12-20", to: "2026-12-31" },
      { from: "2027-01-01", to: "2027-01-05" },
    ]);
  });
  it("janela medida agora = a mesma do banco", () => {
    const meta = { periodicity: "monthly" as const, starts_on: "2026-09-10", ends_on: "2026-12-31" };
    expect(janelaAtual(meta, "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    expect(janelaAtual({ ...meta, periodicity: "whole" }, "2026-10-23")).toEqual({ from: "2026-09-10", to: "2026-10-23" });
    expect(janelaAtual(meta, "2026-09-01")).toBeNull();
    expect(periodoCorrente(meta, "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("ritmo esperado (só dias encerrados; D4: pausa não conta, prazo não estende)", () => {
  const p = { from: "2026-11-01", to: "2026-11-30" };
  it("no dia 16, passaram 15 dias inteiros = metade do caminho", () => {
    expect(fracaoEsperada(p, "2026-11-16")).toBeCloseTo(0.5);
  });
  it("no PRIMEIRO dia ainda não se espera nada (o dia não acabou)", () => {
    expect(fracaoEsperada(p, "2026-11-01")).toBe(0);
  });
  it("antes de começar = nada; depois do fim = tudo", () => {
    expect(fracaoEsperada(p, "2026-10-31")).toBe(0);
    expect(fracaoEsperada(p, "2026-12-01")).toBe(1);
    expect(fracaoEsperada(p, "2026-12-05")).toBe(1);
  });
  it("10 dias pausados saem do que passou e do total", () => {
    // dia 21: passaram 20 inteiros, 10 pausados → 10 de 20 úteis
    expect(fracaoEsperada(p, "2026-11-21", [{ de: "2026-11-01", ate: "2026-11-10" }])).toBeCloseTo(0.5);
  });
  it("encerrado o prazo, com pausa, o esperado é 100% (o prazo não estendeu)", () => {
    expect(fracaoEsperada(p, "2026-12-01", [{ de: "2026-11-05", ate: "2026-11-09" }])).toBe(1);
  });
});

describe("farol e projeção", () => {
  it("soma: compara com o que já deveria ter sido feito", () => {
    expect(farol("sum", 50, 0.5)).toBe("verde");
    expect(farol("sum", 44, 0.5)).toBe("amarelo"); // 88% do ritmo
    expect(farol("sum", 30, 0.5)).toBe("vermelho");
    expect(farol("sum", 0, 0)).toBe("neutro");
    expect(farol("sum", 120, 0.2)).toBe("verde");
  });
  it("taxa: compara com o próprio alvo", () => {
    expect(farol("rate", 100, 0.1)).toBe("verde");
    expect(farol("rate", 93, 0.9)).toBe("amarelo");
    expect(farol("rate", 70, 0.9)).toBe("vermelho");
  });
  it("sem número = neutro (nunca 'atrás' por falta de medida)", () => {
    expect(farol("sum", null, 0.8)).toBe("neutro");
  });
  it("projeção no ritmo atual (só soma)", () => {
    expect(projecao("sum", 40, 0.5)).toBe(80);
    expect(projecao("rate", 40, 0.5)).toBeNull();
    expect(projecao("sum", 40, 0)).toBeNull();
  });
});

describe("alvo por pessoa e por unidade (espelho de _goal_subject_target)", () => {
  const soma = { indicator: "sales_count", target_value: 100, individual_rule: "split" as const, individual_value: null };
  it("dividido: alvo ÷ participantes", () => {
    expect(alvoDoSujeito(soma, "user", "a", 4, [])).toBe(25);
  });
  it("igual para todos: o valor individual", () => {
    expect(alvoDoSujeito({ ...soma, individual_rule: "same", individual_value: 10 }, "user", "a", 4, [])).toBe(10);
  });
  it("o ajuste manual manda", () => {
    expect(alvoDoSujeito(soma, "user", "a", 4, [{ subject_kind: "user", subject_id: "a", target_value: 40 }])).toBe(40);
    expect(alvoDoSujeito(soma, "user", "b", 4, [{ subject_kind: "user", subject_id: "a", target_value: 40 }])).toBe(25);
  });
  it("D2: unidade de uma meta de rede = alvo ÷ unidades (soma); a própria taxa (taxa)", () => {
    expect(alvoDoSujeito(soma, "clinic", "u1", 5, [])).toBe(20);
    expect(alvoDoSujeito({ ...soma, indicator: "attendance_rate", target_value: 85 }, "clinic", "u1", 5, [])).toBe(85);
  });
});

describe("selo Atingível", () => {
  it("até 10% acima do histórico = realista; até 30% = desafiador; mais = muito acima", () => {
    expect(seloAtingivel("increase", 105, 100).nivel).toBe("realista");
    expect(seloAtingivel("increase", 125, 100).nivel).toBe("desafiador");
    expect(seloAtingivel("increase", 148, 100).nivel).toBe("muito_acima");
  });
  it("reduzir: cair de 10% para 5% é pedir o dobro", () => {
    const s = seloAtingivel("decrease", 5, 10);
    expect(s.nivel).toBe("muito_acima");
    expect(s.melhora).toBeCloseTo(1);
  });
  it("sem histórico não inventa selo", () => {
    expect(seloAtingivel("increase", 10, null).nivel).toBe("sem_historico");
    expect(seloAtingivel("increase", 10, 0).nivel).toBe("sem_historico");
  });
  it("a base da soma é proporcional ao tamanho do período; a da taxa, não", () => {
    expect(baseParaOPeriodo("sum", 90, 90, 30)).toBe(30);
    expect(baseParaOPeriodo("rate", 82, 90, 30)).toBe(82);
  });
});

describe("participantes (espelho de _goal_participants)", () => {
  const cand = [
    { user_id: "r1", full_name: "Ana", role: "receptionist", clinic_id: "u1", at_franchisor: false },
    { user_id: "g1", full_name: "Bia", role: "unit_manager", clinic_id: "u1", at_franchisor: false },
    { user_id: "r2", full_name: "Caio", role: "receptionist", clinic_id: "u2", at_franchisor: false },
    { user_id: "c1", full_name: "Duda", role: "commercial_consultant", clinic_id: "fr", at_franchisor: true },
  ];
  it("unidade toda = só quem tem função nas unidades da meta", () => {
    expect(resolverParticipantes([{ kind: "all" }], cand, ["u1"]).map((p) => p.user_id)).toEqual(["r1", "g1"]);
  });
  it("por função inclui a Franqueadora (o consultor atende as unidades de lá)", () => {
    const r = resolverParticipantes([{ kind: "role", role: "commercial_consultant" }], cand, ["u1"]);
    expect(r.map((p) => p.user_id)).toEqual(["c1"]);
  });
  it("por função não puxa a mesma função de outra unidade", () => {
    const r = resolverParticipantes([{ kind: "role", role: "receptionist" }], cand, ["u1"]);
    expect(r.map((p) => p.user_id)).toEqual(["r1"]);
  });
  it("combinação soma as regras sem repetir", () => {
    const r = resolverParticipantes(
      [{ kind: "role", role: "receptionist" }, { kind: "user", user_id: "g1" }, { kind: "user", user_id: "r1" }],
      cand, ["u1"]);
    expect(r.map((p) => p.user_id)).toEqual(["r1", "g1"]);
  });
});

describe("a frase SMART", () => {
  it("o exemplo do dono, por mês", () => {
    const f = fraseSmart({
      indicador: indicadorDe("sales_value"),
      direction: "increase",
      target_mode: "collective",
      target_value: 1_500_000,
      individual_rule: null,
      individual_value: null,
      periodicity: "monthly",
      starts_on: "2027-01-01",
      ends_on: "2027-03-31",
      onde: "na Unidade Centro",
    });
    expect(f.replace(/\s/g, " ")).toBe("Fechar R$ 15.000,00 em vendas por mês na Unidade Centro, de 01/01/2027 a 31/03/2027.");
  });
  it("taxa para reduzir", () => {
    const f = fraseSmart({
      indicador: indicadorDe("no_show_rate"),
      direction: "decrease",
      target_mode: "collective",
      target_value: 5,
      individual_rule: null,
      individual_value: null,
      periodicity: "whole",
      starts_on: "2026-11-01",
      ends_on: "2026-11-30",
      onde: "na rede toda",
    });
    expect(f).toBe("Reduzir para no máximo 5% de faltas na rede toda, de 01/11/2026 a 30/11/2026.");
  });
  it("individual igual para todos, com quem participa", () => {
    const f = fraseSmart({
      indicador: indicadorDe("ppr_adhesions"),
      direction: "increase",
      target_mode: "individual",
      target_value: null,
      individual_rule: "same",
      individual_value: 15,
      periodicity: "whole",
      starts_on: null,
      ends_on: null,
      recorte: "do plano Familiar",
      onde: "na Unidade Centro",
      quem: "com os Consultores Comerciais",
    });
    expect(f).toBe(
      "Fechar 15 adesões ao Riso+ do plano Familiar por participante na Unidade Centro, com os Consultores Comerciais, com prazo a definir."
    );
  });
});

// ============================================================ ETAPA M2 (0319)

function metaDe(over: Partial<Meta>): Meta {
  return {
    id: "m", code: "MT-1", name: "x", indicator: "sales_count", filters: {}, scope: "clinics", clinic_ids: ["u1"],
    how_text: "x", direction: "increase", target_mode: "collective", target_value: 10, individual_rule: null,
    individual_value: null, stretch_value: null, baseline_value: null, baseline_from: null, baseline_to: null,
    resources_text: "x", attainable_note: null, strategic_objective: "growth", relevance_text: "x",
    periodicity: "whole", starts_on: "2026-11-01", ends_on: "2026-11-30", status: "active", outcome: null,
    status_reason: null, published_at: null, finished_at: null, cancelled_at: null, created_by: "a", created_at: "",
    ...over,
  };
}
const foto = (total: { num: number; den?: number | null }, kind: "sum" | "point" = "sum", by_day: { day: string; num: number; den?: number | null }[] = []) =>
  ({ from: "2026-11-01", to: "2026-11-16", kind, n_clinics: 1, n_participants: 0, restricted: false, total, by_clinic: [], by_user: [], by_day });
const medicao = (live: ReturnType<typeof foto>): Medicao => ({ today: "2026-11-16", money_hidden: false, live, frozen: [], milestones: [] });

describe("M2 — limite (N2: soma de 'no máximo')", () => {
  it("o percentual é o USO do limite (espelho de _goal_percent)", () => {
    expect(percentual("decrease", 2, 5, null, true)).toBe(40);
    expect(percentual("decrease", 7, 5, null, true)).toBe(140);
    expect(percentual("decrease", 0, 0, null, true)).toBe(0);
  });
  it("só é limite a soma que o catálogo marca — e com 'reduzir'", () => {
    expect(ehLimite({ indicator: "ppr_cancellations", direction: "decrease" })).toBe(true);
    expect(ehLimite({ indicator: "sales_count", direction: "decrease" })).toBe(false);
  });
  it("farol: verde enquanto o uso não passa do prazo corrido; vermelho passou", () => {
    expect(farol("sum", 30, 0.5, true)).toBe("verde");
    expect(farol("sum", 70, 0.5, true)).toBe("amarelo");
    expect(farol("sum", 120, 0.5, true)).toBe("vermelho");
  });
  it("o resumo usa o uso do limite, sem Super Meta", () => {
    const m = metaDe({ indicator: "ppr_cancellations", direction: "decrease", target_value: 5, stretch_value: 3 });
    const r = resumirMeta(m, medicao(foto({ num: 2 })), [], "2026-11-16");
    expect(r.limite).toBe(true);
    expect(r.pct).toBe(40);
    expect(r.pctSuper).toBeNull();
    expect(r.farol).toBe("verde");
  });
  it("a frase diz 'no máximo'", () => {
    const f = fraseSmart({
      indicador: indicadorDe("ppr_cancellations"), direction: "decrease", target_mode: "collective", target_value: 3,
      individual_rule: null, individual_value: null, periodicity: "whole", starts_on: "2026-11-01", ends_on: "2026-11-30",
      onde: "na Unidade Centro",
    });
    expect(f).toBe("Ter no máximo 3 cancelamentos do Riso+ na Unidade Centro, de 01/11/2026 a 30/11/2026.");
  });
});

describe("M2 — fotografia (N1)", () => {
  const m = metaDe({ indicator: "overdue_rate", direction: "decrease", target_value: 5, baseline_value: 8 });
  it("percentual pela linha de base (de 8% para 5%; hoje 6,5% → 50%)", () => {
    const r = resumirMeta(m, medicao(foto({ num: 650, den: 100 }, "point")), [], "2026-11-16");
    expect(r.pct).toBeCloseTo(50);
    expect(r.farol).toBe("vermelho");
    expect(r.projecao).toBeNull();
    expect(r.rotuloDoPeriodo).toMatch(/Hoje/);
  });
  it("taxa e fotografia não se dividem entre unidades", () => {
    expect(alvoDoSujeito({ ...m, individual_rule: null, individual_value: null }, "clinic", "u1", 4, [])).toBe(5);
    expect(baseParaOPeriodo("point", 8, 30, 90)).toBe(8);
  });
  it("o gráfico mostra o % de cada dia guardado contra a meta (100%)", () => {
    const s = serieDoGrafico(m, foto({ num: 650, den: 100 }, "point", [
      { day: "2026-11-14", num: 800, den: 100 },
      { day: "2026-11-15", num: 650, den: 100 },
    ]), { from: "2026-11-01", to: "2026-11-30" }, "2026-11-16", []);
    expect(s.pontos.map((p) => Math.round(p.realizado ?? -1))).toEqual([0, 50]);
    expect(s.pontos.every((p) => p.esperado === 100)).toBe(true);
  });
  it("receita da DRE não tem gráfico dia a dia (N3)", () => {
    const s = serieDoGrafico(metaDe({ indicator: "revenue_billed" }), foto({ num: 5 }), { from: "2026-11-01", to: "2026-11-30" }, "2026-11-16", []);
    expect(s.pontos).toEqual([]);
  });
});

// ============================================================ ETAPA M3 (0320)
describe("M3 — horas da cadeira e limites", () => {
  it("horas: o campo é em horas, o banco em minutos (a conta da cadeira)", () => {
    expect(paraBanco("hours", 12.5)).toBe(750);
    expect(daBanco("hours", 750)).toBe(12.5);
    expect(formatarValor("hours", 750)).toBe("12h30");
  });
  it("horas ociosas e vendas canceladas são limites ('no máximo')", () => {
    expect(ehLimite({ indicator: "chair_idle_hours", direction: "decrease" })).toBe(true);
    expect(ehLimite({ indicator: "sales_cancelled", direction: "decrease" })).toBe(true);
    expect(ehLimite({ indicator: "chair_occupancy", direction: "increase" })).toBe(false);
  });
  it("a frase das horas ociosas", () => {
    const f = fraseSmart({
      indicador: indicadorDe("chair_idle_hours"), direction: "decrease", target_mode: "collective", target_value: 1200,
      individual_rule: null, individual_value: null, periodicity: "whole", starts_on: "2026-11-01", ends_on: "2026-11-30",
      onde: "na Unidade Centro",
    });
    expect(f).toBe("Ter no máximo 20h de cadeira ociosa na Unidade Centro, de 01/11/2026 a 30/11/2026.");
  });
  it("medidos no código não têm marco nem meta mensal (o catálogo marca)", () => {
    expect(indicadorDe("chair_occupancy")?.noApp).toBe(true);
    expect(indicadorDe("chair_idle_hours")?.noApp).toBe(true);
    expect(indicadorDe("net_margin")?.noApp).toBeFalsy();
  });
});
