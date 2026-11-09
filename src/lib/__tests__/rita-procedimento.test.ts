// Rita 0A.5 — a avaliação como dado (0369 + 3004). A prova de comportamento é
// `npm run test:rita`; esta régua roda em todo `npm test` e prende o que não
// pode sumir num "recriar".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAPEIS_DA_RITA, resumoDaRita } from "@/lib/rita-procedimento";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sql0369 = ler(arquivos.find((f) => f.startsWith("0369_"))!);

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

describe("os papéis da Rita", () => {
  it("o código e o banco têm o mesmo conjunto", () => {
    const m = /rita_role in \(([^)]*)\)/.exec(sql0369);
    expect(m).not.toBeNull();
    const doBanco = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect([...doBanco].sort()).toEqual([...PAPEIS_DA_RITA].sort());
  });

  it("resumo do cartão", () => {
    expect(resumoDaRita({ canOffer: true, role: "evaluation_new", patientName: "Avaliação" })).toBe(
      "Avaliação de quem é novo · a assistente pode oferecer · “Avaliação”"
    );
    expect(resumoDaRita({ canOffer: false, role: "urgency", patientName: null })).toBe(
      "Urgência · fora do rol da assistente"
    );
  });
});

describe("0369 — as travas", () => {
  it("decisão 38: marca pelo nome exato e FALHA alto se não achar um", () => {
    expect(sql0369).toMatch(/if v_n <> 1 then\s*raise exception 'RITA_MARCA/);
    for (const nome of [
      "Consulta odontológica inicial",
      "Consulta odontológica",
      "Consulta odontológica de Urgência",
      "Consulta odontológica de Urgência 24 hs",
    ]) {
      expect(sql0369).toContain(`('${nome}', `);
    }
  });

  it("só o Admin Master mexe nos campos da Rita no procedimento", () => {
    const corpo = ultimaDefinicao("public.procedures_rita_guard");
    expect(corpo).toMatch(/if v_role not in \('authenticated', 'anon'\) or public\.is_admin_master\(\) then\s*return new;/);
    expect(corpo).toContain("RITA_FIELDS_ADMIN_ONLY");
  });

  it("só o Admin aprova texto para o paciente; mudar o texto volta a rascunho", () => {
    const corpo = ultimaDefinicao("public.patient_texts_guard");
    expect(corpo).toContain("raise exception 'PATIENT_TEXT_ADMIN_APPROVES'");
    expect(corpo).toMatch(/new\.content is distinct from old\.content then\s*new\.version := old\.version \+ 1;/);
  });
});

describe("3004 — campanhas e catálogo", () => {
  it("só campanha ATIVA, no período, vale", () => {
    const corpo = ultimaDefinicao("rita._active_campaign");
    expect(corpo).toMatch(/where c\.status = 'active'\s*and \(now\(\) at time zone 'America\/Sao_Paulo'\)::date between c\.starts_on and c\.ends_on/);
  });

  it("só o Admin ativa ou encerra campanha", () => {
    expect(ultimaDefinicao("rita.set_fee_campaign_status")).toMatch(
      /if auth\.uid\(\) is null or not public\.is_admin_master\(\) then\s*raise exception 'NOT_ALLOWED'/
    );
  });

  it("o catálogo nunca dá preço de tratamento (só avaliação/consulta)", () => {
    expect(ultimaDefinicao("rita.catalog")).toMatch(
      /case when p\.rita_role in \('evaluation_new', 'evaluation_returning'\)\s*then coalesce\(cp\.price_cents, p\.default_price_cents\) end/
    );
  });
});
