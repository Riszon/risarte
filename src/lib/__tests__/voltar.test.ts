import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anteriorServeParaVoltar } from "@/lib/voltar";

// Relato OC-00101: uma seta "Voltar" na barra de cima, que volta à tela
// anterior do riSZon do jeito que ela estava (decisão do dono).

const ORIGEM = "https://risarte.vercel.app";
const RAIZ = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("quando a seta acende", () => {
  it("a tela anterior é uma tela do riSZon", () => {
    expect(anteriorServeParaVoltar(`${ORIGEM}/admin/auditoria?visao=acoes`, ORIGEM)).toBe(true);
    expect(anteriorServeParaVoltar(`${ORIGEM}/`, ORIGEM)).toBe(true);
    expect(anteriorServeParaVoltar(`${ORIGEM}/compras/painel`, ORIGEM)).toBe(true);
  });

  it("sem tela anterior, apaga", () => {
    expect(anteriorServeParaVoltar(null, ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar(undefined, ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar("", ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar("não é endereço", ORIGEM)).toBe(false);
  });

  it("login, entrada e conta desativada não são tela de trabalho", () => {
    expect(anteriorServeParaVoltar(`${ORIGEM}/login`, ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar(`${ORIGEM}/login?motivo=inatividade`, ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar(`${ORIGEM}/auth/encerrar`, ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar(`${ORIGEM}/conta-desativada`, ORIGEM)).toBe(false);
    // …mas só o caminho exato: uma tela que COMEÇA com "login" não é o login.
    expect(anteriorServeParaVoltar(`${ORIGEM}/loginsx`, ORIGEM)).toBe(true);
  });

  it("outro endereço não é o riSZon", () => {
    expect(anteriorServeParaVoltar("https://risarte-treino.vercel.app/", ORIGEM)).toBe(false);
    expect(anteriorServeParaVoltar("https://www.google.com/", ORIGEM)).toBe(false);
  });
});

describe("a seta na tela", () => {
  const botao = ler("components/botao-voltar.tsx");

  it("está na barra de cima, que aparece em toda tela", () => {
    const barra = ler("components/topbar.tsx");
    expect(barra).toContain(`import { BotaoVoltar } from "@/components/botao-voltar";`);
    // Fora de qualquer condição: a seta é para todo mundo, inclusive no portal.
    const header = barra.slice(barra.indexOf("<header"), barra.indexOf("<QuickSearch"));
    expect(header).toMatch(/\n {6}<BotaoVoltar \/>\r?\n/);
  });

  it("volta pelo histórico (a tela ANTERIOR, não a tela mãe)", () => {
    expect(botao).toMatch(/onClick=\{\(\) => window\.history\.back\(\)\}/);
  });

  it("só acende pela regra, e nasce apagada no servidor", () => {
    expect(botao).toMatch(
      /return anteriorServeParaVoltar\(anterior\?\.url, window\.location\.origin\);/
    );
    expect(botao).toMatch(/useSyncExternalStore\(assinar, lerSePodeVoltar, \(\) => false\)/);
    expect(botao).toMatch(/disabled=\{!podeVoltar\}/);
  });

  it("avisa a troca de tela DEPOIS, nunca na hora", () => {
    // Avisar na hora deu "useInsertionEffect must not schedule updates" no
    // console a cada troca de tela (visto na tela, e reproduzido de propósito).
    expect(botao).toMatch(/const depois = \(\) => queueMicrotask\(avisar\);/);
    expect(botao).toMatch(/addEventListener\("currententrychange", depois\)/);
    expect(botao).toMatch(/addEventListener\("popstate", depois\)/);
  });

  it("o painel de Compras tem o caminho de volta também para a Franqueadora", () => {
    const painel = ler("app/(app)/compras/painel/page.tsx");
    expect(painel).toMatch(/voltar=\{\{ href: "\/compras", rotulo: "Compras" \}\}/);
  });
});
