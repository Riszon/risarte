import { describe, expect, it } from "vitest";
import { relatorioDoSaldoDeAbertura, somaPor, type DividaDoSaldo } from "@/lib/finance/dividas-saldo-de-abertura";

const d = (p: Partial<DividaDoSaldo>): DividaDoSaldo => ({
  code: "DV-1",
  credor: "Banco X",
  documentoDoCredor: null,
  categoria: "Empréstimo",
  conta: "5.3.01",
  nomeDaConta: "Empréstimos",
  contrato: null,
  emissao: null,
  vencimento: "2026-12-01",
  originalCents: 100_00,
  saldoCents: 120_00,
  pagoCents: 0,
  noFinanceiro: true,
  ...p,
});

describe("saldo de abertura do passivo (0406)", () => {
  it("soma por chave, do maior para o menor", () => {
    expect(somaPor([1, 2, 3, 4], (n) => (n % 2 ? "ímpar" : "par"), (n) => n)).toEqual([
      { chave: "par", total: 6 },
      { chave: "ímpar", total: 4 },
    ]);
  });

  it("total, contas, categorias e quem ainda não está no Contas a Pagar", () => {
    const r = relatorioDoSaldoDeAbertura({
      devedor: "Risarte Cambé Ltda",
      cnpj: "00.000.000/0001-00",
      implantacao: "2026-11-16",
      dividas: [
        d({}),
        d({ code: "DV-2", conta: "5.5.01", nomeDaConta: "Saldo de implantação", categoria: "Tributos", saldoCents: 300_00, noFinanceiro: false }),
      ],
      geradoEm: "agora",
      geradoPor: "Fulano",
      formatarData: (iso) => iso.split("-").reverse().join("/"),
    });
    const resumo = Object.fromEntries(r.resumo.map((x) => [x.rotulo, x.valor.replace(/\s/g, " ")]));
    expect(resumo["Dívidas anteriores à implantação"]).toBe("2");
    expect(resumo["Saldo na implantação"]).toBe("R$ 420,00");
    expect(resumo["Conta 5.5.01 · Saldo de implantação"]).toBe("R$ 300,00");
    expect(resumo["Categoria Empréstimo"]).toBe("R$ 120,00");
    expect(r.situacao).toMatch(/^1 dívida ainda não está/);
    expect(r.linhas.map((l) => l.code)).toEqual(["DV-1", "DV-2"]); // pela conta
    expect(r.nomeDoArquivo).toBe("saldo-de-abertura-risarte-cambe-ltda");
    expect(r.metadados[0].valor).toBe("16/11/2026");
  });

  it("todas no Contas a Pagar: sem frase de situação", () => {
    const r = relatorioDoSaldoDeAbertura({
      devedor: "X", cnpj: null, implantacao: null, dividas: [d({})], geradoEm: "", geradoPor: "", formatarData: (x) => x,
    });
    expect(r.situacao).toBeNull();
  });
});
