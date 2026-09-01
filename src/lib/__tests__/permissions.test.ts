import { describe, expect, it } from "vitest";
import {
  CAPACIDADES,
  CAPACIDADES_POR_ID,
  matrizPadrao,
  podeComPapeis,
} from "@/lib/permissions";
import { USER_ROLES, type UserRole } from "@/lib/roles";

describe("matriz de permissões", () => {
  it("todo papel do catálogo existe de verdade", () => {
    // Um papel escrito errado na semente vira permissão que nunca vale para
    // ninguém — e não dá erro nenhum: só some da tela silenciosamente.
    for (const cap of CAPACIDADES) {
      for (const papel of cap.padrao) {
        expect(USER_ROLES).toContain(papel);
      }
    }
  });

  it("nenhuma capacidade tem id repetido", () => {
    // O id é a chave no banco: repetido, uma sobrescreveria a outra na leitura.
    expect(CAPACIDADES_POR_ID.size).toBe(CAPACIDADES.length);
  });

  it("nenhum papel aparece duas vezes na mesma capacidade", () => {
    for (const cap of CAPACIDADES) {
      expect(new Set(cap.padrao).size).toBe(cap.padrao.length);
    }
  });

  it("quem tem o papel, pode", () => {
    const m = matrizPadrao();
    expect(podeComPapeis(m, "modulo.financeiro", ["unit_manager"])).toBe(true);
  });

  it("quem não tem o papel, não pode", () => {
    const m = matrizPadrao();
    expect(podeComPapeis(m, "modulo.financeiro", ["receptionist"])).toBe(false);
  });

  it("basta UM papel com a permissão", () => {
    // Quem acumula funções soma acessos — é assim que o sistema sempre tratou
    // quem trabalha em mais de uma unidade.
    const m = matrizPadrao();
    expect(
      podeComPapeis(m, "modulo.financeiro", ["receptionist", "unit_manager"])
    ).toBe(true);
  });

  it("capacidade desconhecida nunca libera", () => {
    // Erro de digitação numa chamada não pode virar acesso liberado.
    const m = matrizPadrao();
    expect(podeComPapeis(m, "modulo.inexistente", ["unit_manager"])).toBe(false);
  });

  it("sem papel nenhum, não pode nada", () => {
    const m = matrizPadrao();
    for (const cap of CAPACIDADES) {
      expect(podeComPapeis(m, cap.id, [])).toBe(false);
    }
  });

  // Os padrões abaixo prendem o comportamento que existia ANTES da matriz. Se
  // algum mudar sem querer, o teste avisa — a semente é o contrato com o
  // passado.
  const esperado: Record<string, UserRole[]> = {
    "modulo.financeiro": ["finance_franchisor", "unit_manager", "franchisee"],
    "acao.financeiro.configurar_rede": ["finance_franchisor"],
    "acao.compras.negociar": ["purchaser"],
    "acao.compras.requisitar": ["unit_manager"],
    "menu.planejamento": ["planner_dentist"],
    "menu.procedimentos": ["planner_dentist"],
  };

  for (const [cap, papeis] of Object.entries(esperado)) {
    it(`o padrão de "${cap}" é o mesmo de antes da matriz`, () => {
      expect([...matrizPadrao()[cap]].sort()).toEqual([...papeis].sort());
    });
  }

  it("a recepção não lança dinheiro por padrão", () => {
    const m = matrizPadrao();
    expect(podeComPapeis(m, "acao.financeiro.lancar", ["receptionist"])).toBe(false);
  });

  it("o franqueado vê o financeiro mas não lança", () => {
    // A distinção mais confundida do sistema, presa por teste.
    const m = matrizPadrao();
    expect(podeComPapeis(m, "modulo.financeiro", ["franchisee"])).toBe(true);
    expect(podeComPapeis(m, "acao.financeiro.lancar", ["franchisee"])).toBe(false);
  });

  it("quem compra não é quem paga", () => {
    const m = matrizPadrao();
    expect(podeComPapeis(m, "acao.compras.negociar", ["purchaser"])).toBe(true);
    expect(podeComPapeis(m, "modulo.financeiro", ["purchaser"])).toBe(false);
  });
});
