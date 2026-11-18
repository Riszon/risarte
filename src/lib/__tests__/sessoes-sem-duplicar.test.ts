import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AP179 (0429, 18/11/2026): a ficha chama ensure_treatment_sessions e
// topup_treatment_sessions na mesma abertura; sem trava, as duas criavam as
// sessões do plano e cada procedimento nascia em dobro (no treino, 16 casos
// desde 01/10/2026). A cópia pendente segurava o repasse.
//
// A régua lê a migração MAIS NOVA que define cada rotina: quem recriar uma
// delas tem de levar a trava por paciente.

const DIR = "supabase/migrations";
const arquivos = readdirSync(DIR).filter((f) => /^0\d{3}.*\.sql$/.test(f)).sort();

function definicaoMaisNova(nome: string): string {
  const re = new RegExp(`create or replace function public\\.${nome}\\(`, "i");
  const ultimo = [...arquivos].reverse().find((f) => re.test(readFileSync(`${DIR}/${f}`, "utf8")));
  if (!ultimo) throw new Error(`nenhuma migração define ${nome}: a régua não mediu nada`);
  const sql = readFileSync(`${DIR}/${ultimo}`, "utf8");
  const ini = sql.search(re);
  const fim = sql.indexOf("$$;", ini);
  return sql.slice(ini, fim);
}

describe("as rotinas que criam sessões do plano têm trava por paciente", () => {
  it.each(["ensure_treatment_sessions", "topup_treatment_sessions", "_generate_complement_sessions"])(
    "%s trava antes de olhar se o item já tem sessão",
    (nome) => {
      const corpo = definicaoMaisNova(nome);
      const trava = corpo.indexOf("pg_advisory_xact_lock(hashtextextended('treatment_sessions:' || p_client_id::text, 0))");
      expect(trava).toBeGreaterThan(-1);
      // A trava vem antes de qualquer criação de sessão.
      const insere = corpo.indexOf("insert into public.treatment_sessions");
      if (insere > -1) expect(trava).toBeLessThan(insere);
    }
  );
});

describe("a arrumação das cópias (0429)", () => {
  const sql = readFileSync(`${DIR}/0429_sessoes_do_plano_sem_duplicar.sql`, "utf8");
  it("o apagamento é declarado e só alcança cópia sem uso", () => {
    expect(sql).toMatch(/-- DESTRUTIVO: AP179/);
    for (const guarda of [
      "public.attendance_session_outcomes",
      "public.provider_payouts p where p.session_id = s.id",
      "public.tooth_findings",
      "s.reopened_at is null",
      "interval '2 seconds'",
    ]) {
      expect(sql).toContain(guarda);
    }
  });
  it("refaz a conta do repasse que a cópia segurava", () => {
    expect(sql).toContain("perform public._payout_accrue_block(v_s.id)");
  });
});
