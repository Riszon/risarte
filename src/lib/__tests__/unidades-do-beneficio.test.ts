import { describe, expect, it } from "vitest";
import {
  rotuloDasUnidades,
  valeNaUnidade,
} from "@/lib/empresarial/beneficios-da-proposta";

const PARCERIA = ["cambe", "londrina"];
const NOMES = new Map([
  ["cambe", "Risarte Cambé"],
  ["londrina", "Risarte Londrina"],
]);

describe("em quais unidades o benefício vale", () => {
  it("SEM restrição, vale em todas as unidades da parceria", () => {
    expect(valeNaUnidade(null, "cambe", PARCERIA)).toBe(true);
    expect(valeNaUnidade([], "londrina", PARCERIA)).toBe(true);
  });

  it("LISTA VAZIA é ausência de restrição, não restrição a nada", () => {
    // A outra leitura faria todo benefício já existente parar de valer no dia
    // em que a coluna nasceu.
    expect(valeNaUnidade([], "cambe", PARCERIA)).toBe(true);
  });

  it("sem restrição, NÃO vale fora da parceria", () => {
    // É o ponto de ter parceria: a empresa contratou atendimento nas unidades
    // combinadas.
    expect(valeNaUnidade(null, "maringa", PARCERIA)).toBe(false);
  });

  it("com restrição, vale só nas unidades escolhidas", () => {
    expect(valeNaUnidade(["cambe"], "cambe", PARCERIA)).toBe(true);
    expect(valeNaUnidade(["cambe"], "londrina", PARCERIA)).toBe(false);
  });

  it("SEM PARCERIA declarada, o programa não limita unidade nenhuma", () => {
    // É como funcionava antes desta regra existir — e é o que mantém toda
    // empresa já cadastrada exatamente como está.
    expect(valeNaUnidade(null, "qualquer", [])).toBe(true);
  });

  it("sem saber onde a pessoa está, a resposta honesta é SIM", () => {
    // Recusar por falta de informação tiraria benefício de quem tem direito.
    expect(valeNaUnidade(["cambe"], null, PARCERIA)).toBe(true);
    expect(valeNaUnidade(null, null, PARCERIA)).toBe(true);
  });
});

describe("como a restrição é escrita", () => {
  it("sem restrição, diz que vale em todas", () => {
    expect(rotuloDasUnidades(null, NOMES)).toBe("Em todas as unidades da parceria");
  });

  it("uma unidade, sem lista", () => {
    expect(rotuloDasUnidades(["cambe"], NOMES)).toBe("Só em Risarte Cambé");
  });

  it("várias unidades saem por nome", () => {
    expect(rotuloDasUnidades(["cambe", "londrina"], NOMES)).toBe(
      "Só em: Risarte Cambé, Risarte Londrina"
    );
  });

  it("id que não é mais unidade da parceria SOME do texto", () => {
    // "e mais 1" sem saber qual seria pior que não escrever nada.
    expect(rotuloDasUnidades(["sumiu"], NOMES)).toBe("Em todas as unidades da parceria");
    expect(rotuloDasUnidades(["cambe", "sumiu"], NOMES)).toBe("Só em Risarte Cambé");
  });
});
