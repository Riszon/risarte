import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { situacaoDoPlanoNoDia, type PlanItem } from "@/lib/annual-plan";
import { effectiveDayHours } from "@/lib/agenda-settings";

// AP41 (decisão do dono, 15/10/2026: "a agenda segue a regra escrita"): num
// dia de recesso (segunda a sábado) com um dia avulso das 08h às 12h, a
// agenda tratava o dia como NORMAL e unia as janelas — aceitava das 08h às
// 18h. A regra escrita (AJ7) diz: dia fechado + avulso = só a janela do avulso.

const DIA = "2026-12-28"; // uma segunda-feira
function item(m: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "i1",
    type: "recess",
    startsDate: "2026-12-24",
    endsDate: "2027-01-02",
    title: null,
    note: null,
    userIds: [],
    isNetwork: false,
    locked: false,
    ...m,
  };
}

describe("o que o Planejamento Anual faz com o dia", () => {
  it("recesso da unidade FECHA o dia (o avulso pode abrir)", () => {
    expect(situacaoDoPlanoNoDia([item()], DIA, null, false)).toEqual({ bloqueia: false, fechaODia: true });
  });
  it("período da REDE travado BLOQUEIA (nem avulso abre)", () => {
    expect(situacaoDoPlanoNoDia([item({ isNetwork: true, locked: true })], DIA, null, false)).toEqual({
      bloqueia: true,
      fechaODia: false,
    });
  });
  it("período da rede sem trava fecha como o da unidade", () => {
    expect(situacaoDoPlanoNoDia([item({ isNetwork: true })], DIA, null, false).fechaODia).toBe(true);
  });
  it("férias individuais bloqueiam SÓ o profissional delas", () => {
    const ferias = item({ type: "individual_vacation", userIds: ["dra-ana"] });
    expect(situacaoDoPlanoNoDia([ferias], DIA, "dra-ana", false)).toEqual({ bloqueia: true, fechaODia: false });
    expect(situacaoDoPlanoNoDia([ferias], DIA, "dr-beto", false)).toEqual({ bloqueia: false, fechaODia: false });
  });
  it("campanha é informativa: não fecha nada", () => {
    expect(situacaoDoPlanoNoDia([item({ type: "campaign" })], DIA, null, false)).toEqual({ bloqueia: false, fechaODia: false });
  });
  it("o online (consultor remoto) não é fechado pela unidade — só pelas férias dele", () => {
    expect(situacaoDoPlanoNoDia([item()], DIA, "consultor", true)).toEqual({ bloqueia: false, fechaODia: false });
    const ferias = item({ type: "individual_vacation", userIds: ["consultor"] });
    expect(situacaoDoPlanoNoDia([ferias], DIA, "consultor", true).bloqueia).toBe(true);
  });
  it("fora do período, nada", () => {
    expect(situacaoDoPlanoNoDia([item()], "2026-12-23", null, false)).toEqual({ bloqueia: false, fechaODia: false });
  });
});

describe("a janela do dia (AJ7) com o plano", () => {
  it("o caso do achado: recesso numa segunda + avulso 08h–12h = SÓ 08h–12h", () => {
    const { fechaODia } = situacaoDoPlanoNoDia([item()], DIA, null, false);
    const diaUtil = true; // segunda-feira configurada
    expect(effectiveDayHours("08:00", "18:00", { start: "08:00", end: "12:00" }, diaUtil && !fechaODia)).toEqual({
      open: "08:00",
      close: "12:00",
    });
  });
  it("sem o plano, o avulso num dia normal continua ESTENDENDO (une)", () => {
    expect(effectiveDayHours("08:00", "18:00", { start: "07:00", end: "12:00" }, true)).toEqual({
      open: "07:00",
      close: "18:00",
    });
  });
});

describe("as duas réguas da agenda usam a mesma regra", () => {
  const acoes = readFileSync(join(__dirname, "..", "..", "app", "(app)", "agenda", "actions.ts"), "utf8");
  it("a validação do agendamento", () => {
    expect(acoes).toMatch(/const \{ fechaODia: fechadoPeloPlano \} = situacaoDoPlanoNoDia\(/);
    expect(acoes).toMatch(/holidayDecision\?\.will_attend === true\) &&\s*!fechadoPeloPlano;/);
  });
  it("e a lista de próximos horários (que antes nem lia o plano)", () => {
    expect(acoes).toMatch(/const plano = situacaoDoPlanoNoDia\(itensDoPlano, dateOnly, providerUserId \|\| null, isOnline\);/);
    expect(acoes).toMatch(/if \(plano\.bloqueia\) continue;/);
    expect(acoes).toMatch(/if \(plano\.fechaODia && !special\) continue;/);
    expect(acoes).toMatch(/const isNormalDay = \(isWeekdayOpen \|\| hd === true\) && !plano\.fechaODia;/);
  });
});
