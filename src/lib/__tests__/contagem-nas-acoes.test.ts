import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("⚠️ nenhuma AÇÃO transforma 'não consegui contar' em zero (AP11)", () => {
  // Arquivos de ação (`*actions.ts`) são onde moram as TRAVAS: o que decide
  // se cobra, se apaga, se deixa passar do limite. Ali, `count ?? 0` é sempre
  // uma escolha perigosa escondida — e ela já tinha escondido a trava contra a
  // mensalidade em dobro do Empresarial.
  //
  // Onde zero FOR a resposta aceitável (ordem na lista, um contador), a regra
  // pede `contagemConfirmada(r) ?? 0`: a escolha fica visível, com um
  // comentário ao lado, em vez de parecer inofensiva.
  //
  // FORA do alcance, de propósito: telas e componentes (o pior caso é um
  // número errado na tela, não uma ação liberada) e o outro jeito de escrever
  // o mesmo defeito — ler só o `data` de uma função do banco e ignorar o
  // erro. Esse segundo jeito tem usos legítimos demais (buscas para
  // autopreencher, o chat) para uma régua de texto separar; ele foi varrido à
  // mão em 26/09/2026 e está registrado no BACKLOG (AP11).
  const RAIZ = join(process.cwd(), "src", "app");
  const PROIBIDO = /(^|[^\w)])(\w+\.)?count \?\? 0/;

  function acoes(dir: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) saida.push(...acoes(p));
      else if (/actions\.ts$/.test(nome)) saida.push(p);
    }
    return saida;
  }

  it("a régua está medindo alguma coisa", () => {
    // Régua vazia grita: se ela não acha nenhum arquivo de ação, a varredura
    // quebrou — e um verde aqui seria mentira.
    expect(acoes(RAIZ).length).toBeGreaterThan(20);
  });

  it("nenhum arquivo de ação usa `count ?? 0`", () => {
    const achados: string[] = [];
    for (const arq of acoes(RAIZ)) {
      readFileSync(arq, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          if (linha.trimStart().startsWith("//")) return;
          if (PROIBIDO.test(linha)) {
            achados.push(`${arq.replace(process.cwd(), "")}:${i + 1}  ${linha.trim()}`);
          }
        });
    }
    expect(
      achados,
      "Contagem que falhou vira ZERO e a trava deixa passar. Use contagemConfirmada() " +
        "e recuse quando vier null (ver src/lib/contagem.ts):\n" +
        achados.join("\n")
    ).toEqual([]);
  });

  it("a régua separa o jeito perigoso do jeito explícito", () => {
    expect(PROIBIDO.test("  const atuais = count ?? 0;")).toBe(true);
    expect(PROIBIDO.test("    numero: esperando.count ?? 0,")).toBe(true);
    expect(PROIBIDO.test("  if ((count ?? 0) > 0) {")).toBe(true);
    // O explícito, com a escolha à vista, passa:
    expect(
      PROIBIDO.test("    sort_order: contagemConfirmada({ count, error: e }) ?? 0,")
    ).toBe(false);
    // E coluna de dado que por acaso termina em "count" não é contagem:
    expect(PROIBIDO.test("    kitCount: Number(c.kit_count ?? 0),")).toBe(false);
  });
});
