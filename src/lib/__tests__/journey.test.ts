import { describe, expect, it } from "vitest";
import {
  JOURNEY_PHASES,
  PHASE_TRANSITIONS,
  allowedNextPhases,
  displayedPillar,
  isSlaExceeded,
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

describe("isSlaExceeded", () => {
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  it("estourado quando o tempo na fase passa do SLA", () => {
    expect(isSlaExceeded(hoursAgo(10), 5)).toBe(true);
  });
  it("dentro do SLA", () => {
    expect(isSlaExceeded(hoursAgo(2), 24)).toBe(false);
  });
  it("sem SLA configurado nunca estoura", () => {
    expect(isSlaExceeded(hoursAgo(1000), null)).toBe(false);
    expect(isSlaExceeded(hoursAgo(1000), undefined)).toBe(false);
  });
});
