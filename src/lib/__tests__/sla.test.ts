import { describe, expect, it } from "vitest";
import {
  resolveInactivity,
  resolveSla,
  type InactivitySettingRow,
  type SlaSettingRow,
} from "@/lib/sla";

// Padrão "cascata": linha com clinic_id NULL = padrão da rede; linha com
// clinic_id = ajuste daquela unidade (vence o padrão). Vale para SLA,
// inatividade e (futuro) tabela de preços.

const slaRow = (
  clinicId: string | null,
  key: SlaSettingRow["sla_key"],
  hours: number
): SlaSettingRow => ({ id: `${clinicId}-${key}`, clinic_id: clinicId, sla_key: key, hours });

describe("resolveSla", () => {
  const rows = [
    slaRow(null, "evaluation", 24),
    slaRow(null, "planning", 24),
    slaRow("clinic-x", "evaluation", 48),
  ];

  it("ajuste da unidade vence o padrão da rede", () => {
    expect(resolveSla(rows, "clinic-x").evaluation).toBe(48);
  });
  it("sem ajuste, vale o padrão da rede", () => {
    expect(resolveSla(rows, "clinic-y").evaluation).toBe(24);
    expect(resolveSla(rows, "clinic-x").planning).toBe(24);
  });
  it("sem padrão nem ajuste = null (sem SLA)", () => {
    expect(resolveSla(rows, "clinic-x").presentation_to_closing).toBeNull();
  });
});

describe("resolveInactivity", () => {
  const rows: InactivitySettingRow[] = [
    {
      id: "1",
      clinic_id: null,
      setting_key: "phase7_inactivity_days",
      value_days: 180,
    },
    {
      id: "2",
      clinic_id: "clinic-x",
      setting_key: "phase7_inactivity_days",
      value_days: 90,
    },
  ];

  it("mesma cascata dos SLAs", () => {
    expect(resolveInactivity(rows, "clinic-x").phase7_inactivity_days).toBe(90);
    expect(resolveInactivity(rows, "clinic-y").phase7_inactivity_days).toBe(180);
    expect(resolveInactivity(rows, "clinic-x").phase1_max_days).toBeNull();
  });
});
