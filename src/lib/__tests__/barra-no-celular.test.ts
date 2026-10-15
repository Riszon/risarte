import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// AP23/AP46 (decisão do dono, 15/10/2026): no celular a página rolava para o
// lado em TODA tela. Medido como Admin em 375 px: o menu lateral aberto (256
// px) espremia a tela em 119 px, e a fileira de ícones da barra de cima não
// cabia. Agora o menu é gaveta (☰) e os ícones menos usados vão para o "⋯".
// AP22: o aviso de hidratação era o tema escuro marcando o <html>.

const SRC = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const lateral = ler("components/app-sidebar.tsx");
const barra = ler("components/topbar.tsx");
const mais = ler("components/menu-mais-da-barra.tsx");

describe("no celular, o menu lateral é gaveta", () => {
  it("fechado, some abaixo de 768 px; aberto, fica por cima da tela", () => {
    expect(lateral).toMatch(
      /abertoNoCelular\s*\?\s*"max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50[^"]*"\s*:\s*"max-md:hidden"/
    );
  });

  it("abre pelo ☰ da barra de cima (um evento só, dos dois lados)", () => {
    expect(lateral).toContain('export const ABRIR_MENU_LATERAL = "risarte:abrir-menu-lateral";');
    expect(lateral).toMatch(/window\.addEventListener\(ABRIR_MENU_LATERAL, abrir\)/);
    expect(ler("components/botao-menu-lateral.tsx")).toMatch(
      /window\.dispatchEvent\(new Event\(ABRIR_MENU_LATERAL\)\)/
    );
    expect(barra).toMatch(/\{!modoPortal && <BotaoMenuLateral \/>\}/);
  });

  it("fecha ao trocar de tela, ao tocar fora e no Esc", () => {
    expect(lateral).toMatch(
      /if \(caminhoDaGaveta !== pathname\) \{\s*setCaminhoDaGaveta\(pathname\);\s*setAbertoNoCelular\(false\);/
    );
    expect(lateral).toMatch(/aria-label="Fechar o menu"\s*onClick=\{\(\) => setAbertoNoCelular\(false\)\}/);
    expect(lateral).toMatch(/if \(e\.key === "Escape"\) setAbertoNoCelular\(false\);/);
  });

  it("aberta no celular, mostra o menu inteiro mesmo que tenha sido minimizado no computador", () => {
    expect(lateral).toContain("const minimizada = collapsed && !abertoNoCelular;");
    // Nenhum desenho lê `collapsed` direto (só o estado e o cookie).
    const desenho = lateral.slice(lateral.indexOf("const adminVisivel"));
    expect(desenho.replace(/setCollapsed|risarte_sidebar_collapsed/g, "")).not.toMatch(/\bcollapsed\b/);
  });
});

describe("no celular, a barra de cima cabe", () => {
  it("tema, alertas, novidades e manual saem da barra abaixo de 640 px…", () => {
    expect(barra).toMatch(/<BotaoDeTema className="hidden sm:grid" \/>/);
    for (const href of ["/alertas", "/novidades", "/manual"]) {
      const i = barra.indexOf(`href="${href}"`);
      expect(i, href).toBeGreaterThan(0);
      expect(barra.slice(Math.max(0, i - 120), i), href).toContain('<div className="hidden sm:contents">');
    }
  });

  it("…e entram no menu ⋯, com as mesmas condições", () => {
    expect(barra).toMatch(
      /<MenuMaisDaBarra\s+podeVerSistema=\{podeVerSistema\}\s+podeVerManual=\{podeVerManual\}\s+modoPortal=\{modoPortal\}\s*\/>/
    );
    expect(mais).toMatch(/sm:hidden/);
    expect(mais).toMatch(/onClick=\{\(\) => alternarTema\(\)\}/);
    expect(mais).toMatch(/\{podeVerSistema && \(\s*<DropdownMenuItem onClick=\{\(\) => router\.push\("\/alertas"\)\}/);
    expect(mais).toMatch(/\{!modoPortal && \(\s*<DropdownMenuItem onClick=\{\(\) => router\.push\("\/novidades"\)\}/);
    expect(mais).toMatch(/\{podeVerManual && \(\s*<DropdownMenuItem onClick=\{\(\) => router\.push\("\/manual"\)\}/);
  });

  it("a troca de tema é uma só, para o botão e para o menu", () => {
    const tema = ler("components/tema.tsx");
    expect(tema).toMatch(/export function alternarTema\(\)/);
    expect(tema).toMatch(/const alternar = useCallback\(\(\) => alternarTema\(\), \[\]\);/);
  });
});

describe("AP22 — o aviso de hidratação do tema escuro", () => {
  it("o <html> aceita a marca do tema posta antes do React", () => {
    const raiz = ler("app/layout.tsx");
    const inicio = raiz.search(/<html\s+lang=/); // o elemento, não o comentário que fala dele
    expect(inicio).toBeGreaterThan(0);
    const html = raiz.slice(inicio, raiz.indexOf(">", inicio) + 1);
    expect(html).toMatch(/^<html\s+lang="pt-BR"[\s\S]*\ssuppressHydrationWarning\s*>$/);
    expect(html.length).toBeLessThan(200); // a licença está no PRÓPRIO <html>, não mais adiante
  });

  it("e SÓ ele: a licença não se espalha (esconderia defeito de verdade)", () => {
    const usos: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(join(SRC, dir))) {
        const rel = `${dir}/${nome}`;
        if (nome === "__tests__") continue;
        if (statSync(join(SRC, rel)).isDirectory()) varrer(rel);
        else if (rel.endsWith(".tsx")) {
          const linhas = ler(rel).split("\n").filter((l) => /^\s*suppressHydrationWarning\b/.test(l));
          usos.push(...linhas.map(() => rel));
        }
      }
    };
    varrer("app");
    varrer("components");
    expect(usos).toEqual(["app/layout.tsx"]);
  });
});
