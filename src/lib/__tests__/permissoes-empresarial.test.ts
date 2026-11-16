// 1048 — AS PERMISSÕES DO EMPRESARIAL NA MATRIZ (pedido do dono, 16/11/2026).
//
// O banco (`empresarial._padrao_da_permissao`) e o catálogo (`permissions.ts`)
// dizem os mesmos padrões; o app pergunta à matriz, não ao papel escrito.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPACIDADES_POR_ID } from "@/lib/permissions";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const MIGRACAO = ler("supabase/migrations/1048_permissoes_do_empresarial_na_matriz.sql");
const ACESSO = ler("src/lib/empresarial/access.ts");

const CAPS = [
  "acao.empresarial.gerir",
  "acao.empresarial.carteira",
  "acao.empresarial.cobrancas",
  "acao.empresarial.titulares",
  "acao.empresarial.configurar",
];

/** Os papéis que o banco dá a cada permissão, lidos da 1048. */
function padraoDoBanco(cap: string): string[] {
  const m = MIGRACAO.match(new RegExp(`when '${cap.replace(/\./g, "\\.")}' then\\s+array\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`NÃO ACHEI o padrão de ${cap} na 1048`);
  return m[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
}

describe("os padrões do banco = os do catálogo", () => {
  for (const cap of CAPS) {
    it(cap, () => {
      const c = CAPACIDADES_POR_ID.get(cap);
      expect(c, `${cap} no catálogo`).toBeDefined();
      expect(padraoDoBanco(cap)).toEqual([...c!.padrao].sort());
      // O banco lê a matriz: na tela não aparece "o banco também decide".
      expect(c!.dependeDoBanco).toBe(false);
    });
  }

  it("a semente cobre as cinco", () => {
    for (const cap of CAPS) expect(MIGRACAO).toContain(`('${cap}')`);
  });
});

describe("o app pergunta à matriz", () => {
  it("nenhum papel escrito à mão em access.ts", () => {
    expect(ACESSO).not.toMatch(/"(franchisor_staff|finance_franchisor|rislife_consultant|sdr|receptionist)"/);
    for (const cap of CAPS) expect(ACESSO).toContain(`"${cap}"`);
  });

  it("as Configurações do programa seguem a permissão própria", () => {
    expect(ler("src/app/(app)/empresarial/configuracoes/page.tsx")).toContain("if (!canConfigureProgram(session))");
    const acoes = ler("src/app/(app)/empresarial/configuracoes/actions.ts");
    expect(acoes).toContain("if (companyId === null) return canConfigureProgram(session);");
    expect(acoes).not.toContain('includes("franchisor_staff")');
  });

  it("titulares (cadastro e arquivos) seguem a permissão, não a lista de papéis", () => {
    for (const f of [
      "src/app/(app)/empresarial/[companyId]/employee-actions.ts",
      "src/app/(app)/empresarial/[companyId]/document-actions.ts",
      "src/app/(app)/empresarial/[companyId]/page.tsx",
    ]) {
      expect(ler(f), f).not.toMatch(/\["sdr", "receptionist", "unit_manager", "franchisee"\]/);
    }
  });
});

describe("o banco: as portas que passam por fora da regra da tabela", () => {
  it("inativar/restaurar titular pedem a permissão de titulares", () => {
    const n = MIGRACAO.split("and empresarial.can_manage_employees()\n       and (public.is_admin_master()").length - 1;
    expect(n).toBe(2);
  });

  it("levar à unidade exige unidade no alcance (o Consultor RisLife não liga paciente)", () => {
    const n = MIGRACAO.split("or exists (select 1 from public.user_full_access_clinic_ids())) then").length - 1;
    expect(n).toBe(2);
  });

  it("a pergunta à matriz é fechada a anônimos", () => {
    expect(MIGRACAO).toContain("revoke execute on function empresarial.pode(text) from public, anon, authenticated;");
  });
});
