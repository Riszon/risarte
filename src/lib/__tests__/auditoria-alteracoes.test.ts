import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ENTITY_LABELS, auditEntityLabel } from "@/lib/audit-labels";
import {
  OCULTO,
  VAZIO,
  camposDaAlteracao,
  clientesCitados,
  contarAlteracoes,
  destinoDoRegistro,
  formatarDetalhe,
  formatarValor,
  lerDia,
  lerOperacao,
  lerTabela,
  nomeDoRegistro,
  opcoesDeTabela,
  quemFez,
  resumoDosCampos,
  rotuloDaTabela,
  rotuloDoCampo,
  rotuloDoDetalhe,
  type Alteracao,
  type Nomes,
} from "@/lib/auditoria-alteracoes";
import { TABELAS } from "@/lib/auditoria-catalogo";

// 0288 (dono, 09/10/2026): "melhore a auditoria do riSZon, com mais detalhes e
// possibilidades de enxergar o que cada usuário fez e alterou". O banco passou
// a registrar sozinho cada alteração, com o antes e o depois; aqui ficam a
// tradução (nome técnico → português) e as RÉGUAS que impedem a auditoria de
// envelhecer: tabela nova sem nome, tipo novo em inglês, trilha que se apaga.

const MIGRACOES = "supabase/migrations";
const lerMigracao = (f: string) =>
  readFileSync(join(MIGRACOES, f), "utf8").replace(/\r\n/g, "\n");
/** O código da migração, sem as linhas de comentário (explicar não é fazer). */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
const arquivosDeMigracao = readdirSync(MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const nomes: Nomes = {
  usuarios: new Map([["11111111-1111-4111-8111-111111111111", "Ana Recepção"]]),
  unidades: new Map([["22222222-2222-4222-8222-222222222222", "Risarte Cambé"]]),
};

function alteracao(parcial: Partial<Alteracao>): Alteracao {
  return {
    id: 1,
    occurred_at: "2026-10-09T17:00:00Z",
    user_id: "11111111-1111-4111-8111-111111111111",
    actor: "usuario",
    auth_session_id: null,
    schema_name: "public",
    table_name: "clients",
    op: "U",
    row_id: "33333333-3333-4333-8333-333333333333",
    row_label: "FRA-00012 · Maria",
    clinic_id: null,
    client_id: null,
    changes: {},
    tx: 10,
    ...parcial,
  };
}

describe("o dicionário: nome técnico vira português", () => {
  it("tabela conhecida tem nome; desconhecida aparece pelo nome técnico (nunca some)", () => {
    expect(rotuloDaTabela("public", "clients")).toBe("Cliente");
    expect(rotuloDaTabela("empresarial", "employees")).toBe("Colaborador titular");
    expect(rotuloDaTabela("indica", "indicacoes")).toBe("Indicação");
    expect(rotuloDaTabela("public", "tabela_que_nasceu_ontem")).toBe(
      "tabela_que_nasceu_ontem"
    );
  });

  it("campo comum tem rótulo escrito à mão", () => {
    expect(rotuloDoCampo("phone")).toBe("Telefone");
    expect(rotuloDoCampo("full_name")).toBe("Nome completo");
    expect(rotuloDoCampo("journey_phase")).toBe("Fase da jornada");
    expect(rotuloDoCampo("clinic_id")).toBe("Unidade");
  });

  it("campo raro é traduzido palavra a palavra, sem o sufixo de tipo", () => {
    expect(rotuloDoCampo("expected_settlement_date")).toBe("Previsto liquidação data");
    expect(rotuloDoCampo("benefit_discount_cents")).toBe("Benefício desconto");
    expect(rotuloDoCampo("renegotiation_id")).toBe("Renegociação");
  });

  it("palavra sem tradução fica como está — não se inventa nome", () => {
    expect(rotuloDoCampo("xyzzy_qualquer")).toBe("Xyzzy qualquer");
    expect(rotuloDoCampo("regra_congelada")).toBe("Regra congelada");
  });

  it("o filtro de tabelas vem em ordem alfabética e marca a área", () => {
    const op = opcoesDeTabela();
    expect(op.length).toBe(Object.keys(TABELAS).length);
    expect(op.find((o) => o.value === "public.clients")?.label).toBe("Cliente");
    expect(op.find((o) => o.value === "empresarial.companies")?.label).toBe(
      "Empresa (Empresarial)"
    );
    // Quem já traz a área no nome não a repete.
    expect(op.find((o) => o.value === "indica.config")?.label).toBe(
      "Configuração do Indica +Risos"
    );
    const rotulos = op.map((o) => o.label);
    expect([...rotulos].sort((a, b) => a.localeCompare(b, "pt-BR"))).toEqual(rotulos);
  });

  it("tabela vinda da URL só vale se for conhecida", () => {
    expect(lerTabela("public.clients")).toEqual({ schema: "public", tabela: "clients" });
    expect(lerTabela("public.audit_changes")).toBeNull();
    expect(lerTabela("auth.users")).toBeNull();
    expect(lerTabela(undefined)).toBeNull();
  });
});

describe("o valor: traduz o que sabe, mostra o resto como está", () => {
  const f = (campo: string, valor: unknown, tabela = "clients", schema = "public") =>
    formatarValor(schema, tabela, campo, valor, nomes);

  it("vazio, sim/não e segredo", () => {
    expect(f("phone", null)).toBe(VAZIO);
    expect(f("phone", "")).toBe(VAZIO);
    expect(f("is_active", true)).toBe("Sim");
    expect(f("is_active", false)).toBe("Não");
    expect(f("portal_token_hash", "[oculto]")).toBe(OCULTO);
  });

  it("dinheiro em centavos vira reais; número comum não", () => {
    expect(f("amount_cents", 123456)).toContain("1.234,56");
    expect(f("valor_centavos", 990)).toContain("9,90");
    expect(f("seq", 3)).toBe("3");
    expect(f("discount_percent", 7.5)).toBe("7,5");
  });

  it("data e data-hora no formato e no fuso do Brasil", () => {
    expect(f("birth_date", "1990-03-05")).toBe("05/03/1990");
    // 02:30 UTC do dia 10 = 23:30 do dia 9 em Brasília.
    expect(f("created_at", "2026-10-10T02:30:00+00:00")).toBe("09/10/2026, 23:30");
  });

  it("identificador vira gente ou unidade quando a tela conhece", () => {
    expect(f("created_by", "11111111-1111-4111-8111-111111111111")).toBe("Ana Recepção");
    expect(f("clinic_id", "22222222-2222-4222-8222-222222222222")).toBe("Risarte Cambé");
    expect(f("plan_id", "99999999-9999-4999-8999-999999999999")).toBe("registro 99999999…");
  });

  it("função, fase, pilar e situação saem em português", () => {
    expect(f("role", "receptionist", "user_clinic_roles_all")).toBe("Recepcionista");
    expect(f("journey_phase", "planning_center")).toBe("Centro de Planejamento");
    expect(f("status", "anonymized")).toBe("Anonimizado");
    expect(f("papel", "*", "access_idle_settings")).toBe("Todas as funções");
  });

  it("a situação de UMA tabela não vaza para outra", () => {
    // `status = active` só tem tradução declarada em `clients`.
    expect(f("status", "active", "clients")).toBe("Ativo");
    expect(f("status", "active", "suppliers")).toBe("active");
  });

  it("lista: item a item; lista vazia diz que é vazia", () => {
    expect(
      f("clinic_ids", [
        "22222222-2222-4222-8222-222222222222",
        "99999999-9999-4999-8999-999999999999",
      ])
    ).toBe("Risarte Cambé, registro 99999999…");
    expect(f("specialties", [])).toBe("(nenhum)");
  });

  it("texto comum não é mexido", () => {
    expect(f("notes", "Prefere atendimento à tarde.")).toBe("Prefere atendimento à tarde.");
    expect(f("code", "2026-10")).toBe("2026-10");
  });
});

describe("os detalhes de uma ação (trilha antiga) também saem em português", () => {
  it("fase de/para, forçado, como entrou e motivo da saída", () => {
    expect(rotuloDoDetalhe("from")).toBe("De");
    expect(rotuloDoDetalhe("to")).toBe("Para");
    expect(rotuloDoDetalhe("forcado")).toBe("Forçado pelo Admin");
    expect(formatarDetalhe("to", "commercial_conversion", nomes)).toBe("Conversão Comercial");
    expect(formatarDetalhe("lifecycle", "aguardando_apresentacao", nomes)).toBe("Aguardando apresentação");
    expect(formatarDetalhe("origem", "retomada", nomes)).toBe("já estava logado");
    expect(formatarDetalhe("motivo", "inatividade", nomes)).toBe("Desconectado por inatividade");
    expect(formatarDetalhe("forcado", true, nomes)).toBe("Sim");
  });

  it("detalhe desconhecido aparece como foi gravado", () => {
    expect(rotuloDoDetalhe("quantidade_importada")).toBe("Quantidade importada");
    expect(formatarDetalhe("arquivo", "colaboradores.xlsx", nomes)).toBe("colaboradores.xlsx");
  });
});

describe("campo a campo: antes e depois", () => {
  it("alteração mostra só o que mudou, com antes e depois", () => {
    const a = alteracao({
      changes: {
        phone: { antes: "(43) 99999-0000", depois: "(43) 98888-1111" },
        email: { antes: null, depois: "maria@exemplo.com" },
      },
    });
    expect(camposDaAlteracao(a, nomes)).toEqual([
      { campo: "phone", rotulo: "Telefone", antes: "(43) 99999-0000", depois: "(43) 98888-1111" },
      { campo: "email", rotulo: "E-mail", antes: VAZIO, depois: "maria@exemplo.com" },
    ]);
    expect(resumoDosCampos(a)).toBe("Telefone, E-mail");
  });

  it("inclusão não tem 'antes'; exclusão não tem 'depois'; a chave e o 'criado em' não poluem", () => {
    const conteudo = { id: "x", name: "Ortodontia", created_at: "2026-10-09T12:00:00Z", is_active: true };
    const inc = camposDaAlteracao(alteracao({ op: "I", table_name: "specialties", changes: conteudo }), nomes);
    expect(inc).toEqual([
      { campo: "name", rotulo: "Nome", antes: null, depois: "Ortodontia" },
      { campo: "is_active", rotulo: "Ativo", antes: null, depois: "Sim" },
    ]);
    const exc = camposDaAlteracao(alteracao({ op: "D", table_name: "specialties", changes: conteudo }), nomes);
    expect(exc[0]).toEqual({ campo: "name", rotulo: "Nome", antes: "Ortodontia", depois: null });
  });

  it("resumo longo é cortado dizendo quantos faltam; inclusão não tem resumo", () => {
    const muitos = Object.fromEntries(
      ["phone", "email", "city", "state", "zip_code", "notes"].map((c) => [c, { antes: 1, depois: 2 }])
    );
    expect(resumoDosCampos(alteracao({ changes: muitos }))).toBe(
      "Telefone, E-mail, Cidade, Estado e mais 2"
    );
    expect(resumoDosCampos(alteracao({ op: "I", changes: { name: "x" } }))).toBe("");
  });

  it("registro estranho (sem antes/depois numa alteração) é ignorado, não quebra a tela", () => {
    const a = alteracao({ changes: { phone: "valor solto", email: { antes: 1, depois: 2 } } });
    expect(camposDaAlteracao(a, nomes).map((c) => c.campo)).toEqual(["email"]);
    expect(camposDaAlteracao(alteracao({ changes: null }), nomes)).toEqual([]);
  });
});

describe("quem, qual registro e a contagem do dia", () => {
  it("quem fez: a pessoa; sem pessoa, o sistema — dizendo de que jeito", () => {
    expect(quemFez(alteracao({}), nomes)).toBe("Ana Recepção");
    expect(quemFez(alteracao({ user_id: null, actor: "servico" }), nomes)).toBe(
      "Sistema (em nome de alguém)"
    );
    expect(quemFez(alteracao({ user_id: null, actor: "sistema" }), nomes)).toBe(
      "Sistema (rotina automática)"
    );
    expect(quemFez(alteracao({ user_id: "00000000-0000-4000-8000-000000000000" }), nomes)).toBe(
      "Usuário removido"
    );
  });

  it("o nome do registro é o rótulo do banco; sem ele, a chave curta", () => {
    expect(nomeDoRegistro({ row_label: "FRA-00012 · Maria", row_id: "x" })).toBe("FRA-00012 · Maria");
    expect(nomeDoRegistro({ row_label: null, row_id: "33333333-3333-4333-8333-333333333333" })).toBe("33333333…");
    // Chave em texto: a função sai em português, o resto como está.
    expect(nomeDoRegistro({ row_label: null, row_id: "modulo.x,tsb" })).toBe("modulo.x · TSB (Técnica em Saúde Bucal)");
    expect(nomeDoRegistro({ row_label: null, row_id: "purchaser" })).toBe("Comprador da Franqueadora");
    expect(nomeDoRegistro({ row_label: null, row_id: "*" })).toBe("Todas as funções");
    expect(nomeDoRegistro({ row_label: null, row_id: null })).toBe("—");
  });

  it("registro sem nome próprio (agendamento, parcela) é identificado pelo CLIENTE", () => {
    const comCliente: Nomes = {
      ...nomes,
      clientes: new Map([["44444444-4444-4444-8444-444444444444", "FRA-00012 · Maria"]]),
    };
    const agendamento = {
      schema_name: "public",
      table_name: "appointments",
      row_id: "33333333-3333-4333-8333-333333333333",
      row_label: null,
      client_id: "44444444-4444-4444-8444-444444444444",
    };
    expect(nomeDoRegistro(agendamento, comCliente)).toBe("de FRA-00012 · Maria");
    // Com nome próprio, o cliente vem depois.
    expect(nomeDoRegistro({ ...agendamento, table_name: "treatment_sessions", row_label: "Limpeza" }, comCliente)).toBe(
      "Limpeza — FRA-00012 · Maria"
    );
    // O próprio cadastro do cliente não repete o nome dele.
    expect(
      nomeDoRegistro({ ...agendamento, table_name: "clients", row_label: "FRA-00012 · Maria" }, comCliente)
    ).toBe("FRA-00012 · Maria");
    // Sem os nomes carregados, cai na chave curta — não quebra.
    expect(nomeDoRegistro(agendamento, nomes)).toBe("33333333…");
    expect(clientesCitados([agendamento, agendamento, { client_id: null }])).toEqual([
      "44444444-4444-4444-8444-444444444444",
    ]);
    // E o identificador do cliente dentro de um campo também vira nome.
    expect(
      formatarValor("public", "appointments", "client_id", "44444444-4444-4444-8444-444444444444", comCliente)
    ).toBe("FRA-00012 · Maria");
  });

  it("registro ligado a cliente leva ao prontuário", () => {
    expect(destinoDoRegistro({ client_id: "abc" })).toBe("/prontuarios/abc");
    expect(destinoDoRegistro({ client_id: null })).toBeNull();
  });

  it("conta por tipo e quantos registros DIFERENTES foram mexidos", () => {
    const base = { schema_name: "public", table_name: "clients" };
    expect(
      contarAlteracoes([
        { ...base, op: "U", row_id: "a" },
        { ...base, op: "U", row_id: "a" },
        { ...base, op: "I", row_id: "b" },
        { schema_name: "public", table_name: "appointments", op: "D", row_id: "a" },
      ])
    ).toEqual({ cadastrou: 1, alterou: 2, excluiu: 1, registros: 3 });
  });

  it("dia e operação vindos da URL são conferidos", () => {
    expect(lerDia("2026-10-09")).toBe("2026-10-09");
    expect(lerDia("09/10/2026")).toBe("");
    expect(lerDia("2026-13-45")).toBe("");
    expect(lerDia(undefined)).toBe("");
    expect(lerOperacao("U")).toBe("U");
    expect(lerOperacao("X")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — o que impede a auditoria de envelhecer
// ---------------------------------------------------------------------------

/** Tabelas que as migrações criam nos três schemas (lidas do SQL). */
function tabelasCriadas(): Set<string> {
  const criadas = new Set<string>();
  for (const f of arquivosDeMigracao) {
    for (const m of semComentarios(lerMigracao(f)).matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(public|empresarial|indica)\.)?(\w+)/gi
    )) {
      criadas.add(`${(m[1] ?? "public").toLowerCase()}.${m[2].toLowerCase()}`);
    }
  }
  // Renomeada na 0277 (a tabela de verdade; o nome antigo virou uma view).
  if (criadas.delete("public.user_clinic_roles")) {
    criadas.add("public.user_clinic_roles_all");
  }
  // Derrubadas depois de copiadas (0215: o kit ganhou nome próprio).
  criadas.delete("public.procedure_kits");
  criadas.delete("public.procedure_kit_items");
  return criadas;
}

/** O que as migrações declaram FORA da auditoria (com motivo). */
function tabelasDeclaradasFora(): Set<string> {
  const fora = new Set<string>();
  for (const f of arquivosDeMigracao) {
    const sql = semComentarios(lerMigracao(f));
    if (!/insert\s+into\s+public\.audit_excluded_tables/i.test(sql)) continue;
    for (const m of sql.matchAll(
      /\(\s*'(public|empresarial|indica)'\s*,\s*'(\w+)'\s*,\s*'[^']/gi
    )) {
      fora.add(`${m[1]}.${m[2]}`);
    }
  }
  return fora;
}

describe("RÉGUA: toda tabela ou é auditada (e tem nome) ou está declarada fora", () => {
  const criadas = tabelasCriadas();
  const fora = tabelasDeclaradasFora();

  it("a régua enxerga as tabelas (não passa por não ter achado nada)", () => {
    expect(criadas.size).toBeGreaterThan(200);
    expect(fora.size).toBeGreaterThan(30);
  });

  it("tabela nova sem nome em português reprova", () => {
    const semNome = [...criadas].filter((t) => !(t in TABELAS) && !fora.has(t));
    expect(
      semNome,
      "Tabela criada por migração sem rótulo em src/lib/auditoria-catalogo.ts " +
        "(TABELAS) e sem estar declarada em public.audit_excluded_tables"
    ).toEqual([]);
  });

  it("não sobra rótulo de tabela que não existe mais", () => {
    expect(Object.keys(TABELAS).filter((t) => !criadas.has(t))).toEqual([]);
  });

  it("nenhuma tabela está ao mesmo tempo auditada (com nome) e declarada fora", () => {
    expect(Object.keys(TABELAS).filter((t) => fora.has(t))).toEqual([]);
  });

  it("os cadastros que importam NÃO podem ser declarados fora", () => {
    const obrigatorias = [
      "public.clients",
      "public.appointments",
      "public.treatment_plans",
      "public.treatment_sessions",
      "public.staff_members",
      "public.profiles",
      "public.user_clinic_roles_all",
      "public.permission_matrix",
      "public.payment_installments",
      "public.payment_receipts",
      "public.financial_entries",
      "public.payables",
      "public.stock_movements",
      "empresarial.companies",
      "empresarial.employees",
      "indica.indicacoes",
    ];
    expect(obrigatorias.filter((t) => fora.has(t))).toEqual([]);
    expect(obrigatorias.filter((t) => !(t in TABELAS))).toEqual([]);
  });
});

describe("RÉGUA: todo tipo de registro da trilha de ações tem nome em português", () => {
  const arquivos = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const c = join(d, n);
      if (statSync(c).isDirectory()) return n === "__tests__" ? [] : arquivos(c);
      return /\.(ts|tsx)$/.test(n) ? [c] : [];
    });

  it("os que o CÓDIGO grava (entityType: \"...\")", () => {
    const tipos = new Set<string>();
    for (const a of arquivos("src")) {
      for (const m of readFileSync(a, "utf8").matchAll(/entityType:\s*"([a-z_]+)"/g)) {
        tipos.add(m[1]);
      }
    }
    expect(tipos.size).toBeGreaterThan(150);
    expect([...tipos].filter((t) => auditEntityLabel(t) === t).sort()).toEqual([]);
  });

  it("os que as FUNÇÕES DO BANCO gravam", () => {
    const tipos = new Set<string>();
    for (const f of arquivosDeMigracao) {
      for (const m of lerMigracao(f).matchAll(
        /insert into public\.audit_logs[\s\S]{0,400}?values[\s\S]{0,300}?'(?:create|update|view|delete|export|anonymize|login|logout)',\s*'([a-z_]+)'/g
      )) {
        tipos.add(m[1]);
      }
    }
    expect(tipos.size).toBeGreaterThan(20);
    expect([...tipos].filter((t) => !(t in AUDIT_ENTITY_LABELS)).sort()).toEqual([]);
  });
});

describe("RÉGUA: a trilha de alterações (0288) não se apaga, não vaza e não derruba", () => {
  const arquivo = arquivosDeMigracao.find((f) => f.startsWith("0288_"));
  const sql = arquivo ? semComentarios(lerMigracao(arquivo)) : "";
  const todas = arquivosDeMigracao.map((f) => semComentarios(lerMigracao(f))).join("\n");

  /** O corpo de uma função da 0288, do `create` até o `$$;` que a fecha. */
  const corpo = (nome: string) => {
    const ini = sql.indexOf(`function public.${nome}(`);
    const fim = sql.indexOf("$$;", ini);
    return ini >= 0 && fim > ini ? sql.slice(ini, fim) : "";
  };

  it("a régua achou a migração e as funções (senão não mediu nada)", () => {
    expect(arquivo).toBeDefined();
    expect(corpo("audit_capture").length).toBeGreaterThan(500);
    expect(corpo("audit_attach_all").length).toBeGreaterThan(200);
  });

  it("o gatilho NUNCA derruba a operação: todo erro vira aviso no log", () => {
    const c = corpo("audit_capture");
    expect(c).toMatch(/exception\s+when\s+others\s+then/i);
    expect(c).toMatch(/raise\s+warning/i);
    expect(c).not.toMatch(/raise\s+exception/i);
  });

  it("segredo (senha, token, chave) é gravado como [oculto]", () => {
    const c = corpo("audit_capture");
    expect(c).toMatch(/password\|secret\|token/);
    expect(c).toContain('"[oculto]"');
  });

  it("só o Admin Master lê, e ninguém tem regra para escrever, editar ou apagar", () => {
    const politicas = [
      ...todas.matchAll(
        /create\s+policy\s+"?\w+"?\s+on\s+public\.audit_changes\s+for\s+(\w+)[\s\S]{0,200}?;/gi
      ),
    ];
    expect(politicas.length).toBeGreaterThan(0);
    for (const p of politicas) {
      expect(p[1].toLowerCase()).toBe("select");
      expect(p[0]).toMatch(/is_admin_master\(\)/);
    }
  });

  it("editar, apagar e esvaziar a trilha são recusados por gatilho", () => {
    expect(sql).toMatch(
      /before\s+update\s+or\s+delete\s+on\s+public\.audit_changes[\s\S]{0,80}?audit_changes_immutable/i
    );
    expect(sql).toMatch(
      /before\s+truncate\s+on\s+public\.audit_changes[\s\S]{0,80}?audit_changes_immutable/i
    );
    expect(sql).not.toMatch(/references\s+/i); // sem chave estrangeira: nenhum CASCADE alcança
  });

  it("o gatilho só é preso nos três schemas do riSZon — nunca no Academy", () => {
    const c = corpo("audit_attach_all");
    expect(c).toMatch(/nspname\s+in\s+\('public',\s*'empresarial',\s*'indica'\)/);
    expect(sql).not.toMatch(/treinamento/i);
    expect(sql).not.toMatch(/\bauth\.users\b/i);
  });

  it("as funções internas não respondem à API", () => {
    for (const fn of ["audit_capture", "audit_attach_all"]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`,
          "i"
        )
      );
      expect(sql).not.toMatch(
        new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\(`, "i")
      );
    }
  });
});

describe("RÉGUA: a tela de Auditoria é só do Admin Master", () => {
  it("a página exige Admin Master antes de ler qualquer coisa", () => {
    const pagina = readFileSync("src/app/(app)/admin/auditoria/page.tsx", "utf8");
    const guarda = pagina.indexOf("await requireAdminMaster()");
    const primeiraLeitura = pagina.search(/createClient\(\)|\.from\(/);
    expect(guarda).toBeGreaterThan(0);
    expect(primeiraLeitura).toBeGreaterThan(guarda);
  });
});
