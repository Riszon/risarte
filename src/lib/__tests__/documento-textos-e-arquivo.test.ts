import { describe, expect, it } from "vitest";
import {
  comoOColaboradorPaga,
  nomeDoArquivo,
  relatorioMensal,
} from "@/lib/empresarial/documento-da-proposta";
import { textoDoPagamento } from "@/lib/empresarial/riso-social";

describe("o nome do arquivo da proposta (dono, 28/10/2026)", () => {
  it("legível, com acento e a data brasileira", () => {
    expect(nomeDoArquivo("Proposta", "Cooperativa Recicla Brasil", "2026-10-28")).toBe(
      "Proposta Risarte Empresarial - Cooperativa Recicla Brasil - 28-10-2026"
    );
    expect(nomeDoArquivo("Contrato", "Padaria São José", "2026-01-05")).toBe(
      "Contrato Risarte Empresarial - Padaria São José - 05-01-2026"
    );
  });

  it("tira só o que o Windows não aceita em nome de arquivo", () => {
    expect(nomeDoArquivo("Proposta", 'A/B: "Ltda"  *?', "2026-10-28")).toBe(
      "Proposta Risarte Empresarial - A B Ltda - 28-10-2026"
    );
    expect(nomeDoArquivo("Proposta", "  ", "2026-10-28")).toBe(
      "Proposta Risarte Empresarial - Empresa - 28-10-2026"
    );
  });
});

describe("como o colaborador paga o tratamento", () => {
  it("usa os meios combinados e diz que a parcela atrasada perde o desconto", () => {
    const frases = comoOColaboradorPaga(textoDoPagamento(["BOLETO"], 12));
    expect(frases[1]).toContain("por boleto, com parcelamento em até 12x");
    expect(frases[2]).toContain("parcela paga com atraso perde o desconto");
  });
});

describe("o relatório mensal", () => {
  it("empresa que paga recebe o boleto junto; a divergência é dela", () => {
    const t = relatorioMensal("COMPANY_PAYS");
    expect(t).toContain("junto com o boleto da mensalidade do programa");
    expect(t).toContain("cabe à empresa solicitar a correção");
  });
  it("quando só o titular paga, não promete boleto à empresa", () => {
    expect(relatorioMensal("EMPLOYEE_PAYS")).not.toContain("boleto");
  });
});
