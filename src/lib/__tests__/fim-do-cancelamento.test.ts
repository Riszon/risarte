import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pedeDestino, recusaDoCancelamento, type FimDoCancelamento } from "@/lib/fim-do-cancelamento";
import { ESCOPO_LABEL } from "@/lib/fim-do-tratamento";

// O CANCELAMENTO PELO CAMINHO DO FIM (0426, Etapa 5 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md, seção 5.3). Os furos: o cliente
// esquecido na Fase 5, a pergunta "sobra outra venda?" incompleta, nada
// conferindo o executado, o plano sem "Cancelado", a Fase 7 sem o Coordenador
// e os riscos de um procedimento interrompido sem registro.

const s26 = readFileSync(
  join(process.cwd(), "supabase/migrations/0426_fim_do_tratamento_cancelamento.sql"),
  "utf8"
).replace(/\r\n/g, "\n");
const fn = (nome: string) => {
  const i = s26.indexOf(`create or replace function public.${nome}(`);
  expect(i, `a 0426 não cria ${nome}: não dá para medir`).toBeGreaterThanOrEqual(0);
  return s26.slice(i, s26.indexOf("\n$$;", i));
};

describe("0426 — o cancelamento sem tocar nas funções do Asaas", () => {
  it("não recria open_plan_cancellation nem apply_plan_cancellation (a 4020 rodaria por cima)", () => {
    expect(s26).not.toMatch(/function public\.open_plan_cancellation\(/);
    expect(s26).not.toMatch(/function public\.apply_plan_cancellation\(/);
  });
  it("D25: procedimento começado e não terminado exige os riscos antes da assinatura", () => {
    expect(fn("_cancelamento_tem_incompleto")).toContain("p.status in ('pending', 'scheduled')");
    expect(fn("plan_cancellation_risks_on_open")).toContain("new.risks_required := public._cancelamento_tem_incompleto");
    expect(fn("plan_cancellation_end_guard")).toContain("raise exception 'RISKS_PENDING'");
    const q = fn("register_cancellation_risks");
    expect(q).toContain("array['clinical_coordinator']");
    expect(q).toContain("raise exception 'RISKS_REQUIRED'");
  });
  it("D10: o destino pela regra única, sem contar o plano cancelado", () => {
    const fora = fn("_tratamento_em_aberto_fora");
    expect(fora).toContain("ts.plan_id is distinct from p_plan_id");
    expect(fora).toContain("o.status in ('aguardando_inicio', 'em_tratamento', 'suspenso')");
    expect(fora).toContain("tp.complement_of_plan_id is not null");
    const prep = fn("prepare_cancellation_apply");
    expect(prep).toContain("return 'segue_em_tratamento';");
    expect(prep).toContain("raise exception 'DESTINATION_REQUIRED'");
    expect(prep).toContain("interval '6 months'");
    expect(prep).toContain("array['unit_manager']");
  });
  it("a trava da efetivação: nem esquecido na Fase 5, nem fora dela com tratamento sobrando", () => {
    const g = fn("plan_cancellation_end_guard");
    expect(g).toContain("if v_phase = 'treatment_start' and not public._tratamento_em_aberto(new.client_id) then");
    expect(g).toContain("raise exception 'TREATMENT_STILL_OPEN'");
  });
  it("D11: o plano vira Cancelado e o Coordenador é chamado (avaliação ou contato)", () => {
    const a = fn("plan_cancellation_end_apply");
    expect(a).toContain("set lifecycle = 'cancelado'");
    expect(a).toContain("when v_phase = 'reevaluation' then 'reavaliacao'");
    expect(a).toContain("when v_phase = 'follow_up' then 'contato'");
    expect(a).toContain("'cancelamento', new.plan_id, new.id");
    expect(s26).toContain("check (scope in ('plano', 'venda_direta', 'ortodontia', 'urgencia', 'cancelamento'))");
    expect(s26).toContain("(scope = 'cancelamento' and cancellation_id is not null)");
  });
  it("as portas fecham para quem não está logado; as regras internas não são portas", () => {
    for (const f of ["register_cancellation_risks", "prepare_cancellation_apply", "cancellation_end_info"]) {
      expect(s26).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
    }
    for (const f of ["_tratamento_em_aberto_fora", "_cancelamento_tem_incompleto", "plan_cancellation_end_guard", "plan_cancellation_end_apply"]) {
      expect(s26).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
  });
});

describe("as regras da tela do cancelamento", () => {
  const base: FimDoCancelamento = {
    kind: "contrato",
    segueEmTratamento: false,
    fase: "treatment_start",
    destino: null,
    retorno: null,
    riscosPendentes: false,
  };
  it("pede o destino só no contrato, na Fase 5 e sem tratamento sobrando", () => {
    expect(pedeDestino(base)).toBe(true);
    expect(pedeDestino({ ...base, segueEmTratamento: true })).toBe(false);
    expect(pedeDestino({ ...base, kind: "venda_direta" })).toBe(false);
    expect(pedeDestino({ ...base, fase: "reevaluation" })).toBe(false);
    expect(pedeDestino(null)).toBe(false);
  });
  it("cada recusa nova do banco vira frase", () => {
    for (const code of s26.matchAll(/raise exception '([A-Z_]+)'/g)) {
      expect(recusaDoCancelamento(code[1]), code[1]).toBeTruthy();
    }
  });
  it("o fechamento do cancelamento tem nome na tela", () => {
    expect(ESCOPO_LABEL.cancelamento).toBe("plano cancelado");
  });
});
