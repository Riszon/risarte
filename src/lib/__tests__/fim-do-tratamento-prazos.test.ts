import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notasDoDentista, satisfacaoDoDentista, type ResumoDoDentista } from "@/lib/fim-do-tratamento";
import { INACTIVITY_KEYS, INACTIVITY_LABELS } from "@/lib/sla";
import { indicadorDe } from "@/lib/metas/indicadores";

// PRAZOS E INDICADORES (0427, Etapa 6 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seções 5.8, 7.2 e 8). O cliente não
// pode ser esquecido: a tarefa parada volta a avisar, contada em dias úteis
// DA UNIDADE; e o que o plano mede vira número no Meu dia e nas Metas.

const s27 = readFileSync(
  join(process.cwd(), "supabase/migrations/0427_fim_do_tratamento_prazos_e_indicadores.sql"),
  "utf8"
).replace(/\r\n/g, "\n");
const fn = (nome: string) => {
  const i = s27.indexOf(`create or replace function public.${nome}(`);
  expect(i, `a 0427 não cria ${nome}: não dá para medir`).toBeGreaterThanOrEqual(0);
  return s27.slice(i, s27.indexOf("\n$$;", i));
};

describe("0427 — os dias úteis da unidade (C4)", () => {
  const q = fn("_dia_util_da_unidade");
  it("pula o fim de semana e os feriados nacional, estadual e municipal da unidade", () => {
    expect(q).toContain("extract(isodow from p_day) < 6");
    expect(q).toContain("h.scope = 'national'");
    expect(q).toContain("(h.scope = 'state' and h.state = upper(btrim(c.state)))");
    expect(q).toContain("lower(btrim(h.city)) = lower(btrim(c.city))");
  });
  it("o feriado em que a unidade decidiu atender conta como dia útil", () => {
    expect(q).toContain("d.will_attend");
  });
});

describe("0427 — a tarefa parada volta a avisar (7.2)", () => {
  const q = fn("end_of_treatment_reminders");
  it("conta em dias úteis da unidade, com o prazo de Prazos", () => {
    expect(q).toContain("'stalled_task_business_days'");
    expect(q).toContain("public.clinic_business_days_between(r.clinic_id");
    expect(s27).toContain("(null, 'stalled_task_business_days', 3)");
    expect(INACTIVITY_KEYS).toContain("stalled_task_business_days");
    expect(INACTIVITY_LABELS.stalled_task_business_days).toMatch(/DIAS ÚTEIS/);
  });
  it("chega ao Gerente sempre, e marca o aviso para não repetir", () => {
    expect(q.match(/'unit_manager'/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(q).toContain("update public.treatment_closures set reminded_at = now()");
    expect(q).toContain("update public.treatment_abandonments set reminded_at = now()");
  });
  it("só a decisão líder (uma por cliente) e a reavaliação sem horário", () => {
    expect(q).toContain("where f.grouped_into is null");
    expect(q).toContain("public._tem_horario_futuro(r.client_id)");
  });
  it("é rotina, não porta", () => {
    expect(s27).toContain("'risarte-fim-lembretes-daily'");
    expect(s27).not.toMatch(/grant execute on function public\.end_of_treatment_reminders/);
  });
});

describe("0427 — os indicadores (8, D26)", () => {
  it("as Metas medem os quatro indicadores do fim do tratamento", () => {
    const medida = fn("_goal_measure_raw");
    for (const k of ["redo_rate", "client_satisfaction", "closure_decided_on_time", "clients_without_next_step"]) {
      expect(medida).toContain(`p_indicator = '${k}'`);
      expect(indicadorDe(k), k).not.toBeNull();
    }
  });
  it("a fotografia das Metas e a lista da Jornada são a mesma consulta", () => {
    expect(fn("_goal_measure_raw")).toContain("cross join lateral public._sem_proximo_passo(u.cid) x");
    expect(fn("clients_without_next_step")).toContain("from public._sem_proximo_passo(p_clinic_id) x");
  });
  it("o Meu dia lê só o próprio dentista", () => {
    const q = fn("my_end_of_treatment_summary");
    expect(q).toContain("r.executor_dentist_id = v_user");
    expect(q).toContain("f.asked_user_id = v_user");
  });

  const vazio: ResumoDoDentista = { excelente: 0, bom: 0, aceitavel: 0, revisar: 0, refazer: 0, respostas: 0, satisfeitos: 0, queixas: 0 };
  it("a satisfação do dentista: % de 9 e 10 entre quem respondeu", () => {
    expect(satisfacaoDoDentista(null).valor).toBe("—");
    expect(satisfacaoDoDentista(vazio).valor).toBe("—");
    const s = satisfacaoDoDentista({ ...vazio, respostas: 4, satisfeitos: 3, queixas: 1 });
    expect(s.valor).toBe("75%");
    expect(s.dica).toContain("1 com queixa");
  });
  it("as notas técnicas: % aprovados e a distribuição dos cinco níveis", () => {
    expect(notasDoDentista(vazio).valor).toBe("—");
    const n = notasDoDentista({ ...vazio, excelente: 2, bom: 1, aceitavel: 1, revisar: 1 });
    expect(n.valor).toBe("80%");
    expect(n.dica).toContain("2 Excelente");
    expect(n.dica).toContain("1 Revisar");
  });
});
