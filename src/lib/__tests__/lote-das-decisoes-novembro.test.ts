// O LOTE DAS DECISÕES DO DONO (10/11/2026, 0.414.0) — AP111, AP16, AP67, AP77,
// AP84, AP98, AP128, AP132 e AP134.
//
// Cada bloco prende a regra de um item: a conta pura é exercitada, e os
// arquivos que precisam CHAMÁ-LA (ou a migração que precisa trazê-la) são
// lidos do disco. Régua provada devolvendo o defeito (ver o ESTADO, 0.414.0).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENDA_DEFAULTS, resolveAgendaSettings, unidadeHerdaOAlmoco } from "@/lib/agenda-settings";
import { INDICADORES } from "@/lib/certificacao";
import { recusaDaImportacao } from "@/lib/empresarial/importacao";
import { minutosPelaSequencia } from "@/lib/finance/custos-da-margem";
import {
  escopoAceitoPelaFuncao,
  soAceitaTodasAsUnidades,
} from "@/lib/finance/escopo";
import { comissaoEmMassa } from "@/lib/finance/repasse-percentual";
import { textoDaBaixa } from "@/lib/finance/quem-fez";
import { podeEntrarNoRol } from "@/lib/rita-procedimento";

const ler = (caminho: string) => readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");
const MIG = "supabase/migrations";
const migracao = (prefixo: string) => {
  const nome = readdirSync(MIG).find((f) => f.startsWith(prefixo));
  if (!nome) throw new Error(`NÃO MEDI: migração ${prefixo} não encontrada`);
  return ler(join(MIG, nome));
};
/** Só o SQL que roda: sem os comentários `--`. */
const semComentario = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

describe("AP111 — a planilha do Empresarial entra numa transação só, com o teto de dependentes", () => {
  const sql = semComentario(migracao("1042_"));
  const acao = ler("src/app/(app)/empresarial/[companyId]/employee-actions.ts");

  it("a função grava como a pessoa logada (valem as regras das tabelas) e trava por empresa", () => {
    expect(sql).toMatch(/function empresarial\.importar_titulares\([\s\S]*?security invoker/);
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("o teto é conferido pelas MESMAS funções do cadastro um a um, e a recusa desfaz tudo", () => {
    expect(sql).toContain("empresarial.limite_de_dependentes(p_company_id)");
    expect(sql).toContain("empresarial.dependentes_ativos(p_company_id)");
    expect(sql).toMatch(/raise exception 'DEPENDENT_LIMIT:%:%:%'/);
    expect(sql).toMatch(/raise exception 'DEPENDENT_MAX:%:%:%'/);
    expect(sql).toMatch(/raise exception 'HOLDER_NOT_FOUND:%'/);
    // "Só titulares" na proposta não diz nada sobre dependentes.
    expect(sql).toMatch(/if v_alvo = 'HOLDERS' then\s+v_maximo := null;/);
  });

  it("não executa sem login", () => {
    expect(sql).toMatch(
      /revoke all on function empresarial\.importar_titulares\(uuid, jsonb, jsonb\) from public, anon, authenticated/
    );
  });

  it("a ação grava pela função e só cai no caminho antigo quando ela não existe no banco", () => {
    expect(acao).toContain('db.rpc("importar_titulares"');
    expect(acao).toContain("funcaoDaImportacaoAusente(juntas.error)");
    expect(acao).toContain("recusaDaImportacao(juntas.error.message)");
    // O caminho de duas gravações só é chamado de um lugar: a reserva.
    expect(acao.match(/gravarEmDuasEtapas\(/g)?.length).toBe(2); // a definição e a chamada
  });

  it("a recusa diz os números e que nada foi gravado", () => {
    const limite = recusaDaImportacao("DEPENDENT_LIMIT:50:48:5");
    expect(limite).toContain("5 dependente(s) novo(s)");
    expect(limite).toContain("48 ativo(s)");
    expect(limite).toContain("o contrato fechou 50");
    expect(limite).toContain("2 vaga(s)");
    expect(limite).toContain("Nada foi gravado");
    expect(recusaDaImportacao("DEPENDENT_MAX:60:60:1")).toContain("máximo combinado na proposta é 60");
    expect(recusaDaImportacao("HOLDER_NOT_FOUND:2")).toContain("titular não está na empresa");
    expect(recusaDaImportacao("qualquer outra coisa")).toBe(
      "Não foi possível importar a planilha. Nada foi gravado."
    );
    expect(recusaDaImportacao(null)).toContain("Nada foi gravado");
  });
});

describe("AP16 — função NOVA não nasce aberta para quem não está logado", () => {
  // No Supabase toda função nova executa para `anon` pelo nome
  // (`pg_default_acl`). A 0379 fechou as que existiam; daqui em diante, a
  // migração que CRIA uma função (que não seja gatilho) tem de fechá-la.
  const arquivos = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  const numero = (f: string) => Number(f.slice(0, 4));
  /** Onde a régua começa em cada faixa (core, Empresarial, Indica, Rita). */
  const desde = (n: number) => (n < 1000 ? 379 : n < 2000 ? 1042 : n < 3000 ? 2012 : 3007);
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+((?:public|empresarial|indica|rita)\.\w+)\s*\(([\s\S]*?)\)\s*returns\s+(\S+)/gi;

  const criadasAntes = new Set<string>();
  const novas: { arquivo: string; nome: string; sql: string }[] = [];
  for (const f of arquivos) {
    const sql = semComentario(ler(join(MIG, f)));
    for (const m of sql.matchAll(FN)) {
      const nome = m[1].toLowerCase();
      const gatilho = m[3].toLowerCase() === "trigger";
      if (numero(f) >= desde(numero(f)) && !gatilho && !criadasAntes.has(nome)) {
        novas.push({ arquivo: f, nome, sql });
      }
      criadasAntes.add(nome);
    }
    for (const m of sql.matchAll(/alter function ((?:public|empresarial|indica|rita)\.\w+)[^;]*rename to (\w+)/gi)) {
      criadasAntes.add(`${m[1].split(".")[0]}.${m[2]}`.toLowerCase());
    }
  }

  it("a régua enxerga as funções novas deste lote (não passa por ausência)", () => {
    expect(novas.map((n) => n.nome)).toContain("empresarial.importar_titulares");
  });

  it("toda função nova tem `revoke ... from ... anon` na própria migração", () => {
    const abertas = novas.filter(({ nome, sql }) => {
      const n = nome.replace(".", "\\.");
      return !new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+${n}\\b[^;]*\\bfrom\\b[^;]*\\banon\\b`, "i").test(sql);
    });
    expect(abertas.map((a) => `${a.arquivo}: ${a.nome}`)).toEqual([]);
  });

  it("a 0379 não fecha as réguas que as regras de segurança das tabelas chamam", () => {
    const sql = semComentario(migracao("0379_"));
    for (const regua of ["is_admin_master", "has_role_in_clinic", "user_clinic_ids", "can_see_clinic_finance"]) {
      expect(sql).not.toMatch(new RegExp(`function public\\.${regua}\\(`));
    }
    expect(sql.match(/^revoke execute on function/gm)?.length).toBeGreaterThan(100);
    // Para quem está logado nada muda: todo revoke vem com o grant de volta.
    expect(sql.match(/^grant execute on function .* to authenticated/gm)?.length).toBe(
      sql.match(/^revoke execute on function/gm)?.length
    );
  });
});

describe("AP67 — o Financeiro da Franqueadora só com o escopo \"Todas\"", () => {
  it("a regra: só essa função é limitada, e só \"Todas\" (ou o padrão) passa", () => {
    expect(soAceitaTodasAsUnidades("finance_franchisor")).toBe(true);
    expect(soAceitaTodasAsUnidades("unit_manager")).toBe(false);
    expect(escopoAceitoPelaFuncao("finance_franchisor", "all")).toBe(true);
    expect(escopoAceitoPelaFuncao("finance_franchisor", undefined)).toBe(true);
    expect(escopoAceitoPelaFuncao("finance_franchisor", "specific")).toBe(false);
    expect(escopoAceitoPelaFuncao("finance_franchisor", "none")).toBe(false);
    expect(escopoAceitoPelaFuncao("commercial_consultant", "specific")).toBe(true);
  });

  it("os três caminhos que gravam o escopo perguntam à regra, e a gravação tem a segunda trava", () => {
    const acoes = ler("src/app/(app)/risartanos/acesso-actions.ts");
    const corpo = (nome: string) => {
      const i = acoes.indexOf(`function ${nome}(`);
      if (i < 0) throw new Error(`NÃO MEDI: ${nome} não encontrada`);
      const j = acoes.indexOf("\n}\n", i);
      return acoes.slice(i, j);
    };
    for (const nome of ["saveUnitScope", "parseAssignments", "addUserRole", "updateRoleScope"]) {
      expect(corpo(nome), nome).toContain("escopoAceitoPelaFuncao(");
    }
  });

  it("a tela não oferece a escolha para essa função", () => {
    const controle = ler("src/app/(app)/risartanos/unit-access-control.tsx");
    expect(controle).toMatch(/if \(soTodas\) \{\s+return \(/);
    const tela = ler("src/app/(app)/risartanos/acesso.tsx");
    expect(tela.match(/soTodas=\{soAceitaTodasAsUnidades\(/g)?.length).toBe(2);
  });

  it("o banco tem a terceira trava, na tabela de verdade", () => {
    const sql = semComentario(migracao("0380_"));
    expect(sql).toMatch(
      /alter table public\.user_clinic_roles_all\s+add constraint user_clinic_roles_finance_scope_all\s+check \(role <> 'finance_franchisor' or unit_scope is null or unit_scope = 'all'\)/
    );
  });
});

describe("AP77 — a comissão em massa grava em R$, como o cadastro", () => {
  it("valor em R$: todos ficam com ele e o percentual zera", () => {
    expect(comissaoEmMassa({ valorCents: 5000, percent: null }, 40000)).toMatchObject({
      valorCents: 5000,
      percent: 0,
    });
  });

  it("percentual: vira R$ sobre o preço de CADA procedimento", () => {
    const a = comissaoEmMassa({ valorCents: null, percent: 10 }, 40000);
    const b = comissaoEmMassa({ valorCents: null, percent: 10 }, 15000);
    expect(a).toMatchObject({ valorCents: 4000, percent: 0 });
    expect(b).toMatchObject({ valorCents: 1500, percent: 0 });
    expect(a.texto).toContain("10% do preço padrão");
  });

  it("percentual sem preço: guarda o percentual (não há como converter) e diz isso", () => {
    const r = comissaoEmMassa({ valorCents: null, percent: 10 }, 0);
    expect(r).toMatchObject({ valorCents: 0, percent: 10 });
    expect(r.texto).toContain("sem preço padrão");
  });

  it("a ação recusa os dois juntos e grava pelo cálculo por procedimento", () => {
    const acao = ler("src/app/(app)/procedimentos/actions.ts");
    const i = acao.indexOf("export async function setCommissionBulk");
    const corpo = acao.slice(i, acao.indexOf("\nexport ", i + 10));
    expect(corpo).toMatch(/if \(percent !== null && fixedCents !== null\) \{\s+return \{ ok: false, error: RECUSA_DA_COMISSAO_EM_MASSA \}/);
    expect(corpo).toContain("comissaoEmMassa({ valorCents: fixedCents, percent }, p.default_price_cents ?? 0)");
    // O jeito antigo (gravar o % como veio) não volta.
    expect(corpo).not.toContain("percent ?? atual.commission_percent");
  });
});

describe("AP84 — na negociação, a hora de cadeira da margem vem da sequência montada", () => {
  it("soma os minutos das sessões por item, com o ajuste da sequência", () => {
    expect(
      minutosPelaSequencia([
        { item_id: "a", planned_minutes: 30 },
        { item_id: "a", planned_minutes: 45 },
        { item_id: "b", planned_minutes: 60 },
      ])
    ).toEqual({ a: 75, b: 60 });
  });

  it("item sem tempo na sequência não entra (vale o planejado do item)", () => {
    expect(minutosPelaSequencia([{ item_id: "a", planned_minutes: null }])).toEqual({});
    expect(minutosPelaSequencia(null)).toEqual({});
    expect(minutosPelaSequencia([])).toEqual({});
  });

  it("o carregador da negociação usa a sequência primeiro e o item depois", () => {
    const loader = ler("src/app/(app)/apresentacao/[clientId]/negotiation-loader.ts");
    expect(loader).toContain('supabase.rpc("project_option_sessions", { p_option_id: o.id })');
    expect(loader).toContain("minutosPlanejados: minutosDaSequencia[i.id] ?? i.planned_total_minutes");
    // Erro na leitura da sequência não vira "zero minuto".
    expect(loader).toMatch(/if \(!sequencia\.error && Array\.isArray\(sequencia\.data\)\)/);
  });
});

describe("AP98 — o almoço cai da unidade para a rede campo a campo", () => {
  const rede = {
    clinic_id: null,
    open_time: "08:00:00",
    close_time: "18:00:00",
    weekdays: [1, 2, 3, 4, 5],
    chairs: 3,
    lunch_enabled: true,
    lunch_start: "12:30:00",
    lunch_end: "13:30:00",
  };
  const unidade = (almoco: boolean | null) => ({
    clinic_id: "u1",
    open_time: "07:00:00",
    close_time: "19:00:00",
    weekdays: [1, 2, 3, 4, 5, 6],
    chairs: 5,
    lunch_enabled: almoco,
    lunch_start: "12:00:00",
    lunch_end: "13:00:00",
  });

  it("unidade com horário próprio que NÃO definiu o almoço herda o da rede (era o defeito)", () => {
    const r = resolveAgendaSettings([rede, unidade(null)], "u1");
    expect(r.openTime).toBe("07:00"); // o horário é o dela
    expect(r.lunchEnabled).toBe(true);
    expect(r.lunchStart).toBe("12:30");
    expect(r.lunchEnd).toBe("13:30");
    expect(unidadeHerdaOAlmoco([rede, unidade(null)], "u1")).toBe(true);
  });

  it("unidade que decidiu ficar SEM almoço não herda", () => {
    const r = resolveAgendaSettings([rede, unidade(false)], "u1");
    expect(r.lunchEnabled).toBe(false);
    expect(unidadeHerdaOAlmoco([rede, unidade(false)], "u1")).toBe(false);
  });

  it("unidade com almoço próprio usa os horários dela", () => {
    const r = resolveAgendaSettings([rede, unidade(true)], "u1");
    expect([r.lunchEnabled, r.lunchStart, r.lunchEnd]).toEqual([true, "12:00", "13:00"]);
  });

  it("sem linha da unidade vale a rede; sem nada, o padrão do código", () => {
    expect(resolveAgendaSettings([rede], "u1").lunchStart).toBe("12:30");
    expect(resolveAgendaSettings([], "u1")).toEqual(AGENDA_DEFAULTS);
    expect(resolveAgendaSettings([unidade(null)], "u1").lunchEnabled).toBe(false);
  });

  it("a migração só troca na primeira vez e nunca mexe na linha da rede", () => {
    const sql = semComentario(migracao("0381_"));
    expect(sql).toMatch(/attname = 'lunch_enabled' and attnotnull/);
    expect(sql).toMatch(/set lunch_enabled = null\s+where clinic_id is not null\s+and lunch_enabled = false/);
  });

  it("salvar o almoço numa unidade sem linha própria não troca o horário dela pelo padrão do banco", () => {
    const acoes = ler("src/app/(app)/agenda/actions.ts");
    const i = acoes.indexOf("export async function saveLunchBreak");
    const corpo = acoes.slice(i, acoes.indexOf("\nexport ", i + 10));
    expect(corpo).toContain("open_time: rede.open_time");
    expect(corpo).not.toContain(".upsert(");
  });
});

describe("AP128 — desconto de pontualidade em mensalidade de mês fechado vira dedução", () => {
  const sql = semComentario(migracao("0382_"));
  const ramoFechado = sql.slice(sql.indexOf("if v_fechado then"), sql.indexOf("else\n      update public.financial_entries"));

  it("no mês fechado o valor do lançamento NÃO muda", () => {
    expect(ramoFechado.length).toBeGreaterThan(200);
    const principal = ramoFechado.slice(0, ramoFechado.indexOf("v_competencia := v_cash"));
    expect(principal).toContain("set status = 'settled', cash_date = v_cash");
    expect(principal).not.toContain("amount_cents");
  });

  it("o desconto entra na 1.9.02, como saída quitada, com o caixa na data do pagamento", () => {
    expect(ramoFechado).toMatch(/new\.clinic_id, '1\.9\.02', v_competencia, v_cash,\s+v_disc, 'outflow', 'settled', 'ortho_charge_discount', new\.id/);
    // Nunca num mês fechado: se o do pagamento também fechou, é hoje.
    expect(ramoFechado).toMatch(/v_competencia := public\.today_br\(\)/);
  });

  it("no mês aberto continua valendo o líquido, e desfazer cancela a dedução", () => {
    expect(sql).toContain("amount_cents = coalesce(new.paid_amount_cents, new.amount_cents), updated_at = now()");
    expect(sql).toMatch(/where source_type = 'ortho_charge_discount' and source_id = new\.id and status = 'settled'/);
  });
});

describe("AP132 — urgência nunca entra no rol da assistente virtual", () => {
  it("a regra", () => {
    expect(podeEntrarNoRol("urgency")).toBe(false);
    expect(podeEntrarNoRol("evaluation_new")).toBe(true);
    expect(podeEntrarNoRol(null)).toBe(true);
  });

  it("a ação recusa antes de gravar e a tela esconde a caixa", () => {
    const acao = ler("src/app/(app)/procedimentos/rita-actions.ts");
    expect(acao.indexOf("!podeEntrarNoRol(entrada.role)")).toBeGreaterThan(0);
    expect(acao.indexOf("!podeEntrarNoRol(entrada.role)")).toBeLessThan(acao.indexOf('.from("procedures")'));
    const tela = ler("src/app/(app)/procedimentos/rita-do-procedimento.tsx");
    expect(tela).toMatch(/\{podeEntrarNoRol\(v\.role\) \? \(\s+<label/);
  });

  it("o banco recusa por qualquer caminho", () => {
    const sql = semComentario(migracao("0383_"));
    expect(sql).toMatch(/check \(rita_role is distinct from 'urgency' or not rita_can_offer\)/);
  });
});

describe("AP134 — a missão só cobra o que a função consegue fazer", () => {
  const item = (chave: string) => {
    const i = INDICADORES.find((x) => x.chave === chave);
    if (!i) throw new Error(`NÃO MEDI: indicador ${chave} não existe`);
    return i;
  };

  it("avaliação e reavaliação contam a passagem de fase (o que o Coordenador grava)", () => {
    expect(item("avaliacoes").origem).toBe("journey_phase_history.moved_by + phase=planning_center");
    expect(item("avaliacoes").quando).toBe("entered_at");
    expect(item("reavaliacoes").origem).toBe("journey_phase_history.moved_by + phase=follow_up");
    // `closed_by` da avaliação não é gravado por nenhum botão do Coordenador.
    expect(INDICADORES.filter((x) => x.origem.startsWith("clinical_evaluations.closed_by"))).toEqual([]);
  });

  it("cada item está com a função que tem o botão", () => {
    expect(item("complementos_planejamento").papeis).toEqual(["clinical_coordinator"]);
    expect(item("pedidos_enviados").papeis).toEqual(["unit_manager"]);
    expect(item("consentimentos").papeis).toEqual(["clinical_coordinator"]);
  });
});

describe("AP129 — quem deu a baixa na mensalidade (Ortodontia) e na cobrança (Empresarial)", () => {
  it("o texto é o do Financeiro; sem ter lido os nomes, a tela não afirma nada", () => {
    expect(textoDaBaixa({ a: "Maria Souza" }, "a", null)).toBe("Baixa por Maria Souza");
    expect(textoDaBaixa({ a: "Maria Souza" }, "a", "2026-11-10T15:00:00Z")).toMatch(
      /^Baixa por Maria Souza em 10\/11\/2026 às 12:00$/
    );
    expect(textoDaBaixa({}, "a", null)).toBe("Baixa por autor não registrado");
    expect(textoDaBaixa({}, "a", null, true)).toBe("Baixa pelo sistema");
    // Nomes não lidos (migração ausente, erro) ≠ "autor não registrado".
    expect(textoDaBaixa(null, "a", null)).toBeNull();
  });

  it("os nomes vêm de funções com a régua de quem vê o dinheiro, fechadas sem login", () => {
    const orto = semComentario(migracao("0385_"));
    expect(orto).toContain("and public.ortho_can_see_money(c.clinic_id)");
    expect(orto).toMatch(/revoke execute on function public\.ortho_charge_authors\(uuid\[\]\) from public, anon, authenticated/);
    const emp = semComentario(migracao("1043_"));
    expect(emp).toContain("b.company_id in (select empresarial.accessible_company_ids())");
    expect(emp).toMatch(/revoke execute on function empresarial\.billing_settlers\(uuid\[\]\) from public, anon, authenticated/);
  });

  it("o carimbo do Empresarial entra ao virar PAGA e sai quando deixa de estar", () => {
    const emp = semComentario(migracao("1043_"));
    expect(emp).toMatch(/if new\.status = 'PAID' then[\s\S]*?new\.paid_by := coalesce\(new\.paid_by, \(select auth\.uid\(\)\)\);[\s\S]*?else\s+new\.paid_by := null;/);
    expect(emp).toMatch(/before insert or update of status on empresarial\.adhesion_billing/);
  });

  it("as três telas mostram a baixa, e o Empresarial não chama de \"pelo sistema\" o que não sabe", () => {
    expect(ler("src/app/(app)/ortodontia/mensalidades/page.tsx")).toContain(
      '{ch.status === "paga" && textoDaBaixa(quemBaixou, ch.id, ch.paid_at) && ('
    );
    expect(ler("src/app/(app)/ortodontia/casos/[id]/page.tsx")).toContain(
      '{ch.status === "paga" && textoDaBaixa(quemBaixou, ch.id, ch.paid_at) && ('
    );
    const emp = ler("src/app/(app)/empresarial/cobrancas/page.tsx");
    expect(emp).toContain('db.rpc("billing_settlers"');
    expect(emp).toMatch(/r\.status === "PAID" && quemBaixou\?\.\[r\.id\]/);
  });
});

describe("AP135 — a anamnese antiga só é apagada se estiver vazia", () => {
  const cru = migracao("0384_");
  const sql = semComentario(cru);

  it("a migração confere as duas tabelas e PARA antes de apagar se houver uma linha", () => {
    const trava = sql.indexOf("raise exception 'ANAMNESE_ANTIGA_COM_DADO");
    const apaga = sql.indexOf("drop table if exists");
    expect(trava).toBeGreaterThan(0);
    expect(apaga).toBeGreaterThan(trava);
    expect(sql).toMatch(/if v_n > 0 or v_m > 0 then/);
  });

  it("cada comando que apaga está declarado, e só as duas tabelas antigas caem", () => {
    const drops = sql.match(/drop table[^;]*;/g) ?? [];
    expect(drops.map((d) => d.replace(/\s+/g, " "))).toEqual([
      "drop table if exists public.clinical_anamnesis_revisions;",
      "drop table if exists public.clinical_anamnesis;",
    ]);
    expect(cru.match(/^-- DESTRUTIVO: /gm)?.length).toBe(2);
  });
});
