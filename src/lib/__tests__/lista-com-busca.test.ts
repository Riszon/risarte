import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atendeABusca, normalizar } from "@/lib/busca";

// Relato OC-00100 (André, Financeiro da Franqueadora): "ao abrir a janela para
// selecionar, permite apenas a rolagem e seleção. Interessante ter uma lupa
// para digitar o nome do item que procura." As listas longas de Compras,
// Estoque e Financeiro passaram a ter um campo de busca no alto.

const RAIZ = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("a busca (uma regra só para todo campo de procurar)", () => {
  it("ignora acento e maiúscula", () => {
    expect(normalizar("  Anestésico LIDOCAÍNA ")).toBe("anestesico lidocaina");
    expect(normalizar("Conciliação")).toBe("conciliacao");
  });

  it("procura por pedaços de palavra, em qualquer ordem", () => {
    const item = "Anestésico lidocaína 2% — 0 un";
    expect(atendeABusca(item, "anest lido")).toBe(true);
    expect(atendeABusca(item, "lido anest")).toBe(true);
    expect(atendeABusca(item, "LIDOCAINA")).toBe(true);
    expect(atendeABusca("Resina composta A2", "resina a2")).toBe(true);
  });

  it("toda palavra digitada tem de aparecer", () => {
    expect(atendeABusca("Resina composta A2", "resina a3")).toBe(false);
    expect(atendeABusca("2.6.01 · Royalties", "royal fundo")).toBe(false);
  });

  it("busca vazia mostra tudo", () => {
    expect(atendeABusca("Qualquer coisa", "")).toBe(true);
    expect(atendeABusca("Qualquer coisa", "   ")).toBe(true);
  });

  it("a faixa dos acentos está escrita com \\u, não com o caractere invisível", () => {
    // O caractere literal some numa cópia e o editor não mostra — a busca
    // passaria a exigir o acento sem ninguém ver por quê.
    // (Montado por código: o próprio editor já trocou o escape pelo
    // caractere ao gravar este teste.)
    const fonte = ler("lib/busca.ts");
    const B = String.fromCharCode(92);
    expect(fonte).toContain(`/[${B}u0300-${B}u036f]/g`);
    const invisiveis = new RegExp(
      `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`
    );
    expect(invisiveis.test(fonte)).toBe(false);
  });

  it("a tela de Permissões usa a MESMA regra (não uma cópia)", () => {
    const fonte = ler("lib/matriz-de-permissoes.ts");
    expect(fonte).toContain(`from "@/lib/busca"`);
    expect(fonte).not.toMatch(/function normalizar\(/);
  });
});

describe("a lista com busca", () => {
  const fonte = ler("components/ui/lista-com-busca.tsx");

  it("filtra pela regra da busca, olhando o rótulo e o texto extra", () => {
    expect(fonte).toMatch(
      /filter=\{\(o, busca\) => atendeABusca\(`\$\{o\.label\} \$\{o\.busca \?\? ""\}`, busca\)\}/
    );
  });

  it("o botão não toma o foco no apertar do mouse", () => {
    // Medido na tela: a biblioteca punha o cursor na busca e o navegador o
    // devolvia ao botão — o que a pessoa digitava não ia a lugar nenhum.
    const gatilho = fonte.slice(
      fonte.indexOf("<Combobox.Trigger"),
      fonte.indexOf("<Combobox.Value")
    );
    expect(gatilho.length).toBeGreaterThan(0);
    expect(gatilho).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("aberta a lista, o cursor vai para a busca", () => {
    expect(fonte).toMatch(
      /onOpenChangeComplete=\{\(aberta\) => \{\s*if \(aberta\) buscaRef\.current\?\.focus\(\);\s*\}\}/
    );
    const campo = fonte.slice(
      fonte.indexOf("<Combobox.Input"),
      fonte.indexOf("/>", fonte.indexOf("<Combobox.Input"))
    );
    expect(campo).toMatch(/ref=\{buscaRef\}/);
  });

  it("digitou, a primeira que atende fica destacada (Enter escolhe)", () => {
    expect(fonte).toMatch(/^\s*autoHighlight\s*$/m);
  });
});

// As telas convertidas. Cada uma usa a lista nova.
const CONVERTIDAS = [
  "app/(app)/compras/purchases-client.tsx",
  "app/(app)/compras/rodadas/rounds-client.tsx",
  "app/(app)/estoque/stock-client.tsx",
  "app/(app)/estoque/nfe-import.tsx",
  "app/(app)/financeiro/contas-a-pagar/payables-board.tsx",
  "app/(app)/financeiro/contas-a-pagar/approval-rules-dialog.tsx",
  "app/(app)/financeiro/contas-a-pagar/recurrences-dialog.tsx",
  "app/(app)/financeiro/conciliacao/reconciliation-board.tsx",
  "app/(app)/financeiro/repasses/payout-manager.tsx",
  "app/(app)/financeiro/bens/assets-client.tsx",
  "app/(app)/financeiro/dre/dre-client.tsx",
  "app/(app)/financeiro/ponto-de-equilibrio/breakeven-client.tsx",
];

// Listas que crescem com a rede: fornecedores, plano de contas, centros de
// custo, itens de estoque, procedimentos.
const LONGAS = new Set([
  "suppliers",
  "accounts",
  "chart",
  "costCenters",
  "items",
  "stockItems",
  "activeItems",
  "procedures",
]);

// O que ficou de <select> nativo DE PROPÓSITO, com o motivo.
const EXCECOES: Record<string, string> = {
  // Ali "accounts" são as CONTAS BANCÁRIAS da unidade — lista curta.
  "app/(app)/financeiro/conciliacao/reconciliation-board.tsx:accounts": "contas bancárias",
};

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`;
    if (statSync(join(RAIZ, rel)).isDirectory()) arquivos(rel, achados);
    else if (rel.endsWith(".tsx")) achados.push(rel);
  }
  return achados;
}

// `{lista.map((x) => <option` — com ou sem `.filter(...)` no meio.
const OPCAO_NATIVA =
  /\{\s*([A-Za-z_.]+)\s*(?:\.filter\([\s\S]*?\)\s*)?\.map\(\(\s*\w+\s*\)\s*=>\s*\(?\s*<option\b/g;

describe("as listas longas de Compras, Estoque e Financeiro têm busca", () => {
  it.each(CONVERTIDAS)("%s usa a lista com busca", (rel) => {
    expect(ler(rel)).toContain(
      `import { ListaComBusca } from "@/components/ui/lista-com-busca";`
    );
  });

  it("nenhuma lista longa voltou a ser <select> nativo", () => {
    const telas = ["app/(app)/compras", "app/(app)/estoque", "app/(app)/financeiro"]
      .flatMap((d) => arquivos(d));
    // Régua que não acha nada tem de gritar: se a busca não reconhecer NENHUMA
    // caixa nativa nessas telas (sobram as curtas), quem está errada é ela.
    let nativas = 0;
    const longas: string[] = [];
    for (const rel of telas) {
      for (const m of ler(rel).matchAll(OPCAO_NATIVA)) {
        nativas++;
        const chave = `${rel}:${m[1]}`;
        if (LONGAS.has(m[1]) && !EXCECOES[chave]) longas.push(chave);
      }
    }
    expect(nativas).toBeGreaterThan(10);
    expect(longas).toEqual([]);
  });
});
