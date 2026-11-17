import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  botoesDaResposta,
  detalheDoFechamento,
  recusaDoFechamento,
  retornoSugerido,
  tituloDoFechamento,
  type Fechamento,
} from "@/lib/fim-do-tratamento";
import { appointmentTypeOptions } from "@/lib/appointments";

// O FIM DO TRATAMENTO (0418, Etapa 2 do plano
// docs/jornada/FIM-DO-TRATAMENTO-PLANO.md). O defeito era total: a pergunta do
// fim nunca abriu em nenhum dos dois bancos. Esta régua prende o que faz ela
// abrir — e o que faz o cliente nunca ser esquecido.

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0418_fim_do_tratamento_o_motor.sql"),
  "utf8"
).replace(/\r\n/g, "\n");

/** O corpo de uma função da migração (do `create` ao `$$;`). */
function corpo(nome: string): string {
  const i = sql.indexOf(`create or replace function public.${nome}(`);
  expect(i, `a 0418 não cria ${nome}: não dá para medir`).toBeGreaterThanOrEqual(0);
  const fim = sql.indexOf("\n$$;", i);
  return sql.slice(i, fim);
}

const base: Fechamento = {
  id: "f1",
  scope: "plano",
  status: "pergunta",
  answer: null,
  askedUserId: "dentista",
  autoYes: false,
  treatmentEnd: true,
  changedByCoordinator: false,
  createdAt: "2026-11-16T12:00:00Z",
  tentativas: 0,
  tentativasSemSucesso: 0,
};

describe("a regra única 'sobra tratamento?' (3.1)", () => {
  const regra = corpo("_tratamento_em_aberto");
  it("olha sessão aberta de QUALQUER venda, não só de plano", () => {
    expect(regra).toContain("ts.status in ('pending', 'scheduled')");
    // Sem filtro por plano: venda direta, revisão e refação também seguram.
    expect(regra).not.toMatch(/ts\.plan_id is not null/);
  });
  it("o complemento em andamento segura (D3)", () => {
    expect(regra).toContain("tp.complement_of_plan_id is not null");
  });
  it("a ortodontia segura até a contenção, e a suspensa também (C2, D19)", () => {
    expect(regra).toContain("o.status in ('aguardando_inicio', 'em_tratamento', 'suspenso')");
    expect(regra).not.toMatch(/'contencao'/);
  });
});

describe("o fim de um plano abre o fechamento sozinho", () => {
  const gatilho = corpo("treatment_closure_on_session");
  it("só sessão CONCLUÍDA de plano vendido e não cancelado", () => {
    expect(gatilho).toContain("new.status <> 'done'");
    expect(gatilho).toContain("s.closed_at is not null and s.cancelled_at is null");
  });
  it("revisão e refação não refazem a pergunta (Passo 4)", () => {
    expect(gatilho).toContain("if new.redo_kind is not null then return null; end if;");
  });
  it("a situação do plano anda sozinha: 'Em tratamento' e 'Concluído'", () => {
    expect(gatilho).toContain("lifecycle = 'em_tratamento'");
    expect(gatilho).toContain("lifecycle = 'concluido'");
  });
  it("reabrir sessão volta o cliente a 'Em Tratamento'", () => {
    expect(gatilho).toContain("set journey_status = 'in_treatment'");
  });
  it("nunca derruba a baixa da sessão", () => {
    expect(gatilho).toMatch(/exception when others then\s+--[^\n]*\n[^\n]*\n\s+raise warning/);
  });
  it("a pergunta vai para quem executou; o titular concluindo por outro → o profissional", () => {
    expect(gatilho).toContain("v_last.executed_by");
    expect(gatilho).toContain("v_provider <> v_last.executed_by then v_provider");
  });
  it("o gatilho está preso na tabela das sessões", () => {
    expect(sql).toMatch(/create trigger treatment_closure_on_session\s+after insert or update of status on public\.treatment_sessions/);
  });
});

describe("a pergunta antiga (0019) não abre junto", () => {
  it("o gatilho da 0019 sai", () => {
    expect(sql).toContain("drop trigger if exists clients_treatment_finished on public.clients;");
  });
});

describe("urgência (D13)", () => {
  const checkIn = corpo("check_in_appointment");
  it("o check-in da urgência não leva mais a Fase 1 à Fase 5", () => {
    expect(checkIn).not.toMatch(/'acquisition' and v_type in \('urgency', 'emergency'\)/);
    // As outras passagens do check-in continuam.
    expect(checkIn).toContain("when v_phase = 'acquisition' and v_type = 'evaluation' then 'clinical_conversion'");
    expect(checkIn).toContain("when v_phase = 'follow_up' and v_type = 'reevaluation' then 'reevaluation'");
  });
  it("concluir a urgência abre 'agendar a avaliação completa', e agendar resolve", () => {
    const g = corpo("treatment_closure_on_appointment");
    expect(g).toContain("'agendar_avaliacao'");
    expect(g).toContain("outcome = 'avaliacao_agendada'");
  });
});

describe("'Tratamento Finalizado' à mão: só o Admin Master (D9)", () => {
  it("o banco recusa os outros", () => {
    expect(corpo("set_journey_status")).toContain("when p_status = 'treatment_finished' then false");
  });
});

describe("portas e internas", () => {
  it("as internas não respondem a ninguém de fora", () => {
    for (const f of [
      "_tratamento_em_aberto(uuid)",
      "_abrir_fechamento(text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, uuid)",
      "_fechamento_reavaliar(uuid, uuid)",
      "_jornada_mover_por_evento(uuid, public.journey_phase, text, uuid, date)",
    ]) {
      expect(sql).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
    }
  });
  it("as portas são só de quem está logado", () => {
    expect(sql).toContain("grant execute on function public.answer_treatment_closure(uuid, text) to authenticated;");
    expect(sql).toContain(
      "grant execute on function public.register_closure_contact(uuid, text, boolean, text, text, date) to authenticated;"
    );
  });
  it("'sem contato' só depois de 3 tentativas (D6)", () => {
    expect(corpo("register_closure_contact")).toContain("if v_fails < 3 then raise exception 'NEEDS_THREE_ATTEMPTS'");
  });
  it("tabela nova entra na auditoria", () => {
    expect(sql).toContain("select public.audit_attach_all();");
  });
});

describe("botoesDaResposta — espelho da guarda do banco", () => {
  const dentista = { userId: "dentista", ehCoordenador: false, clienteNaFase5: true };
  const coord = { userId: "coord", ehCoordenador: true, clienteNaFase5: true };
  const outro = { userId: "recepcao", ehCoordenador: false, clienteNaFase5: true };

  it("quem executou responde Sim, Não e Não sei", () => {
    expect(botoesDaResposta(base, dentista)).toEqual(["sim", "nao", "nao_sei"]);
  });
  it("o Coordenador responde Sim ou Não, nunca 'Não sei' pelo dentista", () => {
    expect(botoesDaResposta(base, coord)).toEqual(["sim", "nao"]);
  });
  it("quem não executou nem coordena não vê botão", () => {
    expect(botoesDaResposta(base, outro)).toEqual([]);
    expect(botoesDaResposta({ ...base, status: "coordenador" }, dentista)).toEqual([]);
  });
  it("D21: o Coordenador muda enquanto nada aconteceu", () => {
    expect(botoesDaResposta({ ...base, status: "contato", answer: "nao" }, coord)).toEqual(["sim"]);
    expect(botoesDaResposta({ ...base, status: "contato", answer: "nao", tentativas: 1 }, coord)).toEqual([]);
    expect(botoesDaResposta({ ...base, status: "reavaliacao", answer: "sim" }, coord)).toEqual(["nao"]);
    expect(
      botoesDaResposta({ ...base, status: "reavaliacao", answer: "sim" }, { ...coord, clienteNaFase5: false })
    ).toEqual([]);
  });
});

describe("textos", () => {
  it("cada situação tem título e frase", () => {
    for (const status of ["pergunta", "coordenador", "reavaliacao", "contato", "agendar_avaliacao"] as const) {
      expect(tituloDoFechamento({ status, scope: "plano" }).length).toBeGreaterThan(5);
      expect(detalheDoFechamento({ ...base, status }).length).toBeGreaterThan(5);
    }
  });
  it("o D17 diz por que não houve pergunta", () => {
    expect(detalheDoFechamento({ ...base, status: "reavaliacao", autoYes: true })).toContain("reavaliação obrigatória");
  });
  it("toda recusa do banco vira frase, e o desconhecido não vaza o código", () => {
    for (const c of [
      "NOT_ALLOWED", "COORDINATOR_DECIDES", "ALREADY_CLOSED", "ALREADY_ACTED", "NOTHING_TO_CHANGE",
      "NOT_IN_CONTACT", "SUMMARY_REQUIRED", "OUTCOME_REQUIRED", "INVALID_OUTCOME",
      "NEEDS_THREE_ATTEMPTS", "RETURN_DATE_PAST", "NOT_FOUND",
    ]) {
      const frase = recusaDoFechamento(`ERROR: ${c}`);
      expect(frase).not.toContain(c);
      expect(frase).not.toBe(recusaDoFechamento("algo estranho"));
    }
    // Todo código que a migração levanta tem frase.
    const codigos = [...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codigos.length).toBeGreaterThan(5);
    for (const c of new Set(codigos)) {
      if (["INVALID_ANSWER", "INVALID_CHANNEL", "APPOINTMENT_NOT_FOUND", "CLIENT_NOT_FOUND",
           "STATUS_INVALID_FOR_PHASE", "REEVALUATION_FLAG_ADMIN_ONLY"].includes(c)) continue;
      expect(recusaDoFechamento(c), c).not.toBe(recusaDoFechamento("algo estranho"));
    }
  });
});

describe("retornoSugerido (D22)", () => {
  it("6 meses depois, no mesmo dia", () => {
    expect(retornoSugerido("2026-11-16")).toBe("2027-05-16");
  });
  it("dia que não existe no mês de destino vira o último dia", () => {
    expect(retornoSugerido("2026-08-31")).toBe("2027-02-28");
  });
});

describe("a reavaliação dentro da Fase 5 (C1)", () => {
  it("a agenda oferece Reavaliação para o cliente em tratamento", () => {
    expect(appointmentTypeOptions("treatment_start")).toContain("reevaluation");
  });
});
