import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// AP50 (varredura do schema `empresarial`, 16/10/2026): funções que GRAVAVAM
// executavam sem login e sem conferir quem chamava — confirmado na produção
// para cancelar cobrança (1029) e para excluir titular, completar cadastro e
// ligar dependente (1030). A régua olha a ÚLTIMA migração que mexe em cada
// uma: a guarda tem de estar no corpo, e a permissão tem de excluir `anon`.

const PASTA = join(__dirname, "..", "..", "..", "supabase", "migrations");
const arquivos = readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const sql = (f: string) => readFileSync(join(PASTA, f), "utf8");

/** O corpo da definição mais recente da função (nas migrações). */
function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+empresarial\\.${nome}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`,
    "gi"
  );
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const f of arquivos) for (const m of sql(f).matchAll(re)) achado = { arquivo: f, corpo: m[2] };
  if (!achado) throw new Error(`NÃO MEDI: não achei a definição de empresarial.${nome}`);
  return achado;
}

/** A permissão mais recente dada/tirada da função. */
function ultimoRevoke(nome: string): string {
  let ultimo = "";
  const re = new RegExp(`revoke\\s+(?:all|execute)[^;]*on\\s+function\\s+empresarial\\.${nome}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`, "gi");
  for (const f of arquivos) for (const m of sql(f).matchAll(re)) ultimo = m[1];
  return ultimo;
}

const GRAVAM = [
  "delete_employee",
  "complete_employee",
  "link_dependent",
  "cancel_billing",
  "reverse_billing",
  "salvar_acordo_de_cobranca",
];

describe("AP50: as funções do Empresarial que gravam conferem quem chama", () => {
  it.each(GRAVAM)("%s tem guarda no corpo (NOT_ALLOWED)", (nome) => {
    const { corpo } = ultimaDefinicao(nome);
    expect(corpo).toMatch(/raise exception 'NOT_ALLOWED'/);
  });

  it.each([...GRAVAM, "delete_billing", "check_funnel_alerts"])(
    "%s não executa sem login (a permissão tira anon)",
    (nome) => {
      const de = ultimoRevoke(nome);
      expect(de, `${nome}: nenhum revoke achado`).not.toBe("");
      expect(de).toMatch(/\banon\b/);
    }
  );

  it("as que criam cliente conferem também a UNIDADE escolhida", () => {
    for (const nome of ["complete_employee", "link_dependent"]) {
      expect(ultimaDefinicao(nome).corpo, nome).toMatch(
        /p_clinic_id in \(select public\.user_full_access_clinic_ids\(\)\)\) then\s+raise exception 'NOT_ALLOWED';/
      );
    }
  });

  it("a régua do banco é a mesma da tela (quem mexe nos titulares)", () => {
    const banco = ultimaDefinicao("can_manage_employees").corpo;
    const tela = readFileSync(
      join(__dirname, "..", "..", "app", "(app)", "empresarial", "[companyId]", "employee-actions.ts"),
      "utf8"
    );
    const papeisDoBanco = [...banco.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const trechoDaTela = tela.slice(tela.indexOf("function canManageEmployees"), tela.indexOf("function field"));
    const papeisDaTela = [...trechoDaTela.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(papeisDaTela.length).toBeGreaterThan(0);
    expect(papeisDoBanco).toEqual(papeisDaTela);
    expect(banco).toContain("empresarial.is_program_manager()");
    expect(trechoDaTela).toContain("isProgramManager(session)");
  });
});
