// ASA1, entrega 1 — as abas Financeiro e Comercial da Central (quem vê cada
// uma), o responsável financeiro e a carência fixa em zero. O que é do banco
// (um pagador só, carência presa em zero, histórico por papel) é provado pelo
// ensaio `scripts/asaas-ensaio-asa1-entrega1.mjs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionContext } from "@/lib/auth";
import {
  ABAS_DA_CENTRAL,
  abasVisiveis,
  podeVerAba,
  podeVerCentral,
  podeVerRedeNaCentral,
  podeVerUnidadeNaCentral,
  primeiraAba,
} from "@/lib/central/central";
import { matrizPadrao } from "@/lib/permissions";
import { erroDosResponsaveis, normalizarPagador, ordemDeGravacao } from "@/lib/responsaveis";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function sessao(p: Partial<SessionContext>): SessionContext {
  return {
    userId: "u1",
    email: "x@example.com",
    fullName: "X",
    isAdminMaster: false,
    clinics: [],
    rolesByClinic: {},
    activeClinic: null,
    activeClinicExplicit: false,
    permissoes: matrizPadrao(),
    ...p,
  } as SessionContext;
}

describe("Central por aba", () => {
  it("as abas existem nos dois níveis, na ordem da tela (a ASA2 acrescentou Cobrança e comunicação)", () => {
    expect(ABAS_DA_CENTRAL.map((a) => a.id)).toEqual(["conta", "financeiro", "comercial", "cobranca", "taxas"]);
    // ASA3 (4008): Taxas da franquia é só da Rede (o acordo da unidade mora na própria tela de taxas).
    for (const a of ABAS_DA_CENTRAL) expect(a.niveis).toEqual(["rede", "unidade"]);
  });

  it("Admin Master vê todas as abas em todo lugar", () => {
    const admin = sessao({ isAdminMaster: true });
    expect(abasVisiveis(admin, "rede").map((a) => a.id)).toEqual(["conta", "financeiro", "comercial", "cobranca", "taxas"]);
    expect(abasVisiveis(admin, "unidade", "a").map((a) => a.id)).toEqual(["conta", "financeiro", "comercial", "cobranca", "taxas"]);
    expect(podeVerCentral(admin)).toBe(true);
  });

  it("Gerente (padrão de hoje): Financeiro e Cobrança e comunicação da PRÓPRIA unidade — nada da rede, nada da conta Asaas", () => {
    const gerente = sessao({ rolesByClinic: { a: ["unit_manager"] } });
    expect(podeVerCentral(gerente)).toBe(true);
    expect(abasVisiveis(gerente, "unidade", "a").map((x) => x.id)).toEqual(["financeiro", "cobranca", "taxas"]);
    expect(abasVisiveis(gerente, "unidade", "b")).toEqual([]);
    expect(podeVerRedeNaCentral(gerente)).toBe(false);
    expect(podeVerUnidadeNaCentral(gerente, "a")).toBe(true);
    expect(primeiraAba(gerente, "unidade", "a")).toBe("financeiro");
  });

  it("Franqueado: Financeiro e Cobrança e comunicação da própria unidade", () => {
    const franqueado = sessao({ rolesByClinic: { a: ["franchisee"] } });
    expect(abasVisiveis(franqueado, "unidade", "a").map((x) => x.id)).toEqual(["financeiro", "cobranca", "taxas"]);
    expect(podeVerRedeNaCentral(franqueado)).toBe(false);
  });

  it("Financeiro da Franqueadora: Financeiro e Cobrança e comunicação na rede e em todas as unidades; Comercial e conta, não", () => {
    const fin = sessao({ rolesByClinic: { f: ["finance_franchisor"] } });
    expect(abasVisiveis(fin, "rede").map((x) => x.id)).toEqual(["financeiro", "cobranca", "taxas"]);
    expect(abasVisiveis(fin, "unidade", "qualquer").map((x) => x.id)).toEqual(["financeiro", "cobranca", "taxas"]);
  });

  it("Comercial é só do Admin Master (como Regras Comerciais sempre foi)", () => {
    for (const papel of ["unit_manager", "finance_franchisor", "commercial_consultant", "franchisee"] as const) {
      const s = sessao({ rolesByClinic: { a: [papel] } });
      expect(podeVerAba(s, "comercial", "rede"), papel).toBe(false);
      expect(podeVerAba(s, "comercial", "unidade", "a"), papel).toBe(false);
    }
  });

  it("quem não tem o Financeiro nem a conta não vê a Central", () => {
    for (const papel of ["receptionist", "dentist", "clinical_coordinator", "commercial_consultant"] as const) {
      expect(podeVerCentral(sessao({ rolesByClinic: { a: [papel] } })), papel).toBe(false);
    }
  });

  it("aba desconhecida ou unidade ausente não abre", () => {
    const admin = sessao({ isAdminMaster: true });
    expect(podeVerAba(admin, "fiscal", "rede")).toBe(false);
    expect(podeVerAba(admin, "financeiro", "unidade", null)).toBe(false);
  });

  it("componente de navegador da Central não importa código de servidor (a montagem quebraria)", () => {
    const clientes = [
      "src/app/(app)/central/financeiro-form.tsx",
      "src/app/(app)/central/conta-client.tsx",
      "src/components/central/campo-herdado.tsx",
      "src/lib/central/heranca.ts",
    ];
    for (const f of clientes) {
      const t = ler(f);
      expect(t, f).not.toMatch(/from "@\/lib\/central\/central"/);
      expect(t, f).not.toMatch(/from "@\/lib\/auth"/);
      expect(t, f).not.toMatch(/from "@\/lib\/supabase\/(server|admin)"/);
    }
  });

  it("os endereços antigos levam às abas novas", () => {
    expect(ler("src/app/(app)/financeiro/configuracao/page.tsx")).toContain('rotaDaRede("financeiro")');
    expect(ler("src/app/(app)/financeiro/configuracao/page.tsx")).toContain('rotaDaUnidade(unidade, "financeiro")');
    expect(ler("src/app/(app)/admin/regras-comerciais/page.tsx")).toContain('rotaDaRede("comercial")');
    expect(ler("src/components/app-sidebar.tsx")).toContain('href: "/central/rede/comercial", label: "Regras Comerciais"');
  });
});

describe("responsável financeiro", () => {
  it("menor com UM responsável: ele vira o pagador sozinho", () => {
    const r = normalizarPagador([{ isFinancial: false, nome: "A" }], true);
    expect(r[0].isFinancial).toBe(true);
    expect(erroDosResponsaveis(r, true)).toBeNull();
  });

  it("menor com dois e nenhum marcado: pede para marcar", () => {
    const r = normalizarPagador([{ isFinancial: false }, { isFinancial: false }], true);
    expect(erroDosResponsaveis(r, true)).toMatch(/marque qual responsável é o financeiro/);
  });

  it("menor sem responsável: recusado", () => {
    expect(erroDosResponsaveis([], true)).toMatch(/ao menos um responsável/);
  });

  it("dois marcados: recusado, para menor e para adulto", () => {
    const dois = [{ isFinancial: true }, { isFinancial: true }];
    expect(erroDosResponsaveis(dois, true)).toMatch(/só um responsável financeiro/);
    expect(erroDosResponsaveis(dois, false)).toMatch(/só um responsável financeiro/);
  });

  it("adulto: responsável é opcional, e não é marcado sozinho", () => {
    expect(erroDosResponsaveis([], false)).toBeNull();
    const um = normalizarPagador([{ isFinancial: false }], false);
    expect(um[0].isFinancial).toBe(false);
    expect(erroDosResponsaveis(um, false)).toBeNull();
  });

  it("grava primeiro quem deixa de ser pagador", () => {
    const ordem = ordemDeGravacao([
      { id: "novo", isFinancial: true },
      { id: "antigo", isFinancial: false },
    ]);
    expect(ordem.map((g) => g.id)).toEqual(["antigo", "novo"]);
  });

  it("o salvar não apaga e recria: atualiza quem continua (id estável)", () => {
    const acoes = ler("src/app/(app)/prontuarios/actions.ts");
    const corpo = acoes.slice(acoes.indexOf("async function saveGuardians"), acoes.indexOf("/** Autofill helper"));
    expect(corpo.length).toBeGreaterThan(500);
    // A estratégia antiga apagava TODOS os responsáveis do cliente.
    expect(corpo).not.toMatch(/\.delete\(\)\s*\.eq\("client_id"/);
    expect(corpo).toMatch(/\.update\(linha\(g\)\)\.eq\("id"/);
    expect(corpo).toMatch(/\.delete\(\)\.in\("id", sairam\)/);
  });

  it("a ficha manda os responsáveis também do adulto (não apaga mais ao fazer 18 anos)", () => {
    const form = ler("src/app/(app)/prontuarios/client-form.tsx");
    expect(form).toContain('formData.set("guardians", JSON.stringify(guardians));');
    expect(form).not.toContain("JSON.stringify(minor ? guardians : [])");
  });
});

describe("carência fixa em zero", () => {
  const m = ler("supabase/migrations/4003_asa1_responsavel_financeiro_e_carencia.sql");

  it("o banco prende a carência em zero e a migração para se achar outro valor", () => {
    expect(m).toContain("check (grace_days is null or grace_days = 0)");
    expect(m).toContain("raise exception 'GRACE_NOT_ZERO");
    // Nunca muda o valor sozinha.
    expect(m).not.toMatch(/update\s+public\.finance_settings/i);
  });

  it("a ação grava zero na rede e vazio na unidade, e recusa outro valor", () => {
    const acoes = ler("src/app/(app)/financeiro/actions.ts");
    expect(acoes).toContain("grace_days: naRede ? 0 : null,");
    expect(acoes).toMatch(/A carência é fixa em zero/);
  });

  it("a aba mostra a carência só para leitura, com a explicação", () => {
    const form = ler("src/app/(app)/central/financeiro-form.tsx");
    expect(form).toContain("o Asaas não aplica carência; multa e juros contam do dia seguinte ao vencimento");
    // Nenhum campo editável de carência.
    expect(form).not.toMatch(/setGrace|graceDays:\s*[a-z]/);
  });

  it("o histórico das abas novas está no banco", () => {
    expect(m).toContain("p_tab not in ('conta', 'financeiro', 'comercial')");
    expect(m).toContain("array['commercial_rules', 'commercial_followup_settings']");
  });
});
