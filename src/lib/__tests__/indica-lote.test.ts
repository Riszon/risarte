import { describe, expect, it } from "vitest";
import { errosDoLote, linhasPreenchidas, type LinhaLote } from "@/lib/indica/lote";

const l = (nome: string, telefone: string, aceite: LinhaLote["aceite"] = ""): LinhaLote => ({ nome, telefone, aceite });

describe("errosDoLote", () => {
  it("linhas certas não têm erro; a última em branco é ignorada", () => {
    const linhas = [l("Ana", "(43) 99999-0001"), l("Bia", "43 99999-0002", "presencial"), l("", "")];
    expect(errosDoLote(linhas).size).toBe(0);
    expect(linhasPreenchidas(linhas)).toHaveLength(2);
  });

  it("aponta a linha certa: sem nome, sem telefone, telefone curto", () => {
    const e = errosDoLote([l("", "(43) 99999-0001"), l("Caio", ""), l("Duda", "9999-0001")]);
    expect(e.get(0)).toContain("nome");
    expect(e.get(1)).toContain("WhatsApp");
    expect(e.get(2)).toContain("DDD");
  });

  it("telefone repetido dentro da mesma lista acusa a SEGUNDA, dizendo qual é a primeira", () => {
    const e = errosDoLote([l("Ana", "(43) 99999-0001"), l("Bia", "(43) 99999-0002"), l("Ana de novo", "43999990001")]);
    expect(e.has(0)).toBe(false);
    expect(e.get(2)).toBe("Mesmo WhatsApp da pessoa 1 desta lista.");
  });
});
