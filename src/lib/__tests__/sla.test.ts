import { describe, expect, it } from "vitest";
import {
  formatDuration,
  resolveInactivity,
  resolveInactivityMinutes,
  resolveSla,
  toMinutes,
  type InactivitySettingRow,
  type SlaSettingRow,
  type TimeUnit,
} from "@/lib/sla";

// Padrão "cascata": linha com clinic_id NULL = padrão da rede; linha com
// clinic_id = ajuste daquela unidade (vence o padrão). Vale para SLA,
// inatividade e (futuro) tabela de preços.
// I3: o prazo é quantidade + unidade, e vale em MINUTOS.

const slaRow = (
  clinicId: string | null,
  key: SlaSettingRow["sla_key"],
  amount: number,
  unit: TimeUnit = "hours"
): SlaSettingRow => ({
  id: `${clinicId}-${key}`,
  clinic_id: clinicId,
  sla_key: key,
  hours: Math.max(1, Math.ceil(toMinutes(amount, unit) / 60)),
  amount,
  unit,
  total_minutes: toMinutes(amount, unit),
});

const inactivityRow = (
  clinicId: string | null,
  key: InactivitySettingRow["setting_key"],
  amount: number,
  unit: TimeUnit = "days"
): InactivitySettingRow => ({
  id: `${clinicId}-${key}`,
  clinic_id: clinicId,
  setting_key: key,
  value_days: Math.max(1, Math.ceil(toMinutes(amount, unit) / 1440)),
  amount,
  unit,
  total_minutes: toMinutes(amount, unit),
});

describe("unidades de tempo do prazo", () => {
  it("converte cada unidade para minutos", () => {
    expect(toMinutes(90, "minutes")).toBe(90);
    expect(toMinutes(2, "hours")).toBe(120);
    expect(toMinutes(3, "days")).toBe(4320);
    expect(toMinutes(1, "months")).toBe(43200); // 1 mês = 30 dias
  });

  it("nunca deixa o prazo zerar", () => {
    expect(toMinutes(0, "hours")).toBe(1);
  });

  it("escreve o prazo do jeito que foi configurado", () => {
    expect(formatDuration(1, "days")).toBe("1 dia");
    expect(formatDuration(3, "days")).toBe("3 dias");
    expect(formatDuration(1, "months")).toBe("1 mês");
    expect(formatDuration(90, "minutes")).toBe("90 minutos");
    expect(formatDuration(null, "hours")).toBe("—");
  });
});

describe("resolveSla (em minutos)", () => {
  const rows = [
    slaRow(null, "evaluation", 24),
    slaRow(null, "planning", 24),
    slaRow("clinic-x", "evaluation", 48),
  ];

  it("ajuste da unidade vence o padrão da rede", () => {
    expect(resolveSla(rows, "clinic-x").evaluation).toBe(48 * 60);
  });
  it("sem ajuste, vale o padrão da rede", () => {
    expect(resolveSla(rows, "clinic-y").evaluation).toBe(24 * 60);
    expect(resolveSla(rows, "clinic-x").planning).toBe(24 * 60);
  });
  it("sem padrão nem ajuste = null (sem SLA)", () => {
    expect(resolveSla(rows, "clinic-x").presentation_to_closing).toBeNull();
  });
  it("aceita prazo menor que uma hora", () => {
    const fast = [slaRow(null, "planning", 30, "minutes")];
    expect(resolveSla(fast, null).planning).toBe(30);
  });
  it("aceita prazo em meses", () => {
    const long = [slaRow(null, "planning", 2, "months")];
    expect(resolveSla(long, null).planning).toBe(86400);
  });
});

describe("resolveInactivity", () => {
  const rows: InactivitySettingRow[] = [
    inactivityRow(null, "phase7_inactivity_days", 180),
    inactivityRow("clinic-x", "phase7_inactivity_days", 90),
  ];

  it("mesma cascata dos SLAs", () => {
    expect(resolveInactivity(rows, "clinic-x").phase7_inactivity_days).toBe(90);
    expect(resolveInactivity(rows, "clinic-y").phase7_inactivity_days).toBe(180);
    expect(resolveInactivity(rows, "clinic-x").phase1_max_days).toBeNull();
  });

  it("em minutos, respeitando a unidade configurada", () => {
    const rowsMin = [inactivityRow(null, "phase1_max_days", 12, "hours")];
    expect(resolveInactivityMinutes(rowsMin, null).phase1_max_days).toBe(720);
  });
});
