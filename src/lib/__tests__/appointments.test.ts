import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_TYPES,
  PHASE_APPOINTMENT_TYPE,
  appointmentTypeOptions,
} from "@/lib/appointments";

// Regra do dono: o tipo de agendamento acompanha a fase da jornada; tipos
// excepcionais (retorno, urgência, emergência, revisão, refação) sempre podem.

describe("PHASE_APPOINTMENT_TYPE", () => {
  it("1ª vez = Avaliação; retorno de cliente = Reavaliação", () => {
    expect(PHASE_APPOINTMENT_TYPE.acquisition).toBe("evaluation");
    expect(PHASE_APPOINTMENT_TYPE.clinical_conversion).toBe("evaluation");
    expect(PHASE_APPOINTMENT_TYPE.reevaluation).toBe("reevaluation");
  });
  it("Fases comercial e de tratamento apontam para o tipo certo", () => {
    expect(PHASE_APPOINTMENT_TYPE.commercial_conversion).toBe(
      "commercial_presentation"
    );
    expect(PHASE_APPOINTMENT_TYPE.treatment_start).toBe("treatment_start");
    expect(PHASE_APPOINTMENT_TYPE.follow_up).toBe("return_visit");
  });
});

describe("appointmentTypeOptions", () => {
  it("sem fase conhecida oferece todos os tipos", () => {
    expect(appointmentTypeOptions(null)).toEqual([...APPOINTMENT_TYPES]);
  });

  it("Aquisição: avaliação + excepcionais", () => {
    expect(appointmentTypeOptions("acquisition")).toEqual([
      "evaluation",
      "return_visit",
      "urgency",
      "emergency",
      "revision",
      "redo",
    ]);
  });

  it("Início de Tratamento inclui a Sessão de Tratamento", () => {
    const opts = appointmentTypeOptions("treatment_start");
    expect(opts[0]).toBe("treatment_start");
    expect(opts).toContain("treatment_session");
  });

  it("REVISÃO e REFAÇÃO (controle de qualidade) disponíveis em qualquer fase", () => {
    for (const phase of [
      "acquisition",
      "clinical_conversion",
      "planning_center",
      "commercial_conversion",
      "treatment_start",
      "reevaluation",
      "follow_up",
    ] as const) {
      const opts = appointmentTypeOptions(phase);
      expect(opts).toContain("revision");
      expect(opts).toContain("redo");
    }
  });

  it("não repete o tipo automático quando ele já é excepcional (Acompanhamento)", () => {
    const opts = appointmentTypeOptions("follow_up");
    expect(opts.filter((t) => t === "return_visit")).toHaveLength(1);
  });
});
