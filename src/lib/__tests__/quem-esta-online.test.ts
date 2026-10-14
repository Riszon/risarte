import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NOME_DA_TELA,
  NOME_NA_ADMINISTRACAO,
  detalheDaPessoa,
  haQuanto,
  horaDe,
  lerPresenca,
  lerResumo,
  nomeDaTela,
  porSituacao,
  rotuloDasFuncoes,
  telaParaRegistrar,
  type PessoaNaPresenca,
} from "@/lib/quem-esta-online";

// QUEM ESTÁ ONLINE (0291, pedido do dono em 13/10/2026): a barra de cima e a
// Auditoria mostram ao Admin Master quem está com o sistema aberto, em qual
// tela, desde que horas — e quem ainda não entrou hoje.

/** A regra que o BANCO aplica à tela informada (`access_session_screen`). */
const REGRA_DO_BANCO = /^[a-z][a-z-]{0,39}(\/[a-z][a-z-]{0,39})?$/;

describe("em qual tela a pessoa está — vai o MÓDULO, nunca o endereço", () => {
  it("o identificador do paciente NUNCA sai do navegador", () => {
    expect(telaParaRegistrar("/prontuarios/8c0c8d32-4dd3-47f2-9072-1b21e36bc5af")).toBe(
      "prontuarios"
    );
    expect(telaParaRegistrar("/clientes/12345/editar")).toBe("clientes");
    expect(telaParaRegistrar("/planejamento/8c0c8d32-4dd3-47f2-9072-1b21e36bc5af")).toBe(
      "planejamento"
    );
    // Código de documento (maiúsculas e números) também fica de fora.
    expect(telaParaRegistrar("/problemas/OC-00083")).toBe("problemas");
  });

  it("o que vem DEPOIS de um identificador também fica de fora", () => {
    // "/empresarial/<id>/boas-vindas": não vira "empresarial/boas-vindas".
    expect(
      telaParaRegistrar("/empresarial/8c0c8d32-4dd3-47f2-9072-1b21e36bc5af/boas-vindas")
    ).toBe("empresarial");
  });

  it("no máximo dois pedaços, sem a parte depois do '?'", () => {
    expect(telaParaRegistrar("/admin/auditoria?visao=online&colaborador=abc")).toBe(
      "admin/auditoria"
    );
    expect(telaParaRegistrar("/empresarial/funil/painel")).toBe("empresarial/funil");
    expect(telaParaRegistrar("/financeiro#topo")).toBe("financeiro");
  });

  it("a página inicial tem nome; o que não é endereço não vira tela", () => {
    expect(telaParaRegistrar("/")).toBe("inicio");
    expect(telaParaRegistrar("agenda")).toBeNull();
    expect(telaParaRegistrar("")).toBeNull();
    expect(telaParaRegistrar(null)).toBeNull();
    expect(telaParaRegistrar("/Agenda")).toBeNull();
    expect(telaParaRegistrar("/123")).toBeNull();
  });

  it("TUDO o que esta função devolve passa na regra do banco — e nada tem número", () => {
    const enderecos = [
      "/",
      "/agenda",
      "/admin/auditoria",
      "/prontuarios/8c0c8d32-4dd3-47f2-9072-1b21e36bc5af",
      "/empresarial/funil/3064dce8-4e1e-4678-974d-7b6e67dfe526/contrato",
      "/financeiro/contas-a-pagar/nova",
      "/indica-mais-risos/equipe/apuracao/77",
      "/ppr/adesoes/5/contrato",
      "/risartanos/RIS-00012",
    ];
    for (const e of enderecos) {
      const tela = telaParaRegistrar(e);
      expect(tela, e).not.toBeNull();
      expect(tela!, e).toMatch(REGRA_DO_BANCO);
      expect(tela!, e).not.toMatch(/\d/);
    }
  });
});

describe("o nome de cada tela", () => {
  it("usa o nome do menu, e detalha a Administração", () => {
    expect(nomeDaTela("agenda")).toBe("Agenda");
    expect(nomeDaTela("inicio")).toBe("Início");
    expect(nomeDaTela("admin/auditoria")).toBe("Administração › Auditoria");
    expect(nomeDaTela("admin")).toBe("Administração");
    // Fora da Administração, o segundo pedaço não muda o nome.
    expect(nomeDaTela("financeiro/contas-a-pagar")).toBe("Financeiro");
    expect(nomeDaTela("empresarial/funil")).toBe("Empresarial");
  });

  it("tela DESCONHECIDA vira 'Outra tela' — nunca o texto gravado", () => {
    expect(nomeDaTela("modulo-que-nao-existe")).toBe("Outra tela");
    expect(nomeDaTela("admin/tela-nova")).toBe("Administração");
    expect(nomeDaTela(null)).toBeNull();
    expect(nomeDaTela("")).toBeNull();
  });

  const pastas = (dir: string) =>
    readdirSync(join(process.cwd(), dir), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      // Pastas de rota dinâmica e de agrupamento não são telas com nome.
      .filter((n) => !n.startsWith("[") && !n.startsWith("(") && !n.startsWith("_"));

  it("TODA tela do sistema tem nome (tela nova sem nome apareceria como 'Outra tela')", () => {
    const telas = pastas("src/app/(app)");
    // Zero pastas seria ausência de medição, não "todas têm nome".
    expect(telas.length).toBeGreaterThan(20);
    expect(telas.filter((t) => !NOME_DA_TELA[t])).toEqual([]);
  });

  it("TODA tela da Administração tem nome", () => {
    const telas = pastas("src/app/(app)/admin");
    expect(telas.length).toBeGreaterThan(8);
    expect(telas.filter((t) => !NOME_NA_ADMINISTRACAO[t])).toEqual([]);
  });
});

const linha = {
  user_id: "u1",
  full_name: "Ana de Teste",
  is_admin_master: false,
  roles: [
    { c: "c1", n: "Cambé", r: "receptionist" },
    { c: "c2", n: "Londrina", r: "receptionist" },
  ],
  status: "online",
  connected_since: "2026-10-13T16:30:00Z",
  first_today_at: "2026-10-13T11:12:00Z",
  last_activity_at: "2026-10-13T17:58:00Z",
  left_at: null,
  current_screen: "agenda",
  open_sessions: 1,
  idle_limit_min: 60,
};

describe("ler a resposta do banco", () => {
  it("lê cada linha com as funções e a tela", () => {
    const [p] = lerPresenca([linha])!;
    expect(p).toEqual({
      id: "u1",
      nome: "Ana de Teste",
      admin: false,
      funcoes: [
        { unidade: "Cambé", funcao: "receptionist" },
        { unidade: "Londrina", funcao: "receptionist" },
      ],
      situacao: "online",
      conectadoDesde: "2026-10-13T16:30:00Z",
      primeiraEntrada: "2026-10-13T11:12:00Z",
      ultimaAtividade: "2026-10-13T17:58:00Z",
      saiuEm: null,
      tela: "agenda",
      acessosAbertos: 1,
      limiteMin: 60,
    });
  });

  it("resposta que não é lista devolve NULO — 'não li' não é 'ninguém online'", () => {
    expect(lerPresenca(null)).toBeNull();
    expect(lerPresenca({ erro: "x" })).toBeNull();
    expect(lerPresenca(undefined)).toBeNull();
    // Lista vazia é resposta de verdade: ninguém.
    expect(lerPresenca([])).toEqual([]);
  });

  it("situação DESCONHECIDA é descartada — não vira 'online' por omissão", () => {
    const lidas = lerPresenca([
      linha,
      { ...linha, user_id: "u2", status: "voando" },
      { ...linha, user_id: "u3", status: null },
      { ...linha, user_id: null },
      "texto solto",
    ])!;
    expect(lidas.map((p) => p.id)).toEqual(["u1"]);
  });

  it("o resumo só vale completo", () => {
    expect(lerResumo({ online: 3, ausentes: 1, sairam: 5, nao_entraram: 12 })).toEqual({
      online: 3,
      ausentes: 1,
      sairam: 5,
      naoEntraram: 12,
    });
    // Nulo (não é Admin, ou a função ainda não existe) e resposta pela metade.
    expect(lerResumo(null)).toBeNull();
    expect(lerResumo({ online: 3 })).toBeNull();
    expect(lerResumo({ online: -1, ausentes: 0, sairam: 0, nao_entraram: 0 })).toBeNull();
    expect(lerResumo({ online: "3", ausentes: 0, sairam: 0, nao_entraram: 0 })).toBeNull();
  });

  it("separa as pessoas pelos quatro grupos", () => {
    const pessoas = lerPresenca([
      linha,
      { ...linha, user_id: "u2", status: "ausente" },
      { ...linha, user_id: "u3", status: "saiu" },
      { ...linha, user_id: "u4", status: "nao_entrou" },
      { ...linha, user_id: "u5", status: "online" },
    ])!;
    const g = porSituacao(pessoas);
    expect(g.online.map((p) => p.id)).toEqual(["u1", "u5"]);
    expect(g.ausente.map((p) => p.id)).toEqual(["u2"]);
    expect(g.saiu.map((p) => p.id)).toEqual(["u3"]);
    expect(g.nao_entrou.map((p) => p.id)).toEqual(["u4"]);
  });
});

const pessoa = (extra: Partial<PessoaNaPresenca> = {}): PessoaNaPresenca => ({
  ...lerPresenca([linha])![0],
  ...extra,
});

describe("as frases", () => {
  const agora = new Date("2026-10-13T18:00:00Z").getTime();

  it("funções: uma por unidade, com o Admin Master na frente", () => {
    expect(rotuloDasFuncoes(pessoa())).toBe(
      "Recepcionista · Cambé; Recepcionista · Londrina"
    );
    expect(rotuloDasFuncoes(pessoa({ admin: true, funcoes: [] }))).toBe("Admin Master");
    expect(rotuloDasFuncoes(pessoa({ funcoes: [] }))).toBe("sem função cadastrada");
    // Função que o código não conhece aparece com o nome técnico, à vista.
    expect(
      rotuloDasFuncoes(pessoa({ funcoes: [{ unidade: null, funcao: "funcao_nova" }] }))
    ).toBe("funcao_nova");
    // A mesma função duas vezes na mesma unidade não se repete.
    expect(
      rotuloDasFuncoes(
        pessoa({
          funcoes: [
            { unidade: "Cambé", funcao: "dentist" },
            { unidade: "Cambé", funcao: "dentist" },
          ],
        })
      )
    ).toBe("Dentista · Cambé");
  });

  it("a hora é a de Brasília, não a do servidor", () => {
    expect(horaDe("2026-10-13T11:12:00Z")).toBe("08:12");
    expect(horaDe("2026-10-14T02:30:00Z")).toBe("23:30");
    expect(horaDe(null)).toBeNull();
    expect(horaDe("isso não é data")).toBeNull();
  });

  it("'há quanto tempo' — nunca negativo, nunca inventado", () => {
    expect(haQuanto("2026-10-13T17:59:40Z", agora)).toBe("agora");
    expect(haQuanto("2026-10-13T17:57:00Z", agora)).toBe("há 3 min");
    expect(haQuanto("2026-10-13T16:55:00Z", agora)).toBe("há 1h 05min");
    expect(haQuanto("2026-10-13T16:00:00Z", agora)).toBe("há 2h");
    // Relógio do navegador atrasado em relação ao do banco: "agora", não "-2 min".
    expect(haQuanto("2026-10-13T18:02:00Z", agora)).toBe("agora");
    expect(haQuanto(null, agora)).toBeNull();
    expect(haQuanto("xx", agora)).toBeNull();
  });

  it("conectado: hora de entrada, primeira entrada do dia e última atividade", () => {
    expect(detalheDaPessoa(pessoa(), agora)).toBe(
      "entrou às 13:30 · primeira entrada às 08:12 · última atividade há 2 min"
    );
    // Quem entrou uma vez só não repete a mesma hora duas vezes.
    expect(
      detalheDaPessoa(
        pessoa({ primeiraEntrada: "2026-10-13T16:30:00Z", ultimaAtividade: "2026-10-13T17:59:50Z" }),
        agora
      )
    ).toBe("entrou às 13:30 · mexeu agora");
    expect(detalheDaPessoa(pessoa({ acessosAbertos: 2 }), agora)).toContain(
      "2 acessos abertos"
    );
  });

  it("quem saiu diz até quando esteve; quem não entrou não ganha hora nenhuma", () => {
    expect(
      detalheDaPessoa(
        pessoa({ situacao: "saiu", conectadoDesde: null, saiuEm: "2026-10-13T15:00:00Z" }),
        agora
      )
    ).toBe("entrou às 08:12 · esteve até 12:00");
    const naoEntrou = detalheDaPessoa(
      pessoa({
        situacao: "nao_entrou",
        conectadoDesde: null,
        primeiraEntrada: null,
        ultimaAtividade: null,
      }),
      agora
    );
    expect(naoEntrou).toBe("ainda não entrou hoje");
    expect(naoEntrou).not.toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — leem a migração e as telas. Cada uma foi provada quebrando o
// código de propósito (régua nova só vale depois de reprovar uma vez).
// ---------------------------------------------------------------------------

const ler = (caminho: string) => {
  const texto = readFileSync(join(process.cwd(), caminho), "utf8").replace(/\r\n/g, "\n");
  if (texto.length < 200) throw new Error(`${caminho}: vazio ou curto demais`);
  return texto;
};
const MIGRACAO = ler("supabase/migrations/0291_quem_esta_online.sql");
/** O corpo de uma função da migração, do `create` até o `$$;` que a fecha. */
const corpo = (nome: string) => {
  const i = MIGRACAO.search(new RegExp(`create (or replace )?function public\\.${nome}\\(`));
  if (i < 0) throw new Error(`não achei a função ${nome} na migração`);
  const f = MIGRACAO.indexOf("$$;", i);
  if (f < 0) throw new Error(`não achei o fim da função ${nome}`);
  return MIGRACAO.slice(i, f);
};

describe("réguas de quem está online", () => {
  it("SÓ O ADMIN MASTER recebe a lista e o resumo — a guarda está no banco", () => {
    // Na lista, tudo depende de `hoje`, e `hoje` só existe para o Admin.
    expect(corpo("presence_now")).toMatch(
      /with hoje as \(\s*select public\.today_br\(\) as dia\s*where public\.is_admin_master\(\)\s*\)/
    );
    expect(corpo("presence_summary")).toContain("when public.is_admin_master() then");
  });

  it("as três funções são fechadas para quem não está logado", () => {
    for (const assinatura of [
      "public.access_session_screen(text)",
      "public.presence_now(text)",
      "public.presence_summary()",
    ]) {
      expect(MIGRACAO, assinatura).toContain(
        `revoke execute on function ${assinatura}\n  from public, anon, authenticated;`
      );
      expect(MIGRACAO, assinatura).toContain(
        `grant execute on function ${assinatura} to authenticated;`
      );
    }
  });

  it("o banco aplica à tela a MESMA regra que o navegador", () => {
    expect(corpo("access_session_screen")).toContain(
      "'^[a-z][a-z-]{0,39}(/[a-z][a-z-]{0,39})?$'"
    );
  });

  it("informar a tela NÃO conta como atividade (não renova o tempo de ninguém)", () => {
    const f = corpo("access_session_screen");
    expect(f).toContain("set current_screen = v_tela");
    expect(f).not.toContain("last_activity_at");
    expect(f).not.toContain("active_seconds");
  });

  it("o sinal de ATIVIDADE não mudou: a tela vai numa chamada à parte", () => {
    const monitor = ler("src/components/monitor-de-sessao.tsx");
    // Se o sinal passasse a pedir a tela, ele falharia até a 0291 rodar — e
    // todo mundo cairia por inatividade trabalhando.
    expect(monitor).toContain('.rpc("access_session_touch", { p_gravando: gravando })');
    expect(monitor).toContain('.rpc("access_session_screen", { p_tela: tela })');
    expect(monitor).toContain("const tela = telaParaRegistrar(caminho);");
  });

  it("a barra de cima só desenha o item para o Admin Master", () => {
    const barra = ler("src/components/topbar.tsx");
    expect(barra).toContain("{isAdminMaster && !modoPortal && <QuemEstaOnline />}");
    expect(barra.split("<QuemEstaOnline").length - 1).toBe(1);
  });

  it("o número da barra vem de consulta própria, e sem resposta NÃO desenha nada", () => {
    const item = ler("src/components/quem-esta-online.tsx");
    expect(item).toContain('.rpc("presence_summary")');
    expect(item).toContain("if (!resumo) return null;");
    // Lista que não veio não vira "ninguém online".
    expect(item).toContain("if (lidas === null) {");
    expect(item).not.toMatch(/pessoas\?\.length\s*\?\?\s*0/);
  });

  it("a Auditoria lê a lista INTEIRA, em páginas (a API corta em 1.000)", () => {
    const visao = ler("src/app/(app)/admin/auditoria/visao-online.tsx");
    expect(visao).toContain("lerTodasAsPaginas<unknown>((de, ate) =>");
    expect(visao).toContain('.rpc("presence_now", { p_grupo: null }).range(de, ate)');
    // E a ordem do banco é estável, senão as páginas se embaralham.
    expect(corpo("presence_now")).toMatch(/lower\(l\.full_name\),\s*l\.user_id;?\s*$/);
  });

  it("sem conseguir ler, a Auditoria DIZ — não mostra quatro zeros", () => {
    const visao = ler("src/app/(app)/admin/auditoria/visao-online.tsx");
    expect(visao).toContain("if (pessoas === null) {");
    expect(visao).toContain("if (!resumo) return null;");
  });

  it("online = 5 minutos, e só o acesso de HOJE e ainda dentro do limite conta", () => {
    const f = corpo("presence_now");
    expect(f).toContain("now() - p.ultima_viva <= interval '5 minutes' then 'online'");
    expect(f).toContain("where a.access_day = h.dia");
    expect(f).toContain("now() - a.last_activity_at <= make_interval(mins => q.limite + 2)");
    // Só quem tem acesso ativo entra na lista (inclusive em "não entrou hoje").
    expect(f).toContain("where p.is_active");
  });

  it("a migração não cria tabela nem apaga nada", () => {
    const semComentario = MIGRACAO.replace(/--.*$/gm, "");
    expect(semComentario).not.toMatch(/\b(create table|drop table|delete from|truncate)\b/i);
  });
});
