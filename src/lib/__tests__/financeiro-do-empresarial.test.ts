import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionContext } from "@/lib/auth";
import { matrizPadrao } from "@/lib/permissions";
import type { UserRole } from "@/lib/roles";
import { isProgramFinance, isProgramManager } from "@/lib/empresarial/access";

// Relato OC-00105 (Financeiro da Franqueadora, treino, 16/10/2026): "Gerar
// cobrança mensal" no Empresarial respondia "Sem permissão". Não era defeito —
// a regra escrita dava a cobrança só ao gestor do programa. DECISÃO DO DONO:
// o Financeiro da Franqueadora faz SÓ O FINANCEIRO do programa (cobranças,
// baixas, estornos, inadimplência e o Acordo de cobrança); funil, proposta,
// contrato, termos e configurações seguem com o gestor. A régua da tela
// espelha a do banco (`empresarial.is_program_finance`, 1029).

const RAIZ = join(__dirname, "..", "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

function sessao(papel: UserRole | null, admin = false): SessionContext {
  return {
    isAdminMaster: admin,
    rolesByClinic: papel ? { matriz: [papel] } : {},
    permissoes: matrizPadrao(),
    clinics: [{ id: "matriz", name: "Franqueadora", type: "franchisor", is_active: true }],
  } as unknown as SessionContext;
}

describe("quem cuida do financeiro do Empresarial", () => {
  it("o Financeiro da Franqueadora cobra, mas NÃO gere o programa", () => {
    expect(isProgramFinance(sessao("finance_franchisor"))).toBe(true);
    expect(isProgramManager(sessao("finance_franchisor"))).toBe(false);
  });

  it("os gestores do programa continuam cobrando", () => {
    expect(isProgramFinance(sessao(null, true))).toBe(true);
    expect(isProgramFinance(sessao("franchisor_staff"))).toBe(true);
    expect(isProgramFinance(sessao("rislife_consultant"))).toBe(true);
  });

  it("a unidade não cobra", () => {
    for (const papel of ["receptionist", "unit_manager", "sdr", "franchisee"] as UserRole[]) {
      expect(isProgramFinance(sessao(papel)), papel).toBe(false);
    }
  });
});

describe("as ações de cobrança usam a régua do financeiro", () => {
  const cobrancaDaEmpresa = ler("src/app/(app)/empresarial/[companyId]/billing-actions.ts");
  const cobrancasEmLote = ler("src/app/(app)/empresarial/cobrancas/actions.ts");

  it("gerar, prévia, editar, cancelar, dar baixa e checar inadimplência", () => {
    expect(cobrancaDaEmpresa.match(/if \(!isProgramFinance\(session\)\) return \{ ok: false, error: "Sem permissão\." \};/g)).toHaveLength(6);
    expect(cobrancaDaEmpresa).not.toMatch(/isProgramManager/);
  });

  it("baixa em lote, mensalidades em lote e estorno", () => {
    expect(cobrancasEmLote.match(/if \(!isProgramFinance\(session\)\) return \{ ok: false, error: "Sem permissão\." \};/g)).toHaveLength(3);
    expect(cobrancasEmLote).not.toMatch(/isProgramManager/);
    expect(ler("src/app/(app)/empresarial/cobrancas/page.tsx")).toContain("if (!isProgramFinance(session)) notFound();");
  });

  it("o Acordo de cobrança grava pela porta estreita do banco", () => {
    const acordo = ler("src/app/(app)/empresarial/[companyId]/acordo-actions.ts");
    expect(acordo).toMatch(/if \(!isProgramFinance\(session\)\) \{/);
    expect(acordo).toContain('db.rpc("salvar_acordo_de_cobranca"');
    // O caminho antigo (alterar a empresa direto) só vale para o GESTOR, e só
    // na janela em que o banco ainda não recebeu a 1029.
    expect(acordo).toMatch(/semAPorta\(erroPorta\) && isProgramManager\(session\)/);
  });

  it("o comercial continua só com o gestor do programa (decisão do dono)", () => {
    expect(ler("src/app/(app)/empresarial/configuracoes/page.tsx")).toContain("if (!isProgramManager(session)) redirect(\"/empresarial\");");
    expect(ler("src/app/(app)/empresarial/[companyId]/inclusion-actions.ts")).not.toMatch(/isProgramFinance/);
    expect(ler("src/app/(app)/empresarial/actions.ts")).not.toMatch(/isProgramFinance/);
  });
});

describe("a tela segue o banco: botão de cobrança só para quem cobra", () => {
  const aba = ler("src/app/(app)/empresarial/[companyId]/billing-tab.tsx");
  const ficha = ler("src/app/(app)/empresarial/[companyId]/page.tsx");

  it("a ficha da empresa diz à aba quem pode cobrar", () => {
    expect(ficha).toContain("const podeCobrar = isProgramFinance(session);");
    expect(ficha).toMatch(/<BillingTab[\s\S]*?podeCobrar=\{podeCobrar\}[\s\S]*?\/>/);
    expect(ficha).toContain("podeEditar={podeCobrar}");
  });

  it("os botões de gerar e os de cada cobrança dependem disso", () => {
    expect(aba).toMatch(/\{podeCobrar && \(\s*<Card>\s*<CardContent[^>]*>\s*<Button[\s\S]*?Gerar cobrança mensal/);
    expect(aba).toContain('{podeCobrar && b.status !== "PAID" && b.status !== "CANCELLED" && (');
  });

  it("o caminho para Cobranças aparece para quem cobra", () => {
    expect(ler("src/app/(app)/empresarial/page.tsx")).toMatch(/\{podeCobrar && \(\s*<Button[\s\S]*?href="\/empresarial\/cobrancas"/);
  });
});

describe("o banco (1029)", () => {
  const sql = ler("supabase/migrations/1029_financeiro_da_franqueadora_cobra_no_empresarial.sql");
  const funcao = (nome: string) => {
    const i = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION empresarial\\.${nome}\\(`, "i"));
    expect(i, nome).toBeGreaterThanOrEqual(0);
    return sql.slice(i, sql.indexOf("$function$;", i));
  };

  it("cancelar e estornar conferem quem chama — antes atendiam qualquer um", () => {
    for (const nome of ["cancel_billing", "reverse_billing"]) {
      expect(funcao(nome), nome).toMatch(
        /if not \(public\.is_admin_master\(\) or empresarial\.is_program_finance\(\)\) then\s+raise exception 'NOT_ALLOWED';/
      );
      expect(sql, nome).toContain(`revoke execute on function empresarial.${nome}(uuid, text) from public, anon, authenticated;`);
    }
  });

  it("a gravação de cobrança e a lista de empresas incluem o Financeiro", () => {
    const regra = sql.slice(sql.indexOf("create policy adhesion_billing_write"));
    expect(regra).toContain(
      "using (public.is_admin_master() or public.is_network_viewer() or empresarial.is_finance_franchisor())"
    );
    expect(regra).toContain(
      "with check (public.is_admin_master() or public.is_network_viewer() or empresarial.is_finance_franchisor());"
    );
    expect(funcao("accessible_company_ids")).toContain("or empresarial.is_finance_franchisor()");
  });

  it("baixa, inadimplência e aviso usam a régua do financeiro", () => {
    expect(funcao("settle_billing")).toContain("or empresarial.is_program_finance()) then");
    expect(funcao("mark_overdue_and_suspend")).toContain("or empresarial.is_program_finance()) then");
    expect(funcao("avisar_cadastros_pendentes")).toContain("if not empresarial.is_program_finance() then");
  });
});
