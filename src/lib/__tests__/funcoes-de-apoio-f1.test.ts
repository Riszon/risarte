import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Funções de apoio, F1 (0413 + 2012; plano aprovado em 16/11/2026,
// docs/equipe/FUNCOES-DE-APOIO-PLANO.md): antes de a pessoa poder ter duas
// funções na mesma unidade, nada pode somar em dobro, pagar pelo nível errado,
// dar dois prêmios, fechar a unidade inteira ou mandar o aviso duas vezes.

const ROOT = join(__dirname, "..", "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
const ler = (f: string) => readFileSync(join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const M = ler("0413_funcoes_de_apoio_leitores.sql");

/** O corpo da função na 0413 (de `create or replace function X(` ao `$$;`). */
function corpo(texto: string, nome: string): string {
  const i = texto.indexOf(`create or replace function ${nome}(`);
  if (i < 0) throw new Error(`não achei ${nome}`);
  const fim = texto.indexOf("\n$$;", i);
  if (fim < 0) throw new Error(`fim de ${nome} não achado`);
  return texto.slice(i, fim);
}

describe("dinheiro: a função PRINCIPAL manda (D8)", () => {
  it("relatório e histórico do repasse juntam só a linha principal", () => {
    for (const nome of ["public.payout_report_candidates", "public.payout_history"]) {
      expect(corpo(M, nome)).toContain("and u.assignment_kind = 'principal'");
    }
  });

  it("o nível do repasse vem da principal, não de uma linha qualquer", () => {
    expect(corpo(M, "public.payout_rate_for")).toMatch(/order by \(ucr\.assignment_kind = 'principal'\) desc[^;]*\n\s*limit 1;/);
    expect(corpo(M, "public.payout_report_generate")).toMatch(/order by \(u\.assignment_kind = 'principal'\) desc[^;]*\n\s*limit 1;/);
  });

  it("o prêmio do Indica é um por pessoa (2012)", () => {
    expect(corpo(ler("2012_indica_um_premio_por_pessoa.sql"), "indica.aprovar_apuracao")).toContain(
      "and r.assignment_kind = 'principal'"
    );
  });

  it("uma principal por pessoa por unidade, travada no banco", () => {
    expect(M).toContain("create unique index if not exists user_clinic_roles_one_principal");
    expect(M).toContain("where assignment_kind = 'principal'");
  });

  it("⚠️ migração NOVA que leia o nível de carreira pela função tem de escolher a principal", () => {
    // Daqui para a frente: quem ler `career_level_id` de user_clinic_roles(_all)
    // sem citar `assignment_kind` voltaria a pegar uma linha qualquer.
    const novas = readdirSync(DIR).filter((f) => /^0(41[4-9]|4[2-9]\d|[5-9]\d\d)_/.test(f));
    for (const f of novas) {
      const t = ler(f);
      if (/user_clinic_roles(_all)?[\s\S]{0,400}career_level_id|career_level_id[\s\S]{0,400}user_clinic_roles/.test(t)) {
        expect(t, `${f} lê o nível sem escolher a função principal`).toContain("assignment_kind");
      }
    }
  });
});

describe("a tranca é por FUNÇÃO", () => {
  it("o fechado guarda a função e a janela esconde só ela", () => {
    expect(corpo(M, "public.refresh_system_closed")).toContain(
      "insert into public.system_closed_clinics (user_id, clinic_id, role)"
    );
    expect(M).toMatch(/c\.clinic_id = r\.clinic_id\n\s*and c\.role = r\.role/);
  });

  it("liberar com duas funções exige dizer qual; tirar pode ser só uma", () => {
    expect(corpo(M, "public.grant_clinic_access")).toContain("ROLE_REQUIRED");
    expect(corpo(M, "public.revoke_clinic_access")).toContain("(p_role is null or role = p_role)");
  });
});

describe("avisos: um por pessoa, por fato", () => {
  it("o gatilho do banco barra o mesmo aviso no mesmo instante", () => {
    const f = corpo(M, "public._notification_dedupe");
    expect(f).toContain("n.created_at = new.created_at");
    expect(f).toContain("return null;");
    expect(M).toContain("before insert on public.notifications");
  });
});

describe("o app", () => {
  it("a lista de repasses tem uma linha por pessoa", () => {
    const tela = readFileSync(join(ROOT, "src/app/(app)/financeiro/repasses/page.tsx"), "utf8");
    expect(tela).toContain("const porPessoa = new Map");
  });

  it("o nível é gravado só na principal", () => {
    const acao = readFileSync(join(ROOT, "src/app/(app)/financeiro/repasses/actions.ts"), "utf8");
    expect(acao).toMatch(/update\(\{ career_level_id: input\.levelId \}\)[\s\S]{0,300}\.eq\("assignment_kind", "principal"\)/);
  });
});
