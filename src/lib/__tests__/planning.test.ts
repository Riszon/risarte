import { describe, expect, it } from "vitest";
import { planStage } from "@/lib/planning";

// A "linha do tempo" do plano junta o trilho interno (status) com o ciclo de
// vida pós-aprovação (lifecycle). O lifecycle, quando existe, sempre manda.

describe("planStage", () => {
  it("mapeia o status interno quando não há ciclo de vida", () => {
    expect(planStage({ status: "draft", lifecycle: null })).toBe(
      "em_planejamento"
    );
    expect(planStage({ status: "submitted", lifecycle: null })).toBe(
      "aguardando_aprovacao"
    );
    expect(planStage({ status: "returned", lifecycle: null })).toBe(
      "em_revisao"
    );
    expect(planStage({ status: "approved", lifecycle: null })).toBe(
      "aprovado_coordenador"
    );
  });

  it("rascunho com devolução do Comercial pendente = Replanejamento", () => {
    expect(
      planStage({
        status: "draft",
        lifecycle: null,
        commercialReturnNote: "cliente não aprovou os valores",
      })
    ).toBe("replanejamento");
    // Nota limpa (reaprovado e reaberto depois) → volta ao normal.
    expect(
      planStage({ status: "draft", lifecycle: null, commercialReturnNote: null })
    ).toBe("em_planejamento");
  });

  it("o ciclo de vida tem prioridade sobre o status", () => {
    expect(planStage({ status: "approved", lifecycle: "em_tratamento" })).toBe(
      "em_tratamento"
    );
    expect(planStage({ status: "approved", lifecycle: "concluido" })).toBe(
      "concluido"
    );
    expect(planStage({ status: "draft", lifecycle: "suspenso" })).toBe(
      "suspenso"
    );
  });
});
