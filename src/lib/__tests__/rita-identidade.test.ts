// Rita (assistente virtual), Fase 0A.1 — a identidade e a auditoria.
//
// O que esta régua prende (docs/sdr/PLANO-FASE-0A.md, DA2/DA3):
//   * a VERSÃO MAIS RECENTE de `public.audit_capture` (quem recriar a função
//     depois da 0365 tem de levar isto junto):
//       - lê `rita.actor` SÓ quando não há pessoa logada;
//       - só aceita o id se o perfil for `kind = 'agent'`;
//       - continua "nunca derruba a operação" (exception → raise warning);
//   * `rita.begin_as_agent()` fechada a quem loga e recusando pessoa logada;
//   * a trava do tipo do perfil (`profiles_kind_guard`);
//   * a tela traduz o autor "assistente".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quemFez } from "@/lib/auditoria-alteracoes";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** O corpo da ÚLTIMA definição de uma função, em qualquer migração. */
function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const abre = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${nome.replace(".", "\\.")}\\s*\\(`, "i");
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const f of arquivos) {
    const sql = ler(f);
    const m = abre.exec(sql);
    if (!m) continue;
    const resto = sql.slice(m.index);
    const ini = resto.indexOf("$$");
    const fim = resto.indexOf("$$", ini + 2);
    achado = { arquivo: f, corpo: resto.slice(0, fim + 2) };
  }
  // Régua que não acha o que medir grita (§0d do CLAUDE.md).
  if (!achado) throw new Error(`NÃO MEDI: nenhuma definição de ${nome}`);
  return achado;
}

describe("Rita 0A.1 — a auditoria reconhece a assistente", () => {
  const { arquivo, corpo } = ultimaDefinicao("public.audit_capture");

  it("a versão mais nova da audit_capture é a 0365 ou posterior", () => {
    expect(Number(arquivo.slice(0, 4))).toBeGreaterThanOrEqual(365);
  });

  it("lê rita.actor só sem pessoa logada, e só aceita perfil 'agent'", () => {
    const bloco = corpo.slice(corpo.indexOf("if v_uid is null then"));
    expect(bloco).toContain("current_setting('rita.actor', true)");
    expect(bloco.indexOf("current_setting('rita.actor'")).toBeLessThan(bloco.indexOf("end if;"));
    expect(bloco).toMatch(/p\.kind\s*=\s*'agent'/);
    expect(bloco).toContain("v_actor := 'assistente'");
  });

  it("a auditoria continua sem derrubar a operação", () => {
    expect(corpo).toMatch(/exception\s+when\s+others\s+then\s+[\s\S]*raise\s+warning/);
  });

  it("o banco aceita o autor 'assistente'", () => {
    const sql = ler("0365_auditoria_reconhece_a_assistente.sql");
    expect(sql).toMatch(/check\s*\(actor in \('usuario', 'servico', 'sistema', 'assistente'\)\)/);
  });
});

describe("Rita 0A.1 — quem fala pela Rita", () => {
  const sql = ler("3000_rita_schema_e_identidade.sql");

  it("begin_as_agent e agent_id fechadas a quem loga, abertas à chave de serviço", () => {
    for (const fn of ["rita.begin_as_agent()", "rita.agent_id()"]) {
      expect(sql).toContain(`revoke execute on function ${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant execute on function ${fn.replace(/[.()]/g, "\\$&")} to [^;]*authenticated`));
    }
    expect(sql).not.toMatch(/grant\s+usage\s+on\s+schema\s+rita\s+to\s+[^;]*(anon|authenticated)/i);
  });

  it("pessoa logada nunca declara a Rita (segunda barreira)", () => {
    const { corpo } = ultimaDefinicao("rita.begin_as_agent");
    expect(corpo).toMatch(/if\s+auth\.uid\(\)\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'NOT_ALLOWED'/);
  });

  it("só o sistema muda o tipo do perfil", () => {
    const { corpo } = ultimaDefinicao("public.profiles_kind_guard");
    expect(corpo).toContain("v_role in ('authenticated', 'anon')");
    expect(corpo).toContain("PROFILE_KIND_LOCKED");
  });
});

describe("Rita 0A.1 — a tela", () => {
  const nomes = { usuarios: new Map<string, string>(), unidades: new Map<string, string>() };

  it("o autor 'assistente' aparece como a Rita, nunca como 'Usuário removido'", () => {
    expect(
      quemFez({ user_id: "00000000-0000-4000-8000-0000000000aa", actor: "assistente" }, nomes)
    ).toBe("Rita (assistente virtual)");
  });
});
