import { describe, expect, it } from "vitest";
import { estadoNaRecepcao } from "../commercial";

/**
 * O ESTADO DA RECEPÇÃO NO CARTÃO DO COMERCIAL (0269) — relato OC-00073.
 *
 * O fluxo que o dono descreveu: a recepção recebe o cliente e o coloca "em
 * espera"; o consultor precisa VER isso no cartão, com o tempo correndo, para
 * saber que tem alguém esperando por ele. Antes as duas telas não se falavam.
 */
const AGORA = new Date("2026-09-22T14:30:00-03:00");

describe("o que o cartão do comercial diz sobre a recepção", () => {
  it("em espera mostra o rótulo e há quanto tempo", () => {
    const r = estadoNaRecepcao("waiting", "2026-09-22T14:12:00-03:00", null, AGORA);
    expect(r.rotulo).toBe("Em espera");
    expect(r.esperando).toBe(true);
    expect(r.minutos).toBe(18);
  });

  it("em atendimento conta do momento em que foi chamado", () => {
    const r = estadoNaRecepcao(
      "in_service",
      "2026-09-22T14:00:00-03:00",
      "2026-09-22T14:25:00-03:00",
      AGORA
    );
    expect(r.rotulo).toBe("Em atendimento");
    expect(r.esperando).toBe(false);
    expect(r.minutos).toBe(5); // desde a chamada, não desde a chegada
  });

  it("concluído e desistência aparecem sem cronômetro", () => {
    expect(estadoNaRecepcao("done", null, null, AGORA)).toEqual({
      rotulo: "Atendimento concluído",
      esperando: false,
      minutos: null,
    });
    expect(estadoNaRecepcao("gave_up", null, null, AGORA).rotulo).toBe(
      "Desistiu da espera"
    );
  });

  it("sem check-in ainda, o cartão não inventa rótulo", () => {
    // A hora da apresentação já aparece no cartão; escrever "aguardando" aqui
    // só ocuparia espaço sem dizer nada novo.
    expect(estadoNaRecepcao(null, null, null, AGORA).rotulo).toBeNull();
    expect(estadoNaRecepcao(undefined, null, null, AGORA).rotulo).toBeNull();
  });

  it("hora no futuro não vira tempo negativo", () => {
    // Relógio do computador adiantado, ou dado gravado à frente: "há -3 min"
    // faz quem lê duvidar do resto da tela.
    const r = estadoNaRecepcao("waiting", "2026-09-22T14:45:00-03:00", null, AGORA);
    expect(r.rotulo).toBe("Em espera");
    expect(r.minutos).toBeNull();
  });

  it("em espera sem hora de chegada ainda diz que está esperando", () => {
    const r = estadoNaRecepcao("waiting", null, null, AGORA);
    expect(r.esperando).toBe(true);
    expect(r.minutos).toBeNull();
  });
});
