import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acoesDoAbandono,
  detalheDoAbandono,
  diasDesde,
  MOTIVO_LABEL,
  recusaDoAbandono,
  TENTATIVAS_DA_RECEPCAO,
  tituloDoAbandono,
  type Abandono,
} from "@/lib/abandono";
import { INACTIVITY_KEYS, INACTIVITY_LABELS } from "@/lib/sla";
import { TABELAS as AUDITORIA_TABELAS } from "@/lib/auditoria-catalogo";

// O ABANDONO DE TRATAMENTO E A LISTA (0423, Etapa 4 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seções 6 e 7). O furo: o cliente
// para de vir com sessões pendentes e ninguém tem tarefa. Esta régua prende o
// que impede o cliente de ser esquecido.

const s23 = readFileSync(
  join(process.cwd(), "supabase/migrations/0423_fim_do_tratamento_abandono.sql"),
  "utf8"
).replace(/\r\n/g, "\n");
const fn = (nome: string) => {
  const i = s23.indexOf(`create or replace function public.${nome}(`);
  expect(i, `a 0423 não cria ${nome}: não dá para medir`).toBeGreaterThanOrEqual(0);
  return s23.slice(i, s23.indexOf("\n$$;", i));
};

describe("0423 — o caminho do abandono (D16)", () => {
  it("uma tarefa aberta por cliente", () => {
    expect(s23).toMatch(/create unique index if not exists treatment_abandonments_one_open\s+on public.treatment_abandonments \(client_id\) where status <> 'encerrado'/);
  });
  it("a varredura abre para quem tem sessão pendente, nada agendado e passou do prazo", () => {
    const q = fn("treatment_abandonment_scan");
    expect(q).toContain("ts.status = 'pending'");
    expect(q).toContain("not public._tem_horario_futuro(c.id)");
    expect(q).toContain("'abandon_no_schedule_days'");
    expect(q).toContain("array['receptionist']");
    expect(s23).toContain("'risarte-abandono-daily'");
  });
  it("3 tentativas da Recepção (ou o encaminhamento) levam ao Coordenador", () => {
    const q = fn("register_abandonment_attempt");
    expect(q).toContain("if v_tentativas >= 3 or p_escalate then");
    expect(q).toContain("array['clinical_coordinator']");
    expect(TENTATIVAS_DA_RECEPCAO).toBe(3);
  });
  it("o registro exige os riscos, o meio e a data, e só o Coordenador faz", () => {
    const q = fn("register_treatment_abandonment");
    expect(q).toContain("raise exception 'RISKS_REQUIRED'");
    expect(q).toContain("p_informed_on > public.today_br()");
    expect(q).toContain("array['clinical_coordinator']::public.user_role[])) then");
  });
  it("o Gerente decide; na Fase 7 as sessões ficam abertas e o retorno é sugerido", () => {
    const q = fn("decide_treatment_abandonment");
    expect(q).toContain("array['unit_manager']");
    expect(q).toContain("_jornada_mover_por_evento(v_ab.client_id, 'follow_up', 'abandono'");
    expect(q).toContain("interval '6 months'");
    expect(q).not.toMatch(/update public\.treatment_sessions/);
  });
  it("agendar encerra a tarefa; o termo aberto cumpre a decisão de cancelar", () => {
    expect(fn("treatment_abandonment_on_appointment")).toContain("status in ('reagendar', 'contato', 'gerente')");
    expect(s23).toContain("after insert or update of status, starts_at on public.appointments");
    expect(fn("treatment_abandonment_on_cancellation")).toContain("outcome = 'cancelamento_aberto'");
  });
  it("ninguém grava direto nas tabelas e as portas fecham para quem não está logado", () => {
    expect(s23).toContain("revoke insert, update, delete on public.treatment_abandonments from anon, authenticated;");
    for (const f of ["register_abandonment_attempt", "register_treatment_abandonment", "decide_treatment_abandonment", "start_treatment_abandonment", "clients_without_next_step"]) {
      expect(s23).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
    }
    expect(s23).not.toMatch(/grant execute on function public\.treatment_abandonment_scan/);
  });
  it("as tabelas novas são auditadas e estão no catálogo", () => {
    expect(s23).toContain("select public.audit_attach_all();");
    expect(AUDITORIA_TABELAS["public.treatment_abandonments"]).toBeTruthy();
    expect(AUDITORIA_TABELAS["public.treatment_abandonment_attempts"]).toBeTruthy();
  });
});

describe("0423 — a lista \"Clientes sem próximo passo\" (7.4, D19)", () => {
  const q = fn("clients_without_next_step");
  it("Fase 5 ou 6, sem horário futuro e sem tarefa aberta", () => {
    expect(q).toContain("c.journey_phase in ('treatment_start', 'reevaluation')");
    expect(q).toContain("and not public._tem_horario_futuro(c.id)");
    expect(q).toContain("from public.treatment_closures f");
    expect(q).toContain("from public.treatment_abandonments t");
  });
  it("só a ortodontia EM TRATAMENTO protege; o complemento só com movimento recente", () => {
    expect(q).toContain("o.status = 'em_tratamento')");
    expect(q).toContain("'stalled_treatment_days'");
    expect(q).toContain("> now() - make_interval(days => v_parado)");
  });
  it("só o Coordenador e o Gerente leem", () => {
    expect(q).toContain("array['clinical_coordinator', 'unit_manager']");
  });
  it("todo motivo do banco tem nome na tela", () => {
    for (const m of q.matchAll(/then '([a-z_]+)'/g)) {
      expect(MOTIVO_LABEL[m[1] as keyof typeof MOTIVO_LABEL], m[1]).toBeTruthy();
    }
    expect(q).toMatch(/else 'sem_tratamento_pendente'/);
  });
  it("os dois prazos novos estão em Prazos, com o mesmo nome do banco", () => {
    for (const k of ["abandon_no_schedule_days", "stalled_treatment_days"] as const) {
      expect(INACTIVITY_KEYS).toContain(k);
      expect(INACTIVITY_LABELS[k]).toBeTruthy();
      expect(s23).toContain(`(null, '${k}', 30)`);
    }
  });
});

describe("as regras da tela do abandono", () => {
  const base: Abandono = {
    id: "a",
    status: "reagendar",
    origin: "automatico",
    lastActivityAt: "2026-10-01T12:00:00-03:00",
    tentativasRecepcao: 1,
    tentativasCoordenador: 0,
    risksInformed: null,
    risksChannel: null,
    risksInformedOn: null,
    registeredAt: null,
  };
  const agora = Date.parse("2026-11-17T12:00:00-03:00");

  it("conta os dias desde a última atividade", () => {
    expect(diasDesde("2026-11-10T12:00:00-03:00", agora)).toBe(7);
    expect(diasDesde(null, agora)).toBeNull();
    expect(diasDesde("lixo", agora)).toBeNull();
  });
  it("cada etapa tem título e frase", () => {
    for (const e of ["reagendar", "contato", "gerente", "cancelamento"] as const) {
      expect(tituloDoAbandono(e).length).toBeGreaterThan(5);
      expect(detalheDoAbandono({ ...base, status: e }, agora).length).toBeGreaterThan(5);
    }
    expect(detalheDoAbandono(base, agora)).toContain("1 de 3");
    expect(detalheDoAbandono(base, agora)).toContain("47 dia(s)");
  });
  it("quem vê cada botão espelha o banco", () => {
    const ninguem = { ehRecepcao: false, ehCoordenador: false, ehGerente: false };
    expect(acoesDoAbandono("reagendar", { ...ninguem, ehRecepcao: true })).toMatchObject({ tentativa: true, agendar: true, registrar: false });
    expect(acoesDoAbandono("contato", { ...ninguem, ehRecepcao: true })).toMatchObject({ tentativa: false, registrar: false });
    expect(acoesDoAbandono("contato", { ...ninguem, ehCoordenador: true })).toMatchObject({ tentativa: true, registrar: true, decidir: false });
    expect(acoesDoAbandono("gerente", { ...ninguem, ehCoordenador: true }).decidir).toBe(false);
    expect(acoesDoAbandono("gerente", { ...ninguem, ehGerente: true }).decidir).toBe(true);
    expect(acoesDoAbandono("cancelamento", { ...ninguem, ehGerente: true }).termo).toBe(true);
  });
  it("cada recusa do banco vira frase", () => {
    for (const code of s23.matchAll(/raise exception '([A-Z_]+)'/g)) {
      expect(recusaDoAbandono(code[1]), code[1]).not.toContain("Não foi possível registrar");
    }
  });
});
