import { describe, expect, it } from "vitest";
import {
  addMonths,
  attendance,
  attentionReasons,
  caseTimeliness,
  chargeStatusToday,
  daysBetween,
  dueDateFor,
  extensionForMisses,
  finishForecast,
  isFinished,
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
  ORTHO_CHARGE_KINDS,
  ORTHO_CHARGE_STATUSES,
  ORTHO_KINDS,
  ORTHO_MAINTENANCE_STATUSES,
  ORTHO_BILLING_METHODS,
  ORTHO_MONEY_VIEW_ROLES,
  ORTHO_RETAINER_KINDS,
  ORTHO_SETTLE_ROLES,
  ORTHO_STATUSES,
} from "@/lib/ortodontia/constants";
import { CAPACIDADES } from "@/lib/permissions";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ortodontia (docs/ortodontia/ORTO-PLANO.md). Trava as decisões do dono: a
// mensalidade é devida sem comparecimento e vai ATÉ A ENTREGA DAS CONTENÇÕES,
// que finaliza o tratamento (O1, 28/10/2026); a baixa é do Gerente e do
// Financeiro (O2); atrasado = passou do término previsto + tolerância, e cada
// falta prorroga o término em um intervalo (O3); manutenção vencida depois de
// 7 dias (O4).

const TODAY = "2026-10-27";
const MIG = (n: string) => join(__dirname, "..", "..", "..", "supabase", "migrations", n);

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
  it("cada falta prorroga o término em um intervalo de manutenção (O3)", () => {
    expect(extensionForMisses(2, 30)).toBe(60);
    expect(extensionForMisses(0, 30)).toBe(0);
    expect(plannedEndDate("2026-03-10", 24, 60)).toBe("2028-05-09");
  });
  it("assiduidade = realizadas ÷ (realizadas + faltas); sem histórico não há taxa", () => {
    const a = attendance(
      [
        { status: "realizada" },
        { status: "realizada" },
        { status: "realizada" },
        { status: "faltou" },
        { status: "prevista" },
        { status: "cancelada" },
      ],
      30
    );
    expect(a).toEqual({ done: 3, missed: 1, ratePercent: 75, extensionDays: 30 });
    expect(attendance([{ status: "prevista" }]).ratePercent).toBeNull();
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
  it("contenções entregues = tratamento finalizado (O1): compara a data da entrega, não a de hoje", () => {
    // Entregou dentro do prazo, mesmo que hoje já tenha passado dele.
    expect(
      caseTimeliness(caso({ status: "contencao", planned_end_date: "2026-06-01", finished_at: "2026-06-10" }), TODAY)
    ).toBe("finalizado_no_prazo");
    expect(
      caseTimeliness(caso({ status: "contencao", planned_end_date: "2026-06-01", finished_at: "2026-09-20" }), TODAY)
    ).toBe("finalizado_atrasado");
    expect(isFinished({ status: "contencao" })).toBe(true);
    expect(isFinished({ status: "finalizado" })).toBe(true);
    expect(isFinished({ status: "em_tratamento" })).toBe(false);
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
  it("em acompanhamento (contenções entregues) não pede agendamento nem conta atraso — só o controle vencido", () => {
    const base = caso({ status: "contencao", planned_end_date: "2026-06-01", finished_at: "2026-06-10" });
    expect(attentionReasons({ caso: base, maintenances: [], today: TODAY })).toEqual([]);
    expect(
      attentionReasons({ caso: { ...base, next_reevaluation_date: "2026-10-01" }, maintenances: [], today: TODAY })
    ).toEqual(["reavaliacao_vencida"]);
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
  it("O1 no termo: mensalidade até a entrega das contenções, que finaliza o tratamento e abre o acompanhamento", () => {
    const texto = orthoClauses(terms).join(" ");
    expect(texto).toMatch(/até a entrega das contenções/);
    expect(texto).toMatch(/considerado finalizado/);
    expect(texto).toMatch(/acompanhamento ortodôntico/);
  });
  it("O1 no termo: a contenção cobrada sai com valor e condição; sem cobrança, diz que está incluída", () => {
    const cobrada = orthoClauses({ ...terms, retainerCharged: true, retainerFeeCents: 35000, retainerTerms: "em até 3x sem juros" }).join(" ");
    expect(cobrada).toMatch(/contenções são cobradas à parte/);
    expect(cobrada).toMatch(/R\$\s?350,00/);
    expect(cobrada).toMatch(/em até 3x sem juros/);
    const incluida = orthoClauses({ ...terms, retainerCharged: false }).join(" ");
    expect(incluida).toMatch(/incluídas no tratamento/);
    expect(incluida).not.toMatch(/cobradas à parte/);
    // Ligada mas sem valor = incluída (não se promete cobrança de zero).
    expect(orthoClauses({ ...terms, retainerCharged: true, retainerFeeCents: 0 }).join(" ")).toMatch(/incluídas/);
  });
  it("O3 no termo: cada falta prorroga o término em um intervalo e a assiduidade fica registrada", () => {
    const texto = orthoClauses(terms).join(" ");
    expect(texto).toMatch(/Cada falta a uma manutenção prorroga a data prevista de término em 30 dias/);
    expect(texto).toMatch(/assiduidade/);
  });
  it("R6 no termo (ORTO7): o prazo é uma referência, não compromisso de data", () => {
    const texto = orthoClauses(terms).join(" ");
    expect(texto).toMatch(/24 meses\. Esse prazo é uma referência/);
    expect(texto).toMatch(/não um compromisso de conclusão em data certa/);
    expect(texto).toMatch(/podendo ser menor ou maior/);
  });
  it("R10 no termo (ORTO7): diz quem INICIA e que outro ortodontista da equipe pode continuar", () => {
    const comNome = orthoClauses({ ...terms, orthodontistName: "Dra. Ana Lima" }).join(" ");
    expect(comNome).toMatch(/será iniciado pelo\(a\) ortodontista Dra\. Ana Lima/);
    expect(comNome).toMatch(/continuado por outro\(a\) ortodontista da equipe Risarte/);
    expect(comNome).toMatch(/saída do profissional da equipe/);
    const semNome = orthoClauses(terms).join(" ");
    expect(semNome).toMatch(/será designado\(a\) pela clínica/);
    expect(semNome).toMatch(/continuado por outro\(a\) ortodontista/);
    expect(semNome).not.toMatch(/Ana Lima/);
  });
  it("R5 no termo (ORTO7): a contenção prevista pelo Planner sai, salvo 'a definir'", () => {
    expect(orthoClauses({ ...terms, retainerKind: "placa_removivel" }).join(" ")).toMatch(/Contenção prevista: placa removível/);
    expect(orthoClauses({ ...terms, retainerKind: "a_definir" }).join(" ")).not.toMatch(/Contenção prevista/);
    expect(orthoClauses(terms).join(" ")).not.toMatch(/Contenção prevista/);
  });
});

describe("espelho do banco (migração 0333 — ORTO7, do clínico ao plano)", () => {
  const sql = readFileSync(MIG("0333_ortodontia_indicacao_proposta_quem_inicia.sql"), "utf8");
  const fn = (name: string) => {
    const from = sql.slice(sql.indexOf(`function public.${name}(`));
    return from.slice(0, from.indexOf("$$;"));
  };
  it("R3: a indicação vive na rodada da avaliação e só o Coordenador marca (rodada finalizada não muda)", () => {
    for (const col of ["ortho_indicated", "ortho_indication_note", "ortho_indicated_by", "ortho_indicated_at"]) {
      expect(sql).toContain(`add column if not exists ${col}`);
    }
    const f = fn("set_evaluation_ortho_indication");
    expect(f).toMatch(/'clinical_coordinator'/);
    expect(f).toMatch(/ensure_open_evaluation\(p_client, p_clinic\)/);
    expect(f).toMatch(/EVALUATION_LOCKED/);
  });
  it("R3/R5: a proposta ortodôntica é por opção, lida por quem lê a opção, escrita só pelo Planner/titular com o plano editável", () => {
    expect(sql).toMatch(/create table if not exists public\.treatment_plan_ortho/);
    expect(sql).toContain("treatment_plan_ortho_option_id_fkey");
    for (const k of ORTHO_RETAINER_KINDS) expect(sql).toContain(`'${k}'`);
    for (const k of ORTHO_KINDS) expect(sql).toContain(`'${k}'`);
    expect(sql).toMatch(/create policy "treatment_plan_ortho_select" on public\.treatment_plan_ortho\s+for select to authenticated\s+using \(\s*public\.is_admin_master\(\)\s+or clinic_id in \(select public\.user_full_access_clinic_ids\(\)\)\s+or public\.is_planner\(\)/);
    const s = fn("save_plan_option_ortho");
    expect(s).toMatch(/public\.is_planner\(\) or public\.is_owner\(\)/);
    expect(s).toMatch(/_plan_is_editable\(v_o\.plan_id\)/);
    expect(s).toMatch(/PLAN_LOCKED/);
    expect(fn("delete_plan_option_ortho")).toMatch(/PLAN_LOCKED/);
    expect(sql).toMatch(/select public\.audit_attach_all\(\);/);
  });
  it("R10/Q3: trocar o responsável fica no histórico; sem ortodontista, o dentista da instalação assume", () => {
    expect(fn("ortho_update_case")).toMatch(/'ortodontista_alterado'/);
    const sync = fn("ortho_appointment_sync");
    expect(sync).toMatch(/v_c\.orthodontist_id is null/);
    expect(sync).toMatch(/'ortodontista_definido'/);
    expect(sync).toMatch(/r\.role in \('dentist','clinical_coordinator'\)/);
    // Só quem instala/atende assume — nunca um retorno.
    expect(sync).toMatch(/new\.type::text in \('treatment_start','treatment_session'\)/);
  });
  it("o caso aberto a partir da venda herda a proposta da opção", () => {
    const c = fn("ortho_create_case");
    expect(c).toMatch(/from public\.treatment_plan_ortho where option_id = v_option/);
    expect(c).toMatch(/coalesce\(p_treatment_kind, v_p\.treatment_kind, 'aparelho_fixo'\)/);
    expect(c).toMatch(/coalesce\(p_planned_months, v_p\.planned_months, 24\)/);
  });
});

describe("espelho do banco (migração 0334 — ORTO8, do Comercial ao caso)", () => {
  const sql = readFileSync(MIG("0334_ortodontia_acordo_comercial_caso_na_venda.sql"), "utf8");
  const fn = (name: string) => {
    const from = sql.slice(sql.indexOf(`function public.${name}(`));
    return from.slice(0, from.indexOf("$$;"));
  };
  it("R5/R7: o acordo ortodôntico é por negociação, com as formas de emissão do código", () => {
    expect(sql).toMatch(/create table if not exists public\.plan_negotiation_ortho/);
    expect(sql).toContain("plan_negotiation_ortho_negotiation_id_fkey");
    for (const m of ORTHO_BILLING_METHODS) expect(sql).toContain(`'${m}'`);
    const s = fn("save_negotiation_ortho");
    expect(s).toMatch(/'commercial_consultant'/);
    expect(s).toMatch(/NEGOTIATION_CLOSED/);
    expect(s).toMatch(/return public\.evaluate_negotiation_rules\(p_negotiation_id, true\)/);
  });
  it("Q4: os limites da ortodontia entram na regra comercial (mínimo, pontualidade) e pedem o Gerente", () => {
    const v = fn("_negotiation_ortho_violations");
    expect(v).toMatch(/min_monthly_fee_cents/);
    expect(v).toMatch(/max_punctuality_discount_percent/);
    expect(v).toMatch(/Contenção marcada como cobrada, sem valor/);
    const e = fn("evaluate_negotiation_rules");
    expect(e).toMatch(/_negotiation_ortho_violations\(p_negotiation_id\)/);
    // A regra inteira continua (nada da 0327 se perdeu).
    expect(e).toMatch(/_negotiation_package_floor/);
    expect(e).toMatch(/_negotiation_procedure_floor/);
    expect(e).toMatch(/'aguardando_autorizacao'/);
    expect(sql).toMatch(/max_punctuality_discount_percent numeric\(5,2\) not null default 10/);
  });
  it("R2/R4: o fechamento abre o caso (sem derrubar a venda) e avisa quem agenda e quem gere", () => {
    const c = fn("commercial_close_step");
    expect(c).toMatch(/v_ortho := public\._ortho_open_from_sale\(p_negotiation_id\)/);
    expect(c).toMatch(/exception when others then\s+raise warning '_ortho_open_from_sale/);
    expect(c).toMatch(/'FECHAMENTO! Iniciar tratamento'/); // o pop-up da recepção continua
    const o = fn("_ortho_open_from_sale");
    expect(o).toMatch(/p\.specialty ilike '%ortod%'/);
    expect(o).toMatch(/'aguardando_inicio'/);
    expect(o).toMatch(/'Ortodontia: caso fechado — agendar a instalação'/);
    expect(o).toMatch(/ucr\.role in \('unit_manager','clinical_coordinator','receptionist'\)/);
    expect(o).toMatch(/'\/ortodontia\/casos\/' \|\| v_id/);
    expect(sql).toMatch(/revoke execute on function public\._ortho_open_from_sale\(uuid\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\._ortho_open_from_sale/);
  });
  it("R4/Q1: sem venda fechada não se abre caso; o legado tem porta própria, do Admin", () => {
    const c = fn("ortho_create_case");
    expect(c).toMatch(/SALE_REQUIRED/);
    expect(c).toMatch(/SALE_NOT_CLOSED/);
    expect(c).toMatch(/'venda', \(select auth\.uid\(\)\)/);
    const l = fn("ortho_create_legacy_case");
    expect(l).toMatch(/LEGACY_CLOSED/);
    expect(l).toMatch(/LEGACY_NOTE_REQUIRED/);
    expect(l).toMatch(/'legado'/);
    expect(fn("ortho_save_settings")).toMatch(/p_legacy_entry_enabled is not null and not public\.is_admin_master\(\)/);
    expect(sql).toMatch(/check \(origin in \('venda','legado'\)\)/);
    expect(sql).toMatch(/update public\.ortho_cases set origin = 'legado'\s+where negotiation_id is null/);
    expect(sql).toMatch(/select public\.audit_attach_all\(\);/);
  });
});

describe("espelho do banco (migração 0329)", () => {
  const sql = readFileSync(MIG("0329_ortodontia.sql"), "utf8");
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

describe("espelho do banco (migração 0331 — decisões O1, O2, O3)", () => {
  const sql = readFileSync(MIG("0331_ortodontia_contencao_baixa_faltas.sql"), "utf8");
  const fn = (name: string) => {
    const from = sql.slice(sql.indexOf(`function public.${name}(`));
    return from.slice(0, from.indexOf("$$;"));
  };
  it("O1: a mensalidade continua só em tratamento, e a cobrança tem tipo (mensalidade | contenção)", () => {
    const gen = fn("ortho_generate_charges");
    expect(gen).toMatch(/status = 'em_tratamento'/);
    expect(gen).toMatch(/'mensalidade'/);
    for (const k of ORTHO_CHARGE_KINDS) expect(sql).toContain(`'${k}'`);
    expect(sql).toMatch(/kind in \('mensalidade', 'contencao'\)/);
  });
  it("O1: entregar as contenções finaliza (finished_at) e passa a acompanhamento (contencao)", () => {
    const d = fn("ortho_deliver_retainers");
    expect(d).toMatch(/status = 'contencao'/);
    expect(d).toMatch(/finished_at = v_date/);
    expect(d).toMatch(/retainer_delivered_at = v_date/);
    expect(d).toMatch(/kind = 'mensalidade'/);
    expect(d).toMatch(/'contencao',\s*\n?\s*date_trunc/);
  });
  it("O2: a guarda da baixa tem o Gerente e o Financeiro, e NÃO a Recepção nem o Franqueado", () => {
    const g = fn("ortho_can_settle");
    expect(g).toMatch(/'unit_manager'/);
    expect(g).toMatch(/'finance_franchisor'/);
    expect(g).not.toMatch(/'receptionist'/);
    expect(g).not.toMatch(/'franchisee'/);
    expect(sql).toMatch(/delete from public\.permission_matrix\s+where capability = 'acao\.ortodontia\.financeiro'\s+and role in \('receptionist', 'franchisee'\)/);
    expect(ORTHO_SETTLE_ROLES).toEqual(["unit_manager"]);
  });
  it("O3: o término previsto soma a prorrogação, mantida por gatilho a partir das faltas", () => {
    expect(fn("ortho_case_before_write")).toMatch(/\+ coalesce\(new\.extension_days, 0\)/);
    expect(fn("_ortho_recompute_extension")).toMatch(/status = 'faltou'/);
    expect(sql).toMatch(/create trigger ortho_maintenances_extension/);
  });
});

describe("espelho do banco (migração 0332 — ORTO6, a tela do ortodontista)", () => {
  const sql = readFileSync(MIG("0332_ortodontia_tela_do_ortodontista.sql"), "utf8");
  const fn = (name: string) => {
    const from = sql.slice(sql.indexOf(`function public.${name}(`));
    return from.slice(0, from.indexOf("$$;"));
  };
  it("R13: o dinheiro do caso sai de ortho_cases e vai para a irmã, lida só por quem vê dinheiro", () => {
    expect(sql).toMatch(/create table if not exists public\.ortho_case_terms/);
    for (const col of ["monthly_fee_cents", "billing_day", "installation_fee_cents", "retainer_charged", "retainer_fee_cents", "retainer_terms"]) {
      expect(sql).toContain(`alter table public.ortho_cases drop column if exists ${col};`);
    }
    expect(sql).toMatch(/create policy "ortho_case_terms_select" on public\.ortho_case_terms\s+for select to authenticated using \(public\.ortho_can_see_money\(clinic_id\)\)/);
    expect(sql).toMatch(/create policy "ortho_charges_select" on public\.ortho_charges\s+for select to authenticated using \(public\.ortho_can_see_money\(clinic_id\)\)/);
    // A ligação de nome fixo que o app embute.
    expect(sql).toContain("ortho_case_terms_case_id_fkey");
    expect(sql).toMatch(/select public\.audit_attach_all\(\);/);
  });
  it("Q8: o Coordenador vê dinheiro; o dentista não — no banco e no código", () => {
    const g = fn("ortho_can_see_money");
    expect(g).toMatch(/'clinical_coordinator'/);
    expect(g).toMatch(/'finance_franchisor'/);
    expect(g).not.toMatch(/'dentist'/);
    expect(ORTHO_MONEY_VIEW_ROLES).toContain("clinical_coordinator");
    expect(ORTHO_MONEY_VIEW_ROLES).not.toContain("dentist");
    // A baixa não muda (O2): quem vê não é quem dá baixa.
    expect(ORTHO_SETTLE_ROLES).toEqual(["unit_manager"]);
    const fin = CAPACIDADES.find((c) => c.id === "acao.ortodontia.financeiro");
    expect(fin?.padrao).not.toContain("receptionist");
    expect(fin?.padrao).not.toContain("franchisee");
    expect(fin?.padrao).not.toContain("clinical_coordinator");
  });
  it("R13: as funções leem e gravam o dinheiro na irmã, e o histórico não carrega valor", () => {
    expect(fn("ortho_create_case")).toMatch(/insert into public\.ortho_case_terms/);
    expect(fn("ortho_update_case")).toMatch(/update public\.ortho_case_terms set/);
    expect(fn("ortho_generate_charges")).toMatch(/join public\.ortho_case_terms t on t\.case_id = c\.id/);
    const d = fn("ortho_deliver_retainers");
    expect(d).toMatch(/v_t public\.ortho_case_terms/);
    expect(d).not.toMatch(/R\$/);
    expect(sql).toMatch(/update public\.ortho_events\s+set description = regexp_replace/);
  });
  it("achado do ensaio: concluir a manutenção sem procedimento registra repasse ZERO (não quebra)", () => {
    const c = fn("_ortho_complete_maintenance");
    expect(c).toMatch(/v_amount integer := 0/);
    expect(c).toMatch(/v_rate_id uuid := null/);
    expect(c).not.toMatch(/v_rate record/);
    expect(c).toMatch(/coalesce\(v_amount, 0\), v_rate_id/);
  });
  it("R11: a evolução vai também para o Desenvolvimento Clínico, respeitando a tranca (adendo)", () => {
    expect(sql).toMatch(/alter table public\.clinical_progress_notes\s+add column if not exists ortho_maintenance_id/);
    const m = fn("_ortho_mirror_evolution");
    expect(m).toMatch(/_progress_note_locked\(/);
    expect(m).toMatch(/addendum_of, addendum_reason, ortho_maintenance_id/);
    expect(m).toMatch(/Ortodontia — manutenção/);
    expect(m).not.toMatch(/delete from/);
    expect(fn("ortho_save_evolution")).toMatch(/perform public\._ortho_mirror_evolution\(p_maintenance_id\)/);
    // Interna: ninguém a chama pela API.
    expect(sql).toMatch(/revoke execute on function public\._ortho_mirror_evolution\(uuid\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant execute on function public\._ortho_mirror_evolution/);
  });
});
