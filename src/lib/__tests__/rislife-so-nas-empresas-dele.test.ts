import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionContext } from "@/lib/auth";
import { matrizPadrao } from "@/lib/permissions";
import type { UserRole } from "@/lib/roles";
import { canWorkOnCompanies, isProgramFinance, isProgramManager } from "@/lib/empresarial/access";
import { montarContrato, type Contratada, type DadosDaEmpresaNoContrato } from "@/lib/empresarial/contrato";
import { candidatosDaRisarte } from "@/lib/signatures/send-empresa";
import type { SignatureTemplate, StaffSignerOption } from "@/lib/signatures/types";

// AP95, entrega 2 (decisão do dono, 03/11/2026): o Consultor RisLife faz o
// contato e a venda do programa às empresas. Trabalha SÓ no Empresarial e só
// nas empresas e nos leads em que é o responsável; lead sem responsável fica
// com o gestor. Vê tudo das empresas dele e dos beneficiários; não leva
// ninguém à unidade; das cobranças, só vê. Assina o contrato de adesão pela
// Risarte (sem consultor responsável, assina quem envia) — e o texto o cita.
//
// O banco é quem garante (1039): `is_program_manager()` sem ele;
// `is_my_company()` nas regras dos dados da empresa e dos titulares.

const RAIZ = join(__dirname, "..", "..", "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8").replace(/\r\n/g, "\n");

/** Corpo de cada função, pela última migração que a (re)cria. */
function ultimasDefinicoes(): Map<string, string> {
  const defs = new Map<string, string>();
  const FN =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi;
  for (const arquivo of readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    for (const m of sql.matchAll(FN)) defs.set(m[1].toLowerCase().replace(/"/g, ""), m[3]);
  }
  return defs;
}

/** O texto da última criação de cada política (`tabela.nome`). */
function ultimasPoliticas(): Map<string, string> {
  const pols = new Map<string, string>();
  const POL = /create policy (\w+) on ([\w.]+)([\s\S]*?);/gi;
  for (const arquivo of readdirSync(PASTA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(PASTA, arquivo), "utf8");
    for (const m of sql.matchAll(POL)) pols.set(`${m[2].replace(/^empresarial\./, "")}.${m[1]}`, m[3]);
  }
  return pols;
}

function sessao(papel: UserRole | null, admin = false): SessionContext {
  return {
    isAdminMaster: admin,
    rolesByClinic: papel ? { matriz: [papel] } : {},
    permissoes: matrizPadrao(),
    clinics: [{ id: "matriz", name: "Franqueadora", type: "franchisor", is_active: true }],
  } as unknown as SessionContext;
}

describe("o banco: o consultor só nas empresas e nos leads dele (1039)", () => {
  const defs = ultimasDefinicoes();
  const pols = ultimasPoliticas();

  it("o gestor do programa não inclui o Consultor RisLife", () => {
    const gestor = defs.get("empresarial.is_program_manager");
    expect(gestor).toBeDefined();
    expect(gestor).not.toMatch(/rislife_consultant/);
  });

  it("os dados da empresa e os titulares aceitam o consultor responsável", () => {
    for (const p of [
      "company_documents.company_documents_write",
      "company_files.company_files_write",
      "company_price_tiers.company_price_tiers_write",
      "company_inclusion_terms.company_inclusion_terms_write",
      "adhesion_pricing.adhesion_pricing_write",
      "procedure_benefits.procedure_benefits_write",
      "employees.employees_write",
      "dependents.dependents_write",
    ]) {
      expect(pols.get(p), `${p} sumiu`).toBeDefined();
      expect(pols.get(p), `${p} sem o ramo da empresa dele`).toMatch(/is_my_company/);
    }
  });

  it("a divisão de receita (split) segue só com o gestor", () => {
    expect(pols.get("split_rules.split_rules_write") ?? "").not.toMatch(/is_my_company/);
  });

  it("a empresa nasce com o consultor como responsável — nunca em nome de outro", () => {
    expect(pols.get("companies.companies_insert")).toMatch(
      /is_program_manager\(\)\s+or assigned_consultant_id = \(select auth\.uid\(\)\)/
    );
  });

  it("levar à unidade (completar cadastro, vincular dependente) NÃO é do consultor", () => {
    expect(defs.get("empresarial.complete_employee")).not.toMatch(/is_my_company/);
    expect(defs.get("empresarial.link_dependent")).not.toMatch(/is_my_company/);
  });

  it("o resumo do uso só responde ao gestor e ao consultor responsável", () => {
    const resumo = defs.get("empresarial.consultant_usage_summary") ?? "";
    expect(resumo).toMatch(/is_my_company\(p_company_id\)/);
    expect(resumo).toMatch(/raise exception 'NOT_ALLOWED'/);
    // Sem dado clínico: nada de sessões, evolução, anamnese ou CPF.
    expect(resumo).not.toMatch(/treatment_sessions|clinical_|anamnes|\bcpf\b/);
  });
});

describe("a tela segue o banco", () => {
  it("o consultor não é gestor, mas trabalha nas empresas (as dele)", () => {
    expect(isProgramManager(sessao("rislife_consultant"))).toBe(false);
    expect(canWorkOnCompanies(sessao("rislife_consultant"))).toBe(true);
    expect(isProgramFinance(sessao("rislife_consultant"))).toBe(false);
    expect(isProgramManager(sessao("franchisor_staff"))).toBe(true);
    expect(canWorkOnCompanies(sessao("finance_franchisor"))).toBe(false);
  });

  it("as configurações da rede seguem só com o gestor", () => {
    expect(ler("src/app/(app)/empresarial/configuracoes/page.tsx")).toContain(
      'if (!isProgramManager(session)) redirect("/empresarial");'
    );
  });

  it("o relatório de uso do consultor vem do resumo sem dado clínico", () => {
    const pagina = ler("src/app/(app)/empresarial/[companyId]/relatorio-beneficios/page.tsx");
    const resumo = pagina.indexOf('rpc("consultant_usage_summary"');
    expect(resumo).toBeGreaterThan(0);
    // O relatório completo só é carregado DEPOIS do ramo do consultor ter voltado.
    expect(pagina.indexOf("await loadBenefitsReport(companyId)")).toBeGreaterThan(resumo);
  });

  it("sem unidade para escolher, não aparece 'Completar cadastro' nem 'Vincular cliente'", () => {
    const aba = ler("src/app/(app)/empresarial/[companyId]/titulares-tab.tsx");
    expect(aba).toMatch(/employee\.status === "ACTIVE" &&\s+units\.length > 0 && \(/);
    expect(aba).toContain("{!d.clientId && units.length > 0 && (");
  });
});

describe("quem assina o contrato de adesão pela Risarte", () => {
  const pessoa = (key: string, nome: string): StaffSignerOption => ({
    key,
    user_id: key,
    staff_member_id: null,
    name: nome,
    cpf: null,
    email: null,
    phone: null,
    role_label: "",
  });
  const modelo = (role: UserRole | null) =>
    ({ risarte_signer_mode: "role", risarte_signer_role: role, risarte_signer_user_id: null }) as SignatureTemplate;
  const base = {
    sender: pessoa("admin", "Quem envia"),
    staff: [],
    byRole: { owner: [pessoa("titular", "Titular")], rislife_consultant: [pessoa("c1", "Consultor 1"), pessoa("c2", "Consultor 2")] },
  };

  it("o modelo do consultor oferece SÓ o responsável (não todos os consultores)", () => {
    const r = candidatosDaRisarte({ ...base, template: modelo("rislife_consultant"), responsavel: pessoa("c2", "Consultor 2") });
    expect(r.map((p) => p.key)).toEqual(["c2"]);
  });

  it("sem responsável ativo na equipe, ninguém (a janela diz o porquê)", () => {
    expect(candidatosDaRisarte({ ...base, template: modelo("rislife_consultant"), responsavel: null })).toEqual([]);
  });

  it("o modelo do titular continua oferecendo o titular", () => {
    expect(candidatosDaRisarte({ ...base, template: modelo(null) }).map((p) => p.key)).toEqual(["titular"]);
  });

  it("o texto do contrato cita o de quem assina, e diz onde completar", () => {
    const daFicha: Contratada = {
      legalName: "RISARTE TESTE LTDA",
      cnpj: "11.222.333/0001-44",
      address: "Rua do Teste, 1, Cambé/PR",
      signingCity: "Cambé/PR",
      repName: "Consultor de Teste",
      repRole: "Consultor Comercial Empresarial (RisLife)",
      repNationality: null,
      repRg: null,
      repCpf: "529.982.247-25",
      repGender: "M",
      repOrigem: "ficha do Risartano Consultor de Teste",
    };
    const empresa = {
      companyName: "Aurora",
      cnpj: "55666777000188",
      legalName: "Aurora Ltda",
      category: "empresa_privada",
      address: { street: "Rua A", number: "1", city: "Cambé", state: "PR" },
      responsibleName: "Maria",
      responsibleRole: "diretora",
      responsibleNationality: null,
      responsibleRg: null,
      responsibleCpf: "999.888.777-66",
      responsibleGender: "F",
      dueDay: null,
      billingBasis: "PER_EMPLOYEE",
      fixedMonthlyCents: null,
      employeeCount: 10,
      holderFeeCents: 3500,
      includesDependents: true,
      dependentFeeCents: 3000,
      dependentMode: "FAMILY_PACKAGE",
      dependentFamilyFeeCents: 5000,
      dependentFamilyExtraFeeCents: 1500,
      dependentFamilySize: 4,
    } as DadosDaEmpresaNoContrato;
    const { valores, faltando, avisos } = montarContrato({
      empresa,
      faixas: [],
      contratada: daFicha,
      unidades: [{ city: "Cambé", state: "PR" }],
      beneficios: 1,
      hoje: "2026-11-03",
    });
    expect(valores.contratada_representante).toBe("Consultor de Teste");
    expect(faltando).toContain("RG do representante da Risarte (ficha do Risartano Consultor de Teste)");
    expect(avisos.some((a) => a.includes("nacionalidade") && a.includes("ficha do Risartano"))).toBe(true);
  });
});
