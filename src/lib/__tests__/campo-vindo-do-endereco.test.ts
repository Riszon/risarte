import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AP137 (resto do AP78). Dentro de um `FilterForm`, o campo do Base UI
 * (`<Input>`) com `defaultValue` vindo do ENDEREÇO solta um erro no console a
 * cada busca: a página volta com outro valor inicial e o Base UI reclama
 * ("changing the default value state of an uncontrolled FieldControl"). Erro
 * que sempre aparece é erro que ninguém lê.
 *
 * O conserto é o `CampoDeBusca` (controlado; só acompanha o endereço quando
 * ele muda). Esta régua reprova a volta do desenho antigo em qualquer tela
 * que use o `FilterForm`.
 *
 * O `<input>` nativo (minúsculo) NÃO entra: ele não é do Base UI e não solta
 * o aviso.
 */
const RAIZ = join(process.cwd(), "src", "app");

function telasComFiltro(pasta: string, achadas: string[] = []): string[] {
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) telasComFiltro(caminho, achadas);
    else if (nome.endsWith(".tsx") && readFileSync(caminho, "utf8").includes("<FilterForm")) {
      achadas.push(caminho);
    }
  }
  return achadas;
}

// `<Input ... defaultValue={...} ... />`, na mesma linha ou partido em várias.
const PROIBIDO = /<Input\b[^>]*?defaultValue=\{/g;

function achados(texto: string): number {
  return (texto.match(PROIBIDO) ?? []).length;
}

describe("⚠️ campo do FilterForm com valor do endereço usa o CampoDeBusca (AP137)", () => {
  const telas = telasComFiltro(RAIZ);

  it("a régua está medindo alguma coisa", () => {
    // Zero telas = a busca não achou o que medir, não "está tudo certo".
    expect(telas.length).toBeGreaterThan(20);
    const comCampo = telas.filter((t) => readFileSync(t, "utf8").includes("<CampoDeBusca"));
    expect(comCampo.length).toBeGreaterThanOrEqual(13);
  });

  it("nenhuma tela com FilterForm tem <Input defaultValue=…>", () => {
    const ruins = telas
      .map((t) => ({ t, n: achados(readFileSync(t, "utf8")) }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.t.slice(process.cwd().length + 1)} (${x.n})`);
    expect(
      ruins,
      "Use <CampoDeBusca valorDoEndereco={…} /> (src/components/campo-de-busca.tsx):\n" + ruins.join("\n")
    ).toEqual([]);
  });

  it("a régua pega as formas reais e deixa passar as legítimas", () => {
    expect(achados('<Input name="busca" defaultValue={busca} placeholder="x" />')).toBe(1);
    expect(achados('<Input\n  name="busca"\n  defaultValue={busca}\n/>')).toBe(1);
    expect(achados('<Input type="date" name="de" defaultValue={de ?? ""} />')).toBe(1);
    expect(achados('<CampoDeBusca name="busca" valorDoEndereco={busca} />')).toBe(0);
    expect(achados('<input name="q" defaultValue={busca} />')).toBe(0);
    expect(achados('<Input name="nome" />\n<select defaultValue={x}>')).toBe(0);
  });

  it("o CampoDeBusca é controlado e segue o endereço só quando ele muda", () => {
    const c = readFileSync(join(process.cwd(), "src/components/campo-de-busca.tsx"), "utf8");
    expect(c).toContain("value={valor}");
    expect(c).toContain("if (valorDoEndereco !== doEndereco) {");
    expect(c).toContain("onChange={(e) => setValor(e.target.value)}");
  });
});
