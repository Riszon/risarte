import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_DO_CONTRATO,
  camposUsados,
  concordancia,
  montarContrato,
  textoDaFidelidade,
  type DadosDaEmpresaNoContrato,
} from "@/lib/empresarial/contrato";
import { textoDaPermanencia } from "@/lib/empresarial/documento-da-proposta";

// ---------------------------------------------------------------------------
// 1037 (dono, 28/10/2026): Sr./Sra. de quem assina, fidelidade da empresa e
// o texto novo do modelo da rede.
// ---------------------------------------------------------------------------

describe("a concordância com quem assina", () => {
  it("Sra., Sr. e a forma dupla quando ninguém escolheu", () => {
    expect(concordancia("F")).toEqual({ seu: "sua", portador: "portadora", inscrito: "inscrita" });
    expect(concordancia("M")).toEqual({ seu: "seu", portador: "portador", inscrito: "inscrito" });
    expect(concordancia(null)).toEqual({
      seu: "seu(sua)",
      portador: "portador(a)",
      inscrito: "inscrito(a)",
    });
  });
});

describe("a fidelidade da empresa", () => {
  it("sem fidelidade: sai a qualquer tempo, com aviso de 30 dias", () => {
    expect(textoDaFidelidade(null, null)).toContain("não há prazo mínimo de permanência");
    expect(textoDaFidelidade(0, 50000)).toContain("30 (trinta) dias");
  });
  it("com fidelidade e sem multa", () => {
    const t = textoDaFidelidade(12, null);
    expect(t).toContain("pelo prazo mínimo de 12 (doze) meses");
    expect(t).not.toContain("multa");
  });
  it("com fidelidade e multa fixa, por extenso", () => {
    expect(textoDaFidelidade(24, 150000)).toContain(
      "multa de R$ 1.500,00 (um mil e quinhentos reais)".replace("um mil", "mil")
    );
    expect(textoDaFidelidade(1, null)).toContain("1 (um) mês");
  });
  it("a proposta diz a mesma regra para quem decide", () => {
    expect(textoDaPermanencia(null, null)).toContain("Sem prazo mínimo de fidelidade");
    expect(textoDaPermanencia(12, 150000)).toBe(
      "Prazo mínimo de fidelidade de 12 meses, contados da assinatura do contrato. Se a empresa encerrar a participação antes desse prazo, há multa de R$ 1.500,00, em parcela única."
    );
  });
});

const empresa: DadosDaEmpresaNoContrato = {
  companyName: "Aurora",
  cnpj: "55666777000188",
  legalName: "Aurora Indústria Ltda",
  category: "empresa_privada",
  address: { street: "Rua das Flores", number: "120", city: "Cambé", state: "PR" },
  responsibleName: "Maria de Teste",
  responsibleRole: "presidente",
  responsibleNationality: null,
  responsibleRg: null,
  responsibleCpf: "999.888.777-66",
  dueDay: null,
  billingBasis: "PER_EMPLOYEE",
  fixedMonthlyCents: null,
  employeeCount: 40,
  holderFeeCents: 3500,
  includesDependents: true,
  dependentFeeCents: 3000,
  dependentMode: "FAMILY_PACKAGE",
  dependentFamilyFeeCents: 5000,
  dependentFamilyExtraFeeCents: 1500,
  dependentFamilySize: 4,
};
const entrada = {
  empresa,
  faixas: [],
  contratada: null,
  unidades: [{ city: "Cambé", state: "PR" }],
  beneficios: 4,
  hoje: "2026-10-28",
};

describe("o contrato montado", () => {
  it("preenche a concordância e a fidelidade a partir da proposta", () => {
    const { valores } = montarContrato({
      ...entrada,
      empresa: { ...empresa, responsibleGender: "F", minTermMonths: 12, earlyExitFeeCents: 100000 },
    });
    expect(valores.contratante_seu).toBe("sua");
    expect(valores.contratante_portador).toBe("portadora");
    expect(valores.fidelidade).toContain("12 (doze) meses");
    expect(valores.fidelidade).toContain("R$ 1.000,00 (mil reais)");
  });

  it("sem Sr./Sra. escolhido, avisa — e não bloqueia", () => {
    const { valores, avisos, faltando } = montarContrato(entrada);
    expect(valores.contratante_seu).toBe("seu(sua)");
    expect(avisos.some((a) => a.includes("Sr. ou Sra."))).toBe(true);
    expect(faltando.some((f) => f.includes("Sr."))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RÉGUA DO TEXTO NOVO — lê a migração 1037.
// ---------------------------------------------------------------------------

const MIGRACAO = readFileSync(
  join(process.cwd(), "supabase/migrations/1037_contrato_genero_fidelidade_e_texto.sql"),
  "utf8"
).replace(/\r\n/g, "\n");
/** O texto NOVO: preâmbulo ($pre$) e cláusulas ($t$ / $c$). O antigo fica de fora. */
const NOVO = [...MIGRACAO.matchAll(/\$(pre|t|c)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]);

describe("o texto novo do modelo da rede (1037)", () => {
  it("a régua acha o texto: preâmbulo + 15 títulos + 15 cláusulas", () => {
    expect(NOVO).toHaveLength(31);
  });

  it("todo campo usado existe na lista do sistema, inclusive os novos", () => {
    const usados = [...new Set(NOVO.flatMap((t) => camposUsados(t)))];
    const conhecidos = new Set(CAMPOS_DO_CONTRATO.map((c) => c.chave));
    expect(usados.filter((c) => !conhecidos.has(c))).toEqual([]);
    for (const novo of ["contratante_seu", "contratante_portador", "contratada_inscrito", "fidelidade"]) {
      expect(usados).toContain(novo);
    }
  });

  it("sem colaborador, funcionário, empregado, convênio, plano nem co-participação", () => {
    const tudo = NOVO.join("\n");
    for (const termo of [/colaborador/i, /funcion[áa]rio/i, /empregad/i, /conv[êe]nio/i, /\bplano\b/i, /co-?participa/i]) {
      expect(tudo).not.toMatch(termo);
    }
  });

  it("reajuste IPCA + 3%, Anexo I na décima e exames por conta do beneficiário na décima primeira", () => {
    const tudo = NOVO.join("\n");
    expect(tudo).toContain("IPCA/IBGE");
    expect(tudo).toContain("acrescida de 3% (três por cento)");
    expect(tudo).toContain("exclusivamente os relacionados no Anexo I");
    expect(tudo).toMatch(/tomografias, radiografias panorâmicas, documentações ortodônticas/);
    expect(tudo).toContain("responsabilidade do Titular ou do Dependente");
  });

  it("só troca o modelo da rede, e só se ainda for o original", () => {
    expect(MIGRACAO).toMatch(/where lead_id is null\s+and preamble = \$antigo_pre\$/);
    expect(MIGRACAO).toContain("$antigo_sec$");
  });
});
