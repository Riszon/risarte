import { describe, expect, it, vi } from "vitest";
import { copiarPropostaParaEmpresa } from "@/lib/empresarial/fechamento";

/**
 * O FECHAMENTO LEVANDO A PROPOSTA (OC-00083, H4 / 1018).
 *
 * ⚠️ O RISCO QUE ESTE TESTE EXISTE PARA PEGAR é campo que SOME na cópia. Ele
 * não quebra nada, não aparece em log e não derruba tela: a empresa nasce com
 * o padrão da rede, e a diferença entre o vendido e o cobrado só aparece na
 * primeira fatura — para o cliente, antes de para nós.
 *
 * O banco é de mentira de propósito: o que se mede aqui é O QUE É ESCRITO,
 * campo a campo. Que as colunas existem, a migração 1018 provou ao rodar.
 */

type Escrita = { tabela: string; linhas: unknown[] };

function bancoDeMentira(
  dados: Record<string, unknown[]> = {},
  falhar: string | null = null
) {
  const escritas: Escrita[] = [];

  // ⚠️ A LEITURA RESPEITA A LISTA DE COLUNAS, e isso não é capricho. A
  // primeira versão devolvia a linha inteira, ignorando o `select`: tirei
  // `for_holder, for_dependent` da consulta de propósito para ver a régua
  // reprovar, e ela PASSOU. Coluna esquecida na leitura é exatamente o defeito
  // que este teste existe para pegar, e ele atravessaria inteiro.
  const recortar = (linhas: unknown[], colunas: string) => {
    if (colunas.trim() === "*") return linhas;
    const pedidas = colunas.split(",").map((c) => c.trim());
    return linhas.map((l) => {
      const recorte: Record<string, unknown> = {};
      for (const c of pedidas) recorte[c] = (l as Record<string, unknown>)[c];
      return recorte;
    });
  };

  const db = {
    from(tabela: string) {
      return {
        select(colunas: string) {
          const resultado = Promise.resolve({
            data: recortar(dados[tabela] ?? [], colunas),
            error: null,
          });
          return { eq: () => resultado };
        },
        insert(linhas: unknown) {
          const lista = Array.isArray(linhas) ? linhas : [linhas];
          escritas.push({ tabela, linhas: lista });
          return Promise.resolve({
            error: falhar === tabela ? { message: "falhou de propósito" } : null,
          });
        },
      };
    },
  };
  return { db: db as never, escritas };
}

const QUAL = {
  holder_fee_cents: 3490,
  dependent_fee_cents: 2990,
  dependent_family_fee_cents: 4990,
  dependent_family_extra_fee_cents: 1490,
  dependent_family_size: 4,
};

describe("o que o fechamento copia para a empresa", () => {
  it("os preços NEGOCIADOS, e não os padrões da rede", () => {
    const { db, escritas } = bancoDeMentira();
    return copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL).then(() => {
      const precos = escritas.find((e) => e.tabela === "adhesion_pricing");
      expect(precos?.linhas[0]).toMatchObject({
        company_id: "emp-1",
        holder_fee_cents: 3490,
        dependent_individual_fee_cents: 2990,
        dependent_family_fee_cents: 4990,
        dependent_family_extra_fee_cents: 1490,
        dependent_family_size: 4,
      });
    });
  });

  it("o que a proposta NÃO combinou cai no padrão da rede, não em zero", async () => {
    // Zero seria "de graça", e sairia cobrando nada de todo mundo.
    const { db, escritas } = bancoDeMentira();
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", {});
    const precos = escritas.find((e) => e.tabela === "adhesion_pricing");
    expect(precos?.linhas[0]).toMatchObject({
      holder_fee_cents: 3990,
      dependent_family_size: 3,
    });
  });

  it("as FAIXAS viram faixas da empresa", async () => {
    const { db, escritas } = bancoDeMentira({
      lead_price_tiers: [
        { min_quantity: 50, price_cents: 3290 },
        { min_quantity: 150, price_cents: 2790 },
      ],
    });
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    const faixas = escritas.find((e) => e.tabela === "company_price_tiers");
    expect(faixas?.linhas).toHaveLength(2);
    expect(faixas?.linhas[0]).toEqual({
      company_id: "emp-1",
      min_quantity: 50,
      price_cents: 3290,
    });
  });

  it("OS BENEFÍCIOS ATRAVESSAM COM O 'PARA QUEM VALE'", async () => {
    // É o pedido literal do dono, e é o campo que mais teria a perder: sem
    // ele, o desconto combinado só para o titular apareceria no orçamento do
    // dependente, e quem descobriria seria o paciente pagando.
    const { db, escritas } = bancoDeMentira({
      lead_benefits: [
        {
          procedure_id: "p1",
          benefit_type: "DISCOUNT_PERCENT",
          benefit_value: 40,
          usage_limit_count: 2,
          usage_period_months: 12,
          grace_period_months: 6,
          max_installments: null,
          for_holder: true,
          for_dependent: false,
        },
      ],
    });
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    const ben = escritas.find((e) => e.tabela === "procedure_benefits");
    expect(ben?.linhas[0]).toEqual({
      company_id: "emp-1",
      procedure_id: "p1",
      benefit_type: "DISCOUNT_PERCENT",
      benefit_value: 40,
      usage_limit_count: 2,
      usage_period_months: 12,
      grace_period_months: 6,
      max_installments: null,
      for_holder: true,
      for_dependent: false,
    });
  });

  it("sem faixa e sem benefício, não escreve linha nenhuma à toa", async () => {
    const { db, escritas } = bancoDeMentira();
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    expect(escritas.find((e) => e.tabela === "company_price_tiers")).toBeUndefined();
    expect(escritas.find((e) => e.tabela === "procedure_benefits")).toBeUndefined();
  });
});

describe("quando alguma parte não dá certo", () => {
  it("RELATA em vez de sumir, e não derruba o fechamento", async () => {
    // Quando isto roda, a empresa já existe e o negócio já foi fechado.
    // Levantar erro desfaria o que está certo; calar faria a diferença
    // aparecer na primeira fatura.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = bancoDeMentira(
      { lead_benefits: [{ procedure_id: "p1", benefit_type: "FREE" }] },
      "procedure_benefits"
    );
    const r = await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    expect(r.naoCopiado).toEqual(["os benefícios"]);
  });

  it("uma parte falhar não impede as outras de serem copiadas", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, escritas } = bancoDeMentira(
      {
        lead_price_tiers: [{ min_quantity: 50, price_cents: 3290 }],
        lead_benefits: [{ procedure_id: "p1", benefit_type: "FREE" }],
      },
      "adhesion_pricing"
    );
    const r = await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    expect(r.naoCopiado).toEqual(["os preços de adesão"]);
    expect(escritas.find((e) => e.tabela === "company_price_tiers")).toBeDefined();
    expect(escritas.find((e) => e.tabela === "procedure_benefits")).toBeDefined();
  });
});

describe("as unidades da parceria no fechamento (I3)", () => {
  it("as unidades combinadas viram unidades da empresa", async () => {
    const { db, escritas } = bancoDeMentira({
      lead_clinics: [{ clinic_id: "cambe" }, { clinic_id: "londrina" }],
    });
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    const u = escritas.find((e) => e.tabela === "company_clinics");
    expect(u?.linhas).toEqual([
      { company_id: "emp-1", clinic_id: "cambe" },
      { company_id: "emp-1", clinic_id: "londrina" },
    ]);
  });

  it("A RESTRIÇÃO DE UNIDADE DO BENEFÍCIO ATRAVESSA o fechamento", async () => {
    // Sem ela, o procedimento de custo zero combinado só para a unidade
    // principal passaria a valer em qualquer uma — e quem descobriria seria a
    // unidade que atendeu sem receber por isso.
    const { db, escritas } = bancoDeMentira({
      lead_benefits: [
        {
          procedure_id: "p1",
          benefit_type: "FREE",
          benefit_value: null,
          usage_limit_count: null,
          usage_period_months: null,
          grace_period_months: 0,
          max_installments: null,
          for_holder: true,
          for_dependent: true,
          clinic_ids: ["cambe"],
        },
      ],
    });
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    const ben = escritas.find((e) => e.tabela === "procedure_benefits");
    expect((ben?.linhas[0] as { clinic_ids: string[] }).clinic_ids).toEqual(["cambe"]);
  });

  it("sem unidade combinada, não escreve linha nenhuma", async () => {
    const { db, escritas } = bancoDeMentira();
    await copiarPropostaParaEmpresa(db, "lead-1", "emp-1", QUAL);
    expect(escritas.find((e) => e.tabela === "company_clinics")).toBeUndefined();
  });
});
