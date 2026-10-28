import { describe, expect, it } from "vitest";
import {
  addMonths,
  attentionReasons,
  caseTimeliness,
  chargeStatusToday,
  daysBetween,
  dueDateFor,
  finishForecast,
  maintenanceSchedule,
  monthlyEvolution,
  nextMaintenance,
  orthoClauses,
  originOf,
  plannedEndDate,
  progressPercent,
  type OrthoCaseLike,
} from "@/lib/ortodontia/regras";
import {
  ORTHO_CHARGE_STATUSES,
  ORTHO_KINDS,
  ORTHO_MAINTENANCE_STATUSES,
  ORTHO_STATUSES,
} from "@/lib/ortodontia/constants";
import { CAPACIDADES } from "@/lib/permissions";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ortodontia (docs/ortodontia/ORTO-PLANO.md). Trava as decisões do dono: a
// mensalidade é devida sem comparecimento (O-regra), atrasado = passou do
// término previsto + tolerância (O3), manutenção vencida depois de 7 dias (O4),
// contenção não cobra (O1).

const TODAY = "2026-10-27";

const caso = (p: Partial<OrthoCaseLike> = {}): OrthoCaseLike => ({
  status: "em_tratamento",
  start_date: "2026-01-15",
  planned_end_date: "2028-01-15",
  finished_at: null,
  next_reevaluation_date: null,
  ...p,
});

describe("datas", () => {
  it("soma meses pelo calendário e cai no último dia do mês curto", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-10-27", -12)).toBe("2025-10-27");
  });
  it("conta dias inteiros", () => {
    expect(daysBetween("2026-10-01", "2026-10-27")).toBe(26);
    expect(daysBetween("2026-10-27", "2026-10-01")).toBe(-26);
  });
});

describe("cronograma", () => {
  it("término previsto = início + meses", () => {
    expect(plannedEndDate("2026-03-10", 24)).toBe("2028-03-10");
  });
  it("gera uma manutenção a cada intervalo até o término", () => {
    const datas = maintenanceSchedule("2026-01-01", "2026-07-01", 30);
    expect(datas[0]).toBe("2026-01-31");
    expect(datas.at(-1)! <= "2026-07-01").toBe(true);
    expect(datas.length).toBe(6);
  });
  it("não vira mil linhas com intervalo absurdo", () => {
    expect(maintenanceSchedule("2026-01-01", "2040-01-01", 1).length).toBe(120);
  });
});

describe("no prazo × atrasado (O3)", () => {
  it("em tratamento antes do término é no prazo", () => {
    expect(caseTimeliness(caso(), TODAY)).toBe("no_prazo");
  });
  it("passou do término mas dentro da tolerância segue no prazo", () => {
    expect(caseTimeliness(caso({ planned_end_date: "2026-10-10" }), TODAY, 30)).toBe("no_prazo");
  });
  it("passou da tolerância = atrasado", () => {
    expect(caseTimeliness(caso({ planned_end_date: "2026-09-01" }), TODAY, 30)).toBe("atrasado");
  });
  it("finalizado compara a data em que terminou", () => {
    expect(
      caseTimeliness(caso({ status: "finalizado", planned_end_date: "2026-09-01", finished_at: "2026-09-20" }), TODAY)
    ).toBe("finalizado_no_prazo");
    expect(
      caseTimeliness(caso({ status: "finalizado", planned_end_date: "2026-06-01", finished_at: "2026-09-20" }), TODAY)
    ).toBe("finalizado_atrasado");
  });
  it("sem término previsto não se aplica; o progresso acompanha", () => {
    expect(caseTimeliness(caso({ planned_end_date: null }), TODAY)).toBe("nao_se_aplica");
    expect(progressPercent(caso({ start_date: "2026-01-01", planned_end_date: "2026-12-31" }), "2026-07-02")).toBe(50);
  });
});

describe("atenção (a lista da recepção)", () => {
  it("em tratamento sem agendamento futuro pede agendamento", () => {
    expect(attentionReasons({ caso: caso(), maintenances: [], today: TODAY })).toEqual(["sem_agendamento"]);
  });
  it("com agendamento futuro está em dia", () => {
    expect(
      attentionReasons({
        caso: caso(),
        maintenances: [{ status: "agendada", planned_date: "2026-10-30", appointment_date: "2026-11-03" }],
        today: TODAY,
      })
    ).toEqual([]);
  });
  it("manutenção prevista há mais de 7 dias sem agendar = vencida (O4)", () => {
    expect(
      attentionReasons({
        caso: caso(),
        maintenances: [{ status: "prevista", planned_date: "2026-10-15" }],
        today: TODAY,
      })
    ).toEqual(["manutencao_vencida"]);
    // Dentro dos 7 dias ainda é só "sem agendamento".
    expect(
      attentionReasons({
        caso: caso(),
        maintenances: [{ status: "prevista", planned_date: "2026-10-22" }],
        today: TODAY,
      })
    ).toEqual(["sem_agendamento"]);
  });
  it("faltou na última e não remarcou", () => {
    expect(
      attentionReasons({
        caso: caso(),
        maintenances: [
          { status: "realizada", planned_date: "2026-08-20", done_at: "2026-08-20T13:00:00Z" },
          { status: "faltou", planned_date: "2026-09-20", appointment_date: "2026-09-22" },
        ],
        today: TODAY,
      })
    ).toEqual(["faltou"]);
  });
  it("reavaliação vencida, término atrasado e mensalidade atrasada entram juntos", () => {
    const r = attentionReasons({
      caso: caso({ planned_end_date: "2026-08-01", next_reevaluation_date: "2026-10-01" }),
      maintenances: [{ status: "agendada", planned_date: "2026-10-30", appointment_date: "2026-11-03" }],
      charges: [{ status: "em_aberto", due_date: "2026-10-10" }],
      today: TODAY,
    });
    expect(r).toEqual(["reavaliacao_vencida", "termino_atrasado", "mensalidade_atrasada"]);
  });
  it("quem não vê dinheiro não recebe o motivo financeiro", () => {
    const r = attentionReasons({
      caso: caso(),
      maintenances: [{ status: "agendada", planned_date: "2026-10-30", appointment_date: "2026-11-03" }],
      charges: [{ status: "atrasada", due_date: "2026-10-10" }],
      today: TODAY,
      includeMoney: false,
    });
    expect(r).toEqual([]);
  });
  it("aguardando início sem instalação agendada", () => {
    expect(attentionReasons({ caso: caso({ status: "aguardando_inicio" }), maintenances: [], today: TODAY })).toEqual([
      "aguardando_inicio",
    ]);
  });
  it("finalizado e interrompido não pedem nada", () => {
    expect(attentionReasons({ caso: caso({ status: "finalizado", finished_at: "2026-10-01" }), maintenances: [], today: TODAY })).toEqual([]);
    expect(attentionReasons({ caso: caso({ status: "interrompido" }), maintenances: [], today: TODAY })).toEqual([]);
  });
  it("próxima manutenção: a agendada futura antes da prevista", () => {
    const m = nextMaintenance(
      [
        { status: "prevista", planned_date: "2026-10-01" },
        { status: "agendada", planned_date: "2026-11-01", appointment_date: "2026-11-05" },
      ],
      TODAY
    );
    expect(m?.status).toBe("agendada");
  });
});

describe("mensalidade", () => {
  it("em aberto e vencida mostra atrasada", () => {
    expect(chargeStatusToday({ status: "em_aberto", due_date: "2026-10-10" }, TODAY)).toBe("atrasada");
    expect(chargeStatusToday({ status: "em_aberto", due_date: "2026-10-30" }, TODAY)).toBe("em_aberto");
    expect(chargeStatusToday({ status: "paga", due_date: "2026-10-10" }, TODAY)).toBe("paga");
  });
  it("vencimento no dia de cobrança, limitado ao fim do mês", () => {
    expect(dueDateFor("2026-02-01", 31)).toBe("2026-02-28");
    expect(dueDateFor("2026-10-01", 10)).toBe("2026-10-10");
  });
});

describe("previsão e evolução", () => {
  it("separa por horizonte e conta os que já passaram", () => {
    const f = finishForecast(
      [
        caso({ planned_end_date: "2026-12-01" }),
        caso({ planned_end_date: "2027-03-01" }),
        caso({ planned_end_date: "2027-09-01" }),
        caso({ planned_end_date: "2026-09-01" }),
        caso({ status: "finalizado", planned_end_date: "2026-12-01", finished_at: "2026-10-01" }),
      ],
      TODAY
    );
    expect(f).toEqual({ in3: 1, in6: 1, in12: 1, overdue: 1 });
  });
  it("mês a mês: ativos no fim do mês, começados e terminados", () => {
    const pts = monthlyEvolution(
      [
        caso({ start_date: "2026-08-10" }),
        caso({ start_date: "2026-09-05", status: "finalizado", finished_at: "2026-10-02" }),
      ],
      TODAY,
      3
    );
    expect(pts.map((p) => p.month)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(pts[0]).toMatchObject({ active: 1, started: 1, finished: 0 });
    expect(pts[1]).toMatchObject({ active: 2, started: 1, finished: 0 });
    expect(pts[2]).toMatchObject({ active: 1, started: 0, finished: 1 });
  });
});

describe("origem do paciente", () => {
  it("segue a precedência Indica → Riso+ → Empresarial → indicação → unidade", () => {
    expect(originOf({ has_indica_referral: true, ppr_active: true })).toBe("indica");
    expect(originOf({ ppr_membership_id: "x" })).toBe("riso_mais");
    expect(originOf({ empresarial_company_id: "e" })).toBe("empresarial");
    expect(originOf({ referred_by_client_id: "c" })).toBe("indicacao_direta");
    expect(originOf({})).toBe("unidade");
  });
});

describe("as cláusulas do acordo (proposta e termo)", () => {
  const terms = {
    kind: "aparelho_fixo" as const,
    monthlyCents: 18990,
    plannedMonths: 24,
    maintenanceIntervalDays: 30,
    billingDay: 10,
    installationCents: 50000,
  };
  it("dizem que a mensalidade é devida sem comparecimento (regra do dono)", () => {
    const texto = orthoClauses(terms).join(" ");
    expect(texto).toMatch(/independentemente do comparecimento/);
    expect(texto).toMatch(/R\$\s?189,90/);
    expect(texto).toMatch(/24 meses/);
    expect(texto).toMatch(/a cada 30 dias/);
    expect(texto).toMatch(/não é um procedimento avulso/);
  });
  it("a instalação só aparece quando há valor", () => {
    expect(orthoClauses({ ...terms, installationCents: 0 }).join(" ")).not.toMatch(/instalação do aparelho/);
    expect(orthoClauses(terms).join(" ")).toMatch(/R\$\s?500,00/);
  });
});

describe("espelho do banco (migração 0329)", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "supabase", "migrations", "0329_ortodontia.sql"),
    "utf8"
  );
  it("as situações do código são as do check constraint", () => {
    for (const s of ORTHO_STATUSES) expect(sql).toContain(`'${s}'`);
    for (const s of ORTHO_MAINTENANCE_STATUSES) expect(sql).toContain(`'${s}'`);
    for (const s of ORTHO_CHARGE_STATUSES) expect(sql).toContain(`'${s}'`);
    for (const k of ORTHO_KINDS) expect(sql).toContain(`'${k}'`);
  });
  it("a conta da DRE existe e a mensalidade vai para ela", () => {
    expect(sql).toContain("'1.1.04'");
    expect(sql).toMatch(/Ortodontia — mensalidades/);
  });
  it("as permissões do módulo existem no catálogo e são semeadas no banco", () => {
    const ids = [
      "modulo.ortodontia",
      "modulo.ortodontia.painel",
      "acao.ortodontia.gerir",
      "acao.ortodontia.evoluir",
      "acao.ortodontia.financeiro",
    ];
    for (const id of ids) {
      expect(CAPACIDADES.some((c) => c.id === id), id).toBe(true);
      expect(sql, id).toContain(`('${id}',`);
    }
  });
  it("contenção não gera mensalidade (O1): só em tratamento", () => {
    const gen = sql.slice(sql.indexOf("function public.ortho_generate_charges"));
    const where = gen.slice(0, gen.indexOf("$$;"));
    expect(where).toMatch(/status = 'em_tratamento'/);
    expect(where).not.toMatch(/'contencao'/);
  });
});
