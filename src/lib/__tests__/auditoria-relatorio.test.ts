import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditEntityLabel } from "@/lib/audit-labels";
import {
  MAXIMO_DE_DIAS,
  alteracoesDe,
  horaBr,
  lerLinhasDeAtividade,
  lerModo,
  lerPeriodoDoRelatorio,
  ordenarDiaADia,
  paradoS,
  relatorioDeAtividade,
  resumirPorPessoa,
  semAtividade,
  type LinhaDeAtividade,
} from "@/lib/auditoria-relatorio";
import { temposDoAcesso } from "@/lib/acesso";
import { totaisDoRelatorio } from "@/lib/finance/relatorio";

// 0289 (dono, 09/10/2026): "enxergar o que cada usuário fez e alterou. Tempo de
// atividade ou inatividade no sistema [...] ficando registrado cada dia que fez
// o acesso." A etapa 3 da auditoria: os números por pessoa e por dia, na tela
// e em planilha — com o MESMO modelo servindo às duas saídas.

const ler = (arq: string) => readFileSync(arq, "utf8").replace(/\r\n/g, "\n");
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const ANA = "11111111-1111-4111-8111-111111111111";
const BIA = "22222222-2222-4222-8222-222222222222";
const CAIO = "33333333-3333-4333-8333-333333333333";

function linha(parcial: Partial<LinhaDeAtividade>): LinhaDeAtividade {
  return {
    usuario: ANA,
    dia: "2026-10-08",
    acessos: 1,
    primeiroAcesso: "2026-10-08T11:00:00+00:00",
    ultimaAtividade: "2026-10-08T15:00:00+00:00",
    emUsoS: 3600,
    totalS: 14400,
    porInatividade: 0,
    porViradaDoDia: 0,
    acoes: 10,
    consultas: 7,
    exportacoes: 1,
    cadastrou: 2,
    alterou: 3,
    excluiu: 0,
    registros: 4,
    ...parcial,
  };
}

describe("ler o que o banco devolve", () => {
  it("traduz as colunas e aceita número vindo como texto", () => {
    const lidas = lerLinhasDeAtividade([
      {
        user_id: ANA,
        day: "2026-10-08",
        sessions: 2,
        first_access: "2026-10-08T11:00:00+00:00",
        last_activity: "2026-10-08T15:00:00+00:00",
        active_seconds: "3600",
        total_seconds: 14400,
        idle_logouts: 1,
        day_change_logouts: 0,
        actions: 10,
        views: 7,
        exports: 1,
        inserts: 2,
        updates: 3,
        deletes: 0,
        rows_touched: 4,
      },
    ]);
    expect(lidas).toHaveLength(1);
    expect(lidas![0]).toMatchObject({
      usuario: ANA,
      dia: "2026-10-08",
      acessos: 2,
      emUsoS: 3600,
      totalS: 14400,
      porInatividade: 1,
      consultas: 7,
      alterou: 3,
    });
  });

  it("⚠️ NÃO CONSEGUI LER é diferente de NINGUÉM FEZ NADA", () => {
    // Lista vazia: período sem atividade. A tela informa.
    expect(lerLinhasDeAtividade([])).toEqual([]);
    // Resposta ilegível (função ausente, erro): a tela AVISA, não mostra zero.
    expect(lerLinhasDeAtividade(null)).toBeNull();
    expect(lerLinhasDeAtividade(undefined)).toBeNull();
    expect(lerLinhasDeAtividade({ erro: "x" })).toBeNull();
    expect(lerLinhasDeAtividade([{ day: "2026-10-08" }])).toBeNull();
    expect(lerLinhasDeAtividade([{ user_id: ANA, day: "ontem" }])).toBeNull();
  });

  it("número negativo ou lixo vira zero — nunca tempo negativo", () => {
    const [l] = lerLinhasDeAtividade([
      { user_id: ANA, day: "2026-10-08", active_seconds: -5, total_seconds: "abc", actions: null },
    ])!;
    expect(l.emUsoS).toBe(0);
    expect(l.totalS).toBe(0);
    expect(l.acoes).toBe(0);
  });
});

describe("as contas", () => {
  it("parado = total do acesso − em uso, e nunca negativo", () => {
    expect(paradoS({ totalS: 14400, emUsoS: 3600 })).toBe(10800);
    expect(paradoS({ totalS: 100, emUsoS: 500 })).toBe(0);
  });

  it("⚠️ a conta do relatório é a MESMA da tela de Acessos", () => {
    // Um acesso de 4h com 1h de uso: a tela de Acessos (`temposDoAcesso`) e o
    // relatório têm de dizer a mesma coisa — 1h em uso, 3h parado.
    const t = temposDoAcesso({
      startedAt: "2026-10-08T11:00:00Z",
      lastActivityAt: "2026-10-08T15:00:00Z",
      endedAt: null,
      activeSeconds: 3600,
    });
    const l = linha({ totalS: t.totalS, emUsoS: t.emUsoS });
    expect(l.emUsoS).toBe(3600);
    expect(paradoS(l)).toBe(t.paradoS);
    expect(paradoS(l)).toBe(10800);
  });

  it("alterações = cadastrou + alterou + excluiu", () => {
    expect(alteracoesDe({ cadastrou: 2, alterou: 3, excluiu: 1 })).toBe(6);
  });

  it("hora no relógio de Brasília; sem acesso, vazio", () => {
    expect(horaBr("2026-10-08T11:00:00+00:00")).toBe("08:00");
    // 02:30 UTC é 23:30 do dia anterior aqui.
    expect(horaBr("2026-10-09T02:30:00+00:00")).toBe("23:30");
    expect(horaBr(null)).toBe("");
    expect(horaBr("lixo")).toBe("");
  });
});

describe("o período", () => {
  const HOJE = "2026-10-09";

  it("sem datas: os últimos 7 dias, contando hoje", () => {
    expect(lerPeriodoDoRelatorio("", "", HOJE)).toEqual({
      de: "2026-10-03",
      ate: "2026-10-09",
      dias: 7,
      encurtado: false,
    });
  });

  it("um dia só é um dia", () => {
    expect(lerPeriodoDoRelatorio("2026-10-08", "2026-10-08", HOJE).dias).toBe(1);
  });

  it("datas invertidas são desinvertidas", () => {
    expect(lerPeriodoDoRelatorio("2026-10-08", "2026-10-01", HOJE)).toMatchObject({
      de: "2026-10-01",
      ate: "2026-10-08",
      dias: 8,
    });
  });

  it("não existe relatório do futuro", () => {
    expect(lerPeriodoDoRelatorio("2026-10-05", "2026-12-31", HOJE)).toMatchObject({
      de: "2026-10-05",
      ate: HOJE,
    });
    expect(lerPeriodoDoRelatorio("2027-01-01", "2027-02-01", HOJE).ate).toBe(HOJE);
  });

  it("⚠️ período grande demais fica com os dias MAIS RECENTES e AVISA", () => {
    const p = lerPeriodoDoRelatorio("2025-01-01", "2026-10-09", HOJE);
    expect(p.dias).toBe(MAXIMO_DE_DIAS);
    expect(p.ate).toBe(HOJE);
    expect(p.encurtado).toBe(true);
    // Exatamente no limite não é encurtado.
    expect(lerPeriodoDoRelatorio("2026-07-10", HOJE, HOJE)).toMatchObject({
      dias: MAXIMO_DE_DIAS,
      encurtado: false,
    });
  });

  it("data torta na URL cai no padrão, não quebra", () => {
    expect(lerPeriodoDoRelatorio("09/10/2026", "amanhã", HOJE)).toMatchObject({
      de: "2026-10-03",
      ate: HOJE,
    });
    expect(lerPeriodoDoRelatorio(undefined, ["x"], HOJE).dias).toBe(7);
  });

  it("modo desconhecido vira o resumo por pessoa", () => {
    expect(lerModo("dia")).toBe("dia");
    expect(lerModo("pessoa")).toBe("pessoa");
    expect(lerModo("qualquer")).toBe("pessoa");
  });
});

describe("resumo por pessoa", () => {
  const linhas = [
    linha({ usuario: ANA, dia: "2026-10-08" }),
    linha({ usuario: ANA, dia: "2026-10-09", emUsoS: 1800, totalS: 3600, porInatividade: 1 }),
    // Dia em que só houve ação (sessão aberta na véspera): não é "dia com acesso".
    linha({ usuario: ANA, dia: "2026-10-07", acessos: 0, emUsoS: 0, totalS: 0, acoes: 2, consultas: 2, exportacoes: 0, cadastrou: 0, alterou: 0 }),
    linha({ usuario: BIA, dia: "2026-10-09", emUsoS: 60, totalS: 600, acoes: 1, consultas: 1, exportacoes: 0, cadastrou: 0, alterou: 0 }),
  ];

  it("soma o período de cada pessoa", () => {
    const [ana, bia] = resumirPorPessoa(linhas);
    expect(ana).toMatchObject({
      usuario: ANA,
      diasComAcesso: 2,
      acessos: 2,
      emUsoS: 5400,
      paradoS: 10800 + 1800,
      porInatividade: 1,
      acoes: 22,
      cadastrou: 4,
      alterou: 6,
      ultimoDia: "2026-10-09",
    });
    expect(bia.usuario).toBe(BIA);
    expect(bia.diasComAcesso).toBe(1);
  });

  it("quem mais usou vem primeiro", () => {
    expect(resumirPorPessoa(linhas).map((r) => r.usuario)).toEqual([ANA, BIA]);
  });

  it("quem tem acesso e não apareceu no período é listado à parte", () => {
    expect(semAtividade([ANA, BIA, CAIO], linhas)).toEqual([CAIO]);
    expect(semAtividade([ANA], linhas)).toEqual([]);
  });
});

describe("o modelo da planilha", () => {
  const base = {
    periodo: { de: "2026-10-03", ate: "2026-10-09", dias: 7, encurtado: false },
    quem: {
      nomes: new Map([[ANA, "Ana Recepção"], [BIA, "Bia Gerente"], [CAIO, "Caio Dentista"]]),
      codigos: new Map([[ANA, "RIS-000001"]]),
    },
    filtroPessoa: null,
    semAcesso: [CAIO],
    geradoPor: "Admin",
    geradoEm: "09/10/2026 17:40",
  };
  const linhas = [
    linha({ usuario: ANA, dia: "2026-10-08" }),
    linha({ usuario: BIA, dia: "2026-10-09", emUsoS: 90, totalS: 600 }),
  ];

  it("por pessoa: uma linha por pessoa, tempo em MINUTOS (número, para o Excel somar)", () => {
    const r = relatorioDeAtividade({ ...base, linhas, modo: "pessoa" });
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toMatchObject({
      pessoa: "Ana Recepção",
      codigo: "RIS-000001",
      diasComAcesso: 1,
      emUsoMin: 60,
      paradoMin: 180,
      ultimoDia: "2026-10-08",
    });
    expect(typeof r.linhas[0].emUsoMin).toBe("number");
    expect(r.nomeDoArquivo).toBe("atividade-por-pessoa-2026-10-03-a-2026-10-09");
  });

  it("dia a dia: uma linha por pessoa e dia, com a hora de entrada", () => {
    const r = relatorioDeAtividade({ ...base, linhas, modo: "dia" });
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas.find((l) => l.pessoa === "Ana Recepção")).toMatchObject({
      dia: "2026-10-08",
      pessoa: "Ana Recepção",
      entrou: "08:00",
      ultimaAtividade: "12:00",
      registros: 4,
    });
    expect(r.colunas.find((c) => c.chave === "dia")?.tipo).toBe("data");
    expect(r.nomeDoArquivo).toContain("dia-a-dia");
  });

  it("dia a dia: o dia mais recente primeiro; no mesmo dia, ordem alfabética", () => {
    const tres = [
      linha({ usuario: BIA, dia: "2026-10-08" }),
      linha({ usuario: ANA, dia: "2026-10-08" }),
      linha({ usuario: BIA, dia: "2026-10-09" }),
    ];
    expect(ordenarDiaADia(tres, base.quem.nomes).map((l) => [l.dia, l.usuario])).toEqual([
      ["2026-10-09", BIA],
      ["2026-10-08", ANA],
      ["2026-10-08", BIA],
    ]);
    // A planilha sai na mesma ordem da tela.
    const r = relatorioDeAtividade({ ...base, linhas: tres, modo: "dia" });
    expect(r.linhas.map((l) => [l.dia, l.pessoa])).toEqual([
      ["2026-10-09", "Bia Gerente"],
      ["2026-10-08", "Ana Recepção"],
      ["2026-10-08", "Bia Gerente"],
    ]);
  });

  it("a linha de TOTAL soma o que foi listado", () => {
    const r = relatorioDeAtividade({ ...base, linhas, modo: "dia" });
    const t = totaisDoRelatorio(r);
    expect(t.acessos).toBe(2);
    expect(t.emUsoMin).toBe(60 + 2); // 90 s arredonda para 2 min
    expect(t.acoes).toBe(20);
    // Hora e código não entram em total nenhum.
    expect(t.entrou).toBeUndefined();
  });

  it("o cabeçalho diz o período, a pessoa e quem gerou", () => {
    const r = relatorioDeAtividade({ ...base, linhas, modo: "pessoa", filtroPessoa: "Ana Recepção" });
    const meta = Object.fromEntries(r.metadados.map((m) => [m.rotulo, m.valor]));
    expect(meta["Período"]).toBe("03/10/2026 a 09/10/2026 (7 dias)");
    expect(meta["Pessoa"]).toBe("Ana Recepção");
    expect(meta["Gerado por"]).toBe("Admin");
  });

  it("as notas declaram os limites — e quem não acessou", () => {
    const r = relatorioDeAtividade({ ...base, linhas, modo: "pessoa" });
    const notas = r.notas.join(" | ");
    expect(notas).toContain("última atividade");
    expect(notas).toContain("09/10/2026");
    expect(notas).toContain("SEM nenhum acesso no período (1): Caio Dentista");
  });

  it("período encurtado é dito na PRIMEIRA nota", () => {
    const r = relatorioDeAtividade({
      ...base,
      linhas,
      modo: "pessoa",
      periodo: { ...base.periodo, encurtado: true },
    });
    expect(r.notas[0]).toContain(`${MAXIMO_DE_DIAS} dias mais recentes`);
  });

  it("pessoa que não existe mais aparece como 'Usuário removido', não some", () => {
    const r = relatorioDeAtividade({
      ...base,
      linhas: [linha({ usuario: "99999999-9999-4999-8999-999999999999" })],
      modo: "pessoa",
    });
    expect(r.linhas[0].pessoa).toBe("Usuário removido");
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS
// ---------------------------------------------------------------------------

describe("RÉGUA: o relatório de atividade é só do Admin Master, e exportar fica registrado", () => {
  const sql = semComentarios(ler("supabase/migrations/0289_relatorio_de_atividade.sql"));
  const dados = ler("src/app/(app)/admin/auditoria/relatorio-dados.ts");
  const rota = ler("src/app/(app)/admin/auditoria/exportar/route.ts");
  const tela = ler("src/app/(app)/admin/auditoria/visao-relatorio.tsx");

  it("a régua achou o que medir", () => {
    expect(sql).toContain("function public.audit_activity_report(");
    expect(dados.length).toBeGreaterThan(500);
    expect(rota.length).toBeGreaterThan(500);
  });

  it("no banco: sem ser Admin Master, a função devolve vazio; sem login, nem responde", () => {
    expect(sql).toMatch(/where\s+public\.is_admin_master\(\)/);
    expect(sql).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.audit_activity_report\(date,\s*date,\s*uuid\)\s+from\s+public,\s*anon,\s*authenticated/i
    );
    // As três trilhas passam pelo mesmo portão (`lim`): nenhuma é lida por fora.
    for (const tabela of ["access_sessions", "audit_logs", "audit_changes"]) {
      expect(sql).toMatch(new RegExp(`from public\\.${tabela} \\w+\\s+cross join lim`));
    }
  });

  it("no banco: o dia é o dia BRASILEIRO nas duas trilhas que guardam instante", () => {
    expect(sql.match(/at time zone 'America\/Sao_Paulo'\)::date/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("no servidor: a guarda vem ANTES de qualquer leitura", () => {
    const guarda = dados.indexOf("await requireAdminMaster()");
    const leitura = dados.search(/createClient\(\)|\.from\(|\.rpc\(/);
    expect(guarda).toBeGreaterThan(0);
    expect(leitura).toBeGreaterThan(guarda);
  });

  it("a pessoa vinda da URL só vai ao banco se existir", () => {
    expect(dados).toMatch(/quem\.nomes\.has\(pedido\)\s*\?\s*pedido\s*:\s*""/);
  });

  it("a planilha lê do MESMO carregador da tela", () => {
    expect(rota).toContain("carregarRelatorioDeAtividade(");
    expect(tela).toContain("carregarRelatorioDeAtividade(");
    // A rota não lê o banco por conta própria.
    expect(rota).not.toMatch(/createClient|\.from\(|\.rpc\(/);
  });

  it("exportar grava na trilha — e o tipo tem nome em português", () => {
    expect(rota).toMatch(/await logAudit\(\{[\s\S]*?action:\s*"export"[\s\S]*?entityType:\s*"audit_activity_report"/);
    expect(auditEntityLabel("audit_activity_report")).not.toBe("audit_activity_report");
    // Registra antes de entregar o arquivo.
    expect(rota.indexOf("await logAudit(")).toBeLessThan(rota.indexOf("planilhaDoRelatorio(relatorio)"));
  });

  it("⚠️ a tela chama a exportação por <a>, nunca por <Link> (o Next pré-carregaria e registraria exportação que ninguém pediu)", () => {
    // Só o código: o comentário que explica a regra cita "<Link>" de propósito.
    const codigo = tela
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(codigo).toMatch(/<a\s+href=\{planilha\}/);
    expect(codigo).not.toMatch(/<Link[^>]*href=\{planilha\}/);
    expect(codigo).not.toMatch(/<Link[\s\S]{0,200}?\/admin\/auditoria\/exportar/);
  });

  it("banco sem a 0289: a tela avisa e a rota responde 503 — nunca planilha vazia", () => {
    expect(tela).toContain("falta rodar a");
    expect(rota).toMatch(/if \(!carga\.linhas\)[\s\S]{0,300}status:\s*503/);
  });
});
