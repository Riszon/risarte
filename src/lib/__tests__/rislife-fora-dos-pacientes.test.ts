import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPACIDADES } from "@/lib/permissions";

// AP95 (decisão do dono, 03/11/2026): o Consultor RisLife vende o programa às
// empresas e trabalha SÓ no Empresarial. Não vê paciente: nem cadastro, nem
// agenda, nem plano, negociação ou resumo da apresentação. Quando titulares e
// dependentes vão às unidades, ele não acompanha.
//
// O banco é quem garante (0353): `user_full_access_clinic_ids()` não conta o
// papel dele, e as ~130 regras que leem essa função obedecem. A equipe e o
// chat, que não são dado de paciente, leem `user_staff_scope_clinic_ids()`.

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Corpo de cada função, pela última migração que a (re)cria. */
function ultimasDefinicoes(): Map<string, { arquivo: string; corpo: string }> {
  const defs = new Map<string, { arquivo: string; corpo: string }>();
  const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi;
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    for (const m of sql.matchAll(FN)) {
      const nome = m[1].toLowerCase().replace(/"/g, "");
      defs.set(nome.includes(".") ? nome : `public.${nome}`, { arquivo, corpo: m[3] });
    }
  }
  return defs;
}

/** Os blocos `select … ` unidos por `union` (sem os comentários de linha). */
function partesDaUniao(corpo: string): string[] {
  return corpo
    .replace(/--[^\n]*/g, "")
    .split(/\bunion\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

describe("o Consultor RisLife não alcança as unidades (0353)", () => {
  const defs = ultimasDefinicoes();

  it("o acesso às unidades exclui o papel dele em CADA caminho", () => {
    const def = defs.get("public.user_full_access_clinic_ids");
    expect(def, "user_full_access_clinic_ids não achada nas migrações").toBeDefined();
    const partes = partesDaUniao(def!.corpo);
    // Papel direto, escopo "todas" da Franqueadora e escopo "específicas".
    expect(partes.length).toBe(3);
    for (const parte of partes) {
      expect(parte, `um caminho do acesso deixa o RisLife entrar (${def!.arquivo})`).toMatch(
        /rislife_consultant/
      );
    }
  });

  it("a equipe e o chat seguem enxergando como antes (com o RisLife)", () => {
    const equipe = defs.get("public.user_staff_scope_clinic_ids");
    expect(equipe, "user_staff_scope_clinic_ids não achada").toBeDefined();
    expect(equipe!.corpo).not.toMatch(/rislife_consultant/);
    for (const nome of [
      "public.can_see_staff",
      "public.can_access_chat_channel",
      "public.chat_can_dm",
      "public.chat_contacts",
      "public.chat_my_channel_ids",
      "public.ensure_unit_chat_channel",
    ]) {
      const def = defs.get(nome);
      expect(def, `${nome} não achada`).toBeDefined();
      expect(def!.corpo, `${nome} voltou a ler o acesso às unidades`).not.toMatch(
        /user_full_access_clinic_ids/
      );
      expect(def!.corpo).toMatch(/user_staff_scope_clinic_ids/);
    }
  });
});

describe("as telas de paciente não são do Consultor RisLife", () => {
  const TELAS_DE_PACIENTE = [
    "menu.jornada",
    "menu.agenda",
    "menu.atendimento",
    "menu.prontuarios",
    "modulo.ppr",
  ];

  it.each(TELAS_DE_PACIENTE)("%s não vem ligada para ele de fábrica", (id) => {
    const cap = CAPACIDADES.find((c) => c.id === id);
    expect(cap, `${id} sumiu do catálogo`).toBeDefined();
    expect(cap!.padrao).not.toContain("rislife_consultant");
  });

  it("o Empresarial continua ligado para ele", () => {
    expect(CAPACIDADES.find((c) => c.id === "modulo.empresarial")?.padrao).toContain(
      "rislife_consultant"
    );
  });
});
