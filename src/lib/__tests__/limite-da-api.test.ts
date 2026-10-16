import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lerPorLotes, type Pagina } from "@/lib/paginar";

// AP47 (15/10/2026): a API devolve NO MÁXIMO 1.000 linhas por chamada (AP35,
// medido) — pedir 5.000 volta com 1.000, sem erro. As telas que SOMAM ou
// CONTAM o que vem mostravam um total cortado com cara de certo.

const SRC = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("lerPorLotes — ids em lotes, cada lote em páginas", () => {
  it("lê todos os lotes e todas as páginas, sem repetir nem pular", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `c${i}`);
    // Cada id tem 3 linhas; páginas de 2 linhas; lotes de 3 ids.
    const lotesVistos: string[][] = [];
    const r = await lerPorLotes<string>(
      ids,
      (lote, de, ate) => {
        if (de === 0) lotesVistos.push(lote);
        const todas = lote.flatMap((id) => [`${id}-a`, `${id}-b`, `${id}-c`]);
        return Promise.resolve<Pagina<string>>({ data: todas.slice(de, ate + 1), error: null });
      },
      3
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lotesVistos).toEqual([["c0", "c1", "c2"], ["c3", "c4", "c5"], ["c6"]]);
    expect(r.linhas).toHaveLength(21);
    expect(new Set(r.linhas).size).toBe(21);
  });

  it("erro em QUALQUER lote devolve erro — nunca a metade lida", async () => {
    const r = await lerPorLotes<string>(["a", "b", "c", "d"], (lote) =>
      Promise.resolve<Pagina<string>>(
        lote.includes("c")
          ? { data: null, error: { message: "caiu" } }
          : { data: lote, error: null }
      ),
      2
    );
    expect(r.ok).toBe(false);
  });

  it("sem ids, nada a ler (e nenhuma chamada)", async () => {
    let chamadas = 0;
    const r = await lerPorLotes<string>([], () => {
      chamadas++;
      return Promise.resolve({ data: [], error: null });
    });
    expect(r).toEqual({ ok: true, linhas: [], paginas: 0 });
    expect(chamadas).toBe(0);
  });
});

describe("nenhuma leitura pede mais que a API entrega", () => {
  // Sessões paralelas (CLAUDE.md §0) — registradas no BACKLOG (AP47), não
  // consertadas daqui.
  const DE_OUTRA_SESSAO = new Set([
    "app/(app)/empresarial/page.tsx",
    "app/(app)/indica-mais-risos/relatorios/csv/route.ts",
  ]);

  it("nenhum .limit() acima de 1.000 no núcleo (o excedente some sem aviso)", () => {
    const achados: string[] = [];
    let arquivos = 0;
    const varrer = (dir: string) => {
      for (const nome of readdirSync(join(SRC, dir))) {
        const rel = `${dir}/${nome}`;
        if (nome === "__tests__") continue;
        if (statSync(join(SRC, rel)).isDirectory()) varrer(rel);
        else if (/\.(ts|tsx)$/.test(nome)) {
          arquivos++;
          if (DE_OUTRA_SESSAO.has(rel)) continue;
          for (const m of ler(rel).matchAll(/\.limit\(\s*(\d+)\s*\)/g)) {
            if (Number(m[1]) > 1000) achados.push(`${rel}: .limit(${m[1]})`);
          }
        }
      }
    };
    varrer("app");
    varrer("lib");
    expect(arquivos).toBeGreaterThan(100); // a régua achou o que varrer
    expect(achados).toEqual([]);
  });

  it.each([
    ["app/(app)/relatorios/page.tsx", 3],
    ["lib/painel-dados.ts", 2],
    ["app/(app)/planos/page.tsx", 1],
    ["app/(app)/prontuarios/page.tsx", 1],
    ["app/(app)/risartanos/dados.ts", 1],
    ["app/(app)/planejamento/page.tsx", 1],
  ])("%s lê em páginas", (rel, minimo) => {
    const fonte = ler(rel);
    const usos = (fonte.match(/lerTodasAsPaginas</g) ?? []).length;
    expect(usos).toBeGreaterThanOrEqual(minimo);
  });

  it("listas por ids vão em lotes (o endereço da chamada tem limite)", () => {
    expect((ler("app/(app)/planejamento/page.tsx").match(/lerPorLotes</g) ?? []).length).toBe(3);
    expect((ler("app/(app)/risartanos/dados.ts").match(/lerPorLotes</g) ?? []).length).toBe(2);
  });

  it("leitura que falha DIZ isso na tela (nunca zero com cara de certo)", () => {
    expect(ler("app/(app)/relatorios/page.tsx")).toContain("Não foi possível ler todos os dados agora");
    expect(ler("app/(app)/planos/page.tsx")).toContain("Não foi possível ler os planos agora");
    expect(ler("app/(app)/planejamento/page.tsx")).toContain("Não foi possível ler toda a fila agora");
  });
});
