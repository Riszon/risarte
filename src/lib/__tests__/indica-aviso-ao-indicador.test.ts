import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTO_SEM_ETAPA_LABEL, rotuloDoEvento } from "@/lib/indica/status";

// Indica +Risos — 2009/2010 (itens 2 e 3 do plano aprovado em 03/11/2026):
//
//   * a mensagem ao Embaixador só traz o NOME do indicado com a autorização
//     dele vigente (E10 / decisão 20);
//   * o evento "agendada" entra na fila, com modelo sem data nem horário;
//   * o token do convite /c/<token> NÃO fica na fila (AP100): mora em
//     `indica.convites_tokens`, que só a chave de serviço lê;
//   * a tela traduz os eventos novos da linha do tempo.
//
// A régua lê a ÚLTIMA migração 2000+ que define cada função — a de hoje e as
// que vierem — e reprova a volta ao jeito antigo.
const DIR = "supabase/migrations";
const normalizar = (s: string) => s.replace(/\r\n/g, "\n");
const migracoes = readdirSync(DIR)
  .filter((f) => /^2\d{3}_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ nome: f, sql: normalizar(readFileSync(join(DIR, f), "utf8")) }));

/** O corpo (até o `$$;` final) da ÚLTIMA definição da função nas migrações 2000+. */
function ultimaDefinicao(funcao: string): { nome: string; corpo: string } {
  const assinatura = `create or replace function indica.${funcao}(`;
  const arquivo = migracoes.filter((m) => m.sql.includes(assinatura)).at(-1);
  if (!arquivo) throw new Error(`indica.${funcao} não encontrada nas migrações 2000+ — a régua não mediu nada`);
  const sql = arquivo.sql;
  const inicio = sql.lastIndexOf(assinatura);
  const fim = sql.indexOf("\n$$;", inicio);
  if (fim < 0) throw new Error(`não achei o fim de indica.${funcao} em ${arquivo.nome}`);
  return { nome: arquivo.nome, corpo: sql.slice(inicio, fim) };
}

describe("Indica +Risos — avisar quem indicou só com autorização (2009)", () => {
  const trigger = ultimaDefinicao("mensagens_dos_eventos");

  it("o gatilho cobre o evento 'agendada'", () => {
    const lista = trigger.corpo.match(/new\.status_para not in \(([^)]*)\)/);
    expect(lista, "lista de eventos do gatilho não encontrada").not.toBeNull();
    expect(lista![1]).toContain("'agendada'");
    expect(trigger.corpo).toContain("when 'agendada' then 'msg_agendou_embaixador'");
  });

  it("o nome do indicado depende da autorização VIGENTE (dada e não revogada)", () => {
    // A condição tem de estar na expressão que monta a variável {indicado}.
    const indicado = trigger.corpo.match(/'indicado',\s*case([\s\S]*?)end,/);
    expect(indicado, "expressão do {indicado} não encontrada").not.toBeNull();
    const expressao = indicado![1];
    expect(trigger.corpo).toContain("autoriza_avisar_indicador_em is not null");
    expect(trigger.corpo).toContain("autoriza_avisar_revogado_em is null");
    // O ramo que devolve o primeiro nome fora do "registrada" exige v_autorizado.
    const ramoComNome = expressao.match(/when new\.status_para <> 'registrada' and ([^\n]*)\n\s*then split_part/);
    expect(ramoComNome, "ramo com o nome (fora do registrada) não encontrado").not.toBeNull();
    expect(ramoComNome![1]).toContain("v_autorizado");
    expect(expressao).toContain("'a pessoa que você indicou'");
  });

  it("o modelo 'agendou' não traz data nem horário (kickoff 3.3)", () => {
    const m = migracoes.map((x) => x.sql).join("\n").match(/'msg_agendou_embaixador',\s*\n?\s*'"([^"]*)"'/);
    expect(m, "modelo msg_agendou_embaixador não encontrado").not.toBeNull();
    expect(m![1]).not.toMatch(/\{data\}|\{hora\}|\d/);
    expect(m![1]).toContain("{indicado}");
  });

  it("a tela traduz os eventos avulsos da linha do tempo", () => {
    const sql = migracoes.map((x) => x.sql).join("\n");
    const eventos = new Set([...sql.matchAll(/status_para[^;]*?'(\w+_aviso)'/g)].map((x) => x[1]));
    expect(eventos.size, "nenhum evento *_aviso gravado nas migrações").toBeGreaterThan(0);
    for (const e of eventos) expect(EVENTO_SEM_ETAPA_LABEL[e], e).toBeTruthy();
    expect(rotuloDoEvento("compareceu")).toBe("Compareceu");
    expect(rotuloDoEvento("autorizou_aviso")).not.toBe("autorizou_aviso");
  });

  it("a tela de Mensagens tem rótulo para todo evento que o gatilho enfileira", () => {
    const pagina = normalizar(readFileSync("src/app/(app)/indica-mais-risos/mensagens/page.tsx", "utf8"));
    const rotulos = pagina.match(/const EVENTO: Record<string, string> = \{([\s\S]*?)\};/);
    expect(rotulos, "tabela EVENTO da tela não encontrada").not.toBeNull();
    const lista = trigger.corpo.match(/new\.status_para not in \(([^)]*)\)/)![1];
    const eventos = [...lista.matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(eventos.length).toBeGreaterThan(3);
    for (const e of [...eventos, "convite", "a_vencer"]) {
      expect(rotulos![1], e).toMatch(new RegExp(`\\b${e}:`));
    }
  });
});

describe("Indica +Risos — o token do convite fora da fila (2010, AP100)", () => {
  it("_gerar_convite grava o token no cofre e deixa só '/c/' na fila", () => {
    const { corpo } = ultimaDefinicao("_gerar_convite");
    expect(corpo).toContain("insert into indica.convites_tokens");
    // O que vai para _enfileirar é o caminho fixo — nunca '/c/' || token.
    const chamada = corpo.match(/perform indica\._enfileirar\(([\s\S]*?)\);/);
    expect(chamada, "chamada de _enfileirar não encontrada").not.toBeNull();
    expect(chamada![1]).not.toMatch(/'\/c\/'\s*\|\|/);
    expect(chamada![1]).toMatch(/'\/c\/'\s*\)?\s*$/);
  });

  it("o cofre não tem política de leitura e só a chave de serviço o alcança", () => {
    const sql = migracoes.map((x) => x.sql).join("\n");
    expect(sql).toMatch(/create table if not exists indica\.convites_tokens/);
    expect(sql).not.toMatch(/create policy[^;]*on indica\.convites_tokens/i);
    expect(sql).toMatch(/revoke all on table indica\.convites_tokens from public, anon, authenticated/);
    expect(sql).toMatch(/grant all on table indica\.convites_tokens to service_role/);
    expect(sql).toMatch(/\(\s*'indica'\s*,\s*'convites_tokens'\s*,\s*'/);
  });

  it("link_do_convite só responde ao servidor", () => {
    const sql = migracoes.map((x) => x.sql).join("\n");
    const grants = [...sql.matchAll(/grant execute on function indica\.link_do_convite\([^)]*\) to ([^;]+);/g)].map((m) => m[1].trim());
    expect(grants.length, "nenhum grant de link_do_convite").toBeGreaterThan(0);
    for (const g of grants) expect(g).toBe("service_role");
    expect(sql).toMatch(/revoke execute on function indica\.link_do_convite\([^)]*\) from public, anon, authenticated/);
    const { corpo } = ultimaDefinicao("link_do_convite");
    expect(corpo).toContain("if auth.uid() is not null then");
    expect(corpo).toContain("insert into public.audit_logs");
  });

  it("a tela de Mensagens não monta o link do convite a partir da fila", () => {
    const pagina = normalizar(readFileSync("src/app/(app)/indica-mais-risos/mensagens/page.tsx", "utf8"));
    expect(pagina).toContain('m.evento === "convite"');
    expect(pagina).toMatch(/pedirLinkAoServidor=\{convite/);
    const acoes = normalizar(readFileSync("src/app/(app)/indica-mais-risos/mensagens/actions.ts", "utf8"));
    expect(acoes).toContain('rpc("link_do_convite"');
    expect(acoes).toContain("p_usuario: session.userId");
  });

  it("a rotina diária anonimiza a fila nos dois passos (AP101)", () => {
    const { corpo } = ultimaDefinicao("rotina_diaria");
    const chamadas = corpo.match(/perform indica\._anonimizar_fila\(r\.id\)/g) ?? [];
    expect(chamadas.length).toBe(2);
    const limpeza = ultimaDefinicao("_anonimizar_fila").corpo;
    for (const campo of ["nome = 'Anonimizado'", "telefone = ''", "texto = ''", "link_caminho = null"]) {
      expect(limpeza).toContain(campo);
    }
    expect(limpeza).toContain("delete from indica.convites_tokens where indicacao_id = p_indicacao_id");
  });
});
