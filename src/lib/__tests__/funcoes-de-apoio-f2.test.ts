import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOTIVOS_DE_ACESSO, ROTULO_DO_MOTIVO } from "@/lib/acesso-por-unidade";

// Funções de apoio, F2 (0414; plano aprovado em 16/11/2026,
// docs/equipe/FUNCOES-DE-APOIO-PLANO.md, D1–D15).

const ROOT = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const M = ler("supabase/migrations/0414_funcoes_de_apoio_coberturas.sql");

function corpo(nome: string): string {
  const i = M.indexOf(`create or replace function ${nome}(`);
  if (i < 0) throw new Error(`não achei ${nome}`);
  const fim = M.indexOf("\n$$;", i);
  if (fim < 0) throw new Error(`fim de ${nome} não achado`);
  return M.slice(i, fim);
}

describe("a trava muda: a mesma função duas vezes, nunca", () => {
  it("sai (user, clinic) e entra (user, clinic, role)", () => {
    expect(M).toContain("drop constraint if exists user_clinic_roles_user_clinic_key");
    expect(M).toContain("unique (user_id, clinic_id, role)");
  });

  it("apoio só existe com cobertura, e o contrário", () => {
    expect(M).toContain("check ((assignment_kind = 'apoio') = (coverage_id is not null))");
  });

  it("as travas da função de apoio estão no banco (D3, D4, principal)", () => {
    const g = corpo("public._support_role_guard");
    expect(g).toContain("v_max integer := 2; -- D3");
    expect(g).toContain("NO_PRINCIPAL_ROLE");
    expect(g).toContain("TOO_MANY_SUPPORT_ROLES");
    expect(g).toContain("ROLE_COMBINATION_NOT_ALLOWED");
    expect(M).toContain("'Quem compra não é quem paga (controle interno).'");
  });
});

describe("as portas", () => {
  it("D1: dar, encerrar, cancelar e revisar são só do Admin Master", () => {
    for (const nome of [
      "public.grant_role_coverage",
      "public.end_role_coverage",
      "public.cancel_role_coverage",
      "public.review_role_coverage",
    ]) {
      expect(corpo(nome), nome).toContain("if not public.is_admin_master() then");
    }
  });

  it("D2/D15: a temporária tem fim e limite com as emendas; o desligamento pede a previsão", () => {
    const g = corpo("public.grant_role_coverage");
    expect(g).toContain("TEMPORARY_TOO_LONG");
    expect(g).toContain("_coverage_chain_days");
    expect(g).toContain("HIRING_FORECAST_REQUIRED");
  });

  it("D13: os limites só travam com enforce_limits (que nasce desligado)", () => {
    expect(corpo("public.grant_role_coverage")).toContain("if s.enforce_limits then");
    expect(M).toContain("enforce_limits boolean not null default false");
  });

  it("D6: a temporária libera o sistema real da função; a fixa não", () => {
    const a = corpo("public._role_coverage_activate");
    expect(a).toContain("if c.kind = 'temporaria' then");
    expect(a).toContain("'cobertura'");
    expect(MOTIVOS_DE_ACESSO).toContain("cobertura");
    expect(ROTULO_DO_MOTIVO.cobertura).toMatch(/cobertura/i);
  });

  it("D7: a temporária não entra em turma de certificação", () => {
    expect(M).toMatch(/or exists \(select 1 from public\.role_coverages rc\s+where rc\.id = ucr\.coverage_id and rc\.kind = 'fixa'\)/);
  });
});

describe("o fim (D10) e a rede de segurança", () => {
  it("a janela esconde a linha vencida mesmo sem a rotina", () => {
    expect(M).toContain("where (r.ends_at is null or r.ends_at > now())");
  });

  it("a rotina diária está agendada e não responde à API", () => {
    expect(M).toContain("'risarte-coverage-daily'");
    expect(M).toContain(
      "revoke execute on function public.role_coverage_daily() from public, anon, authenticated;"
    );
  });

  it("perder a principal ou ser desligado encerra as coberturas", () => {
    expect(M).toContain("create trigger coverage_end_on_principal_loss");
    expect(M).toContain("create trigger coverage_end_on_deactivation");
  });
});

describe("o treino e a semente", () => {
  it("o espelho leva só a função principal", () => {
    expect(ler("src/lib/espelho-treino.ts")).toMatch(
      /\.select\("clinic_id, role, unit_scope, role_unit_access \( clinic_id \)"\)[\s\S]{0,300}\.eq\("assignment_kind", "principal"\)/
    );
  });

  it("nenhum script usa mais a trava antiga como alvo do on conflict", () => {
    for (const f of ["scripts/seed-test.mjs", "scripts/repasse-ensaio-0391.mjs"]) {
      expect(ler(f), f).not.toMatch(/on conflict \(user_id, clinic_id\) do update/);
    }
  });
});
