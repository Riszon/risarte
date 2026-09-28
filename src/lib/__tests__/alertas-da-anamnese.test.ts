import { describe, expect, it } from "vitest";
import { evaluateAlerts, type FilledAnswer } from "@/lib/anamnesis";

// OC-00062 (27/09/2026): o alerta dizia "Condição de saúde relevante
// marcada" e repetia a PERGUNTA — sem dizer QUAL doença. O sistema sabia (é o
// que dispara) e jogava fora.

const DOENCAS: FilledAnswer = {
  id: "1",
  questionId: "q1",
  section: "Saúde",
  label: "Marque as doenças/condições que tem ou já teve:",
  kind: "multi_choice",
  value: ["Asma", "AIDS", "Diabetes"],
  detail: null,
  isAdhoc: false,
  sortOrder: 1,
  alertWhen: { any_of: ["AIDS", "Diabetes", "Tuberculose"] },
  alertMessage: "Condição de saúde relevante marcada — atenção no atendimento.",
};

describe("o alerta da anamnese diz O QUE foi marcado (OC-00062)", () => {
  it("múltipla escolha: só as opções que DISPARAM, na ordem marcada", () => {
    const [a] = evaluateAlerts([DOENCAS]);
    expect(a.itens).toEqual(["AIDS", "Diabetes"]);
    expect(a.message).toMatch(/Condição de saúde relevante/);
  });

  it("opção marcada que não dispara (Asma) não vira alerta sozinha", () => {
    expect(evaluateAlerts([{ ...DOENCAS, value: ["Asma"] }])).toEqual([]);
  });

  it("sim/não: 'Sim' não entra nos itens, mas o detalhe escrito entra", () => {
    const [a] = evaluateAlerts([
      {
        ...DOENCAS,
        label: "Tem alergia a algum medicamento?",
        kind: "yes_no",
        value: "sim",
        detail: "  Dipirona ",
        alertWhen: { equals: "sim" },
        alertMessage: "Alergia a medicamento.",
      },
    ]);
    expect(a.itens).toEqual([]);
    expect(a.detalhe).toBe("Dipirona");
  });

  it("resposta única que não é sim/não: a própria resposta é o item", () => {
    const [a] = evaluateAlerts([
      {
        ...DOENCAS,
        kind: "single_choice",
        value: "Tipo 1",
        alertWhen: { equals: "Tipo 1" },
      } as FilledAnswer,
    ]);
    expect(a.itens).toEqual(["Tipo 1"]);
  });

  it("sem detalhe escrito, detalhe é nulo (não string vazia)", () => {
    const [a] = evaluateAlerts([DOENCAS]);
    expect(a.detalhe).toBeNull();
  });
});

describe("a leitura da anamnese", () => {
  it("texto vazio (campo digitado e apagado) aparece como '—', não em branco", async () => {
    const { formatAnswer } = await import("@/lib/anamnesis");
    expect(formatAnswer("", "short_text")).toBe("—");
    expect(formatAnswer("   ", "short_text")).toBe("—");
    expect(formatAnswer(null, "short_text")).toBe("—");
    expect(formatAnswer("Há 2 anos", "short_text")).toBe("Há 2 anos");
  });
});
