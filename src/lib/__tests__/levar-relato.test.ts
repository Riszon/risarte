import { describe, expect, it } from "vitest";
import { valoresDoRelato } from "../levar-relato";

/**
 * O QUE ESTE TESTE PRENDE: o relato que sai da página de Problemas para a
 * barra da boia tem de chegar inteiro. Perder um campo aqui não quebra nada —
 * a pessoa só descobre quando reabre o relato e vê o texto sumido, depois de
 * já ter ido até a tela do problema capturar.
 */
function form(valores: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(valores)) fd.set(k, v);
  return fd;
}

describe("levar o relato para a barra da boia", () => {
  it("leva tudo o que foi escrito", () => {
    const v = valoresDoRelato(
      form({
        kind: "melhoria",
        module: "agenda",
        severity: "alta",
        title: "A agenda não deixa marcar no sábado",
        screen: "/agenda",
        what_happened: "Escolhi sábado e o sistema recusou.",
        expected: "Deveria aceitar, a unidade abre aos sábados.",
      })
    );
    expect(v).toEqual({
      kind: "melhoria",
      module: "agenda",
      severity: "alta",
      title: "A agenda não deixa marcar no sábado",
      screen: "/agenda",
      what_happened: "Escolhi sábado e o sistema recusou.",
      expected: "Deveria aceitar, a unidade abre aos sábados.",
    });
  });

  it("o que ainda não foi preenchido chega com o mesmo padrão do formulário", () => {
    const v = valoresDoRelato(form({ title: "só comecei" }));
    expect(v.kind).toBe("erro");
    expect(v.severity).toBe("media");
    expect(v.title).toBe("só comecei");
    expect(v.what_happened).toBe("");
  });

  it("módulo vazio vira nulo — para a tela seguinte PEDIR a escolha", () => {
    // Texto em branco passaria pelo `required` do Select e gravaria um módulo
    // vazio, que depois não aparece em filtro nenhum.
    expect(valoresDoRelato(form({ module: "" })).module).toBeNull();
    expect(valoresDoRelato(form({})).module).toBeNull();
  });
});
