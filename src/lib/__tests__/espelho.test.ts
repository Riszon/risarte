import { describe, expect, it } from "vitest";
import {
  ambientesNoTreino,
  caminhoDaFotoNoTreino,
  falhaSemDados,
  linhaDoRisartanoNoTreino,
  loginAbertoNoTreino,
  niveisDeCarreiraDoTreino,
  nivelPreservado,
  permitidoNaProducao,
  traduzirIds,
} from "../espelho";

describe("permitidoNaProducao — a mesma regra de environment_allowed (0259)", () => {
  it("sem linha: treino e Academy abertos, sistema fechado", () => {
    expect(permitidoNaProducao(false, [], "treino")).toBe(true);
    expect(permitidoNaProducao(false, [], "academy")).toBe(true);
    expect(permitidoNaProducao(false, [], "sistema")).toBe(false);
  });

  it("a linha manda quando existe", () => {
    const linhas = [
      { environment: "treino", allowed: false },
      { environment: "sistema", allowed: true },
    ];
    expect(permitidoNaProducao(false, linhas, "treino")).toBe(false);
    expect(permitidoNaProducao(false, linhas, "sistema")).toBe(true);
  });

  it("Admin Master entra em tudo, mesmo com linha dizendo não", () => {
    const linhas = [{ environment: "treino", allowed: false }];
    expect(permitidoNaProducao(true, linhas, "treino")).toBe(true);
    expect(permitidoNaProducao(true, [], "sistema")).toBe(true);
  });
});

describe("ambientesNoTreino", () => {
  it("quem ainda NÃO tem o sistema real encontra o sistema aberto no treino", () => {
    // O recém-chegado: sistema fechado na produção, treino liberado (padrão).
    expect(ambientesNoTreino(false, [])).toEqual({
      sistema: true,
      treino: true,
      academy: true,
    });
  });

  it("treino retirado na produção fecha o sistema lá dentro", () => {
    const r = ambientesNoTreino(false, [
      { environment: "treino", allowed: false },
      { environment: "sistema", allowed: true },
    ]);
    expect(r.sistema).toBe(false);
    expect(r.treino).toBe(false);
  });
});

describe("loginAbertoNoTreino", () => {
  it("ativo e liberado = aberto", () => {
    expect(loginAbertoNoTreino({ ativo: true, isAdminMaster: false, linhas: [] })).toBe(true);
  });
  it("desativado na produção = bloqueado no treino", () => {
    expect(loginAbertoNoTreino({ ativo: false, isAdminMaster: false, linhas: [] })).toBe(false);
  });
  it("treino retirado = bloqueado", () => {
    expect(
      loginAbertoNoTreino({
        ativo: true,
        isAdminMaster: false,
        linhas: [{ environment: "treino", allowed: false }],
      })
    ).toBe(false);
  });
});

describe("traduzirIds", () => {
  const mapa = new Map<string, string | null>([
    ["p1", "t1"],
    ["p2", "t2"],
    ["p3", null],
  ]);
  it("troca o que conhece e devolve o que falta, sem repetir", () => {
    expect(traduzirIds(["p1", "p2", "p1", "p3", "p9"], mapa)).toEqual({
      ids: ["t1", "t2"],
      faltando: ["p3", "p9"],
    });
  });
});

describe("caminhoDaFotoNoTreino", () => {
  it("troca a pasta da unidade e mantém o arquivo", () => {
    expect(caminhoDaFotoNoTreino("prod-clinica/abc.jpg", "treino-clinica")).toBe(
      "treino-clinica/abc.jpg"
    );
  });
  it("caminho sem pasta vai para dentro da pasta da unidade", () => {
    expect(caminhoDaFotoNoTreino("solto.png", "u1")).toBe("u1/solto.png");
  });
});

describe("falhaSemDados", () => {
  it("guarda o passo e o código, nunca o texto do banco", () => {
    expect(falhaSemDados("gravar a ficha", "23505")).toBe(
      "gravar a ficha (código 23505)"
    );
    expect(falhaSemDados("gravar a ficha")).toBe("gravar a ficha");
  });
});

describe("linhaDoRisartanoNoTreino", () => {
  const agora = "2026-09-18T12:00:00.000Z";
  const unidades = new Map<string, string | null>([
    ["prodA", "treA"],
    ["prodB", "treB"],
  ]);
  const pessoas = new Map<string, string | null>([["uProd", "uTre"]]);

  it("troca unidade, pessoas e foto; copia o resto como está", () => {
    const { linha, unidadesFaltando } = linhaDoRisartanoNoTreino(
      {
        id: "s1",
        code: "RIS-0007",
        full_name: "Fulana",
        cpf: "123.456.789-00",
        clinic_id: "prodA",
        inactive_unit_ids: ["prodB", "prodZ"],
        user_id: "uProd",
        created_by: "uProd",
        updated_by: "desconhecido",
        photo_path: "prodA/foto.jpg",
        mirrored_at: null,
        coluna_nova: "vem junto",
      },
      { unidadeLocal: "treA", unidades, pessoas, agora }
    );
    expect(linha).toEqual({
      id: "s1",
      code: "RIS-0007",
      full_name: "Fulana",
      cpf: "123.456.789-00",
      clinic_id: "treA",
      inactive_unit_ids: ["treB"],
      user_id: "uTre",
      created_by: "uTre",
      updated_by: null,
      photo_path: "treA/foto.jpg",
      mirrored_at: agora,
      coluna_nova: "vem junto",
    });
    expect(unidadesFaltando).toEqual(["prodZ"]);
  });

  it("sem foto e sem login continua sem foto e sem login", () => {
    const { linha } = linhaDoRisartanoNoTreino(
      { id: "s2", clinic_id: "prodA", user_id: null, photo_path: null },
      { unidadeLocal: "treA", unidades, pessoas, agora }
    );
    expect(linha.user_id).toBeNull();
    expect(linha.photo_path).toBeNull();
    expect(linha.inactive_unit_ids).toEqual([]);
  });
});

describe("nível de carreira preservado no treino (0261)", () => {
  const niveis = niveisDeCarreiraDoTreino([
    { clinic_id: "cam", role: "dentist", career_level_id: "nivel-2" },
    { clinic_id: "lon", role: "dentist", career_level_id: null },
    { clinic_id: "cam", role: "receptionist", career_level_id: "estranho" },
  ]);

  it("a mesma função na mesma unidade volta com o nível", () => {
    expect(nivelPreservado(niveis, "cam", "dentist")).toBe("nivel-2");
  });
  it("sem nível lá, continua sem nível", () => {
    expect(nivelPreservado(niveis, "lon", "dentist")).toBeNull();
  });
  it("papel diferente não herda o nível de outro papel", () => {
    expect(nivelPreservado(niveis, "cam", "unit_manager")).toBeNull();
  });
});
