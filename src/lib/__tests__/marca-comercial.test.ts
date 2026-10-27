import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_TYPES } from "@/lib/appointments";
import { ehComercial } from "@/components/marca-comercial";

// OC-00135/OC-00136 (27/10/2026): a apresentação comercial continua na mesma
// agenda e no mesmo Atendimento (regra da rede), com uma marca que a recepção
// distingue de relance. Estes testes prendem as telas que a recepção usa.

const ler = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const TELAS = {
  atendimento: "src/app/(app)/atendimento/attendance-panel.tsx",
  agendaDia: "src/app/(app)/agenda/day-room-grid.tsx",
  agendaSemana: "src/app/(app)/agenda/week-time-grid.tsx",
  agendaMes: "src/app/(app)/agenda/month-grid.tsx",
  agendaDaRede: "src/app/(app)/agenda/week-grid.tsx",
};

describe("marca da apresentação comercial", () => {
  it("só a apresentação comercial leva a marca", () => {
    const marcados = APPOINTMENT_TYPES.filter((t) => ehComercial(t));
    expect(marcados).toEqual(["commercial_presentation"]);
  });

  it.each(Object.entries(TELAS))("%s usa a marca", (_, arquivo) => {
    const src = ler(arquivo);
    expect(src).toContain('from "@/components/marca-comercial"');
    expect(src).toMatch(/ehComercial\((a|appointment)\.type\)/);
  });

  it("os cartões das grades levam o contorno; o Atendimento e a rede, o selo", () => {
    for (const t of ["atendimento", "agendaDia", "agendaSemana", "agendaDaRede"] as const) {
      expect(ler(TELAS[t])).toMatch(/&& CONTORNO_COMERCIAL/);
    }
    expect(ler(TELAS.atendimento)).toContain("<SeloComercial");
    expect(ler(TELAS.agendaDaRede)).toContain("<SeloComercial");
  });

  it("a cor não colide com as situações da agenda nem com as etapas do Atendimento", () => {
    const situacoes = ler(TELAS.agendaDaRede).match(
      /export const STATUS_STYLES[\s\S]*?\n};/
    )?.[0];
    const etapas = ler(TELAS.atendimento).match(/const STAGE: Record[\s\S]*?\n};/)?.[0];
    expect(situacoes).toBeTruthy();
    expect(etapas).toBeTruthy();
    expect(situacoes).not.toMatch(/fuchsia/);
    expect(etapas).not.toMatch(/fuchsia/);
    expect(ler("src/components/marca-comercial.tsx")).toMatch(/ring-fuchsia/);
  });

  it("o destaque dourado antigo da agenda da rede saiu (uma marca só)", () => {
    expect(ler(TELAS.agendaDaRede)).not.toContain("highlightType");
    expect(ler("src/app/(app)/agenda/page.tsx")).not.toContain("destaque dourado");
  });
});
