import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conferirPlanilha,
  resumoDaRecusa,
  type DependenteDaPlanilha,
  type LinhaDaPlanilha,
} from "@/lib/empresarial/importacao";

// AP97 (item 6 do plano de correções da Rita, 03/11/2026): a importação de
// titulares é TUDO OU NADA. Linha inválida recusa a planilha inteira, com a
// lista de erros por linha; telefone vazio é erro da linha, não um cadastro
// gravado sem telefone.

const CPF_A = "111.111.111-11";
const CPF_B = "222.222.222-22";
const CPF_C = "333.333.333-33";
const SO_DIGITOS = (s: string) => s.replace(/\D/g, "");

function titular(sobre: Partial<LinhaDaPlanilha> = {}): LinhaDaPlanilha {
  return {
    cpf: CPF_A,
    fullName: "Maria Silva",
    phone: "(43) 99999-0000",
    email: "",
    dependentPlan: "NONE",
    ...sobre,
  };
}

const NINGUEM = new Set<string>();

describe("telefone vazio é ERRO DA LINHA", () => {
  it("rows com telefone vazio → errors = 1, com a linha e o motivo", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A }), titular({ cpf: CPF_B, phone: "" })],
      [],
      NINGUEM
    );
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toEqual({ aba: "Titulares", linha: 3, motivo: "sem telefone" });
  });

  it("telefone pela metade também é erro (não vira um telefone inventado)", () => {
    const r = conferirPlanilha([titular({ phone: "4399" })], [], NINGUEM);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].motivo).toBe("telefone incompleto");
  });

  it("fixo com DDD (10 dígitos) e celular (11) passam, já formatados", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A, phone: "4333334444" }), titular({ cpf: CPF_B, phone: "43999998888" })],
      [],
      NINGUEM
    );
    expect(r.erros).toEqual([]);
    expect(r.titulares.map((t) => t.phone)).toEqual(["(43) 3333-4444", "(43) 99999-8888"]);
  });
});

describe("as outras linhas inválidas", () => {
  it("CPF incompleto e sem nome, cada um na sua linha, com todos os motivos", () => {
    const r = conferirPlanilha(
      [titular({ cpf: "123" }), titular({ cpf: CPF_B, fullName: "  " })],
      [],
      NINGUEM
    );
    expect(r.erros.map((e) => [e.linha, e.motivo])).toEqual([
      [2, "CPF incompleto"],
      [3, "sem nome"],
    ]);
  });

  it("uma linha com vários problemas lista todos de uma vez", () => {
    const r = conferirPlanilha([titular({ cpf: "", fullName: "", phone: "" })], [], NINGUEM);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].motivo).toBe("CPF incompleto; sem nome; sem telefone");
  });

  it("CPF repetido na planilha é erro — e diz em que linha ele já está", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A }), titular({ cpf: CPF_B }), titular({ cpf: "11111111111" })],
      [],
      NINGUEM
    );
    expect(r.erros).toEqual([
      { aba: "Titulares", linha: 4, motivo: "CPF repetido (já está na linha 2)" },
    ]);
  });

  it("respeita a linha que veio da planilha; sem ela, conta a partir da 2", () => {
    const r = conferirPlanilha(
      [titular({ linha: 17, phone: "" }), titular({ cpf: CPF_B, phone: "" })],
      [],
      NINGUEM
    );
    expect(r.erros.map((e) => e.linha)).toEqual([17, 3]);
  });

  it("nenhum dado pessoal vai para a tela nos erros (só linha e motivo)", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A, fullName: "Fulana Segredo", phone: "" })],
      [],
      NINGUEM
    );
    const texto = JSON.stringify(r.erros);
    expect(texto).not.toContain(SO_DIGITOS(CPF_A));
    expect(texto).not.toContain("Segredo");
  });
});

describe("quem é NOVO e quem já está", () => {
  it("só os CPFs que não estão na empresa ocupam vaga; os outros contam como já cadastrados", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A }), titular({ cpf: CPF_B }), titular({ cpf: CPF_C })],
      [],
      new Set([SO_DIGITOS(CPF_B)])
    );
    expect(r.erros).toEqual([]);
    expect(r.cpfsNovos).toEqual([SO_DIGITOS(CPF_A), SO_DIGITOS(CPF_C)]);
    expect(r.jaCadastrados).toBe(1);
    // Todos os válidos vão no upsert (quem já está fica como está).
    expect(r.titulares).toHaveLength(3);
    expect(r.titulares[0].cpfFormatado).toBe(CPF_A);
  });

  it("linha inválida não entra nos novos (a planilha vai ser recusada mesmo)", () => {
    const r = conferirPlanilha([titular({ phone: "" })], [], NINGUEM);
    expect(r.cpfsNovos).toEqual([]);
    expect(r.titulares).toEqual([]);
  });
});

describe("a aba Dependentes", () => {
  function dependente(sobre: Partial<DependenteDaPlanilha> = {}): DependenteDaPlanilha {
    return {
      holderCpf: CPF_A,
      cpf: "444.444.444-44",
      fullName: "Ana",
      relationship: "SPOUSE",
      phone: "",
      ...sobre,
    };
  }

  it("dependente de titular que está NA PLANILHA passa", () => {
    const r = conferirPlanilha([titular({ cpf: CPF_A })], [dependente()], NINGUEM);
    expect(r.erros).toEqual([]);
    expect(r.dependentes).toHaveLength(1);
    expect(r.dependentes[0]).toMatchObject({
      holderCpf: SO_DIGITOS(CPF_A),
      cpfFormatado: "444.444.444-44",
      relationship: "SPOUSE",
      phone: null,
    });
  });

  it("dependente de titular que JÁ ESTÁ na empresa (fora da planilha) também passa", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_B })],
      [dependente({ holderCpf: CPF_A })],
      new Set([SO_DIGITOS(CPF_A)])
    );
    expect(r.erros).toEqual([]);
    expect(r.dependentes).toHaveLength(1);
  });

  it("dependente sem titular conhecido é erro da linha (antes era 'ignorado' sem dizer qual)", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_B })],
      [dependente({ holderCpf: CPF_C })],
      NINGUEM
    );
    expect(r.erros).toEqual([
      {
        aba: "Dependentes",
        linha: 2,
        motivo: "o CPF do titular não está na planilha nem na empresa",
      },
    ]);
  });

  it("parentesco desconhecido, CPFs incompletos e repetição também são erros", () => {
    const r = conferirPlanilha(
      [titular({ cpf: CPF_A })],
      [
        dependente({ cpf: "555.555.555-55", relationship: "primo" }),
        dependente({ cpf: "44" }),
        dependente({ holderCpf: "1" }),
        dependente({ linha: 9 }),
        dependente({ linha: 10 }),
      ],
      NINGUEM
    );
    expect(r.erros.map((e) => [e.linha, e.motivo])).toEqual([
      [2, "parentesco não reconhecido"],
      [3, "CPF do dependente incompleto"],
      [4, "CPF do titular incompleto"],
      [10, "dependente repetido (já está na linha 9)"],
    ]);
  });

  it("o titular com telefone vazio derruba a planilha mesmo com o dependente certo", () => {
    // Tudo ou nada: o dependente passa, o titular não — a planilha volta.
    const r = conferirPlanilha([titular({ phone: "" })], [dependente()], NINGUEM);
    expect(r.erros.map((e) => e.aba)).toEqual(["Titulares", "Dependentes"]);
  });
});

describe("a frase da recusa", () => {
  it("diz quantas linhas e que NADA foi gravado", () => {
    const t = resumoDaRecusa([
      { aba: "Titulares", linha: 2, motivo: "sem telefone" },
      { aba: "Dependentes", linha: 5, motivo: "parentesco não reconhecido" },
    ]);
    expect(t).toContain("2 linha(s) com problema");
    expect(t).toContain("Nada foi gravado");
  });
});

describe("⚠️ régua: a action só grava depois da conferência limpa", () => {
  const acao = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "app",
      "(app)",
      "empresarial",
      "[companyId]",
      "employee-actions.ts"
    ),
    "utf8"
  ).replace(/\r\n/g, "\n");
  const ini = acao.indexOf("export async function importEmployees(");
  const fim = acao.indexOf("\nexport ", ini + 1);
  const corpo = acao.slice(ini, fim < 0 ? undefined : fim);

  it("conferirPlanilha vem ANTES de qualquer upsert, e erro devolve a lista", () => {
    const confere = corpo.indexOf("conferirPlanilha(");
    const recusa = corpo.indexOf("linhasComErro: conferida.erros");
    const grava = corpo.indexOf(".upsert(");
    expect(confere).toBeGreaterThan(-1);
    expect(recusa).toBeGreaterThan(confere);
    expect(grava).toBeGreaterThan(recusa);
  });

  it("telefone vazio não vira texto vazio gravado", () => {
    // A forma antiga: `phone: r.phone ? formatPhone(r.phone) : ""`.
    expect(corpo).not.toMatch(/formatPhone\([^)]*\)\s*:\s*""/);
    expect(corpo).not.toContain("errors++");
  });
});
