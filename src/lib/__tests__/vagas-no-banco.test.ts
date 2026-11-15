// 1045 — AS VAGAS DO CONTRATO CONFERIDAS PELO BANCO (Empresarial 0.105.0).
//
// O banco recusa toda pessoa que passa a ativa sem vaga (cadastro, reativação,
// planilha, API). Esta régua prende três coisas:
//   1. a frase que a tela mostra para cada recusa do banco;
//   2. o formato da recusa no SQL = o formato que a tela lê (mudou um, muda o
//      outro);
//   3. os caminhos que REATIVAM traduzem a recusa (sem isso, a pessoa veria
//      "Não foi possível atualizar" e acharia que o sistema quebrou).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recusaDoCadastro, recusaDoDependente } from "@/lib/empresarial/excedente";
import { recusaDaImportacao } from "@/lib/empresarial/importacao";
import { recusaDasVagas } from "@/lib/empresarial/vagas";

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");
const MIGRACAO = ler("supabase/migrations/1045_vagas_do_contrato_no_banco.sql");
const ACOES = ler("src/app/(app)/empresarial/[companyId]/employee-actions.ts");

describe("recusaDasVagas — a recusa do banco em português", () => {
  it("titular acima do contrato: a mesma frase do cadastro, com o termo de inclusão", () => {
    const m = 'VAGAS_TITULARES:LIMIT:10:10 (SQLSTATE P0001)';
    expect(recusaDasVagas(m)).toBe(recusaDoCadastro(10, 10));
    expect(recusaDasVagas(m)).toMatch(/termo de inclusão/);
  });

  it("dependente acima do contrato: a frase dos dependentes", () => {
    expect(recusaDasVagas("VAGAS_DEPENDENTES:LIMIT:3:3")).toBe(recusaDoDependente(3, 3));
  });

  it("máximo da proposta: pede para renegociar", () => {
    expect(recusaDasVagas("VAGAS_TITULARES:MAX:120:120")).toMatch(
      /120 titular\(es\) ativos, e o máximo combinado na proposta é 120/
    );
    expect(recusaDasVagas("VAGAS_DEPENDENTES:MAX:5:5")).toMatch(/5 dependente\(s\) ativos/);
  });

  it("outro erro não vira recusa de vaga", () => {
    expect(recusaDasVagas("duplicate key value")).toBeNull();
    expect(recusaDasVagas(null)).toBeNull();
  });

  it("a planilha recusada pelo gatilho diz o limite e que nada foi gravado", () => {
    const frase = recusaDaImportacao("VAGAS_DEPENDENTES:LIMIT:50:50");
    expect(frase).toMatch(/limite de dependentes do contrato \(50\)/);
    expect(frase).toMatch(/Nada foi gravado/);
  });
});

describe("1045 — o formato do SQL é o que a tela lê", () => {
  it("as quatro recusas do banco têm o formato VAGAS_<QUEM>:<LIMIT|MAX>:%:%", () => {
    for (const quem of ["TITULARES", "DEPENDENTES"]) {
      for (const tipo of ["LIMIT", "MAX"]) {
        expect(MIGRACAO).toContain(`'VAGAS_${quem}:${tipo}:%:%'`);
      }
    }
  });

  it("os gatilhos conferem toda passagem para ATIVO, nas duas tabelas", () => {
    expect(MIGRACAO).toMatch(
      /create trigger employees_vagas_do_contrato\s+after insert or update of status on empresarial\.employees/
    );
    expect(MIGRACAO).toMatch(
      /create trigger dependents_vagas_do_contrato\s+after insert or update of status on empresarial\.dependents/
    );
  });

  it("o limite é o contratado + os termos de inclusão ACEITOS (a regra de sempre)", () => {
    const somas = MIGRACAO.match(/and t\.status = 'ACEITO'/g) ?? [];
    expect(somas.length).toBe(2);
  });

  it("as portas usam a conta interna (uma conta só)", () => {
    expect(MIGRACAO).toContain("return empresarial._limite_de_titulares_raw(p_company_id);");
    expect(MIGRACAO).toContain("return empresarial._limite_de_dependentes_raw(p_company_id);");
    expect(MIGRACAO).toContain("return empresarial._dependentes_ativos_raw(p_company_id);");
  });
});

describe("as ações traduzem a recusa do banco", () => {
  const corpo = (nome: string) => {
    const i = ACOES.indexOf(`export async function ${nome}(`);
    expect(i, `${nome} não achada`).toBeGreaterThan(-1);
    const fim = ACOES.indexOf("\nexport async function ", i + 10);
    return ACOES.slice(i, fim === -1 ? undefined : fim);
  };

  for (const nome of ["createEmployee", "setEmployeeStatus", "addDependent", "setDependentStatus"]) {
    it(`${nome} usa recusaDasVagas`, () => {
      expect(corpo(nome)).toContain("recusaDasVagas(error.message)");
    });
  }

  it("reativar dependente fica na auditoria", () => {
    expect(corpo("setDependentStatus")).toContain("logAudit(");
  });
});

describe("cancelar contrato só vale para a empresa da tela", () => {
  const fonte = ler("src/app/(app)/empresarial/[companyId]/contract-actions.ts");
  const i = fonte.indexOf("export async function cancelContract(");
  // O fim da função (o arquivo pode ter CRLF): o próximo "}" sozinho na linha.
  const fim = fonte.slice(i).search(/\r?\n\}\r?\n/);
  const corpo = fonte.slice(i, i + fim);

  it("achou a função inteira, e só ela", () => {
    expect(i).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(0);
    expect(corpo).not.toContain("buildProposalText");
  });

  it("filtra pela empresa e confere que algo foi cancelado", () => {
    expect(corpo).toContain('.eq("company_id", companyId)');
    expect(corpo).toMatch(/data\.length === 0/);
  });

  it("fica na auditoria", () => {
    expect(corpo).toContain("logAudit(");
  });
});
