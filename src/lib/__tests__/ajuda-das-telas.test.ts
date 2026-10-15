import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionContext } from "@/lib/auth";
import { AJUDAS, ajudaDaTela, linkDoManual } from "@/lib/ajuda-das-telas";
import { apelido } from "@/lib/markdown";
import { matrizPadrao } from "@/lib/permissions";
import { quemDecideACompra } from "@/lib/purchases-access";

// Relato OC-00102: "coloque em cada tela um ícone de ajuda para mostrar o
// passo a passo" — e "quem aprova a compra". A ajuda é um segundo texto; estas
// réguas prendem que ele não se descole da tela nem do manual.

const SRC = join(__dirname, "..", "..");
const APP = join(SRC, "app", "(app)");
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const manual = readFileSync(
  join(SRC, "..", "docs", "treinamento", "manual-treinamento-riSZon.md"),
  "utf8"
).replace(/\r\n/g, "\n");

/** Os arquivos .tsx da PRÓPRIA pasta da rota (sem as subtelas). */
function fontesDaTela(rota: string): string {
  const pasta = join(APP, ...rota.split("/").filter(Boolean));
  return readdirSync(pasta)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(join(pasta, f), "utf8"))
    .join("\n")
    // O JSX parte o texto do botão em linhas ("Enviar à" / "Franqueadora").
    .replace(/\s+/g, " ");
}

describe("a ajuda de cada tela", () => {
  it("existe, e começa por Compras (as telas do relato)", () => {
    expect(AJUDAS.length).toBeGreaterThanOrEqual(5);
    for (const r of ["/compras", "/compras/rodadas", "/compras/aprovar", "/compras/receber", "/compras/painel"]) {
      expect(ajudaDaTela(r)?.rota).toBe(r);
    }
  });

  it.each(AJUDAS.map((a) => [a.rota, a]))("%s: a tela existe em src/app", (_rota, a) => {
    const pasta = join(APP, ...a.rota.split("/").filter(Boolean));
    expect(existsSync(join(pasta, "page.tsx"))).toBe(true);
  });

  it.each(AJUDAS.map((a) => [a.rota, a]))(
    "%s: cada botão em negrito existe na tela (a ajuda não inventa nome)",
    (_rota, a) => {
      const fonte = fontesDaTela(a.rota);
      const nomes = [...a.passos, ...(a.atencao ?? [])].flatMap((p) =>
        [...p.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1])
      );
      expect(nomes.length).toBeGreaterThan(0);
      for (const nome of nomes) expect(fonte, `"${nome}" não está na tela ${a.rota}`).toContain(nome);
    }
  );

  it.each(AJUDAS.map((a) => [a.rota, a]))("%s: a seção do manual existe", (_rota, a) => {
    expect(manual).toContain(`\n## ${a.manual.secao}\n`);
    if (a.manual.trecho) {
      const inicio = manual.indexOf(`\n## ${a.manual.secao}\n`);
      const fim = manual.indexOf("\n## ", inicio + 1);
      expect(manual.slice(inicio, fim)).toContain(`\n### ${a.manual.trecho}\n`);
    }
  });

  it("o link abre o manual na seção e rola até o trecho", () => {
    expect(linkDoManual({ secao: "8. Fluxos principais de uso", trecho: "Fluxo 5 — Compras: pedir" })).toBe(
      `/manual?secao=${apelido("8. Fluxos principais de uso")}#${apelido("Fluxo 5 — Compras: pedir")}`
    );
    expect(linkDoManual({ secao: "7. Mapeamento da interface" })).toBe(
      `/manual?secao=${apelido("7. Mapeamento da interface")}`
    );
  });

  it("acha a tela pelo endereço, sem barra no fim, sem filtro e sem pegar a tela vizinha", () => {
    expect(ajudaDaTela("/compras/aprovar/")?.rota).toBe("/compras/aprovar");
    expect(ajudaDaTela("/compras/painel?de=2026-01-01")?.rota).toBe("/compras/painel");
    expect(ajudaDaTela("/compras/aprovarx")).toBeNull();
    expect(ajudaDaTela("/financeiro")).toBeNull();
  });

  it("o botão ? está na barra de cima, para todos fora do portal", () => {
    const barra = ler("components/topbar.tsx");
    expect(barra).toMatch(/\{!modoPortal && <AjudaDaTela podeVerManual=\{podeVerManual\} \/>\}/);
  });

  it("tela sem ajuda escrita DIZ isso (não mostra um passo a passo genérico)", () => {
    const painel = ler("components/ajuda-da-tela.tsx");
    expect(painel).toContain("Esta tela ainda não tem o passo a passo aqui.");
  });

  it("o manual abre na seção pedida (?secao=)", () => {
    expect(ler("app/(app)/manual/page.tsx")).toMatch(/secaoInicial=\{typeof pedida === "string" \? pedida : undefined\}/);
    expect(ler("app/(app)/manual/manual-reader.tsx")).toMatch(/secoes\.find\(\(s\) => s\.id === secaoInicial\)/);
  });
});

describe("quem aprova a compra — a tela diz (OC-00102)", () => {
  const sessao = {
    isAdminMaster: false,
    rolesByClinic: {},
    permissoes: matrizPadrao(),
    clinics: [
      { id: "fr", name: "Franqueadora", type: "franchisor", is_active: true },
      { id: "un", name: "Cambé", type: "franchise_unit", is_active: true },
    ],
  } as unknown as SessionContext;

  it("na Franqueadora, o Financeiro da Franqueadora; na unidade, o gerente", () => {
    expect(quemDecideACompra(sessao, "fr")).toBe("o Financeiro da Franqueadora ou o Admin");
    expect(quemDecideACompra(sessao, "un")).toBe("o gerente da unidade ou o Admin");
  });

  it("quem não decide vê quem decide, não um traço", () => {
    const tela = ler("app/(app)/compras/aprovar/approval-client.tsx");
    expect(tela).toContain("Decide: {quemDecide}");
    expect(tela).not.toMatch(/<span className="text-muted-foreground">—<\/span>/);
  });
});
