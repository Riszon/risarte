import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filtrarFila, ordenarFila, type CartaoDaFila } from "@/lib/fila-a-apresentar";

// OC-00169 (04/11/2026): a fila "A apresentar" do Comercial por data, quem
// chegou em cima, e os filtros Hoje / Próximos 3 dias / Sem agendamento.

const c = (fullName: string, presentationAt: string | null, atendimento: string | null = null, esperandoDesde: string | null = null): CartaoDaFila => ({
  fullName,
  presentationAt,
  atendimento,
  esperandoDesde,
});

// 10/11/2026, 15h no Brasil (18h UTC).
const AGORA = new Date("2026-11-10T18:00:00Z");

const fila = [
  c("Ana", null),
  c("Bruno", "2026-11-12T13:00:00-03:00"),
  c("Carla", "2026-11-10T17:00:00-03:00"),
  c("Davi", "2026-11-20T09:00:00-03:00"),
  c("Edu", "2026-11-05T09:00:00-03:00", "waiting", "2026-11-10T14:50:00-03:00"),
  c("Fabi", "2026-11-10T16:00:00-03:00", "waiting", "2026-11-10T14:10:00-03:00"),
  c("Zeca", null),
];

describe("a fila A apresentar (OC-00169)", () => {
  it("quem chegou vem em cima, pela hora da chegada; depois por data; sem agendamento no fim", () => {
    expect(ordenarFila(fila).map((x) => x.fullName)).toEqual(["Fabi", "Edu", "Carla", "Bruno", "Davi", "Ana", "Zeca"]);
  });

  it("Hoje: os de hoje e quem já está na clínica", () => {
    expect(filtrarFila(fila, "hoje", AGORA).map((x) => x.fullName).sort()).toEqual(["Carla", "Edu", "Fabi"]);
  });

  it("Próximos 3 dias: hoje, amanhã e depois de amanhã (no dia do Brasil)", () => {
    expect(filtrarFila(fila, "3dias", AGORA).map((x) => x.fullName).sort()).toEqual(["Bruno", "Carla", "Edu", "Fabi"]);
  });

  it("Sem agendamento: só quem não tem nada marcado e não chegou", () => {
    expect(filtrarFila(fila, "sem", AGORA).map((x) => x.fullName)).toEqual(["Ana", "Zeca"]);
  });

  it("o dia é o do Brasil: 23h de hoje aqui (2h UTC de amanhã) ainda é hoje", () => {
    const tarde = [c("Noite", "2026-11-10T23:00:00-03:00")];
    expect(filtrarFila(tarde, "hoje", AGORA)).toHaveLength(1);
  });

  it("o quadro usa a fila na coluna A apresentar (régua)", () => {
    const tela = readFileSync(join(process.cwd(), "src", "app", "(app)", "comercial", "kanban-board.tsx"), "utf8");
    expect(tela).toMatch(/ordenarFila\(\s*filtrarFila\(/);
  });
});
