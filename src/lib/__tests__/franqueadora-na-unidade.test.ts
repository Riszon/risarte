import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canSettleOrtho, canViewOrthoMoney } from "@/lib/ortodontia/access";
import { matrizPadrao } from "@/lib/permissions";
import type { SessionContext } from "@/lib/auth";

// AP178 (18/11/2026): a equipe da Franqueadora não tem função NA UNIDADE, e
// `pode(session, capacidade, unidade)` só olha a função da unidade. O banco
// conta a Franqueadora: `signature_can` pelo escopo da pessoa, e
// `ortho_can_settle` / `ortho_can_see_money` em qualquer unidade.
// Achado no roteiro da ortodontia: o Consultor não enviava o contrato pelo
// Fechamento e o Financeiro da Franqueadora não dava baixa na mensalidade.

const F = "franqueadora";
const U = "unidade";

const sessao = (rolesByClinic: Record<string, string[]>) =>
  ({
    isAdminMaster: false,
    userId: "pessoa",
    rolesByClinic,
    permissoes: matrizPadrao(),
    clinics: [
      { id: F, name: "Franqueadora", type: "franchisor", is_active: true },
      { id: U, name: "Unidade", type: "franchise_unit", is_active: true },
    ],
  }) as unknown as SessionContext;

describe("ortodontia: o Financeiro da Franqueadora numa unidade (espelho de ortho_can_settle)", () => {
  it("dá baixa e vê o dinheiro na unidade, sem ter função nela", () => {
    const s = sessao({ [F]: ["finance_franchisor"] });
    expect(canSettleOrtho(s, U)).toBe(true);
    expect(canViewOrthoMoney(s, U)).toBe(true);
  });
  it("o Gerente da unidade continua dando baixa; o Dentista continua sem ver dinheiro", () => {
    expect(canSettleOrtho(sessao({ [U]: ["unit_manager"] }), U)).toBe(true);
    expect(canSettleOrtho(sessao({ [U]: ["dentist"] }), U)).toBe(false);
    expect(canViewOrthoMoney(sessao({ [U]: ["dentist"] }), U)).toBe(false);
  });
  it("o Consultor da Franqueadora não ganha a baixa (não é da rede financeira)", () => {
    expect(canSettleOrtho(sessao({ [F]: ["commercial_consultant"] }), U)).toBe(false);
  });
});

describe("assinaturas: a tela pergunta ao banco (signature_can), não a pode() da unidade", () => {
  const ler = (f: string) => readFileSync(f, "utf8");
  const ondeSeEnvia = [
    "src/app/(app)/comercial/[clientId]/page.tsx",
    "src/app/(app)/apresentacao/[clientId]/page.tsx",
    "src/app/(app)/prontuarios/[id]/page.tsx",
    "src/lib/signatures/envio-dados.ts",
    "src/lib/signatures/send.ts",
  ];
  it.each(ondeSeEnvia)("%s confere o envio pelo banco", (f) => {
    const s = ler(f);
    expect(s).toContain('"acao.assinaturas.enviar"');
    expect(s).toContain("podeNoBanco(");
    expect(s).not.toMatch(/canSendSignatures\(\s*(input\.)?session\s*,/);
  });
  it("o cockpit e a ficha leem a situação do pacote pelo banco", () => {
    for (const f of ["src/app/(app)/comercial/[clientId]/page.tsx", "src/app/(app)/prontuarios/[id]/page.tsx"]) {
      const s = ler(f);
      expect(s).toContain('"acao.assinaturas.visualizar"');
      expect(s).not.toMatch(/canViewSignaturePackages\(\s*session\s*,/);
    }
  });
});
