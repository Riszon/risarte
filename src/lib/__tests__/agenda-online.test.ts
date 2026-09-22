import { describe, expect, it } from "vitest";
import {
  ONLINE_AGENDA_DEFAULTS,
  resolveOnlineAgenda,
  type OnlineAgendaRow,
} from "../agenda-settings";

/**
 * A AGENDA DO COMERCIAL ONLINE (0268) — relato OC-00072.
 *
 * O consultor trabalha remoto e atende várias unidades: a unidade pode estar
 * fechada no sábado enquanto ele trabalha normalmente. A jornada dele é
 * própria, em cascata — rede como padrão, exceção por pessoa.
 *
 * ⚠️ O QUE ESTES TESTES PRENDEM É A CASCATA CAMPO A CAMPO. Em 04/09/2026 a
 * `finance_settings` dizia resolver assim e não resolvia: a linha da exceção
 * nascia com todos os campos preenchidos por padrão, e a rede nunca mais
 * alcançava quem tinha exceção — sem nada na tela denunciando. Aqui o consultor
 * que só muda o horário TEM de continuar seguindo os dias da rede.
 */
const REDE: OnlineAgendaRow = {
  user_id: null,
  open_time: "08:00:00",
  close_time: "20:00:00",
  weekdays: [1, 2, 3, 4, 5, 6],
};

describe("jornada do atendimento online", () => {
  it("sem nada cadastrado, vale o padrão do código", () => {
    expect(resolveOnlineAgenda([], "quem-quer-que-seja")).toEqual(
      ONLINE_AGENDA_DEFAULTS
    );
  });

  it("sem exceção, o consultor segue a rede", () => {
    const r = resolveOnlineAgenda([REDE], "ana");
    expect(r.openTime).toBe("08:00");
    expect(r.closeTime).toBe("20:00");
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.origem).toBe("rede");
  });

  it("a exceção do consultor ganha da rede", () => {
    const r = resolveOnlineAgenda(
      [
        REDE,
        { user_id: "ana", open_time: "13:00:00", close_time: "22:00:00", weekdays: [2, 3, 4] },
      ],
      "ana"
    );
    expect(r.openTime).toBe("13:00");
    expect(r.closeTime).toBe("22:00");
    expect(r.weekdays).toEqual([2, 3, 4]);
    expect(r.origem).toBe("consultor");
  });

  it("exceção PARCIAL: o que ela não diz continua vindo da rede", () => {
    // Este é o caso que a finance_settings errava. A consultora trabalha até
    // mais tarde, mas nos mesmos dias da rede — e se a rede passar a atender
    // domingo, ela passa junto.
    const r = resolveOnlineAgenda(
      [REDE, { user_id: "ana", open_time: null, close_time: "23:00:00", weekdays: null }],
      "ana"
    );
    expect(r.openTime).toBe("08:00"); // da rede
    expect(r.closeTime).toBe("23:00"); // dela
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5, 6]); // da rede
  });

  it("a exceção de um consultor não alcança o outro", () => {
    const rows = [
      REDE,
      { user_id: "ana", open_time: "13:00:00", close_time: "22:00:00", weekdays: [0] },
    ];
    expect(resolveOnlineAgenda(rows, "bruno").origem).toBe("rede");
    expect(resolveOnlineAgenda(rows, "bruno").weekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("lista de dias VAZIA não zera a agenda — cai para a rede", () => {
    // Uma linha salva sem marcar nenhum dia faria o consultor sumir da agenda
    // para sempre, e ninguém entenderia por quê. Vazio = "não definido".
    const r = resolveOnlineAgenda(
      [REDE, { user_id: "ana", open_time: null, close_time: null, weekdays: [] }],
      "ana"
    );
    expect(r.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("o padrão da rede é mais largo que o da unidade", () => {
    // 08–20h, e não 08–18h: quem atende remoto alcança o cliente fora do
    // horário comercial, que é quando o cliente consegue conversar.
    expect(ONLINE_AGENDA_DEFAULTS.closeTime).toBe("20:00");
  });
});
