// Rita 0A.4 — dados públicos da unidade e horário por dia (regras puras) e as
// travas da 0368/3003 que não podem sumir num "recriar".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  telefoneE164,
  temDiaAberto,
  validarDadosPublicos,
  validarHorarioPorDia,
  type HorarioDoDia,
} from "@/lib/unidade-publica";
import { WEEKDAY_NAMES } from "@/lib/agenda-settings";
import { nationalHolidays } from "@/lib/holidays";

const DIR = join(process.cwd(), "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

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

describe("telefone", () => {
  it("normaliza como rita.phone_e164", () => {
    expect(telefoneE164("(43) 99999-1234")).toBe("+5543999991234");
    expect(telefoneE164("+55 43 3333-1234")).toBe("+554333331234");
    expect(telefoneE164("0 43 99999 1234")).toBe("+5543999991234");
    expect(telefoneE164("99999-1234")).toBeNull();
    expect(telefoneE164("")).toBeNull();
  });

  it("a regra do TS é a mesma da função do banco (mesmo padrão de DDD + 8/9 dígitos)", () => {
    const corpo = ultimaDefinicao("rita.phone_e164");
    expect(corpo).toContain("'^[1-9][1-9][0-9]{8,9}$'");
    expect(corpo).toMatch(/length\(d\) in \(12, 13\) and left\(d, 2\) = '55'/);
  });
});

describe("dados públicos", () => {
  it("aceita tudo vazio (nada é obrigatório para salvar)", () => {
    const r = validarDadosPublicos({});
    expect(r.ok).toBe(true);
  });

  it("recusa mapa sem https, WhatsApp sem DDD e idade fora de 0–17", () => {
    expect(validarDadosPublicos({ mapsUrl: "maps.google.com/x" }).ok).toBe(false);
    expect(validarDadosPublicos({ whatsapp: "99999-1234" }).ok).toBe(false);
    expect(validarDadosPublicos({ minChildAge: "18" }).ok).toBe(false);
    expect(validarDadosPublicos({ minChildAge: "3.5" }).ok).toBe(false);
  });

  it("normaliza o WhatsApp e a idade", () => {
    const r = validarDadosPublicos({ whatsapp: "(43) 99999-1234", minChildAge: "6", mapsUrl: "https://maps.app.goo.gl/abc" });
    expect(r).toEqual({
      ok: true,
      valores: expect.objectContaining({ whatsappE164: "+5543999991234", minChildAge: 6, mapsUrl: "https://maps.app.goo.gl/abc" }),
    });
  });
});

describe("horário por dia", () => {
  const semana = (f: (d: number) => Partial<HorarioDoDia>): HorarioDoDia[] =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, closed: false, open: "08:00", close: "18:00", lunchStart: "", lunchEnd: "", ...f(d) }));

  it("semana válida passa; fechado não precisa de horário", () => {
    expect(validarHorarioPorDia(semana((d) => (d === 0 ? { closed: true, open: "", close: "" } : {})), WEEKDAY_NAMES).ok).toBe(true);
  });

  it("recusa abertura depois do fechamento e almoço fora do dia", () => {
    expect(validarHorarioPorDia(semana((d) => (d === 1 ? { open: "18:00", close: "08:00" } : {})), WEEKDAY_NAMES)).toEqual({
      ok: false,
      erro: "Segunda: a abertura tem de ser antes do fechamento.",
    });
    expect(validarHorarioPorDia(semana((d) => (d === 2 ? { lunchStart: "07:00", lunchEnd: "08:30" } : {})), WEEKDAY_NAMES).ok).toBe(false);
    expect(validarHorarioPorDia(semana((d) => (d === 3 ? { lunchStart: "12:00", lunchEnd: "" } : {})), WEEKDAY_NAMES).ok).toBe(false);
  });

  it("exige os 7 dias", () => {
    expect(validarHorarioPorDia(semana(() => ({})).slice(0, 6), WEEKDAY_NAMES).ok).toBe(false);
  });

  it("dia aberto", () => {
    expect(temDiaAberto(semana(() => ({ closed: true })))).toBe(false);
    expect(temDiaAberto(semana(() => ({})))).toBe(true);
  });
});

describe("0368/3003 — as travas", () => {
  const sql0368 = ler(arquivos.find((f) => f.startsWith("0368_"))!);

  it("a semente dos feriados nacionais é a da função do código (2026–2029)", () => {
    for (let y = 2026; y <= 2029; y++) {
      for (const h of nationalHolidays(y)) {
        expect(sql0368).toContain(`(date '${h.date}', '${h.name}')`);
      }
    }
  });

  it("horário da REDE: só o Admin grava", () => {
    expect(sql0368).toMatch(
      /create policy clinic_weekday_hours_write[\s\S]*?using \(\s*public\.is_admin_master\(\)\s*or \(clinic_id is not null\s*and public\.has_role_in_clinic/
    );
  });

  it("para a Rita, feriado sem decisão = fechado (decisão 9)", () => {
    const corpo = ultimaDefinicao("rita.unit_day");
    expect(corpo).toMatch(/if v_decisao is null then\s*(--[^\n]*\n\s*)*is_open := false; reason := 'feriado_sem_decisao'/);
  });

  it("o portão confere o mapa e o horário por dia (não são mais pendentes)", () => {
    const pend = ultimaDefinicao("rita._pending_items");
    expect(pend).not.toContain("'maps'");
    expect(pend).not.toContain("'horario_por_dia'");
    const gaps = ultimaDefinicao("rita._gaps");
    expect(gaps).toContain("item := 'maps'");
    expect(gaps).toContain("item := 'horario_por_dia'");
  });
});
