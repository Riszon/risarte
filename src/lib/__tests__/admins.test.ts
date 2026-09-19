import { describe, expect, it } from "vitest";
import { podeDarOuTirarAdmin, podeMexerNoAcessoDe, type Hierarquia } from "../admins";

const base: Hierarquia = {
  souAdmin: true,
  souPrincipal: false,
  alvoEAdmin: false,
  alvoEPrincipal: false,
  ehVoceMesmo: false,
};

describe("podeMexerNoAcessoDe — Admins sempre abaixo do Admin Principal", () => {
  it("Admin comum mexe no acesso de quem não é Admin", () => {
    expect(podeMexerNoAcessoDe(base)).toBe(true);
  });
  it("Admin comum NÃO mexe no acesso de outro Admin", () => {
    expect(podeMexerNoAcessoDe({ ...base, alvoEAdmin: true })).toBe(false);
  });
  it("Admin comum NÃO mexe no Admin Principal", () => {
    expect(podeMexerNoAcessoDe({ ...base, alvoEAdmin: true, alvoEPrincipal: true })).toBe(false);
  });
  it("Admin comum NÃO mexe no próprio acesso (é acesso de um Admin)", () => {
    expect(podeMexerNoAcessoDe({ ...base, alvoEAdmin: true, ehVoceMesmo: true })).toBe(false);
  });
  it("o Admin Principal mexe no acesso de qualquer Admin", () => {
    expect(podeMexerNoAcessoDe({ ...base, souPrincipal: true, alvoEAdmin: true })).toBe(true);
  });
  it("quem não é Admin não mexe em acesso nenhum", () => {
    expect(podeMexerNoAcessoDe({ ...base, souAdmin: false })).toBe(false);
  });
});

describe("podeDarOuTirarAdmin", () => {
  it("só o Admin Principal dá ou tira o Admin", () => {
    expect(podeDarOuTirarAdmin(base)).toBe(false);
    expect(podeDarOuTirarAdmin({ ...base, souPrincipal: true })).toBe(true);
  });
  it("nem o Principal tira o próprio Admin", () => {
    expect(podeDarOuTirarAdmin({ ...base, souPrincipal: true, ehVoceMesmo: true, alvoEAdmin: true, alvoEPrincipal: true })).toBe(false);
  });
});
