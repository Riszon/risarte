import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { proximoIntervalo } from "@/lib/venda-direta-caixa";

describe("o horário do encaixe (o próximo intervalo de 5 min, no Brasil)", () => {
  it("arredonda para cima, com 1 minuto de folga", () => {
    // 14:02 em Brasília (17:02 UTC) → 14:05
    expect(proximoIntervalo(new Date("2026-11-17T17:02:00Z"))).toEqual({ data: "2026-11-17", time: "14:05" });
    // 14:04:30 → +1 min = 14:05:30 → 14:10 (não fica "no passado" entre a tela e o banco)
    expect(proximoIntervalo(new Date("2026-11-17T17:04:30Z"))).toEqual({ data: "2026-11-17", time: "14:10" });
  });
  it("vira o dia no fuso do Brasil, não no UTC", () => {
    // 23:58 em Brasília (02:58 UTC do dia seguinte) → 00:00 do dia 18
    expect(proximoIntervalo(new Date("2026-11-18T02:58:00Z"))).toEqual({ data: "2026-11-18", time: "00:00" });
    // 20:59 em Brasília (23:59 UTC) + 1 min = 21:00 exatas → 21:00 do MESMO dia 17 (o UTC já virou o dia)
    expect(proximoIntervalo(new Date("2026-11-17T23:59:00Z"))).toEqual({ data: "2026-11-17", time: "21:00" });
  });
});

describe("réguas da 0424 (o encaixe e a sala ao chamar)", () => {
  const sql = readFileSync("supabase/migrations/0424_encaixe_e_sala_ao_chamar.sql", "utf8");
  const agenda = readFileSync("src/app/(app)/agenda/actions.ts", "utf8");
  const caixa = readFileSync("src/app/(app)/comercial/venda-direta/caixa-actions.ts", "utf8");
  const painel = readFileSync("src/app/(app)/atendimento/attendance-panel.tsx", "utf8");

  it("o encaixe é a marca OU urgência/emergência, no conflito do banco", () => {
    expect(sql).toContain("v_encaixe boolean := new.type in ('urgency', 'emergency') or coalesce(new.is_fit_in, false);");
    expect(sql.match(/not \(a\.type in \('urgency', 'emergency'\) or a\.is_fit_in\)/g)?.length).toBe(3);
  });
  it("chamar presencial sem sala, numa unidade com sala, exige a sala (A4)", () => {
    expect(sql).toContain("raise exception 'ROOM_REQUIRED';");
    expect(sql).toMatch(/v_room is null and not coalesce\(v_online, false\)[\s\S]*clinic_rooms/);
  });
  it("o 'Atender agora' agenda pelo MESMO caminho da Agenda, marcado como encaixe", () => {
    expect(caixa).toContain('fd.set("fit_in", "1");');
    expect(caixa).toContain("await createAppointment(fd)");
    expect(agenda).toMatch(/isEncaixe =[\s\S]{0,120}fit_in/);
  });
  it("a Agenda continua exigindo cadastro completo (A3) antes de criar", () => {
    const criar = agenda.slice(agenda.indexOf("export async function createAppointment("), agenda.indexOf("export async function checkProviderCrossUnit"));
    expect(criar).toContain("getClientRegistrationGaps(parsed.values.client_id)");
  });
  it("a tela Atendimento abre a escolha da sala quando o banco pede", () => {
    expect(painel).toContain('result.error?.startsWith("ROOM_REQUIRED:")');
    expect(painel).toContain("<SalaAoChamarDialog");
  });
});
