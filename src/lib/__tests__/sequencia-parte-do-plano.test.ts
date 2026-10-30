import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rotuloDoLocal } from "@/lib/odontograma/plano";
import type { ProjectedSession } from "@/lib/planning";
import {
  chaveDaSessao,
  juntarSessoes,
  linhasParaGravar,
  montarAtendimentos,
  moverAtendimento,
  opcaoConfigurada,
  ordenarPorPrioridade,
  planoQueAbre,
  repartirTempoDoAtendimento,
  separarSessao,
} from "@/lib/sequencia-do-plano";

// OC-00005, OC-00009, OC-00010 (30/10/2026, migração 0337).

const sessao = (id: string, extra: Partial<ProjectedSession> = {}): ProjectedSession => ({
  itemId: id,
  sessionIndex: 1,
  procedureName: id,
  name: "Sessão 1",
  plannedMinutes: 30,
  groupNo: null,
  blockOrder: null,
  providerId: null,
  ...extra,
});
const ordem = (l: ProjectedSession[]) => montarAtendimentos(l).map((a) => a.sessions.map((s) => s.itemId).join("+"));

describe("OC-00009: o plano que a tela abre", () => {
  const v2 = { id: "v2", status: "approved", supersededAt: null };
  const v1 = { id: "v1", status: "returned", supersededAt: "2026-10-29" };

  it("o caso do relato: v1 devolvido e substituído não abre; abre o v2", () => {
    expect(planoQueAbre([v2, v1] as never[])).toBe(v2);
  });
  it("o editável que vale tem a preferência", () => {
    const rascunho = { id: "r", status: "draft", supersededAt: null };
    expect(planoQueAbre([v2, rascunho] as never[])).toBe(rascunho);
  });
  it("só substituídos: abre o mais novo, para consulta", () => {
    expect(planoQueAbre([v1] as never[])).toBe(v1);
  });
  it("sem plano: nada", () => {
    expect(planoQueAbre([])).toBeNull();
  });
});

describe("OC-00010: mover e juntar, sem ir ao servidor", () => {
  const base = [sessao("a"), sessao("b"), sessao("c"), sessao("d")];

  it("move um atendimento para qualquer posição", () => {
    expect(ordem(moverAtendimento(base, 3, 0))).toEqual(["d", "a", "b", "c"]);
    expect(ordem(moverAtendimento(base, 0, 2))).toEqual(["b", "c", "a", "d"]);
  });
  it("posição fora da lista vai para a ponta", () => {
    expect(ordem(moverAtendimento(base, 0, 99))).toEqual(["b", "c", "d", "a"]);
  });
  it("o atendimento conjunto anda inteiro", () => {
    const juntos = juntarSessoes(base, new Set(["b:1", "d:1"]));
    expect(ordem(juntos)).toEqual(["a", "b+d", "c"]);
    expect(ordem(moverAtendimento(juntos, 1, 2))).toEqual(["a", "c", "b+d"]);
  });
  it("juntar exige duas sessões", () => {
    expect(ordem(juntarSessoes(base, new Set(["a:1"])))).toEqual(["a", "b", "c", "d"]);
  });
  it("juntar a um atendimento que já existe entra nele", () => {
    const juntos = juntarSessoes(base, new Set(["a:1", "b:1"]));
    const grupo = juntos[0].groupNo;
    const mais = juntarSessoes(juntos, new Set(["b:1", "d:1"]));
    expect(ordem(mais)).toEqual(["a+b+d", "c"]);
    expect(mais[0].groupNo).toBe(grupo);
  });
  it("separar a penúltima desfaz o grupo: conjunto de um não existe", () => {
    const juntos = juntarSessoes(base, new Set(["a:1", "b:1"]));
    const sep = separarSessao(juntos, "a:1");
    expect(sep.every((s) => s.groupNo === null)).toBe(true);
    expect(ordem(sep)).toEqual(["b", "a", "c", "d"]);
  });
  it("ordena pela maior prioridade do atendimento; sem nota vai para o fim", () => {
    const itens = new Map([
      ["a", { gutGravity: 1, gutUrgency: 1, gutTendency: 1 }],
      ["c", { gutGravity: 5, gutUrgency: 5, gutTendency: 5 }],
      ["d", { gutGravity: 3, gutUrgency: 3, gutTendency: 3 }],
    ]);
    expect(ordem(ordenarPorPrioridade(base, itens))).toEqual(["c", "d", "a", "b"]);
  });
  it("reparte o tempo só do atendimento pedido", () => {
    const juntos = juntarSessoes(base, new Set(["a:1", "b:1"]));
    const novo = repartirTempoDoAtendimento(juntos, montarAtendimentos(juntos)[0], 40)!;
    expect(novo.find((s) => s.itemId === "a")!.plannedMinutes).toBe(20);
    expect(novo.find((s) => s.itemId === "c")!.plannedMinutes).toBe(30);
    expect(repartirTempoDoAtendimento(juntos, montarAtendimentos(juntos)[0], 1)).toBeNull();
  });
  it("grava todas as sessões, e o conjunto com UMA posição só", () => {
    const juntos = moverAtendimento(juntarSessoes(base, new Set(["b:1", "d:1"])), 0, 2);
    const linhas = linhasParaGravar(juntos);
    expect(linhas).toHaveLength(4);
    const posicao = new Map(linhas.map((l) => [chaveDaSessao(l), l.blockOrder]));
    expect(posicao.get("b:1")).toBe(posicao.get("d:1"));
    expect(posicao.get("a:1")).toBe(2);
  });
  it("grupo antigo de uma sessão (dado de antes) não grava como conjunto", () => {
    expect(linhasParaGravar([sessao("a", { groupNo: 5 })])[0].groupNo).toBeNull();
  });
  it("mostra dente com faces e região", () => {
    expect(rotuloDoLocal({ toothCode: "26", faceCodes: ["M", "O"], regionCode: null })).toBe("26 (M, O)");
    expect(rotuloDoLocal({ toothCode: null, faceCodes: [], regionCode: "RMD" }, () => "Molar direito")).toBe("Molar direito");
  });
});

describe("OC-00010: o sinalizador", () => {
  const comOrdem = [sessao("a", { blockOrder: 0 })];
  const semOrdem = [sessao("a")];

  it("plano editável: só a confirmação conta, mesmo com a ordem gravada", () => {
    expect(opcaoConfigurada({ confirmadaEm: null, sessions: comOrdem }, true)).toBe(false);
    expect(opcaoConfigurada({ confirmadaEm: "2026-10-30", sessions: comOrdem }, true)).toBe(true);
  });
  it("plano já enviado antes da 0337: vale a ordem gravada", () => {
    expect(opcaoConfigurada({ confirmadaEm: null, sessions: comOrdem }, false)).toBe(true);
    expect(opcaoConfigurada({ confirmadaEm: null, sessions: semOrdem }, false)).toBe(false);
    expect(opcaoConfigurada({ confirmadaEm: null, sessions: [] }, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8").replace(/\r\n/g, "\n");
const pasta = join(RAIZ, "supabase/migrations");
const migracoes = readdirSync(pasta).filter((f) => /^0\d{3}_.*\.sql$/.test(f)).sort();

/** O corpo da definição MAIS RECENTE da função: é a que vale no banco. */
function vigente(nome: string): string {
  const assinatura = `create or replace function public.${nome}(`;
  const com = migracoes.filter((f) => readFileSync(join(pasta, f), "utf8").includes(assinatura));
  if (com.length === 0) throw new Error(`régua cega: ${nome} não foi encontrada`);
  const sql = readFileSync(join(pasta, com[com.length - 1]), "utf8").replace(/\r\n/g, "\n");
  const inicio = sql.lastIndexOf(assinatura);
  const D = "$" + "$";
  const abre = sql.indexOf(D, inicio);
  return sql.slice(abre, sql.indexOf(D, abre + 2));
}

describe("régua: OC-00005, sessão do plano só depois da venda", () => {
  it("a complementar confere a fase ANTES de escolher o plano", () => {
    const corpo = vigente("topup_treatment_sessions");
    const guarda = corpo.indexOf("if v_phase not in ('treatment_start', 'reevaluation', 'follow_up')");
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(corpo.indexOf("from public.treatment_plans"));
  });
  it("as duas geradoras levam a sequência do Planner", () => {
    for (const nome of ["ensure_treatment_sessions", "topup_treatment_sessions"]) {
      const corpo = vigente(nome);
      expect(corpo, nome).toMatch(/left join public\.plan_session_joins psj/);
      expect(corpo, nome).toMatch(/psj\.block_order/);
      expect(corpo, nome).toMatch(/psj\.group_no::text/);
    }
  });
  it("na complementar, os DOIS caminhos (protocolo e contagem) levam a sequência", () => {
    const corpo = vigente("topup_treatment_sessions");
    expect(corpo.split("psj.group_no::text, psj.block_order")).toHaveLength(3);
  });
  it("a limpeza declara que apaga e poupa o que teve uso", () => {
    const sql = ler("supabase/migrations/0337_sequencia_parte_do_plano.sql");
    expect(sql).toMatch(/-- DESTRUTIVO: .*\ndelete from public\.treatment_sessions ts/);
    expect(sql).toMatch(/ts\.plan_id is not null/);
    expect(sql).toMatch(/n\.status = 'aceita'/);
    expect(sql).toMatch(/u\.appointment_id is not null/);
    expect(sql).toMatch(/u\.status <> 'pending'/);
  });
});

describe("régua: OC-00009, a configuração não se perde", () => {
  const cockpit = ler("src/app/(app)/planejamento/[clientId]/page.tsx");
  const seletor = ler("src/app/(app)/prontuarios/[id]/plan-editor-switcher.tsx");
  const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");

  it("cockpit e seletor usam a MESMA regra e a MESMA escolha", () => {
    expect(cockpit).toMatch(/const treatmentPlan = planoQueAbre\(plans\)/);
    expect(cockpit).toMatch(/<PlanoSelecionadoProvider plans=\{plans\}>/);
    expect(seletor).toMatch(/planoQueAbre\(plans\)/);
    expect(seletor).toMatch(/compartilhado \? compartilhado\.planoId : escolhaLocal/);
  });
  it("o cartão recebe a sequência de TODOS os planos e escolhe pelo selecionado", () => {
    expect(cockpit).toMatch(/await carregarSequencias\(plans\)/);
    expect(ler("src/app/(app)/planejamento/[clientId]/session-join-planner.tsx")).toMatch(
      /usePlanoSelecionado\(\)\?\.planoId/
    );
  });
  it("a nova versão copia os atendimentos, sem a confirmação", () => {
    const trecho = acoes.slice(acoes.indexOf("export async function createTreatmentPlan"), acoes.indexOf("export async function saveDiagnosis"));
    expect(trecho).toMatch(/\.from\("plan_session_joins"\)\s*\.insert\(copias\)/);
    expect(trecho).not.toMatch(/sequence_confirmed/);
  });
  it("o banco tranca a sequência de plano que não se edita", () => {
    const sql = ler("supabase/migrations/0337_sequencia_parte_do_plano.sql");
    expect(sql).toMatch(/not public\._plan_is_editable\(v_plano\) then\s+raise exception 'PLAN_LOCKED'/);
    expect(sql).toMatch(/before insert or update or delete on public\.plan_session_joins/);
    // Com `security definer`, `current_user` seria sempre o dono e a trava nunca valeria.
    const trava = sql.slice(sql.indexOf("function public.plan_session_joins_lock()"));
    expect(trava.slice(0, trava.indexOf("as $"))).toMatch(/security invoker/);
  });
  it("a gravação não engole erro", () => {
    const trecho = acoes.slice(acoes.indexOf("async function gravarSequencia"), acoes.indexOf("export async function salvarSequenciaDaOpcao"));
    expect(trecho).toMatch(/if \(error\) \{/);
    expect(trecho).toMatch(/if \(erroDaLeitura \|\| !existentes\)/);
    expect(acoes).not.toMatch(/patchSessionSetting/);
  });
});

describe("régua: OC-00010, o envio e quem vê", () => {
  it("o envio recusa opção sem confirmar, depois das conferências de sempre", () => {
    const corpo = vigente("submit_treatment_plan");
    const trava = corpo.indexOf("raise exception 'SEQUENCE_REQUIRED'");
    expect(trava).toBeGreaterThan(corpo.indexOf("raise exception 'ITEM_LOCATION_REQUIRED'"));
    expect(trava).toBeLessThan(corpo.indexOf("group_adjusted_price"));
    expect(corpo).toMatch(/o\.sequence_confirmed_at is null/);
  });
  it("as mensagens do banco têm texto na tela", () => {
    const plano = ler("src/lib/odontograma/plano.ts");
    expect(plano).toMatch(/"SEQUENCE_REQUIRED"/);
    expect(plano).toMatch(/"SEQUENCE_INCOMPLETE"/);
  });
  it("o Coordenador, o Consultor e o Gerente leem; o assistente comercial não (D8)", () => {
    const corpo = vigente("project_option_sessions");
    expect(corpo).toMatch(/'clinical_coordinator', 'commercial_consultant', 'unit_manager'/);
    expect(corpo).not.toMatch(/commercial_assistant|receptionist/);
  });
  it("o papel na Franqueadora conta nas unidades do escopo (o Consultor real está lá)", () => {
    const corpo = vigente("project_option_sessions");
    expect(corpo).toMatch(/v_clinic in \(select public\.user_full_access_clinic_ids\(\)\)/);
    expect(corpo).toMatch(/fc\.type = 'franchisor'/);
    expect(corpo).toMatch(/ucr\.role = any \(v_papeis\)/);
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toMatch(/await hasRoleWithScopeForClinic\(session, client\.clinic_id, \["commercial_consultant"\]\)/);
  });
  it("a tela de aprovação e a ficha mostram a sequência para ler", () => {
    expect(ler("src/app/(app)/avaliacao/[clientId]/page.tsx")).toMatch(/sequencias=\{sequencias\}/);
    const ficha = ler("src/app/(app)/prontuarios/[id]/page.tsx");
    expect(ficha).toMatch(/sequencias=\{sequencias\}/);
    expect(ficha).toMatch(/<SequenciaSomenteLeitura opcoes=\{sequenciaDoConsultor\}/);
  });
  it("mover não recarrega a tela: salvar não revalida", () => {
    const acoes = ler("src/app/(app)/prontuarios/[id]/planning-actions.ts");
    const trecho = acoes.slice(
      acoes.indexOf("async function gravarSequencia"),
      acoes.indexOf("export async function confirmarSequenciaDaOpcao")
    );
    expect(trecho).not.toMatch(/revalidatePath/);
  });
});
