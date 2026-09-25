// E2E — A LISTA DA CAIXA DE SELEÇÃO NO TEMA ESCURO (relatos OC-00053,
// OC-00064 e OC-00084).
//
// ⚠️ ESTE TESTE EXISTE PORQUE O DEFEITO VOLTOU DEPOIS DE "CORRIGIDO", e a
// régua que existia não podia tê-lo pego.
//
// Em 21/09/2026 a causa apontada foi a falta de `color-scheme: dark` — e era
// verdade, mas era só metade. A mesma pessoa reabriu o relato, e o dono
// relatou de novo na 0.274.0. A causa que faltava, medida no navegador em
// 25/09/2026: os `<select>` do sistema usam `bg-transparent`, então as
// `<option>` ficavam com `background-color: rgba(0,0,0,0)`. `color-scheme` só
// muda o PADRÃO do navegador; ele não vence um fundo transparente. Sem fundo
// próprio, o navegador pinta a listinha de branco, e a letra — que herda o
// quase-branco do tema escuro — some.
//
// ⚠️ POR QUE AQUI, E NÃO NUM TESTE DE ARQUIVO. `tema-escuro.test.ts` lê o
// código e procura "mancha clara + letra herdada". Ele passou o tempo todo, e
// estava certo: não havia mancha clara nenhuma no nosso CSS — quem pintava de
// branco era o NAVEGADOR. Defeito que só existe depois que o navegador
// desenha só pode ser medido com um navegador desenhando.
//
// O que fica preso: no escuro E no claro, a opção tem fundo PRÓPRIO (nunca
// transparente) e letra que contrasta com ele.

import { expect, test } from "@playwright/test";
import { PESSOAS, entrarComo, esperarEFecharAvisos } from "./apoio";

test.setTimeout(300_000);

/** "rgb(6, 27, 44)" -> [6,27,44]. Devolve null no transparente. */
function canal(cor: string): [number, number, number] | null {
  if (cor.includes("rgba(0, 0, 0, 0)") || cor === "transparent") return null;
  const m = cor.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) return null;
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** Contraste WCAG entre duas cores sólidas. */
function contraste(a: [number, number, number], b: [number, number, number]) {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("a opção da caixa de seleção tem fundo próprio nos dois temas", async ({
  page,
  context,
}) => {
  await entrarComo(context, PESSOAS.admin);
  // Uma tela real com caixa de seleção: o cadastro de paciente tem a de Gênero,
  // que é justamente a das fotos dos relatos.
  await page.goto("/prontuarios/novo");
  await esperarEFecharAvisos(page);

  const genero = page.locator("select").first();
  await expect(genero).toBeVisible();

  async function medir() {
    return await genero.evaluate((s) => {
      const opcao = (s as HTMLSelectElement).options[1];
      const co = getComputedStyle(opcao);
      return {
        fundo: co.backgroundColor,
        letra: co.color,
        esquema: getComputedStyle(document.documentElement).colorScheme,
      };
    });
  }

  // O sistema abre no tema da pessoa; o botão de lua/sol é quem troca. Clicar
  // nele é o que a pessoa faz — ler a marca direto do documento testaria o
  // nosso atalho, não a tela.
  async function garantirTema(escuro: boolean) {
    const estaEscuro = await page.evaluate(() =>
      document.documentElement.classList.contains("dark")
    );
    if (estaEscuro !== escuro) {
      await page
        .getByRole("button", { name: /Usar tema (escuro|claro)/i })
        .click();
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.classList.contains("dark"))
        )
        .toBe(escuro);
    }
  }

  for (const escuro of [true, false]) {
    await garantirTema(escuro);
    const { fundo, letra, esquema } = await medir();
    const nome = escuro ? "escuro" : "claro";

    // ⚠️ O CORAÇÃO DO TESTE. Transparente é exatamente o estado em que o
    // navegador decide sozinho — e foi o que deixou a lista branca.
    const f = canal(fundo);
    expect(f, `no tema ${nome} a opção ficou SEM fundo próprio (${fundo})`).not.toBeNull();

    const l = canal(letra);
    expect(l, `no tema ${nome} a opção ficou sem cor de letra (${letra})`).not.toBeNull();

    // Fundo e letra têm de dar para ler um sobre o outro.
    const razao = contraste(f!, l!);
    expect(
      razao,
      `no tema ${nome} o contraste da opção ficou em ${razao.toFixed(2)}:1`
    ).toBeGreaterThan(4.5);

    // E o navegador continua sabendo em que tema está (a correção de 21/09).
    expect(esquema).toBe(escuro ? "dark" : "light");
  }
});
