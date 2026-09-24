import { describe, expect, it } from "vitest";
import {
  aplicarGrupo,
  paraQuemVale,
  problemasDoBeneficio,
  rotuloDaCarencia,
  rotuloDoBeneficio,
  rotuloDoUso,
  valeParaPessoa,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";

const base: BeneficioDaProposta = {
  procedureId: "p1",
  benefitType: "DISCOUNT_PERCENT",
  benefitValue: 30,
  usageLimitCount: null,
  usagePeriodMonths: null,
  gracePeriodMonths: 0,
  maxInstallments: null,
  forHolder: true,
  forDependent: true,
};

describe("para quem o benefício vale", () => {
  it("o padrão é os dois", () => {
    expect(paraQuemVale(base)).toBe("Titular e dependente");
    expect(valeParaPessoa(base, "titular")).toBe(true);
    expect(valeParaPessoa(base, "dependente")).toBe(true);
  });

  it("restringir a um lado tira do outro — é o ponto do pedido", () => {
    const soTitular = { ...base, forDependent: false };
    expect(paraQuemVale(soTitular)).toBe("Só o titular");
    expect(valeParaPessoa(soTitular, "dependente")).toBe(false);

    const soDependente = { ...base, forHolder: false };
    expect(paraQuemVale(soDependente)).toBe("Só o dependente");
    expect(valeParaPessoa(soDependente, "titular")).toBe(false);
  });
});

describe("como o benefício é escrito", () => {
  it("desconto em % e em reais dizem o número", () => {
    expect(rotuloDoBeneficio(base)).toBe("30% de desconto");
    expect(
      rotuloDoBeneficio({ ...base, benefitType: "DISCOUNT_AMOUNT", benefitValue: 4550 })
    ).toBe("R$ 45,50 de desconto");
  });

  it("SEM CUSTO e NÃO COBERTO não carregam valor", () => {
    // "Sem custo (0%)" e "Não coberto (R$ 0,00)" são frases que o sistema
    // escreveria por descuido, e as duas confundem quem lê a proposta.
    const gratis = rotuloDoBeneficio({ ...base, benefitType: "FREE", benefitValue: 0 });
    expect(gratis).toBe("Sem custo");
    expect(gratis).not.toMatch(/0/);
    const fora = rotuloDoBeneficio({
      ...base,
      benefitType: "NOT_COVERED",
      benefitValue: 0,
    });
    expect(fora).toBe("Não coberto");
  });
});

describe("a regra de uso", () => {
  it("sem limite, não há regra a escrever", () => {
    expect(rotuloDoUso(base)).toBeNull();
  });

  it("limite sem janela é 'no total'", () => {
    expect(rotuloDoUso({ ...base, usageLimitCount: 3 })).toBe("3 vezes no total");
    expect(rotuloDoUso({ ...base, usageLimitCount: 1 })).toBe("1 vez no total");
  });

  it("limite com janela diz as duas coisas", () => {
    expect(rotuloDoUso({ ...base, usageLimitCount: 2, usagePeriodMonths: 6 })).toBe(
      "2 vezes a cada 6 meses"
    );
    expect(rotuloDoUso({ ...base, usageLimitCount: 1, usagePeriodMonths: 1 })).toBe(
      "1 vez por mês"
    );
  });

  it("JANELA SEM LIMITE NÃO VIRA TEXTO", () => {
    // "a cada 6 meses", sozinho, sugere uma restrição que não existe.
    expect(rotuloDoUso({ ...base, usagePeriodMonths: 6 })).toBeNull();
  });

  it("carência só aparece quando existe", () => {
    expect(rotuloDaCarencia(base)).toBeNull();
    expect(rotuloDaCarencia({ ...base, gracePeriodMonths: 1 })).toBe(
      "após 1 mês de programa"
    );
    expect(rotuloDaCarencia({ ...base, gracePeriodMonths: 6 })).toBe(
      "após 6 meses de programa"
    );
  });
});

describe("aplicar um grupo na proposta", () => {
  const limpeza = { ...base, procedureId: "limpeza" };
  const canal = { ...base, procedureId: "canal", benefitValue: 10 };
  const orto = { ...base, procedureId: "orto", benefitValue: 25 };

  it("o grupo GANHA do que estava lá, e diz quantos trocou", () => {
    // Preservar o que já existia devolveria uma mistura que não é nem o grupo
    // nem o que havia antes — e ninguém saberia o que foi ofertado.
    const r = aplicarGrupo([{ ...limpeza, benefitValue: 5 }], [limpeza, canal]);
    expect(r.trocados).toEqual(["limpeza"]);
    expect(r.incluidos).toBe(1);
    expect(r.lista.find((b) => b.procedureId === "limpeza")?.benefitValue).toBe(30);
  });

  it("o que o grupo NÃO menciona fica como está", () => {
    // Aplicar "Preventivo" não pode apagar um desconto de ortodontia que foi
    // combinado à parte.
    const r = aplicarGrupo([orto], [limpeza]);
    expect(r.lista).toHaveLength(2);
    expect(r.lista.find((b) => b.procedureId === "orto")?.benefitValue).toBe(25);
    expect(r.trocados).toEqual([]);
  });

  it("aplicar sobre proposta vazia traz o grupo inteiro", () => {
    const r = aplicarGrupo([], [limpeza, canal, orto]);
    expect(r.lista).toHaveLength(3);
    expect(r.incluidos).toBe(3);
  });

  it("não devolve a mesma lista por referência — a tela não pode editar o grupo", () => {
    const grupo = [limpeza];
    const r = aplicarGrupo([], grupo);
    r.lista[0].benefitValue = 99;
    expect(grupo[0].benefitValue).toBe(30);
  });
});

describe("o que impede de salvar", () => {
  it("lista TUDO o que falta, não só o primeiro", () => {
    const p = problemasDoBeneficio({
      ...base,
      benefitValue: 0,
      forHolder: false,
      forDependent: false,
      usagePeriodMonths: 6,
    });
    expect(p.length).toBeGreaterThanOrEqual(3);
  });

  it("desconto em % fora de 1 a 100 é recusado", () => {
    expect(problemasDoBeneficio({ ...base, benefitValue: 0 })).toHaveLength(1);
    expect(problemasDoBeneficio({ ...base, benefitValue: 101 })).toHaveLength(1);
    expect(problemasDoBeneficio({ ...base, benefitValue: 100 })).toHaveLength(0);
  });

  it("SEM CUSTO e NÃO COBERTO não exigem valor", () => {
    expect(
      problemasDoBeneficio({ ...base, benefitType: "FREE", benefitValue: null })
    ).toHaveLength(0);
    expect(
      problemasDoBeneficio({ ...base, benefitType: "NOT_COVERED", benefitValue: null })
    ).toHaveLength(0);
  });

  it("janela sem limite é avisada em vez de virar restrição invisível", () => {
    const p = problemasDoBeneficio({ ...base, usagePeriodMonths: 6 });
    expect(p).toContain("a janela em meses só vale com um limite de usos");
  });
});
