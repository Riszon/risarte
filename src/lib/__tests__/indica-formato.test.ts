import { describe, expect, it } from "vitest";
import { diasDesde, haQuantoTempo } from "@/lib/indica/formato";

describe("Indica +Risos — há quanto tempo", () => {
  // 28/09/2026 08:00 em Brasília = 11:00 UTC
  const agora = new Date("2026-09-28T11:00:00Z");

  it("conta dias CIVIS de Brasília, não blocos de 24h", () => {
    // 27/09 às 23:00 em Brasília (28/09 02:00 UTC) é ONTEM às 8h do dia 28.
    expect(haQuantoTempo("2026-09-28T02:00:00Z", agora)).toBe("ontem");
    // 03:30 UTC do dia 28 = 00:30 de Brasília do dia 28: hoje.
    expect(haQuantoTempo("2026-09-28T03:30:00Z", agora)).toBe("hoje");
  });

  it("vários dias", () => {
    expect(haQuantoTempo("2026-09-24T15:00:00Z", agora)).toBe("há 4 dias");
    expect(diasDesde("2026-09-24T15:00:00Z", agora)).toBe(4);
  });

  it("instante no futuro não vira número negativo", () => {
    expect(haQuantoTempo("2026-09-30T15:00:00Z", agora)).toBe("hoje");
    expect(diasDesde("2026-09-30T15:00:00Z", agora)).toBe(0);
  });
});
