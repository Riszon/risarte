// Rita 0A.6 — escalonamento, avisos e o registro (3005). A prova de
// comportamento é `npm run test:rita`; esta régua roda em todo `npm test` e
// prende, na VERSÃO MAIS RECENTE de cada função, o que não pode sumir num
// "recriar".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categorizeNotification } from "@/lib/notifications";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sql3005 = ler(arquivos.find((f) => f.startsWith("3005_"))!);

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

describe("os avisos da Rita", () => {
  it("o sino classifica pelo link /rita (e só ele)", () => {
    expect(categorizeNotification("Rita: pausada em Cambé", "/rita/0b9f4c1e-0000-4000-8000-000000000000")).toBe("rita");
    expect(categorizeNotification("Rita: ligada na rede", "/rita")).toBe("rita");
    expect(categorizeNotification("Plano aprovado", "/ritalina")).not.toBe("rita");
  });

  it("_notify recusa link fora de /rita — o mesmo critério do sino", () => {
    expect(ultimaDefinicao("rita._notify")).toContain("p_link !~ '^/rita(/|$)'");
  });

  it("_notify: só pessoas ativas, nunca quem fez, e a trava contra repetir", () => {
    const corpo = ultimaDefinicao("rita._notify");
    expect(corpo).toMatch(/p\.is_active and p\.kind = 'person'/);
    expect(corpo).toContain("u is distinct from p_skip");
    expect(corpo).toMatch(/on conflict \(dedupe_key\) do nothing\s*returning id into v_notice;\s*if v_notice is null then\s*return 0;/);
  });

  it("_notify não abre para quem loga", () => {
    expect(sql3005).toMatch(/revoke execute on function rita\._notify\([^)]*\) from public, anon, authenticated;/);
    expect(sql3005).not.toMatch(/grant execute on function rita\._notify\([^)]*\) to [^;]*authenticated/);
  });

  it("a pausa automática avisa, e o aviso nunca desfaz a pausa", () => {
    const corpo = ultimaDefinicao("rita._pause_if_gaps");
    const depois = corpo.slice(corpo.indexOf("update rita.settings set"));
    expect(depois).toMatch(/begin\s*perform rita\._notify\([\s\S]*exception when others then[\s\S]*insert into rita\.falhas/);
  });

  it("desligar pela tela avisa sem avisar quem clicou", () => {
    const corpo = ultimaDefinicao("rita.set_enabled");
    const desligar = corpo.slice(corpo.indexOf("-- DESLIGAR"));
    expect(desligar).toMatch(/perform rita\._notify\([\s\S]*true, v_uid\);/);
  });
});

describe("o portão sem pendentes", () => {
  it("_pending_items está vazio", () => {
    expect(ultimaDefinicao("rita._pending_items")).toMatch(/select 0, ''::text, ''::text, ''::text where false;/);
  });

  it("'transferências' é conferido de verdade (papel da rota ou reserva ativa)", () => {
    const corpo = ultimaDefinicao("rita._gaps");
    expect(corpo).toContain("item := 'transferencias'");
    expect(corpo).toContain("ok := v_recebe > 0 or v_reserva;");
    expect(corpo).toMatch(/r\.role = any \(coalesce\(rt\.business_hours_roles, '\{\}'\)\)\s*and p\.is_active\s*and p\.kind = 'person'/);
  });

  it("mexer na rota reconfere as unidades ligadas", () => {
    expect(ultimaDefinicao("rita._recheck_trg")).toContain("'escalation_routes'");
    expect(sql3005).toMatch(/create trigger rita_recheck\s+after update or delete on rita\.escalation_routes/);
  });
});

describe("o registro da Rita", () => {
  it("só cresce: alterar, apagar e esvaziar são recusados", () => {
    expect(sql3005).toMatch(/create trigger append_only before update or delete on rita\.actions/);
    expect(sql3005).toMatch(/create trigger append_only_truncate before truncate on rita\.actions/);
    expect(ultimaDefinicao("rita._actions_append_only")).toContain("raise exception 'RITA_ACTIONS_APPEND_ONLY'");
  });

  it("o gatilho do registro é blindado (nunca derruba a gravação)", () => {
    const corpo = ultimaDefinicao("rita._log_trg");
    expect(corpo).toMatch(/exception\s+when\s+others\s+then[\s\S]*insert\s+into\s+rita\.falhas/);
    expect(corpo).not.toMatch(/\braise\s*;/);
  });

  it("o consentimento entra no registro SEM o telefone", () => {
    const corpo = ultimaDefinicao("rita._log_trg");
    const trecho = corpo.slice(corpo.indexOf("'contact_consents' then"), corpo.indexOf("'opt_outs' then"));
    expect(trecho.length).toBeGreaterThan(100);
    expect(trecho).not.toContain("phone_e164");
    const optOut = corpo.slice(corpo.indexOf("'opt_outs' then"), corpo.indexOf("'evaluation_fee_campaigns' then"));
    expect(optOut.length).toBeGreaterThan(50);
    expect(optOut).not.toContain("phone_e164");
  });
});
