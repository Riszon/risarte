import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeMonthlyCents,
  titularesDaMensalidade,
  type AdhesionPricing,
  type MonthlyEmployee,
} from "@/lib/empresarial/pricing";

// OC-00090 (dono, 07/10/2026): a mensalidade combinada é cobrada mesmo quando
// a empresa ainda não mandou os dados dos colaboradores. O CONTRATADO é o
// mínimo. Antes a conta olhava só os cadastrados: 1 de 7 = R$ 39,90, e sem
// nenhum cadastrado recusava gerar.

const PRECOS: AdhesionPricing = {
  holderFeeCents: 3990,
  dependentIndividualFeeCents: 3990,
  dependentFamilyFeeCents: 5990,
  dependentFamilyExtraFeeCents: 1990,
  maxInstallments: 24,
};

const titulares = (n: number): MonthlyEmployee[] =>
  Array.from({ length: n }, () => ({
    status: "ACTIVE",
    dependentPlan: "NONE",
    activeDependentCount: 0,
  }));

describe("quantos titulares a mensalidade cobra", () => {
  it("menos cadastrados que contratados: cobra o contratado", () => {
    expect(titularesDaMensalidade(2, 7)).toEqual({ cobrados: 7, faltamCadastrar: 5 });
  });

  it("nenhum cadastrado: cobra o contratado inteiro", () => {
    expect(titularesDaMensalidade(0, 7)).toEqual({ cobrados: 7, faltamCadastrar: 7 });
  });

  it("cadastrados no contratado ou acima: cobra os cadastrados, não falta ninguém", () => {
    expect(titularesDaMensalidade(7, 7)).toEqual({ cobrados: 7, faltamCadastrar: 0 });
    expect(titularesDaMensalidade(9, 7)).toEqual({ cobrados: 9, faltamCadastrar: 0 });
  });

  it("sem quantidade contratada (nulo): só os cadastrados contam, como sempre", () => {
    expect(titularesDaMensalidade(3, null)).toEqual({ cobrados: 3, faltamCadastrar: 0 });
    expect(titularesDaMensalidade(0, null)).toEqual({ cobrados: 0, faltamCadastrar: 0 });
    expect(titularesDaMensalidade(0, undefined)).toEqual({ cobrados: 0, faltamCadastrar: 0 });
  });

  it("número estranho não vira cobrança: negativo e NaN contam como zero", () => {
    expect(titularesDaMensalidade(-3, -5)).toEqual({ cobrados: 0, faltamCadastrar: 0 });
    expect(titularesDaMensalidade(Number.NaN, Number.NaN)).toEqual({ cobrados: 0, faltamCadastrar: 0 });
  });
});

describe("a mensalidade pelo contratado", () => {
  it("o caso do relato: 1 cadastrado de 7 contratados cobra 7, não R$ 39,90", () => {
    const r = computeMonthlyCents(PRECOS, titulares(1), [], 7);
    expect(r.totalCents).toBe(7 * 3990);
    expect(r.titularesCobrados).toBe(7);
    expect(r.faltamCadastrar).toBe(6);
    expect(r.holdersCount).toBe(1); // os CADASTRADOS continuam sendo 1
  });

  it("nenhum cadastrado: a mensalidade existe (antes era recusada)", () => {
    expect(computeMonthlyCents(PRECOS, [], [], 5).totalCents).toBe(5 * 3990);
  });

  it("a faixa é a do CONTRATADO: 2 cadastrados de 100 pagam o preço de 100", () => {
    const faixas = [{ minQuantity: 100, priceCents: 2990 }];
    const r = computeMonthlyCents(PRECOS, titulares(2), faixas, 100);
    expect(r.porTitularCents).toBe(2990);
    expect(r.totalCents).toBe(100 * 2990);
  });

  it("dependentes: só os de quem já está cadastrado", () => {
    const lista: MonthlyEmployee[] = [
      { status: "ACTIVE", dependentPlan: "INDIVIDUAL", activeDependentCount: 1 },
    ];
    const r = computeMonthlyCents(PRECOS, lista, [], 4);
    expect(r.holdersCents).toBe(4 * 3990);
    expect(r.dependentsCents).toBe(3990);
    expect(r.totalCents).toBe(4 * 3990 + 3990);
  });

  it("sem o mínimo, nada muda para quem já era cobrado", () => {
    expect(computeMonthlyCents(PRECOS, titulares(120)).totalCents).toBe(120 * 3990);
    expect(computeMonthlyCents(PRECOS, titulares(120), [], null).faltamCadastrar).toBe(0);
  });

  it("inativo não conta como cadastrado", () => {
    const lista: MonthlyEmployee[] = [
      ...titulares(2),
      { status: "INACTIVE", dependentPlan: "NONE", activeDependentCount: 0 },
    ];
    const r = computeMonthlyCents(PRECOS, lista, [], 3);
    expect(r.holdersCount).toBe(2);
    expect(r.faltamCadastrar).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RÉGUAS — a tela e o boleto têm de usar a MESMA base (lição do AP18).
// ---------------------------------------------------------------------------

const RAIZ = process.cwd();
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

/** Os argumentos de cada chamada `nome(...)`, separados pelas vírgulas de fora. */
function argumentosDasChamadas(fonte: string, nome: string): string[][] {
  const chamadas: string[][] = [];
  let i = 0;
  while ((i = fonte.indexOf(nome + "(", i)) !== -1) {
    let j = i + nome.length + 1;
    let fundo = 1;
    let atual = "";
    const args: string[] = [];
    for (; j < fonte.length && fundo > 0; j++) {
      const ch = fonte[j];
      if ("([{".includes(ch)) fundo++;
      else if (")]}".includes(ch)) fundo--;
      if (fundo === 0) break;
      if (ch === "," && fundo === 1) {
        args.push(atual.trim());
        atual = "";
      } else atual += ch;
    }
    if (atual.trim()) args.push(atual.trim());
    chamadas.push(args);
    i = j;
  }
  return chamadas;
}

describe("régua: toda tela que calcula a mensalidade passa o mínimo contratado", () => {
  const telas = arquivos(join(RAIZ, "src/app")).filter((a) =>
    readFileSync(a, "utf8").includes("computeMonthlyCents(")
  );

  it("achou as telas (zero = régua cega, não 'tudo certo')", () => {
    expect(telas.length).toBeGreaterThanOrEqual(5);
  });

  it.each(telas.map((t) => [t.slice(RAIZ.length + 1).replace(/\\/g, "/"), t]))(
    "%s",
    (_nome, caminho) => {
      const chamadas = argumentosDasChamadas(
        readFileSync(caminho, "utf8"),
        "computeMonthlyCents"
      );
      expect(chamadas.length).toBeGreaterThan(0);
      for (const args of chamadas) {
        // (preço, titulares, faixas, MÍNIMO): sem o 4º a tela mostraria os
        // cadastrados e o boleto cobraria o contratado.
        expect(args.length, `chamada com ${args.length} argumento(s)`).toBe(4);
      }
    }
  );
});

describe("régua: a cobrança da mensalidade usa o contratado e avisa", () => {
  const acoes = ler("src/app/(app)/empresarial/[companyId]/billing-actions.ts");
  const lote = ler("src/app/(app)/empresarial/cobrancas/actions.ts");

  it("a prévia pede o contratado só na MENSALIDADE (a implantação tem a própria conta)", () => {
    expect(acoes).toMatch(
      /computeMonthlyBreakdown\(db, companyId, \{\s*peloContratado: billingType === "MONTHLY",\s*\}\)/
    );
  });

  it("a recusa antiga saiu: 'Complete os cadastros antes' não existe mais", () => {
    expect(acoes).not.toMatch(/Complete os cadastros antes/);
  });

  it("gerar pela empresa e gerar em lote avisam os gestores", () => {
    expect(acoes).toMatch(/await avisarCadastrosPendentes\(db, companyId, preview\.referenceMonth\)/);
    expect(lote).toMatch(/await avisarCadastrosPendentes\(db, companyId, preview\.referenceMonth\)/);
  });

  it("o aviso nunca derruba a cobrança: não lança nem devolve erro", () => {
    const servidor = ler("src/lib/empresarial/cobranca-servidor.ts");
    const inicio = servidor.indexOf("export async function avisarCadastrosPendentes");
    expect(inicio).toBeGreaterThan(0);
    const corpo = servidor.slice(inicio, servidor.indexOf("\n}\n", inicio));
    expect(corpo).toMatch(/Promise<void>/);
    expect(corpo).not.toMatch(/\bthrow\b/);
  });
});
