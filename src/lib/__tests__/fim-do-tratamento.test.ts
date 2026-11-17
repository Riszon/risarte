import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  botoesDaResposta,
  desfechosDoContato,
  detalheDoFechamento,
  NIVEIS_DE_QUALIDADE,
  nivelAprova,
  nivelPedeObservacao,
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

// 0420 (combinada com a sessão "Módulo de Ortodontia", 17/11/2026): com a 0417,
// a instalação do aparelho é só uma sessão do plano. O fim do plano ignora as
// sessões de Ortodontia; o fim da ortodontia é a entrega das contenções.
describe("0420 — a instalação ortodôntica não termina o plano", () => {
  const sql0420 = readFileSync(
    join(process.cwd(), "supabase/migrations/0420_fim_do_tratamento_instalacao_ortodontica.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const gatilho = sql0420.slice(
    sql0420.indexOf("create or replace function public.treatment_closure_on_session("),
    sql0420.lastIndexOf("$$;")
  );
  it("reconhece a Ortodontia pelo mesmo critério da 0417 (a especialidade)", () => {
    expect(sql0420).toContain("p.specialty ilike '%ortod%'");
  });
  it("a sessão de Ortodontia concluída nunca termina o plano", () => {
    expect(gatilho).toContain("if public._sessao_ortodontica(new.procedure_id) then return null; end if;");
  });
  it("a instalação pendente não impede o fim do resto do plano", () => {
    expect(gatilho.match(/and not public\._sessao_ortodontica\(s\.procedure_id\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("a regra 'sobra tratamento?' não muda: a ortodontia em andamento continua segurando", () => {
    expect(sql0420).not.toContain("create or replace function public._tratamento_em_aberto(");
  });
  it("a interna não responde a ninguém de fora, e o gatilho segue blindado", () => {
    expect(sql0420).toContain("revoke execute on function public._sessao_ortodontica(uuid) from public, anon, authenticated;");
    expect(gatilho).toContain("raise warning 'treatment_closure_on_session");
  });
});

// 0421 — ETAPA 3: o controle de qualidade (D1, D7, D8, D18, D22, D23, D24, C1).
describe("0421 — os cinco níveis, a satisfação e a saída da Reavaliação", () => {
  const s21 = readFileSync(
    join(process.cwd(), "supabase/migrations/0421_fim_do_tratamento_qualidade.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const fn = (nome: string) => {
    const i = s21.indexOf(`create or replace function public.${nome}(`);
    expect(i, `a 0421 não cria ${nome}: não dá para medir`).toBeGreaterThanOrEqual(0);
    return s21.slice(i, s21.indexOf("\n$$;", i));
  };

  it("os cinco níveis e a conversão das avaliações antigas (D8)", () => {
    expect(s21).toContain("level in ('excelente', 'bom', 'aceitavel', 'revisar', 'refazer')");
    expect(s21).toMatch(/when 'aprovado' then 'bom'\s+when 'revisao' then 'revisar'\s+when 'reprovado' then 'refazer'/);
  });
  it("o nível manda no status (quem lia o status continua certo)", () => {
    const q = fn("set_plan_item_quality");
    expect(q).toMatch(/when 'revisar' then 'revisao'\s+when 'refazer' then 'reprovado'\s+else 'aprovado'/);
  });
  it("a trava conta a opção VENDIDA, sem os excluídos, e encerra o fechamento", () => {
    const q = fn("set_plan_item_quality");
    expect(q).toContain("n.status = 'aceita'");
    expect(q).toContain("ni.included = false");
    expect(q).toContain("where plan_id = v_plan and status = 'reavaliacao';");
  });
  it("o Excelente avisa quem executou (D24)", () => {
    expect(fn("set_plan_item_quality")).toContain("'Procedimento avaliado como Excelente'");
  });
  it("observação obrigatória só em Revisar e Refazer (D7)", () => {
    expect(fn("register_closure_quality")).toContain("if p_level in ('revisar', 'refazer') and coalesce(btrim(p_note), '') = '' then");
  });
  it("o contato pede satisfação e queixa, e queixa obriga revisar (D18)", () => {
    const c = fn("register_closure_contact");
    expect(c).toContain("raise exception 'SATISFACTION_REQUIRED'");
    expect(c).toContain("if p_complaint and p_outcome <> 'revisar' then");
  });
  it("sair da Reavaliação só com a avaliação feita e nada para revisar (D23), com retorno (D22)", () => {
    const r = fn("conclude_reevaluation");
    expect(r).toContain("f.status = 'reavaliacao'");
    expect(r).toContain("r.resolution in ('redo_same', 'redo_other')");
    expect(r).toContain("interval '6 months'");
  });
  it("reavaliação concluída na Fase 5 não encerra mais o fechamento sozinha", () => {
    const a = fn("treatment_closure_on_appointment");
    expect(a).not.toContain("outcome = 'reavaliado'");
  });
  it("as portas novas são só de quem está logado", () => {
    for (const f of [
      "set_plan_item_quality(uuid, text, text, uuid, text, uuid, text, text)",
      "register_closure_quality(uuid, text, text)",
      "register_closure_contact(uuid, text, boolean, text, text, date, smallint, boolean)",
      "conclude_reevaluation(uuid, date)",
    ]) {
      expect(s21).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`);
      expect(s21).toContain(`grant execute on function public.${f} to authenticated;`);
    }
  });
  it("toda recusa nova vira frase", () => {
    const codigos = [...s21.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]);
    for (const c of new Set(codigos)) {
      if (["INVALID_STATUS", "ITEM_NOT_FOUND", "LOCKED", "NOT_FINALIZED", "RESOLUTION_REQUIRED",
           "ASSIGNED_REQUIRED", "REPLAN_REASON_REQUIRED", "INVALID_CHANNEL", "CLIENT_NOT_FOUND",
           "WRONG_PHASE", "QUALITY_PENDING"].includes(c)) continue; // traduzidas em quality-actions / jornada
      expect(recusaDoFechamento(c), c).not.toBe(recusaDoFechamento("algo estranho"));
    }
  });
});

describe("regras puras da Etapa 3", () => {
  it("Excelente, Bom e Aceitável aprovam; Revisar e Refazer pedem observação", () => {
    expect(NIVEIS_DE_QUALIDADE.filter(nivelAprova)).toEqual(["excelente", "bom", "aceitavel"]);
    expect(NIVEIS_DE_QUALIDADE.filter(nivelPedeObservacao)).toEqual(["revisar", "refazer"]);
  });
  it("com queixa, só chamar para revisar", () => {
    expect(desfechosDoContato(true)).toEqual(["revisar"]);
    expect(desfechosDoContato(false)).toEqual(["revisar", "aguardar_retorno", "novo_planejamento"]);
  });
});
