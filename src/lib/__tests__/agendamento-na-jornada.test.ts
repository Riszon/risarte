import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contaComoAgendamento,
  emLotes,
  linkDaAgenda,
  proximoPorCliente,
  rotuloDoAgendamento,
  type AgendamentoLido,
} from "@/lib/agendamento-na-jornada";

// Relato OC-00074: a Jornada passa a dizer se o cliente tem agendamento.

// 14/10/2026 00:00 no Brasil = 03:00 UTC.
const HOJE = "2026-10-14T03:00:00.000Z";

function ag(mudancas: Partial<AgendamentoLido> = {}): AgendamentoLido {
  return {
    client_id: "c1",
    clinic_id: "u1",
    starts_at: "2026-10-16T17:00:00.000Z", // 16/10 14:00 no Brasil
    type: "treatment_start",
    status: "scheduled",
    attendance: null,
    ...mudancas,
  };
}

describe("o que conta como agendamento", () => {
  it("marcado ou confirmado, daqui para a frente", () => {
    expect(contaComoAgendamento(ag(), HOJE)).toBe(true);
    expect(contaComoAgendamento(ag({ status: "confirmed" }), HOJE)).toBe(true);
  });
  it("cancelado, falta e concluído não contam", () => {
    expect(contaComoAgendamento(ag({ status: "cancelled" }), HOJE)).toBe(false);
    expect(contaComoAgendamento(ag({ status: "no_show" }), HOJE)).toBe(false);
    expect(contaComoAgendamento(ag({ status: "completed" }), HOJE)).toBe(false);
    expect(contaComoAgendamento(ag({ attendance: "done" }), HOJE)).toBe(false);
    expect(contaComoAgendamento(ag({ attendance: "gave_up" }), HOJE)).toBe(false);
  });
  it("hoje conta desde a meia-noite BRASILEIRA, mesmo de manhã cedo", () => {
    // 14/10 08:00 no Brasil = 11:00 UTC.
    expect(contaComoAgendamento(ag({ starts_at: "2026-10-14T11:00:00.000Z" }), HOJE)).toBe(true);
    // 13/10 23:00 no Brasil = 14/10 02:00 UTC — é ONTEM aqui.
    expect(contaComoAgendamento(ag({ starts_at: "2026-10-14T02:00:00.000Z" }), HOJE)).toBe(false);
  });
  it("quem está na sala de espera ou em atendimento hoje ainda tem o horário", () => {
    expect(contaComoAgendamento(ag({ starts_at: "2026-10-14T13:00:00.000Z", attendance: "waiting" }), HOJE)).toBe(true);
    expect(contaComoAgendamento(ag({ starts_at: "2026-10-14T13:00:00.000Z", attendance: "in_service" }), HOJE)).toBe(true);
  });
});

describe("o próximo de cada cliente", () => {
  it("é o mais cedo que conta; o que não conta é ignorado", () => {
    const m = proximoPorCliente(
      [
        ag({ starts_at: "2026-10-20T17:00:00.000Z", type: "treatment_session" }),
        ag({ starts_at: "2026-10-15T12:00:00.000Z", status: "cancelled" }),
        ag(),
        ag({ client_id: "c2", starts_at: "2026-10-13T12:00:00.000Z" }), // passado
      ],
      HOJE
    );
    expect(m.get("c1")).toEqual({ startsAt: "2026-10-16T17:00:00.000Z", type: "treatment_start", clinicId: "u1" });
    expect(m.has("c2")).toBe(false);
  });
});

describe("o rótulo", () => {
  it("dia, hora brasileira e tipo", () => {
    expect(rotuloDoAgendamento({ startsAt: "2026-10-16T17:00:00.000Z", type: "treatment_start", clinicId: "u1" })).toBe(
      "16/10 14:00 · Início de Tratamento"
    );
  });
  it("tipo desconhecido vira 'Agendamento'", () => {
    expect(rotuloDoAgendamento({ startsAt: "2026-10-16T17:00:00.000Z", type: "xyz", clinicId: "u1" })).toMatch(/· Agendamento$/);
  });
});

describe("clicar na marca abre a agenda (dono, 14/10/2026)", () => {
  const proximo = { startsAt: "2026-10-17T01:30:00.000Z", type: "evaluation", clinicId: "u9" }; // 16/10 22:30 no Brasil
  it("com agendamento: a agenda no DIA brasileiro dele, para ver", () => {
    expect(linkDaAgenda({ clientId: "c1", clientClinicId: "u1", proximo, visaoDaRede: false })).toBe(
      "/agenda?vista=dia&ref=2026-10-16"
    );
  });
  it("sem agendamento: a agenda já com o cliente escolhido, para agendar", () => {
    expect(linkDaAgenda({ clientId: "c1", clientClinicId: "u1", proximo: null, visaoDaRede: false })).toBe(
      "/agenda?cliente=c1"
    );
  });
  it("na visão da rede, a unidade vai junto (a do agendamento, ou a do cliente)", () => {
    expect(linkDaAgenda({ clientId: "c1", clientClinicId: "u1", proximo, visaoDaRede: true })).toBe(
      "/agenda?vista=dia&ref=2026-10-16&unidade=u9"
    );
    expect(linkDaAgenda({ clientId: "c1", clientClinicId: "u1", proximo: null, visaoDaRede: true })).toBe(
      "/agenda?cliente=c1&unidade=u1"
    );
  });
});

describe("lotes", () => {
  it("parte a lista sem perder nem repetir", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i);
    const lotes = emLotes(ids, 150);
    expect(lotes).toHaveLength(7);
    expect(lotes.flat()).toEqual(ids);
    expect(emLotes([], 150)).toEqual([]);
  });
});

describe("a tela da Jornada", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/jornada/page.tsx"), "utf8");
  const cartao = readFileSync(join(process.cwd(), "src/app/(app)/jornada/kanban-board.tsx"), "utf8");

  it("lê os agendamentos dos clientes da tela, em lotes, sem limitar à unidade", () => {
    const bloco = pagina.slice(pagina.indexOf("OC-00074"));
    expect(bloco).toMatch(/emLotes\(/);
    expect(bloco).toMatch(/\.in\("client_id", lote\)/);
    expect(bloco).not.toMatch(/\.eq\("clinic_id"/);
  });
  it("cada lote é lido em páginas, com ordem que não empata (AP35)", () => {
    const bloco = pagina.slice(pagina.indexOf("OC-00074"));
    expect(bloco).toMatch(/lerTodasAsPaginas<AgendamentoLido>/);
    expect(bloco).toMatch(/\.order\("starts_at"\)\s*\.order\("id"\)\s*\.range\(de, ate\)/);
  });
  it("falha de leitura não vira 'Sem agendamento'", () => {
    expect(pagina).toMatch(/const agendamentosLidos = falhou\s*\?\s*null/);
    expect(pagina).toMatch(/agendamentosLidos \? \(agendamentosLidos\.get\(id\) \?\? null\) : undefined/);
    expect(cartao).toMatch(/client\.next_appointment === undefined/);
  });
  it("as duas marcas são links para a agenda", () => {
    expect(cartao.match(/<Link\s+href=\{linkDaAgenda\(\{/g)).toHaveLength(2);
    expect(cartao).toMatch(/proximo: client\.next_appointment,/);
    expect(cartao).toMatch(/proximo: null,/);
  });
  it("'Sem agendamento' em destaque em todas as fases (decisão do dono)", () => {
    expect(cartao).toMatch(/border-amber-500\/60[^"]*"\s+title="Nenhum horário marcado daqui para a frente[^"]*"\s*>\s*<CalendarX className="size-3 shrink-0" \/>\s*Sem agendamento/);
    expect(cartao).not.toMatch(/journey_phase === "treatment_start" && .*Sem agendamento/);
  });
});
