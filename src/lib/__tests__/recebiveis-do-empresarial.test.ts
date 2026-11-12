// AP147 (relato OC-00166) — AS COBRANÇAS DO EMPRESARIAL EM ABERTO NOS
// RECEBÍVEIS DA FRANQUEADORA E DA REDE, EM BLOCO PRÓPRIO (decisão do dono,
// 12/11/2026: da Franqueadora; fora do % de inadimplência dos pacientes).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recebiveisDoEmpresarial,
  type CobrancaDaEmpresa,
} from "@/lib/finance/recebiveis-do-empresarial";

const c = (p: Partial<CobrancaDaEmpresa>): CobrancaDaEmpresa => ({
  id: p.id ?? "x",
  companyId: "e1",
  empresa: "Empresa",
  tipo: "MONTHLY",
  mesReferencia: "2026-11-01",
  valorCents: 10000,
  situacao: "PENDING",
  vencimento: "2026-11-20",
  ...p,
});

describe("AP147 — a conta das cobranças das empresas", () => {
  const hoje = "2026-11-12";

  it("só pendente e em atraso são dívida", () => {
    const { linhas, resumo } = recebiveisDoEmpresarial(
      [
        c({ id: "a", situacao: "PENDING" }),
        c({ id: "b", situacao: "OVERDUE", vencimento: "2026-11-01" }),
        c({ id: "c", situacao: "PAID" }),
        c({ id: "d", situacao: "CANCELLED" }),
      ],
      hoje
    );
    expect(linhas.map((l) => l.id)).toEqual(["b", "a"]);
    expect(resumo.abertoCents).toBe(20000);
  });

  it("vencido é pela DATA, também quando a situação ainda diz pendente", () => {
    const { resumo, linhas } = recebiveisDoEmpresarial(
      [c({ id: "a", situacao: "PENDING", vencimento: "2026-10-31", valorCents: 30000 })],
      hoje
    );
    expect(resumo.vencidoCents).toBe(30000);
    expect(resumo.vencidoQuantidade).toBe(1);
    expect(linhas[0].diasDeAtraso).toBe(12);
  });

  it("vence hoje não está vencida", () => {
    const { resumo } = recebiveisDoEmpresarial([c({ vencimento: hoje })], hoje);
    expect(resumo.vencidoCents).toBe(0);
  });

  it("a taxa é vencido ÷ a receber, com uma casa; sem nada a receber, não há taxa", () => {
    const { resumo } = recebiveisDoEmpresarial(
      [
        c({ id: "a", vencimento: "2026-11-01", valorCents: 10000 }),
        c({ id: "b", valorCents: 20000 }),
      ],
      hoje
    );
    expect(resumo.taxaPercent).toBe(33.3);
    expect(recebiveisDoEmpresarial([], hoje).resumo.taxaPercent).toBeNull();
  });

  it("sem vencimento entra no a receber e nunca no vencido", () => {
    const { resumo } = recebiveisDoEmpresarial([c({ vencimento: null })], hoje);
    expect(resumo.abertoCents).toBe(10000);
    expect(resumo.vencidoCents).toBe(0);
    expect(resumo.semVencimento).toBe(1);
  });
});

describe("AP147 — onde o bloco aparece", () => {
  const ler = (f: string) => readFileSync(f, "utf8");
  const bloco = ler("src/app/(app)/financeiro/recebiveis/bloco-do-empresarial.tsx");
  const unidade = ler("src/app/(app)/financeiro/recebiveis/page.tsx");
  const rede = ler("src/app/(app)/financeiro/recebiveis-da-rede/page.tsx");

  it("o bloco lê as cobranças em aberto e passa pela conta única", () => {
    expect(bloco).toContain('.from("adhesion_billing")');
    expect(bloco).toContain('.in("status", ["PENDING", "OVERDUE"])');
    expect(bloco).toContain("recebiveisDoEmpresarial(");
    // Leitura que falha diz que falhou (nunca R$ 0,00).
    expect(bloco).toMatch(/if \(error\) \{[\s\S]*?Não foi possível ler as cobranças das empresas/);
  });

  it("na unidade, só na Franqueadora e para quem cuida do financeiro do programa", () => {
    expect(unidade).toMatch(
      /session\.activeClinic\?\.type === "franchisor" && isProgramFinance\(session\) && \(\s*<BlocoDoEmpresarial \/>/
    );
  });

  it("na rede, sempre (a tela já é só do Admin e do Financeiro da Franqueadora)", () => {
    expect(rede).toContain("<BlocoDoEmpresarial />");
  });

  it("bloco próprio: nada do Empresarial entra na conta dos pacientes", () => {
    expect(ler("src/app/(app)/financeiro/recebiveis/dados.ts")).not.toContain("adhesion_billing");
    expect(ler("src/lib/finance/network-receivables.ts")).not.toContain("adhesion_billing");
  });
});
