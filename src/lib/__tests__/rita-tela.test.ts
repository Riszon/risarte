// Rita 0A.7a — a tela "O que a Rita sabe" (3006). A prova de comportamento
// do banco é `npm run test:rita`; esta régua roda em todo `npm test` e prende
// a regra da tela e, na VERSÃO MAIS RECENTE de cada função, o que não pode
// sumir num "recriar".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estadoDaUnidade,
  faltaExporRita,
  mensagemDoInterruptor,
} from "@/lib/rita-tela";
import { CAPACIDADES } from "@/lib/permissions";

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

describe("o estado de cada unidade", () => {
  it("ligada vence tudo", () => {
    expect(estadoDaUnidade({ enabled: true, paused_auto: false, gaps: 3 })).toBe("ligada");
  });
  it("pausada sozinha é alarme; desligada por pessoa não é", () => {
    expect(estadoDaUnidade({ enabled: false, paused_auto: true, gaps: 1 })).toBe("pausada");
    expect(estadoDaUnidade({ enabled: false, paused_auto: false, gaps: 1 })).toBe("desligada");
  });
  it("nada falta e ninguém ligou = pronta", () => {
    expect(estadoDaUnidade({ enabled: false, paused_auto: false, gaps: 0 })).toBe("pronta");
  });
});

describe("o que a tela diz quando o banco recusa", () => {
  it("schema não exposto vira o passo do painel, não erro genérico", () => {
    const e = { code: "PGRST106", message: "Invalid schema: rita" };
    expect(faltaExporRita(e)).toBe(true);
    expect(mensagemDoInterruptor(e)).toMatch(/Exposed schemas/);
  });
  it("as recusas do set_enabled têm frase própria", () => {
    expect(mensagemDoInterruptor({ message: "NETWORK_OFF" })).toMatch(/rede/);
    expect(mensagemDoInterruptor({ message: "ACTIVATION_GAPS: link do mapa" })).toBe("Ainda falta: link do mapa.");
    expect(mensagemDoInterruptor({ message: "NOT_ALLOWED" })).toMatch(/permissão/);
  });
});

describe("a leitura da tela no banco (3006)", () => {
  it("as duas leituras exigem quem pode ler a unidade", () => {
    expect(ultimaDefinicao("rita.screen_unit")).toMatch(/if not rita\._can_read_unit\(p_clinic\) then\s*raise exception 'NOT_ALLOWED'/);
    const lista = ultimaDefinicao("rita.screen_units");
    expect(lista).toMatch(/if auth\.uid\(\) is null then\s*raise exception 'NOT_ALLOWED'/);
    expect(lista).toContain("and rita._can_read_unit(c.id)");
  });

  it("a guarda: pessoa logada, Admin ou a unidade no escopo dela", () => {
    const g = ultimaDefinicao("rita._can_read_unit");
    expect(g).toContain("auth.uid() is not null");
    expect(g).toMatch(/public\.is_admin_master\(\)\s*or p_clinic in \(select public\.user_full_access_clinic_ids\(\)\)/);
  });

  it("a guarda interna não abre para quem loga; as leituras abrem só para logados", () => {
    expect(tudo).toMatch(/revoke execute on function rita\._can_read_unit\(uuid\) from public, anon, authenticated;/);
    expect(tudo).not.toMatch(/grant execute on function rita\._can_read_unit\(uuid\) to [^;]*authenticated/);
    for (const sig of ["rita.screen_units()", "rita.screen_unit(uuid)"]) {
      const esc = sig.replace(/[.()]/g, "\\$&");
      expect(tudo).toMatch(new RegExp(`revoke execute on function ${esc} from public, anon, authenticated;`));
      expect(tudo).not.toMatch(new RegExp(`grant execute on function ${esc} to [^;]*anon`));
    }
  });

  it("a tela lê pelas mesmas funções da Rita (DA7), não pelas tabelas", () => {
    const corpo = ultimaDefinicao("rita.screen_unit");
    for (const f of ["rita._gaps(p_clinic)", "rita.weekday_hours(p_clinic)", "rita.catalog(p_clinic)", "rita.evaluation_fee(p_clinic)", "rita._route(p_clinic)", "rita.unit_day(p_clinic"]) {
      expect(corpo).toContain(f);
    }
  });

  it("o registro na tela: no máximo 30 e sem o conteúdo técnico (payload)", () => {
    const corpo = ultimaDefinicao("rita.screen_unit");
    const trecho = corpo.slice(corpo.indexOf("'actions'"));
    expect(trecho).toMatch(/limit 30/);
    expect(trecho).not.toContain("a.payload");
  });
});

describe("a permissão do módulo", () => {
  it("modulo.rita existe com Gerente e Rede, e a 3006 semeia o mesmo", () => {
    const p = CAPACIDADES.find((x) => x.id === "modulo.rita");
    expect(p).toBeTruthy();
    expect([...(p!.padrao as string[])].sort()).toEqual(["franchisor_staff", "unit_manager"]);
    const sql3006 = ler(arquivos.find((f) => f.startsWith("3006_"))!);
    expect(sql3006).toContain("('modulo.rita', 'unit_manager')");
    expect(sql3006).toContain("('modulo.rita', 'franchisor_staff')");
  });
});
