// Rita, Fase 0A.3 — consentimento e descadastro (3002).
//
// A prova de comportamento é `npm run test:rita` (no banco de treino). Esta
// régua roda em todo `npm test` e prende, na VERSÃO MAIS RECENTE de cada
// função, as regras que não podem sumir num "recriar":
//   * sem texto aprovado, nenhum consentimento novo (decisão 30);
//   * o aceite do Indica vale só para CONTATO;
//   * vale o fato mais recente, e no empate quem bloqueia ganha;
//   * consentimento e descadastro nunca se apagam;
//   * a conta interna não abre para quem loga.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const tudo = arquivos.map(ler).join("\n");

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
  if (!corpo) throw new Error(`NÃO MEDI: nenhuma definição de ${nome}`);
  return corpo;
}

describe("Rita 0A.3 — consentimento", () => {
  it("sem texto aprovado, ninguém grava consentimento novo", () => {
    expect(ultimaDefinicao("rita.register_consent")).toMatch(
      /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+rita\.consent_texts[\s\S]*?raise\s+exception\s+'CONSENT_TEXT_NOT_APPROVED'/
    );
  });

  it("só o Admin Master aprova o texto, e texto aprovado não muda", () => {
    const corpo = ultimaDefinicao("rita.approve_consent_text");
    expect(corpo).toMatch(/if\s+auth\.uid\(\)\s+is\s+null\s+or\s+not\s+public\.is_admin_master\(\)\s+then\s+raise\s+exception\s+'NOT_ALLOWED'/);
    expect(corpo).toContain("CONSENT_TEXT_EXISTS");
  });
});

describe("Rita 0A.3 — pode contatar?", () => {
  const corpo = ultimaDefinicao("rita._can_contact");

  it("o aceite do Indica só libera CONTATO", () => {
    const ini = corpo.indexOf("true, 'aceite_indica'");
    const fim = corpo.indexOf("'aceite_indica_revogado'");
    // Régua que não acha o trecho grita (§0d do CLAUDE.md).
    expect(ini).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(ini);
    expect(corpo.slice(ini, fim)).toMatch(/p_purpose\s*=\s*'contato'/);
  });

  it("vale o fato mais recente; no empate, bloqueia", () => {
    expect(corpo).toMatch(/order\s+by\s+f\.quando\s+desc,\s*f\.libera\s+asc\s+limit\s+1/);
  });

  it("descadastro e revogações entram como bloqueio", () => {
    for (const m of ["'descadastro'", "'consentimento_revogado'", "'aceite_indica_revogado'"]) {
      expect(corpo).toMatch(new RegExp(`false,\\s*${m}`));
    }
  });
});

describe("Rita 0A.3 — nada se apaga e a conta não abre", () => {
  for (const t of ["consent_texts", "contact_consents", "opt_outs"]) {
    it(`rita.${t} recusa DELETE`, () => {
      expect(tudo).toMatch(
        new RegExp(`create trigger never_delete before delete on rita\\.${t}\\s+for each row execute function rita\\._never_delete\\(\\)`)
      );
    });
  }

  it("a conta e os autores internos não abrem para quem loga", () => {
    for (const sig of ["rita._can_contact(text, text)", "rita._author(uuid)", "rita._author_protective()"]) {
      const esc = sig.replace(/[.()]/g, "\\$&");
      expect(tudo).toMatch(new RegExp(`revoke execute on function ${esc} from public, anon, authenticated;`));
      expect(tudo).not.toMatch(new RegExp(`grant execute on function ${esc} to`));
    }
  });
});
