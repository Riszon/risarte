import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { opcaoAbertaPorPadrao } from "@/lib/planning";

// OC-00092 (07/10/2026): o Coordenador não achava onde aprovar o plano. Os
// botões ficavam dentro das opções, todas recolhidas; e o cartão do Início
// que avisa do plano pendente o mandava para uma tela que só o Planner abre.

const ler = (caminho: string) =>
  readFileSync(join(process.cwd(), caminho), "utf8").replace(/\r\n/g, "\n");

describe("a opção do plano começa aberta ou recolhida?", () => {
  it("quem avalia um plano aguardando aprovação vê TODAS abertas", () => {
    expect(opcaoAbertaPorPadrao({ avaliando: true, editando: false, principal: true })).toBe(true);
    expect(opcaoAbertaPorPadrao({ avaliando: true, editando: false, principal: false })).toBe(true);
  });

  it("quem edita vê só a principal aberta", () => {
    expect(opcaoAbertaPorPadrao({ avaliando: false, editando: true, principal: true })).toBe(true);
    expect(opcaoAbertaPorPadrao({ avaliando: false, editando: true, principal: false })).toBe(false);
  });

  it("na leitura, tudo recolhido", () => {
    expect(opcaoAbertaPorPadrao({ avaliando: false, editando: false, principal: true })).toBe(false);
  });

  it("a tela usa a regra, e 'avaliando' é: pode avaliar E o plano aguarda aprovação", () => {
    const tela = ler("src/app/(app)/prontuarios/[id]/planning-section.tsx");
    expect(tela).toMatch(
      /opcaoAbertaPorPadrao\(\{\s*avaliando: canReview && plan\?\.status === "submitted",/
    );
  });
});

describe("o cartão 'Planos aguardando sua aprovação' leva a uma tela que o Coordenador abre", () => {
  const dados = ler("src/app/(app)/inicio-dados.ts");
  const inicio = dados.indexOf('chave: "aprovacao"');
  const bloco = dados.slice(inicio, dados.indexOf("});", inicio));

  it("achou o cartão (não achar = régua cega, não 'tudo certo')", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(bloco).toMatch(/href:/);
  });

  it("aponta para Planos de Tratamento, já no filtro e na unidade ativa", () => {
    expect(bloco).toMatch(/href: `\/planos\?situacao=aguardando_aprovacao&unidade=\$\{clinica\.id\}`/);
  });

  it("não aponta para o Centro de Planejamento, que devolve quem não é Planner", () => {
    expect(bloco).not.toMatch(/href:\s*[`"']\/planejamento/);
    const planejamento = ler("src/app/(app)/planejamento/page.tsx");
    // A premissa da régua: se /planejamento passar a aceitar o Coordenador,
    // esta régua deixa de fazer sentido e tem de ser revista.
    expect(planejamento).toMatch(/if \(!isPlanner\) redirect\("\/"\)/);
  });

  it("o filtro que o cartão usa existe na tela de destino", () => {
    expect(ler("src/app/(app)/planos/page.tsx")).toMatch(/"aguardando_aprovacao"/);
  });
});
