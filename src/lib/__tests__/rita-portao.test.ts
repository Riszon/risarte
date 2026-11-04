// Rita, Fase 0A.2 — o interruptor, o modo e o portão (3001).
//
// O que esta régua prende, na VERSÃO MAIS RECENTE de cada função (quem
// recriar depois tem de levar junto — DA6 do docs/sdr/PLANO-FASE-0A.md):
//   * ligar é só do Admin Master, com a rede ligada e o portão completo;
//   * desligar é do Admin Master ou do Gerente DA unidade, e exige pessoa;
//   * a pausa automática nunca derruba a gravação de quem mexeu;
//   * o que a Rita usa por dentro (`enabled`, `_gaps`, `_pause_if_gaps`) não
//     é chamável por quem loga.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const tudo = arquivos.map(ler).join("\n");

/** O corpo da ÚLTIMA definição de uma função, em qualquer migração. */
function ultimaDefinicao(nome: string): string {
  const abre = new RegExp(`create\\s+or\\s+replace\\s+function\\s+${nome.replace(".", "\\.")}\\s*\\(`, "i");
  let corpo: string | null = null;
  for (const f of arquivos) {
    const sql = ler(f);
    const m = abre.exec(sql);
    if (!m) continue;
    const resto = sql.slice(m.index);
    const ini = resto.indexOf("$$");
    corpo = resto.slice(0, resto.indexOf("$$", ini + 2) + 2);
  }
  // Régua que não acha o que medir grita (§0d do CLAUDE.md).
  if (!corpo) throw new Error(`NÃO MEDI: nenhuma definição de ${nome}`);
  return corpo;
}

describe("Rita 0A.2 — ligar e desligar", () => {
  const corpo = ultimaDefinicao("rita.set_enabled");
  const ligar = corpo.slice(corpo.indexOf("if p_enabled then"), corpo.indexOf("else\n    -- DESLIGAR"));
  const desligar = corpo.slice(corpo.indexOf("-- DESLIGAR"));

  it("é ato de pessoa: sem login, recusa", () => {
    expect(corpo).toMatch(/if\s+v_uid\s+is\s+null\s+then\s+raise\s+exception\s+'NOT_ALLOWED'/);
  });

  it("ligar a unidade: só Admin Master — o Gerente não aparece no trecho de ligar", () => {
    expect(ligar.length).toBeGreaterThan(100);
    expect(ligar).toMatch(/if\s+not\s+public\.is_admin_master\(\)\s+then\s+raise\s+exception\s+'NOT_ALLOWED'/);
    expect(ligar).not.toContain("unit_manager");
  });

  it("ligar a unidade exige a rede ligada e o portão completo", () => {
    expect(ligar).toContain("NETWORK_OFF");
    expect(ligar).toMatch(/rita\._gaps\(p_clinic\)[\s\S]*ACTIVATION_GAPS/);
  });

  it("desligar: Admin Master ou o Gerente da unidade", () => {
    expect(desligar).toMatch(/public\.is_admin_master\(\)[\s\S]*has_role_in_clinic\(p_clinic, array\['unit_manager'\]/);
  });

  it("modo: só Admin Master", () => {
    expect(ultimaDefinicao("rita.set_mode")).toMatch(
      /if\s+auth\.uid\(\)\s+is\s+null\s+or\s+not\s+public\.is_admin_master\(\)\s+then\s+raise\s+exception\s+'NOT_ALLOWED'/
    );
  });
});

describe("Rita 0A.2 — pausa automática blindada", () => {
  for (const fn of ["rita._recheck_trg", "rita._recheck_profile_trg"]) {
    it(`${fn}: erro vai para rita.falhas, nunca derruba a gravação`, () => {
      const corpo = ultimaDefinicao(fn);
      expect(corpo).toMatch(/exception\s+when\s+others\s+then[\s\S]*insert\s+into\s+rita\.falhas/);
      // Devolver o erro (`raise;` puro) derrubaria a gravação de quem mexeu.
      expect(corpo).not.toMatch(/\braise\s*;/);
      expect(corpo).not.toMatch(/\braise\s+exception\b/);
      expect(corpo).toMatch(/return\s+null;\s*end;\s*\$\$/);
    });
  }
});

describe("Rita 0A.2 — o que é só da Rita não abre para quem loga", () => {
  for (const sig of ["rita.enabled(uuid)", "rita.effective_mode(uuid)", "rita._gaps(uuid)", "rita._pause_if_gaps(uuid, text)", "rita._pending_items()"]) {
    it(sig, () => {
      const esc = sig.replace(/[.()]/g, "\\$&");
      expect(tudo).toMatch(new RegExp(`revoke execute on function ${esc} from public, anon, authenticated;`));
      expect(tudo).not.toMatch(new RegExp(`grant execute on function ${esc} to [^;]*authenticated`));
    });
  }

  it("as tabelas da Rita não têm permissão para quem loga", () => {
    expect(tudo).toContain("revoke all on rita.settings from public, anon, authenticated;");
    expect(tudo).toContain("revoke all on rita.falhas from public, anon, authenticated;");
    expect(tudo).not.toMatch(/grant\s+[^;]*on\s+rita\.(settings|falhas)\s+to\s+[^;]*authenticated/i);
  });
});
