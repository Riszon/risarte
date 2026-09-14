import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPLEMENTATION_STEPS,
  IMPLEMENTATION_STEP_LABELS,
  impedimentosDaConferencia,
  podeNaoSeAplicar,
  progressoDaImplantacao,
  type ImplementationStep,
  type PassoRegistrado,
} from "@/lib/empresarial/implantacao";

function feito(step: ImplementationStep): PassoRegistrado {
  return {
    step,
    doneAt: "2026-09-14T12:00:00Z",
    notApplicable: false,
    note: null,
    doneByName: "João",
  };
}
function naoSeAplica(step: ImplementationStep): PassoRegistrado {
  return {
    step,
    doneAt: null,
    notApplicable: true,
    note: null,
    doneByName: "João",
  };
}

describe("os passos da implantação", () => {
  it("são os cinco que o dono descreveu", () => {
    expect([...IMPLEMENTATION_STEPS]).toEqual([
      "IMPORT_EMPLOYEES",
      "GUIDELINES_SENT",
      "WELCOME",
      "GROUP_PRESENTATION",
      "FIRST_SCHEDULING",
    ]);
  });

  it("todos têm rótulo em português", () => {
    for (const s of IMPLEMENTATION_STEPS) {
      expect(IMPLEMENTATION_STEP_LABELS[s]).toBeTruthy();
      expect(IMPLEMENTATION_STEP_LABELS[s]).not.toBe(s);
    }
  });

  it("só a apresentação coletiva pode não se aplicar", () => {
    // As outras toda empresa precisa; deixar qualquer uma ser dispensada
    // transformaria a implantação em checklist decorativo.
    expect(podeNaoSeAplicar("GROUP_PRESENTATION")).toBe(true);
    for (const s of IMPLEMENTATION_STEPS) {
      if (s !== "GROUP_PRESENTATION") expect(podeNaoSeAplicar(s)).toBe(false);
    }
  });

  it("o CHECK da migração 1011 lista exatamente estes passos", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/1011_funil_fechamento_e_implantacao.sql"
      ),
      "utf8"
    );
    const bloco = sql.match(/check \(step in \(([\s\S]*?)\)\)/);
    expect(bloco, "não achei o CHECK de step na 1011").toBeTruthy();
    const doBanco = [...bloco![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...doBanco].sort()).toEqual([...IMPLEMENTATION_STEPS].sort());
  });
});

describe("quanto da implantação já foi feito", () => {
  it("nada feito é zero, e lista os cinco", () => {
    const p = progressoDaImplantacao([]);
    expect(p.concluidos).toBe(0);
    expect(p.total).toBe(5);
    expect(p.percentual).toBe(0);
    expect(p.faltando).toHaveLength(5);
    expect(p.completa).toBe(false);
  });

  it("conta o que foi feito", () => {
    const p = progressoDaImplantacao([feito("IMPORT_EMPLOYEES"), feito("WELCOME")]);
    expect(p.concluidos).toBe(2);
    expect(p.total).toBe(5);
    expect(p.percentual).toBe(40);
  });

  it('"NÃO SE APLICA" SAI DOS DOIS LADOS DA CONTA', () => {
    // Se ficasse no denominador, a empresa que não pediu apresentação coletiva
    // nunca chegaria a 100% — e barra que nunca fecha é barra que ninguém olha.
    const p = progressoDaImplantacao([
      feito("IMPORT_EMPLOYEES"),
      feito("GUIDELINES_SENT"),
      feito("WELCOME"),
      naoSeAplica("GROUP_PRESENTATION"),
      feito("FIRST_SCHEDULING"),
    ]);
    expect(p.total).toBe(4);
    expect(p.concluidos).toBe(4);
    expect(p.percentual).toBe(100);
    expect(p.completa).toBe(true);
    expect(p.faltando).toEqual([]);
  });

  it("um passo que não se aplica E não foi feito não conta como pendência", () => {
    const p = progressoDaImplantacao([naoSeAplica("GROUP_PRESENTATION")]);
    expect(p.faltando).not.toContain("GROUP_PRESENTATION");
    expect(p.total).toBe(4);
  });

  it("tudo dispensado fecha em 100%, sem dividir por zero", () => {
    const p = progressoDaImplantacao(
      IMPLEMENTATION_STEPS.map((s) => naoSeAplica(s))
    );
    expect(p.total).toBe(0);
    expect(p.percentual).toBe(100);
    expect(p.completa).toBe(true);
  });

  it("a ordem das pendências é a ordem dos passos", () => {
    // O consultor lê a lista de cima para baixo; embaralhar faria ele pular.
    const p = progressoDaImplantacao([feito("GUIDELINES_SENT")]);
    expect(p.faltando).toEqual([
      "IMPORT_EMPLOYEES",
      "WELCOME",
      "GROUP_PRESENTATION",
      "FIRST_SCHEDULING",
    ]);
  });
});

describe("a conferência do fechamento", () => {
  it("sem empresa criada, não dá para confirmar", () => {
    // Implantação é cadastrar colaboradores NELA; sem empresa não há onde.
    expect(
      impedimentosDaConferencia({
        companyId: null,
        everythingOk: true,
        considerations: null,
      })
    ).toEqual([
      "criar a empresa a partir do lead (a implantação cadastra os colaboradores nela)",
    ]);
  });

  it("com empresa e tudo certo, nada impede", () => {
    expect(
      impedimentosDaConferencia({
        companyId: "abc",
        everythingOk: true,
        considerations: null,
      })
    ).toEqual([]);
  });

  it('"não está tudo certo" EXIGE dizer o quê', () => {
    // Registro que só diz "tem problema" não serve para ninguém resolver nada.
    expect(
      impedimentosDaConferencia({
        companyId: "abc",
        everythingOk: false,
        considerations: "   ",
      })
    ).toEqual(["escrever o que não está certo"]);

    expect(
      impedimentosDaConferencia({
        companyId: "abc",
        everythingOk: false,
        considerations: "A empresa ainda vai confirmar a lista final.",
      })
    ).toEqual([]);
  });

  it("os dois impedimentos aparecem juntos quando é o caso", () => {
    expect(
      impedimentosDaConferencia({
        companyId: null,
        everythingOk: false,
        considerations: null,
      })
    ).toHaveLength(2);
  });
});

describe("o combinado específico viaja para a empresa", () => {
  it("o gatilho da 1011 copia special_agreements para companies", () => {
    // "Os dependentes entram só no segundo mês" é o tipo de acerto que se perde:
    // quem vendeu não é quem atende. Por isso a cópia mora no BANCO.
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/1011_funil_fechamento_e_implantacao.sql"
      ),
      "utf8"
    );
    expect(sql).toMatch(
      /update empresarial\.companies\s*\n?\s*set special_agreements = new\.special_agreements/
    );
  });

  it("e a cópia acontece ANTES de mover a fase", () => {
    // Se o avanço falhasse depois, o acerto já estaria guardado.
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/1011_funil_fechamento_e_implantacao.sql"
      ),
      "utf8"
    );
    const copia = sql.indexOf("set special_agreements = new.special_agreements");
    const move = sql.indexOf("set stage = 'IMPLEMENTATION'");
    expect(copia).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(0);
    expect(copia).toBeLessThan(move);
  });
});
