import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FUNCAO_ADMIN,
  FUNCOES_DO_FILTRO,
  LIMITES,
  degrau,
  diasSemEntrar,
  eventosDe,
  gradeDeHoras,
  lerFuncao,
  lerPeriodoDoPainel,
  lerPessoasDoPainel,
  lerUnidade,
  pontosDeAtencao,
  porFuncao,
  porUnidade,
  rankings,
  resumoDoPainel,
  rotuloDaFuncao,
  serieDiaria,
  ultimaEntrada,
  variacao,
  type PessoaDoPainel,
} from "@/lib/auditoria-painel";
import { lerTodasAsPaginas } from "@/lib/paginar";
import { USER_ROLES } from "@/lib/roles";

// 0290 (dono, 13/10/2026): "criar um dashboard na auditoria com ranking de quem
// mais acessou o sistema, quem mais ficou logado, quem mais teve atividades,
// quem menos interagiu, quem menos logou, quem está há mais tempo sem logar.
// [...] que seja inteligente e úteis as informações." — e os filtros por
// unidade e por função.

const ler = (arq: string) => readFileSync(arq, "utf8").replace(/\r\n/g, "\n");
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const HOJE = "2026-10-13";
const P30 = { de: "2026-09-14", ate: HOJE, dias: 30 as const };
const CAMBE = "c0000000-0000-4000-8000-000000000001";
const LONDRINA = "c0000000-0000-4000-8000-000000000002";

let n = 0;
function pessoa(parcial: Partial<PessoaDoPainel>): PessoaDoPainel {
  n++;
  return {
    usuario: `u${String(n).padStart(3, "0")}`,
    ativa: true,
    admin: false,
    criadaEm: "2026-08-01T12:00:00Z",
    ultimoLogin: "2026-10-13T12:00:00Z",
    primeiroAcesso: "2026-10-09T12:00:00Z",
    ultimoAcesso: "2026-10-13T12:00:00Z",
    ultimaAtividade: "2026-10-13T13:00:00Z",
    funcoes: [{ unidade: CAMBE, funcao: "receptionist" }],
    diasComAcesso: 5,
    acessos: 6,
    emUsoS: 3600,
    totalS: 7200,
    porInatividade: 0,
    acoes: 40,
    consultas: 30,
    exportacoes: 0,
    cadastrou: 5,
    alterou: 5,
    excluiu: 0,
    antDias: 5,
    antEmUsoS: 3600,
    antEventos: 50,
    ...parcial,
  };
}

describe("ler o que o banco devolve", () => {
  const linha = {
    user_id: "u1",
    is_active: true,
    is_admin_master: false,
    created_at: "2026-08-01T12:00:00Z",
    last_sign_in_at: null,
    first_access_at: null,
    last_access_at: null,
    last_activity_at: null,
    roles: [{ c: CAMBE, r: "dentist" }, { c: null, r: "x" }, "lixo"],
    days_with_access: 3,
    sessions: "4",
    active_seconds: 100,
    total_seconds: 500,
    idle_logouts: 1,
    actions: 7,
    views: 5,
    exports: 1,
    inserts: 1,
    updates: 2,
    deletes: 0,
    prev_days_with_access: 2,
    prev_active_seconds: 50,
    prev_events: 9,
  };

  it("traduz as colunas, aceita número como texto e descarta função torta", () => {
    const [p] = lerPessoasDoPainel([linha])!;
    expect(p).toMatchObject({
      usuario: "u1",
      ativa: true,
      diasComAcesso: 3,
      acessos: 4,
      emUsoS: 100,
      totalS: 500,
      antEventos: 9,
      funcoes: [{ unidade: CAMBE, funcao: "dentist" }],
    });
    expect(eventosDe(p)).toBe(7 + 1 + 2 + 0);
  });

  it("⚠️ NÃO CONSEGUI LER é diferente de NINGUÉM", () => {
    expect(lerPessoasDoPainel([])).toEqual([]);
    expect(lerPessoasDoPainel(null)).toBeNull();
    expect(lerPessoasDoPainel({})).toBeNull();
    expect(lerPessoasDoPainel([{ is_active: true }])).toBeNull();
    expect(serieDiaria(null, P30)).toBeNull();
    expect(gradeDeHoras(undefined)).toBeNull();
    expect(gradeDeHoras([{ dow: 9, hour: 1, events: 1 }])).toBeNull();
  });
});

describe("quando a pessoa entrou pela última vez", () => {
  it("vale o mais recente entre o acesso registrado e o login com senha", () => {
    expect(ultimaEntrada({ ultimoAcesso: "2026-10-10T12:00:00Z", ultimoLogin: "2026-10-12T12:00:00Z" })).toBe("2026-10-12T12:00:00Z");
    expect(ultimaEntrada({ ultimoAcesso: "2026-10-13T12:00:00Z", ultimoLogin: "2026-10-12T12:00:00Z" })).toBe("2026-10-13T12:00:00Z");
    // Antes de 09/10/2026 só existe a data do login.
    expect(ultimaEntrada({ ultimoAcesso: null, ultimoLogin: "2026-09-01T12:00:00Z" })).toBe("2026-09-01T12:00:00Z");
    expect(ultimaEntrada({ ultimoAcesso: null, ultimoLogin: null })).toBeNull();
  });

  it("dias sem entrar são dias de CALENDÁRIO brasileiro; nunca entrou = nulo", () => {
    // 02:30 UTC do dia 13 é 23:30 do dia 12 aqui: 1 dia, não 0.
    expect(diasSemEntrar({ ultimoAcesso: "2026-10-13T02:30:00Z", ultimoLogin: null }, HOJE)).toBe(1);
    expect(diasSemEntrar({ ultimoAcesso: "2026-10-13T15:00:00Z", ultimoLogin: null }, HOJE)).toBe(0);
    expect(diasSemEntrar({ ultimoAcesso: null, ultimoLogin: "2026-09-13T15:00:00Z" }, HOJE)).toBe(30);
    expect(diasSemEntrar({ ultimoAcesso: null, ultimoLogin: null }, HOJE)).toBeNull();
  });
});

describe("período e filtros vindos da URL", () => {
  it("7, 30 ou 90 dias contando hoje; qualquer outra coisa vira 30", () => {
    expect(lerPeriodoDoPainel("7", HOJE)).toEqual({ de: "2026-10-07", ate: HOJE, dias: 7 });
    expect(lerPeriodoDoPainel("90", HOJE).de).toBe("2026-07-16");
    expect(lerPeriodoDoPainel("365", HOJE).dias).toBe(30);
    expect(lerPeriodoDoPainel(undefined, HOJE)).toEqual(P30);
  });

  it("função só vale se existir — o filtro tem todas as do cadastro + Admin Master", () => {
    expect(FUNCOES_DO_FILTRO).toHaveLength(USER_ROLES.length + 1);
    for (const r of USER_ROLES) expect(lerFuncao(r)).toBe(r);
    expect(lerFuncao(FUNCAO_ADMIN)).toBe(FUNCAO_ADMIN);
    expect(lerFuncao("'; drop table x; --")).toBe("");
    expect(lerFuncao(undefined)).toBe("");
    expect(rotuloDaFuncao("receptionist")).toBe("Recepcionista");
    expect(rotuloDaFuncao(FUNCAO_ADMIN)).toBe("Admin Master");
  });

  it("unidade só vale se for uma das conhecidas", () => {
    const conhecidas = new Map([[CAMBE, "Cambé"]]);
    expect(lerUnidade(CAMBE, conhecidas)).toBe(CAMBE);
    expect(lerUnidade(LONDRINA, conhecidas)).toBe("");
    expect(lerUnidade(["x"], conhecidas)).toBe("");
  });
});

describe("os números do alto", () => {
  it("variação contra o período anterior; do zero não se calcula", () => {
    expect(variacao(150, 100)).toEqual({ porcento: 50, sentido: "subiu" });
    expect(variacao(50, 100)).toEqual({ porcento: -50, sentido: "caiu" });
    expect(variacao(100, 100)).toEqual({ porcento: 0, sentido: "igual" });
    // "Subiu 100%" a partir do nada não é informação.
    expect(variacao(10, 0)).toBeNull();
  });

  it("adesão olha quem TEM acesso; os totais somam todo mundo", () => {
    const r = resumoDoPainel([
      pessoa({}),
      pessoa({ diasComAcesso: 0, acessos: 0, emUsoS: 0, totalS: 0, acoes: 0, cadastrou: 0, alterou: 0, ultimoAcesso: null, ultimoLogin: null }),
      // Desativada no meio do período: usou o sistema, mas não entra na taxa.
      pessoa({ ativa: false, emUsoS: 600 }),
    ]);
    expect(r.ativas).toBe(2);
    expect(r.entraram).toBe(1);
    expect(r.adesao).toBe(50);
    expect(r.naoEntraram).toBe(1);
    expect(r.nuncaEntraram).toBe(1);
    expect(r.emUsoS).toBe(3600 + 600);
    expect(r.mediaDeDias).toBe(5);
  });

  it("⚠️ sem período anterior, NÃO mostra variação (não inventa uma alta)", () => {
    const sem = resumoDoPainel([pessoa({ antDias: 0, antEmUsoS: 0, antEventos: 0 })]);
    expect(sem.temAnterior).toBe(false);
    expect(sem.varPessoas).toBeNull();
    expect(sem.varEmUso).toBeNull();
    expect(sem.varEventos).toBeNull();
    const com = resumoDoPainel([pessoa({ antEmUsoS: 7200, antEventos: 100 })]);
    expect(com.temAnterior).toBe(true);
    expect(com.varEmUso).toEqual({ porcento: -50, sentido: "caiu" });
    expect(com.varEventos).toEqual({ porcento: -50, sentido: "caiu" });
  });

  it("ninguém ativo: adesão é 'não se aplica', não 0%", () => {
    expect(resumoDoPainel([]).adesao).toBeNull();
    expect(resumoDoPainel([]).mediaDeDias).toBeNull();
  });
});

describe("os seis rankings", () => {
  const ana = pessoa({ usuario: "ana", diasComAcesso: 20, acessos: 25, totalS: 90_000, emUsoS: 30_000, acoes: 500 });
  const bia = pessoa({ usuario: "bia", diasComAcesso: 10, acessos: 10, totalS: 200_000, emUsoS: 5_000, acoes: 50 });
  const caio = pessoa({ usuario: "caio", diasComAcesso: 2, acessos: 2, totalS: 600, emUsoS: 300, acoes: 0, cadastrou: 0, alterou: 0 });
  const dora = pessoa({
    usuario: "dora", diasComAcesso: 0, acessos: 0, totalS: 0, emUsoS: 0, acoes: 0, cadastrou: 0, alterou: 0,
    ultimoAcesso: null, ultimoLogin: "2026-09-13T15:00:00Z",
  });
  const enzo = pessoa({
    usuario: "enzo", diasComAcesso: 0, acessos: 0, totalS: 0, emUsoS: 0, acoes: 0, cadastrou: 0, alterou: 0,
    ultimoAcesso: null, ultimoLogin: null, criadaEm: "2026-09-01T12:00:00Z",
  });
  const fora = pessoa({ usuario: "fora", ativa: false, diasComAcesso: 1, acessos: 1, totalS: 60, emUsoS: 60, acoes: 1, cadastrou: 0, alterou: 0 });
  // Desativado e sumido há meses: não pode aparecer em "há mais tempo sem entrar".
  const velho = pessoa({
    usuario: "velho", ativa: false, diasComAcesso: 0, acessos: 0, totalS: 0, emUsoS: 0, acoes: 0, cadastrou: 0, alterou: 0,
    ultimoAcesso: null, ultimoLogin: "2026-06-01T15:00:00Z",
  });
  const todos = [caio, dora, ana, enzo, bia, fora, velho];
  const r = Object.fromEntries(rankings(todos, P30, HOJE).map((x) => [x.id, x]));
  const nomes = (id: string) => r[id].linhas.map((l) => l.usuario);

  it("quem mais acessou: por dias com acesso", () => {
    expect(nomes("mais_acessaram")).toEqual(["ana", "bia", "caio", "fora"]);
    expect(r.mais_acessaram.linhas[0].texto).toBe("20 de 30 dias");
  });

  it("quem ficou mais tempo conectado: por tempo com o sistema aberto, com o em uso ao lado", () => {
    expect(nomes("mais_tempo").slice(0, 2)).toEqual(["bia", "ana"]);
    expect(r.mais_tempo.linhas[0].nota).toContain("em uso");
    expect(r.mais_tempo.linhas[0].nota).toContain("parado");
  });

  it("quem mais teve atividade: ações + inclusões + alterações + exclusões", () => {
    expect(nomes("mais_ativos")).toEqual(["ana", "bia", "fora"]);
    expect(r.mais_ativos.linhas[0].valor).toBe(eventosDe(ana));
  });

  it("quem menos interagiu: só entre quem ENTROU e tem acesso ativo", () => {
    expect(nomes("menos_interagiram")).toEqual(["caio", "bia", "ana"]);
    // Quem não entrou está na lista certa para ele, não aqui.
    expect(nomes("menos_interagiram")).not.toContain("dora");
    expect(nomes("menos_interagiram")).not.toContain("fora");
  });

  it("quem menos acessou: só entre quem entrou ao menos uma vez", () => {
    expect(nomes("menos_acessaram")).toEqual(["caio", "bia", "ana"]);
  });

  it("há mais tempo sem entrar: nunca entrou vem PRIMEIRO; quem entrou hoje não aparece; desativado fora", () => {
    expect(nomes("sem_entrar")).toEqual(["enzo", "dora"]);
    expect(r.sem_entrar.linhas[0].texto).toBe("nunca entrou");
    expect(r.sem_entrar.linhas[0].nota).toBe("acesso criado em 01/09/2026");
    expect(r.sem_entrar.linhas[1].texto).toBe("há 30 dias");
    expect(r.sem_entrar.linhas[1].nota).toBe("última vez em 13/09/2026");
  });

  it("mostra só o topo e diz quantos disputam", () => {
    const muitos = Array.from({ length: 12 }, (_, i) => pessoa({ diasComAcesso: i + 1 }));
    const [primeiro] = rankings(muitos, P30, HOJE);
    expect(primeiro.linhas).toHaveLength(5);
    expect(primeiro.total).toBe(12);
    expect(primeiro.linhas[0].valor).toBe(12);
  });

  it("são exatamente os seis pedidos, nesta ordem", () => {
    expect(rankings([], P30, HOJE).map((x) => x.id)).toEqual([
      "mais_acessaram",
      "mais_tempo",
      "mais_ativos",
      "menos_interagiram",
      "menos_acessaram",
      "sem_entrar",
    ]);
  });
});

describe("o que merece atenção", () => {
  const ids = (ps: PessoaDoPainel[]) => pontosDeAtencao(ps, P30, HOJE).map((a) => a.id);

  it("gente em ordem e sem nada estranho: nenhum aviso", () => {
    expect(ids([pessoa({}), pessoa({})])).toEqual([]);
  });

  it("acesso criado e nunca usado é ALERTA — mas não no primeiro dia", () => {
    const nunca = { ultimoAcesso: null, ultimoLogin: null, diasComAcesso: 0, acessos: 0 };
    const [a] = pontosDeAtencao([pessoa({ ...nunca, criadaEm: "2026-09-01T12:00:00Z" })], P30, HOJE);
    expect(a.id).toBe("nunca_entraram");
    expect(a.nivel).toBe("alerta");
    expect(a.pessoas[0].detalhe).toBe("acesso criado há 42 dias");
    // Cadastro de ontem: ainda está recebendo os dados de acesso.
    expect(ids([pessoa({ ...nunca, criadaEm: "2026-10-12T12:00:00Z" })])).toEqual([]);
  });

  it("quem já usou e parou há 15 dias ou mais", () => {
    const sumiu = pessoa({ ultimoAcesso: null, ultimoLogin: "2026-09-20T12:00:00Z", diasComAcesso: 0 });
    expect(ids([sumiu])).toContain("sumidos");
    const recente = pessoa({ ultimoAcesso: "2026-10-01T12:00:00Z", ultimoLogin: null, diasComAcesso: 1 });
    expect(ids([recente])).not.toContain("sumidos");
  });

  it("queda de uso compara a pessoa com ELA MESMA — e ignora quem quase não usava", () => {
    expect(ids([pessoa({ acoes: 10, cadastrou: 0, alterou: 0, antEventos: 100 })])).toContain("queda_de_uso");
    // De 6 para 1: pouco demais para dizer que caiu.
    expect(ids([pessoa({ acoes: 1, cadastrou: 0, alterou: 0, antEventos: 6 })])).not.toContain("queda_de_uso");
    // Caiu, mas não pela metade.
    expect(ids([pessoa({ acoes: 60, cadastrou: 0, alterou: 0, antEventos: 100 })])).not.toContain("queda_de_uso");
  });

  it("deixa a tela aberta: desconectada por inatividade várias vezes", () => {
    expect(ids([pessoa({ porInatividade: LIMITES.quedasPorInatividade })])).toContain("tela_aberta");
    expect(ids([pessoa({ porInatividade: LIMITES.quedasPorInatividade - 1 })])).not.toContain("tela_aberta");
  });

  it("conectada por horas quase sem usar; entra e não registra nada", () => {
    expect(ids([pessoa({ totalS: 4 * 3600, emUsoS: 600 })])).toContain("conectado_sem_usar");
    expect(ids([pessoa({ totalS: 3600, emUsoS: 60 })])).not.toContain("conectado_sem_usar");
    expect(ids([pessoa({ diasComAcesso: 4, acoes: 0, cadastrou: 0, alterou: 0, antEventos: 0 })])).toContain("entra_e_nao_faz");
  });

  it("muitas exclusões e muitas exportações (o dado saindo do sistema)", () => {
    expect(ids([pessoa({ excluiu: 5 })])).toContain("muitas_exclusoes");
    expect(ids([pessoa({ exportacoes: 5 })])).toContain("muitas_exportacoes");
    expect(ids([pessoa({ excluiu: 4, exportacoes: 4 })])).toEqual([]);
  });

  it("o mais grave vem primeiro, e cada aviso diz quem e quanto", () => {
    const avisos = pontosDeAtencao(
      [
        pessoa({ exportacoes: 9 }),
        pessoa({ ultimoAcesso: null, ultimoLogin: null, diasComAcesso: 0, criadaEm: "2026-09-01T12:00:00Z" }),
        pessoa({ totalS: 5 * 3600, emUsoS: 60 }),
      ],
      P30,
      HOJE
    );
    expect(avisos.map((a) => a.nivel)).toEqual(["alerta", "aviso", "info"]);
    for (const a of avisos) {
      expect(a.pessoas.length).toBeGreaterThan(0);
      expect(a.texto.length).toBeGreaterThan(40);
    }
  });

  it("quem foi desativado não vira aviso de 'nunca entrou' nem de 'sumiu'", () => {
    expect(
      ids([pessoa({ ativa: false, ultimoAcesso: null, ultimoLogin: null, diasComAcesso: 0, criadaEm: "2026-01-01T12:00:00Z" })])
    ).toEqual([]);
  });
});

describe("por função e por unidade — a régua justa", () => {
  const gente = [
    pessoa({ funcoes: [{ unidade: CAMBE, funcao: "receptionist" }], diasComAcesso: 10, emUsoS: 6000, acoes: 100, cadastrou: 0, alterou: 0 }),
    pessoa({ funcoes: [{ unidade: CAMBE, funcao: "receptionist" }], diasComAcesso: 0, emUsoS: 0, acoes: 0, cadastrou: 0, alterou: 0 }),
    pessoa({
      funcoes: [{ unidade: CAMBE, funcao: "dentist" }, { unidade: LONDRINA, funcao: "dentist" }],
      diasComAcesso: 4, emUsoS: 600, acoes: 10, cadastrou: 0, alterou: 0,
    }),
    pessoa({ admin: true, funcoes: [], diasComAcesso: 20 }),
    pessoa({ ativa: false, funcoes: [{ unidade: CAMBE, funcao: "receptionist" }] }),
  ];

  it("por função: médias do grupo; quem não entrou puxa a média de dias, não a de uso", () => {
    const f = Object.fromEntries(porFuncao(gente).map((l) => [l.chave, l]));
    expect(f.receptionist).toMatchObject({
      pessoas: 2,
      entraram: 1,
      adesao: 50,
      mediaDeDias: 5,
      mediaEmUsoS: 6000,
      mediaDeEventos: 100,
    });
    // Duas unidades, mesma função: a pessoa conta UMA vez na função.
    expect(f.dentist.pessoas).toBe(1);
    expect(f[FUNCAO_ADMIN].pessoas).toBe(1);
  });

  it("por unidade: quem tem função em duas conta nas duas", () => {
    const u = Object.fromEntries(porUnidade(gente).map((l) => [l.chave, l]));
    expect(u[CAMBE].pessoas).toBe(3);
    expect(u[LONDRINA].pessoas).toBe(1);
    expect(u[LONDRINA].entraram).toBe(1);
  });

  it("grupo em que ninguém entrou não divide por zero", () => {
    const [g] = porFuncao([pessoa({ diasComAcesso: 0, emUsoS: 0, acoes: 0, cadastrou: 0, alterou: 0 })]);
    expect(g).toMatchObject({ entraram: 0, adesao: 0, mediaEmUsoS: 0, mediaDeEventos: 0 });
  });
});

describe("o dia a dia e o mapa de horas", () => {
  it("a série tem TODOS os dias do período, inclusive os vazios", () => {
    const s = serieDiaria(
      [{ day: "2026-10-09", people: 9, sessions: 12, active_seconds: 600, actions: 50, changes: 6 }],
      { de: "2026-10-07", ate: "2026-10-13" }
    )!;
    expect(s).toHaveLength(7);
    expect(s.map((d) => d.pessoas)).toEqual([0, 0, 9, 0, 0, 0, 0]);
    expect(s[2]).toMatchObject({ dia: "2026-10-09", acessos: 12, eventos: 56, semana: 5 });
    // 11/10/2026 é domingo.
    expect(s[4].semana).toBe(0);
  });

  it("o mapa acha o pico e mede o que acontece fora do expediente", () => {
    const g = gradeDeHoras([
      { dow: 1, hour: 10, events: 60, sessions: 3 },
      { dow: 1, hour: 18, events: 100, sessions: 1 },
      { dow: 0, hour: 22, events: 40, sessions: 0 },
      // Sábado às 10h: horário comercial, mas FIM DE SEMANA — conta como fora.
      { dow: 6, hour: 10, events: 50, sessions: 0 },
      { dow: 3, hour: 9, events: 0, sessions: 2 },
    ])!;
    expect(g.pico).toEqual({ semana: 1, hora: 18, eventos: 100 });
    expect(g.total).toBe(250);
    // Segunda às 10h é expediente; segunda às 18h também (7h–19h). Domingo à
    // noite e sábado de manhã, não: (40 + 50) de 250.
    expect(g.foraDoExpediente).toBe(36);
    expect(g.horaInicial).toBe(7);
    expect(g.horaFinal).toBe(22);
    expect(g.celulas[0][22]).toBe(40);
  });

  it("sem movimento: sem pico e sem percentual (não é 0%)", () => {
    const g = gradeDeHoras([])!;
    expect(g.pico).toBeNull();
    expect(g.foraDoExpediente).toBeNull();
    expect([g.horaInicial, g.horaFinal]).toEqual([7, 19]);
  });

  it("os cinco degraus do tom: vazio, e quatro faixas até o pico", () => {
    expect([0, 1, 26, 51, 76, 100].map((v) => degrau(v, 100))).toEqual([0, 1, 2, 3, 4, 4]);
    expect(degrau(5, 0)).toBe(0);
  });
});

describe("ler TUDO, não só as primeiras mil linhas", () => {
  const fonte = (total: number) => {
    const chamadas: [number, number][] = [];
    const buscar = async (de: number, ate: number) => {
      chamadas.push([de, ate]);
      return { data: Array.from({ length: Math.max(0, Math.min(ate + 1, total) - de) }, (_, i) => de + i), error: null };
    };
    return { buscar, chamadas };
  };

  it("⚠️ 2.500 linhas vêm inteiras, em três páginas", async () => {
    const { buscar, chamadas } = fonte(2500);
    const r = await lerTodasAsPaginas(buscar);
    expect(r.ok && r.linhas.length).toBe(2500);
    expect(r.ok && r.linhas[2499]).toBe(2499);
    expect(chamadas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("exatamente mil linhas: pergunta mais uma vez para saber que acabou", async () => {
    const { buscar, chamadas } = fonte(1000);
    const r = await lerTodasAsPaginas(buscar);
    expect(r.ok && r.linhas.length).toBe(1000);
    expect(chamadas).toHaveLength(2);
  });

  it("poucas linhas: uma chamada só", async () => {
    const { buscar, chamadas } = fonte(15);
    expect((await lerTodasAsPaginas(buscar)).ok).toBe(true);
    expect(chamadas).toHaveLength(1);
  });

  it("⚠️ erro na segunda página devolve ERRO — nunca a metade que deu para ler", async () => {
    let i = 0;
    const r = await lerTodasAsPaginas(async () =>
      i++ === 0
        ? { data: Array(1000).fill(1), error: null }
        : { data: null, error: { message: "caiu" } }
    );
    expect(r).toEqual({ ok: false, error: { message: "caiu" } });
  });

  it("fonte que nunca acaba é interrompida com erro (não trava a tela)", async () => {
    const r = await lerTodasAsPaginas(async () => ({ data: [1, 2], error: null }), 2);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS
// ---------------------------------------------------------------------------

describe("RÉGUA: o painel e os filtros são só do Admin Master, e a conta é uma só", () => {
  const sql = semComentarios(ler("supabase/migrations/0290_painel_de_uso_e_filtros.sql"));
  const corpo = (nome: string) => {
    const ini = sql.indexOf(`function public.${nome}(`);
    const fim = sql.indexOf("$$;", ini);
    return ini >= 0 && fim > ini ? sql.slice(ini, fim) : "";
  };
  const FUNCOES = ["audit_activity_report", "audit_usage_people", "audit_usage_days", "audit_usage_hours"];
  const dados = ler("src/app/(app)/admin/auditoria/relatorio-dados.ts");
  const painel = ler("src/app/(app)/admin/auditoria/visao-painel.tsx");
  const relatorio = ler("src/app/(app)/admin/auditoria/visao-relatorio.tsx");
  const acesso = ler("src/lib/acesso.ts");

  it("a régua achou as funções (senão não mediu nada)", () => {
    for (const f of [...FUNCOES, "audit_usage_members"]) expect(corpo(f).length).toBeGreaterThan(150);
  });

  it("toda função exige Admin Master e não responde a quem não está logado", () => {
    for (const f of [...FUNCOES, "audit_usage_members"]) {
      expect(corpo(f), f).toMatch(/public\.is_admin_master\(\)/);
      expect(sql, f).toMatch(
        new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${f}\\([^)]*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, "i")
      );
    }
  });

  it("quem entra no recorte é função INTERNA: não é liberada nem para logado", () => {
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.audit_usage_members/i);
    // E lê a TABELA de funções, não a janela que esconde unidade fechada.
    expect(corpo("audit_usage_members")).toContain("public.user_clinic_roles_all");
    expect(sql).not.toMatch(/public\.user_clinic_roles\b(?!_all)/);
  });

  it("⚠️ painel, dias e horas SOMAM o relatório — ninguém refaz a conta do acesso", () => {
    for (const f of ["audit_usage_people", "audit_usage_days"]) {
      expect(corpo(f), f).toContain("public.audit_activity_report(");
      // Quem soma o relatório não mede intervalo de tempo por conta própria.
      expect(corpo(f), f).not.toContain("extract(epoch");
    }
    // A conta do tempo aparece UMA vez no arquivo inteiro.
    expect(sql.match(/a\.end_reason = 'saiu'/g)).toHaveLength(1);
  });

  it("⚠️ a regra do tempo é a MESMA no banco e na tela: só o clique em Sair conta até o fim", () => {
    expect(corpo("audit_activity_report")).toMatch(
      /case when a\.end_reason = 'saiu' and a\.ended_at is not null then a\.ended_at else a\.last_activity_at end/
    );
    expect(acesso).toMatch(/a\.endReason === "saiu" && a\.endedAt \? a\.endedAt : a\.lastActivityAt/);
    // A regra antiga (até o encerramento, qualquer que fosse) não pode voltar.
    expect(corpo("audit_activity_report")).not.toMatch(/coalesce\(a\.ended_at, a\.last_activity_at\)/);
    expect(acesso).not.toMatch(/a\.endedAt \?\? a\.lastActivityAt/);
  });

  it("⚠️ o relatório lê EM PÁGINAS (a API corta em 1.000 linhas)", () => {
    expect(dados).toContain("lerTodasAsPaginas");
    expect(dados.match(/\.range\(de, ate\)/g)?.length).toBeGreaterThanOrEqual(2);
    // E a ordem do banco não empata: dia e pessoa.
    expect(corpo("audit_activity_report")).toMatch(/order by k\.day desc, k\.user_id/);
  });

  it("banco sem a 0290: o relatório sai sem os filtros novos e AVISA; o painel avisa", () => {
    expect(dados).toContain("filtrosIndisponiveis = true");
    expect(relatorio).toMatch(/carga\.filtrosIndisponiveis &&[\s\S]{0,400}falta rodar a migração 0290/);
    expect(painel).toMatch(/if \(!lista\)[\s\S]{0,400}migração\s+0290/);
  });

  it("unidade e função vindas da URL passam pela conferência antes de ir ao banco", () => {
    for (const arq of [dados, painel]) {
      expect(arq).toMatch(/lerUnidade\(/);
      expect(arq).toMatch(/lerFuncao\(/);
    }
  });

  it("o painel é a aba que abre, e a tela repete que tempo em uso não é produtividade", () => {
    const comum = ler("src/app/(app)/admin/auditoria/comum.ts");
    expect(comum).toMatch(/VISOES\.includes\(v as Visao\) \? \(v as Visao\) : "painel"/);
    expect(painel).toContain("Tempo em uso não é produtividade");
  });
});
