import { describe, expect, it } from "vitest";
import {
  JOURNEY_PHASES,
  PHASE_TRANSITIONS,
  allowedNextPhases,
  displayedPillar,
  isSlaExceeded,
  slaAppliesTo,
} from "@/lib/journey";

// A matriz "quem move o cliente de fase" é regra de negócio central (também
// imposta no banco em move_client_phase) — estes testes travam o contrato.

describe("allowedNextPhases", () => {
  it("Admin Master pode ir para qualquer outra fase", () => {
    const next = allowedNextPhases("acquisition", {
      isAdminMaster: true,
      clinicRoles: [],
      isPlannerAnywhere: false,
    });
    expect(next).toHaveLength(JOURNEY_PHASES.length - 1);
    expect(next).not.toContain("acquisition");
  });

  it("Recepcionista move Aquisição → Conversão Clínica", () => {
    expect(
      allowedNextPhases("acquisition", {
        isAdminMaster: false,
        clinicRoles: ["receptionist"],
        isPlannerAnywhere: false,
      })
    ).toEqual(["clinical_conversion"]);
  });

  it("Coordenador move Reavaliação → Acompanhamento ou Planejamento", () => {
    expect(
      allowedNextPhases("reevaluation", {
        isAdminMaster: false,
        clinicRoles: ["clinical_coordinator"],
        isPlannerAnywhere: false,
      })
    ).toEqual(["follow_up", "planning_center"]);
  });

  it("Planner (papel na Franqueadora) move a partir do Centro de Planejamento", () => {
    expect(
      allowedNextPhases("planning_center", {
        isAdminMaster: false,
        clinicRoles: [],
        isPlannerAnywhere: true,
      })
    ).toEqual(["commercial_conversion", "clinical_conversion", "reevaluation"]);
  });

  it("Dentista (executor) não move fase nenhuma", () => {
    for (const phase of JOURNEY_PHASES) {
      expect(
        allowedNextPhases(phase, {
          isAdminMaster: false,
          clinicRoles: ["dentist"],
          isPlannerAnywhere: false,
        })
      ).toEqual([]);
    }
  });

  it("SDR não tem transição na matriz (decisão do dono, LOTE E)", () => {
    expect(PHASE_TRANSITIONS.some((t) => t.roles.includes("sdr"))).toBe(false);
  });
});

describe("displayedPillar", () => {
  it("Aquisição = a definir (null)", () => {
    expect(displayedPillar("acquisition", null)).toBeNull();
  });
  it("Conversão Clínica e Reavaliação = Diagnóstico", () => {
    expect(displayedPillar("clinical_conversion", null)).toBe("diagnosis");
    expect(displayedPillar("reevaluation", "health")).toBe("diagnosis");
  });
  it("Centro de Planejamento = Planejamento", () => {
    expect(displayedPillar("planning_center", "aesthetics")).toBe("planning");
  });
  it("Fases 4/5 mostram o pilar do tratamento (null = a definir)", () => {
    expect(displayedPillar("commercial_conversion", "function")).toBe("function");
    expect(displayedPillar("treatment_start", null)).toBeNull();
  });
  it("Acompanhamento usa o pilar do tratamento; sem pilar = Prevenção", () => {
    expect(displayedPillar("follow_up", "health")).toBe("health");
    expect(displayedPillar("follow_up", null)).toBe("prevention");
  });
});

describe("isSlaExceeded (prazo em minutos — I3)", () => {
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  it("estourado quando o tempo na fase passa do prazo", () => {
    expect(isSlaExceeded(hoursAgo(10), 5 * 60)).toBe(true);
  });
  it("dentro do prazo", () => {
    expect(isSlaExceeded(hoursAgo(2), 24 * 60)).toBe(false);
  });
  it("prazo menor que uma hora também vale", () => {
    expect(isSlaExceeded(hoursAgo(1), 30)).toBe(true);
    expect(isSlaExceeded(hoursAgo(0.25), 30)).toBe(false);
  });
  it("sem prazo configurado nunca estoura", () => {
    expect(isSlaExceeded(hoursAgo(1000), null)).toBe(false);
    expect(isSlaExceeded(hoursAgo(1000), undefined)).toBe(false);
  });
});

describe("slaAppliesTo — o prazo desliga quando o passo já aconteceu", () => {
  it("Fase 5 cobra só enquanto aguarda iniciar o tratamento", () => {
    expect(slaAppliesTo("treatment_start", "awaiting_treatment_start")).toBe(true);
    expect(slaAppliesTo("treatment_start", null)).toBe(true);
  });
  it("tratamento iniciado (ou encerrado) desliga o prazo", () => {
    expect(slaAppliesTo("treatment_start", "in_treatment")).toBe(false);
    expect(slaAppliesTo("treatment_start", "treatment_finished")).toBe(false);
    expect(slaAppliesTo("treatment_start", "treatment_cancelled")).toBe(false);
  });
  it("as outras fases não mudam", () => {
    expect(slaAppliesTo("planning_center", "in_planning")).toBe(true);
    expect(slaAppliesTo("commercial_conversion", null)).toBe(true);
  });
});
