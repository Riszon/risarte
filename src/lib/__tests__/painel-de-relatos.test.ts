import { describe, expect, it } from "vitest";
import {
  lerPeriodo,
  maiorDe,
  periodoPronto,
  podeVerPainelDeRelatos,
  rotuloDeHoras,
  rotuloDoPonto,
  taxa,
} from "@/lib/painel-de-relatos";

const HOJE = "2026-09-17";

describe("período", () => {
  it("os prontos", () => {
    expect(periodoPronto("30d", HOJE)).toEqual({ de: "2026-08-19", ate: HOJE, pronto: "30d" });
    expect(periodoPronto("90d", HOJE)).toEqual({ de: "2026-06-20", ate: HOJE, pronto: "90d" });
    expect(periodoPronto("mes", HOJE)).toEqual({ de: "2026-09-01", ate: HOJE, pronto: "mes" });
    expect(periodoPronto("ano", HOJE)).toEqual({ de: "2026-01-01", ate: HOJE, pronto: "ano" });
  });

  it("sem nada no endereço: 90 dias", () => {
    expect(lerPeriodo({}, HOJE).pronto).toBe("90d");
  });

  it("pronto desconhecido cai no padrão", () => {
    expect(lerPeriodo({ periodo: "sempre" }, HOJE).pronto).toBe("90d");
  });

  it("data personalizada ganha do pronto", () => {
    expect(lerPeriodo({ periodo: "mes", de: "2026-01-01", ate: "2026-02-15" }, HOJE)).toEqual({
      de: "2026-01-01",
      ate: "2026-02-15",
      pronto: null,
    });
  });

  it("só o início: até hoje", () => {
    expect(lerPeriodo({ de: "2026-09-01" }, HOJE)).toEqual({ de: "2026-09-01", ate: HOJE, pronto: null });
  });

  it("invertido é desvirado", () => {
    expect(lerPeriodo({ de: "2026-09-10", ate: "2026-09-01" }, HOJE)).toMatchObject({
      de: "2026-09-01",
      ate: "2026-09-10",
    });
  });

  it("data impossível ou lixo não derruba: vira o padrão", () => {
    expect(lerPeriodo({ de: "2026-02-31" }, HOJE).pronto).toBe("90d");
    expect(lerPeriodo({ de: "ontem", ate: "<script>" }, HOJE).pronto).toBe("90d");
  });
});

describe("números sem mentir", () => {
  it("taxa sem base é nula, não zero", () => {
    expect(taxa(0, 0)).toBeNull();
    expect(taxa(0, 4)).toBe(0);
    expect(taxa(1, 3)).toBe(33);
    expect(taxa(2, 3)).toBe(67);
  });

  it("horas legíveis", () => {
    expect(rotuloDeHoras(null)).toBeNull();
    expect(rotuloDeHoras(undefined)).toBeNull();
    expect(rotuloDeHoras(0)).toBe("1 min");
    expect(rotuloDeHoras(0.5)).toBe("30 min");
    expect(rotuloDeHoras(5.5)).toBe("5,5 h");
    expect(rotuloDeHoras(47.9)).toBe("47,9 h");
    expect(rotuloDeHoras(76.8)).toBe("3,2 dias");
  });

  it("o banco devolve número como texto às vezes (numeric) — ainda funciona", () => {
    expect(rotuloDeHoras("4.3" as unknown as number)).toBe("4,3 h");
  });

  it("base das barras nunca é zero", () => {
    expect(maiorDe([])).toBe(1);
    expect(maiorDe([0, 0])).toBe(1);
    expect(maiorDe([3, 7])).toBe(7);
  });

  it("rótulo do ponto da série", () => {
    expect(rotuloDoPonto("2026-09-14", "week")).toBe("14/09");
    expect(rotuloDoPonto("2026-09-01", "month")).toBe("set/26");
  });
});

describe("quem vê o link do painel (espelho do banco)", () => {
  const clinics = [
    { id: "matriz", type: "franchisor" },
    { id: "cambe", type: "franchise_unit" },
  ];

  it("Admin sempre", () => {
    expect(podeVerPainelDeRelatos({ isAdminMaster: true, clinics: [], rolesByClinic: {} })).toBe(true);
  });

  it("qualquer papel na Franqueadora", () => {
    expect(
      podeVerPainelDeRelatos({ isAdminMaster: false, clinics, rolesByClinic: { matriz: ["sdr"] } })
    ).toBe(true);
  });

  it("gerente e franqueado de unidade", () => {
    for (const papel of ["unit_manager", "franchisee"]) {
      expect(
        podeVerPainelDeRelatos({ isAdminMaster: false, clinics, rolesByClinic: { cambe: [papel] } })
      ).toBe(true);
    }
  });

  it("⚠️ recepção, dentista etc. de unidade não", () => {
    for (const papel of ["receptionist", "dentist", "clinical_coordinator", "tsb"]) {
      expect(
        podeVerPainelDeRelatos({ isAdminMaster: false, clinics, rolesByClinic: { cambe: [papel] } })
      ).toBe(false);
    }
  });
});
