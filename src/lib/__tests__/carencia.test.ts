import { describe, expect, it } from "vitest";
import {
  liberacaoDaPessoa,
  type EntradaDaCarencia,
} from "@/lib/empresarial/carencia";

// ⚠️ ESTES TESTES GUARDAM UMA REGRA QUE ERRA PARA O LADO QUE NINGUÉM RECLAMA.
// Se a conta liberar a pessoa cedo demais, a recepção agenda, o paciente vem, e
// o benefício é negado NA CADEIRA — o erro aparece na frente do cliente. Se
// liberar tarde demais, ele só não é chamado, e ninguém descobre.

const base: EntradaDaCarencia = {
  contratoIniciadoEm: null,
  diasDaEmpresa: 0,
  diasDoColaboradorPadrao: 0,
  diasDesteColaborador: null,
  entrouEm: null,
};

const EM = (iso: string) => new Date(iso);

describe("liberacaoDaPessoa", () => {
  it("sem carência nenhuma, já está liberada", () => {
    const r = liberacaoDaPessoa(
      { ...base, entrouEm: "2026-09-01T00:00:00Z" },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberada).toBe(true);
    expect(r.liberadoEm).toBeNull();
  });

  it("carência da empresa conta a partir do início do CONTRATO", () => {
    const r = liberacaoDaPessoa(
      {
        ...base,
        contratoIniciadoEm: "2026-09-01T00:00:00Z",
        diasDaEmpresa: 30,
        entrouEm: "2026-09-01T00:00:00Z",
      },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberada).toBe(false);
    expect(r.liberadoEm?.slice(0, 10)).toBe("2026-10-01");
    expect(r.motivo).toBe("empresa");
  });

  it("carência do colaborador conta a partir da ENTRADA dele", () => {
    // A empresa começou há muito tempo; quem entrou ontem ainda espera.
    const r = liberacaoDaPessoa(
      {
        ...base,
        contratoIniciadoEm: "2026-01-01T00:00:00Z",
        diasDaEmpresa: 30,
        diasDoColaboradorPadrao: 15,
        entrouEm: "2026-09-10T00:00:00Z",
      },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberada).toBe(false);
    expect(r.liberadoEm?.slice(0, 10)).toBe("2026-09-25");
    expect(r.motivo).toBe("colaborador");
  });

  it("VALE A MAIS LONGA — passar uma não adianta se a outra ainda corre", () => {
    // Colaborador liberado em 20/09; empresa só em 01/11. Manda a da empresa.
    const r = liberacaoDaPessoa(
      {
        ...base,
        contratoIniciadoEm: "2026-10-02T00:00:00Z",
        diasDaEmpresa: 30,
        diasDoColaboradorPadrao: 10,
        entrouEm: "2026-09-10T00:00:00Z",
      },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberadoEm?.slice(0, 10)).toBe("2026-11-01");
    expect(r.motivo).toBe("empresa");
  });

  it("⚠️ carência própria ZERO libera a pessoa — não cai no padrão da empresa", () => {
    // O caso que `|| padrão` quebraria: alguém tirou a carência desta pessoa de
    // propósito, e o zero seria lido como "não informado".
    const r = liberacaoDaPessoa(
      {
        ...base,
        diasDoColaboradorPadrao: 90,
        diasDesteColaborador: 0,
        entrouEm: "2026-09-10T00:00:00Z",
      },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberada).toBe(true);
  });

  it("carência própria MAIOR que o padrão também vale", () => {
    const r = liberacaoDaPessoa(
      {
        ...base,
        diasDoColaboradorPadrao: 10,
        diasDesteColaborador: 60,
        entrouEm: "2026-09-10T00:00:00Z",
      },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberadoEm?.slice(0, 10)).toBe("2026-11-09");
  });

  it("no DIA em que a carência vence, a pessoa já está liberada", () => {
    // O limite que erra em silêncio: um `<` no lugar de `<=` faria a pessoa
    // esperar um dia a mais, e ninguém notaria.
    const r = liberacaoDaPessoa(
      {
        ...base,
        diasDoColaboradorPadrao: 30,
        entrouEm: "2026-08-12T00:00:00Z",
      },
      EM("2026-09-11T00:00:00Z")
    );
    expect(r.liberada).toBe(true);
  });

  it("contrato sem data de início não cria carência de empresa", () => {
    // Empresa cadastrada mas sem contrato iniciado: não dá para contar 30 dias
    // a partir do nada. Inventar uma data prenderia todo mundo.
    const r = liberacaoDaPessoa(
      { ...base, contratoIniciadoEm: null, diasDaEmpresa: 30, entrouEm: "2026-09-10T00:00:00Z" },
      EM("2026-09-11T12:00:00Z")
    );
    expect(r.liberada).toBe(true);
  });
});
