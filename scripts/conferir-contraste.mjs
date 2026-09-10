// CONFERE O CONTRASTE DA PALETA — lendo o `globals.css` de verdade.
//
// ⚠️ POR QUE ESTE SCRIPT EXISTE. Em 09/09/2026 a mudança de identidade visual
// deixou textos ilegíveis em 5 das 6 combinações de ambiente × luz, e o dono
// achou olhando a tela. Cor errada não quebra build, não quebra teste e não
// aparece na varredura de telas — que abre as páginas mas não enxerga cor.
// Esta é a régua que faltava.
//
// ⚠️ E ELA GRITA QUANDO NÃO CONSEGUE MEDIR. Uma primeira versão devolvia `NaN`
// para um token que ela não sabia resolver e imprimia "as 12 passam" logo abaixo
// de uma linha "FALHA" — porque `NaN < 4.5` é falso. Zero é ausência de medição,
// não medição de ausência (seção 0d do CLAUDE.md). Aqui, token não resolvido
// derruba o script.
//
// Uso: node scripts/conferir-contraste.mjs

import { readFileSync } from "node:fs";

const CSS = readFileSync("src/app/globals.css", "utf8");
const MINIMO = 4.5; // WCAG AA para texto normal

/** Todas as declarações de um bloco, na ordem em que aparecem. */
function bloco(seletor) {
  const i = CSS.indexOf("\n" + seletor);
  if (i < 0) throw new Error("bloco não encontrado: " + seletor);
  const fim = CSS.indexOf("\n}", i);
  const dentro = CSS.slice(i, fim);
  const mapa = new Map();
  for (const m of dentro.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    mapa.set(m[1], m[2].trim());
  }
  return mapa;
}

const RAIZ = bloco(":root {");
const ESCURO = bloco(".dark {");

/**
 * ⚠️ O BLOCO GENÉRICO `[data-ambiente]` FAZ PARTE DA CASCATA, e esquecê-lo fez
 * esta régua aprovar um defeito real (10/09/2026): o símbolo da Risarte sumia
 * na barra lateral encolhida do Empresarial.
 *
 * Ele existe porque propriedade personalizada declarada no `:root` já chega
 * SUBSTITUÍDA aos descendentes — `--sidebar: var(--marca-central)` resolve com o
 * `--marca-central` DA RAIZ, não com o do ambiente. Por isso os tokens que
 * dependem do par precisam ser reafirmados no elemento que tem o ambiente.
 *
 * O problema é que ele tem a MESMA especificidade dos blocos específicos
 * (`[data-ambiente="empresarial"]`), então quem vier depois no arquivo vence.
 * A régua tem de empilhar as camadas na mesma ordem que o navegador.
 */
const GENERICO = bloco("[data-ambiente] {");
const ordemNoArquivo = (sel) => CSS.indexOf("\n" + sel);

/** Resolve `var(--x)` em cadeia até chegar num `#rrggbb`. */
function cor(nome, ...camadas) {
  let v = null;
  for (const c of camadas) if (c.has(nome)) v = c.get(nome);
  if (v === null) throw new Error("token sem definição: " + nome);
  for (let i = 0; i < 12; i++) {
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = v.match(/^var\((--[\w-]+)\)$/);
    if (!m) throw new Error("não sei resolver: " + nome + " = " + v);
    let prox = null;
    for (const c of camadas) if (c.has(m[1])) prox = c.get(m[1]);
    if (prox === null) throw new Error("token sem definição: " + m[1] + " (via " + nome + ")");
    v = prox;
  }
  throw new Error("cadeia de var() longa demais em " + nome);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) =>
  c
    .map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    })
    .reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
function razao(a, b) {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  const r = (x + 0.05) / (y + 0.05);
  if (!Number.isFinite(r)) throw new Error("razão não numérica entre " + a + " e " + b);
  return r;
}
/** Cor esmaecida sobre um fundo — é assim que a pílula é desenhada. */
function sobre(c, alfa, fundo) {
  const a = hex(c), f = hex(fundo);
  return (
    "#" +
    a
      .map((v, i) => Math.round(v * alfa + f[i] * (1 - alfa)).toString(16).padStart(2, "0"))
      .join("")
  );
}

const AMBIENTES = [
  ["unidades", null],
  ["franchising", '[data-ambiente="franchising"] {'],
  ["empresarial", '[data-ambiente="empresarial"] {'],
];

let falhas = 0;
console.log("Conferindo o contraste da paleta, ambiente por ambiente...\n");

for (const luz of ["claro", "escuro"]) {
  for (const [nome, seletor] of AMBIENTES) {
    const camadas = [RAIZ];
    if (luz === "escuro") camadas.push(ESCURO);

    // Genérico e específico têm a mesma especificidade: vence quem vier DEPOIS
    // no arquivo. A régua empilha na mesma ordem que o navegador resolveria.
    const especifico = seletor ? (luz === "escuro" ? ".dark " : "") + seletor : null;
    const doAmbiente = [];
    if (especifico) {
      doAmbiente.push([ordemNoArquivo(especifico), bloco(especifico)]);
    }
    doAmbiente.push([ordemNoArquivo("[data-ambiente] {"), GENERICO]);
    doAmbiente.sort((a, b) => a[0] - b[0]);
    for (const [, b] of doAmbiente) camadas.push(b);

    const card = cor("--card", ...camadas);
    const fundo = cor("--background", ...camadas);
    const primaria = cor("--primary", ...camadas);
    const lateral = cor("--sidebar", ...camadas);

    const provas = [
      ["texto no card", card, cor("--foreground", ...camadas)],
      ["pílula 10%", sobre(cor("--gold", ...camadas), 0.1, card), cor("--gold-tinta", ...camadas)],
      ["ícone 15%", sobre(cor("--gold", ...camadas), 0.15, card), cor("--gold-tinta", ...camadas)],
      ["realce na página", fundo, cor("--gold-tinta", ...camadas)],
      ["realce no painel", primaria, cor("--gold-forte", ...camadas)],
      ["texto no painel", primaria, cor("--primary-foreground", ...camadas)],
      ["realce na lateral", lateral, cor("--sidebar-primary", ...camadas)],
      ["texto na lateral", lateral, cor("--sidebar-foreground", ...camadas)],
      ["texto secundário", card, cor("--muted-foreground", ...camadas)],
    ];

    const ruins = provas.filter(([, f, t]) => razao(f, t) < MINIMO);
    falhas += ruins.length;
    console.log(
      `  ${ruins.length ? "FALHA" : "OK   "} ${nome.padEnd(12)} ${luz.padEnd(7)} ` +
        (ruins.length
          ? ruins.map(([n, f, t]) => `${n} ${razao(f, t).toFixed(2)}:1`).join(", ")
          : `pior caso ${Math.min(...provas.map(([, f, t]) => razao(f, t))).toFixed(2)}:1`)
    );
  }
}

console.log(
  `\n${AMBIENTES.length * 2 * 9} combinações medidas, ${falhas} abaixo de ${MINIMO}:1.`
);
if (falhas) process.exit(1);

// =============================================================================
// SEGUNDA PARTE: O PAR FUNDO × TEXTO EM CADA ELEMENTO
//
// ⚠️ A PRIMEIRA PARTE MEDE OS TOKENS; ESTA MEDE O USO. Ter os tokens certos não
// impede alguém de pôr o token errado no elemento errado — e foi exatamente
// isso que aconteceu em 10/09/2026, no botão "Painel" do Programa de Prevenção.
//
// A varredura que trocou `text-gold-foreground` por `text-gold-tinta` procurava
// `bg-gold/` na linha e encontrou **`hover:bg-gold/90`**. Concluiu que o fundo
// era esmaecido quando ele é SÓLIDO, e o botão virou marinho sobre marinho na
// Franqueadora: 1,00:1, invisível. Variante (`hover:`, `dark:`, `sm:`) não diz
// nada sobre o fundo em repouso.
//
// A regra que esta parte cobra:
//   fundo SÓLIDO   (`bg-gold`)     → texto `text-gold-foreground`
//   fundo ESMAECIDO(`bg-gold/NN`)  → texto `text-gold-tinta`
// =============================================================================

import { readdirSync } from "node:fs";
import { join as unir } from "node:path";

function arquivos(d, a = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = unir(d, e.name);
    if (e.isDirectory()) arquivos(f, a);
    else if (/\.tsx?$/.test(e.name)) a.push(f);
  }
  return a;
}

/** Classes sem prefixo de variante — só elas valem para o estado em repouso. */
const semVariante = (linha) =>
  (linha.match(/[\w:/[\]-]+/g) ?? []).filter((c) => !c.includes(":"));

let pares = 0;
for (const f of arquivos("src")) {
  const L = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < L.length; i++) {
    const cls = semVariante(L[i]);
    const solido = cls.includes("bg-gold");
    const esmaecido = cls.some((c) => /^bg-gold\/\d+$/.test(c));
    const temTinta = L[i].includes("text-gold-tinta");
    const temSolido = L[i].includes("text-gold-foreground");

    if (solido && temTinta) {
      console.log(`  PAR ERRADO ${f}:${i + 1} — fundo SÓLIDO com texto de fundo esmaecido`);
      pares++;
    }
    if (esmaecido && temSolido) {
      console.log(`  PAR ERRADO ${f}:${i + 1} — fundo ESMAECIDO com texto de fundo sólido`);
      pares++;
    }
  }
}

console.log(pares ? `\n${pares} par(es) fundo × texto errado(s).` : "\nNenhum par fundo × texto errado.");
if (pares) process.exit(1);

// =============================================================================
// TERCEIRA PARTE: A ESCADA DE OPACIDADE DA BARRA LATERAL
//
// ⚠️ OPACIDADE SOBRE COR É O JEITO SILENCIOSO DE PERDER CONTRASTE. `text-…/80`
// não é uma cor: é uma mistura com o fundo, e o resultado muda conforme a
// lateral do ambiente. Medido em 10/09/2026: o mesmo `/80` dá 7,75:1 sobre a
// lateral marinho das unidades e **4,38:1 sobre a turquesa da Franqueadora** —
// a mesma classe, uma passa e a outra reprova. E os rótulos de seção, a `/50`,
// davam 2,44:1.
//
// Nada no código denuncia isso: a classe é a mesma nos três ambientes. Só a
// conta denuncia. Esta parte faz a conta para CADA nível de opacidade que a
// lateral usa, no ambiente de lateral mais clara — o pior caso.
// =============================================================================

const LATERAL = readFileSync("src/components/app-sidebar.tsx", "utf8");
const niveis = [
  ...new Set(
    [...LATERAL.matchAll(/text-sidebar-foreground\/(\d{1,3})/g)].map((m) => Number(m[1]))
  ),
].sort((a, b) => a - b);

if (!niveis.length) {
  throw new Error("RÉGUA VAZIA: nenhum `text-sidebar-foreground/NN` encontrado");
}

let opacidadesRuins = 0;
console.log("\nOpacidade do texto sobre a barra lateral, no pior ambiente:\n");

for (const nivel of niveis) {
  let pior = { razao: Infinity, onde: "" };
  for (const luz of ["claro", "escuro"]) {
    for (const [nome, seletor] of AMBIENTES) {
      const camadas = [RAIZ];
      if (luz === "escuro") camadas.push(ESCURO);
      const esp = seletor ? (luz === "escuro" ? ".dark " : "") + seletor : null;
      const doAmb = [];
      if (esp) doAmb.push([ordemNoArquivo(esp), bloco(esp)]);
      doAmb.push([ordemNoArquivo("[data-ambiente] {"), GENERICO]);
      doAmb.sort((a, b) => a[0] - b[0]);
      for (const [, b] of doAmb) camadas.push(b);

      const fundo = cor("--sidebar", ...camadas);
      const texto = cor("--sidebar-foreground", ...camadas);
      const r = razao(fundo, sobre(texto, nivel / 100, fundo));
      if (r < pior.razao) pior = { razao: r, onde: `${nome} ${luz}` };
    }
  }
  const ok = pior.razao >= MINIMO;
  if (!ok) opacidadesRuins++;
  console.log(
    `  ${ok ? "OK   " : "FALHA"} /${String(nivel).padEnd(3)} ${pior.razao.toFixed(2).padStart(5)}:1  (pior: ${pior.onde})`
  );
}

console.log(
  `\n${niveis.length} nível(is) de opacidade na lateral, ${opacidadesRuins} abaixo de ${MINIMO}:1.`
);
if (opacidadesRuins) process.exit(1);

// =============================================================================
// QUARTA PARTE: OPACIDADE ANINHADA — a que a terceira parte NÃO enxerga
//
// ⚠️ A conta acima mede `text-sidebar-foreground/NN`. Uma classe `opacity-NN`
// posta por FORA do texto **multiplica** aquele valor, e o resultado não
// aparece em classe nenhuma: `/85` dentro de um `opacity-80` vale 0,68, e a
// terceira parte continuaria imprimindo "OK /85 4,78:1".
//
// Achado em 10/09/2026, no rodapé da lateral — logo depois de a terceira parte
// ficar verde. É o mesmo defeito de sempre: régua que mede a coisa certa, mas
// não a coisa toda. Em vez de tentar adivinhar a árvore de ancestrais (a
// heurística que já errou quatro vezes na varredura do `text-gold`), a regra
// aqui é grosseira de propósito: **elemento de TEXTO na lateral não usa
// `opacity-NN`**. Hierarquia se faz com peso, tamanho e posição — todos
// visíveis para quem lê o código e para quem lê a tela.
//
// Ícone continua livre: ele é gráfico, mede-se por 3:1, e apagar levemente uma
// seta de menu não esconde informação nenhuma.
// =============================================================================

const TEXTO_COM_OPACIDADE = [
  ...LATERAL.matchAll(/<(span|p|div|h[1-6])\b[^>]*\bopacity-(\d{1,3})\b[^>]*>/g),
];

if (TEXTO_COM_OPACIDADE.length) {
  console.log("\nOpacidade ANINHADA em elemento de texto da lateral:\n");
  for (const m of TEXTO_COM_OPACIDADE) {
    console.log(`  FALHA <${m[1]}> com opacity-${m[2]}`);
  }
  console.log(
    `\n${TEXTO_COM_OPACIDADE.length} elemento(s) de texto com opacidade por fora.` +
      "\nUse peso, tamanho ou posição para hierarquia — opacidade multiplica em silêncio."
  );
  process.exit(1);
}

console.log("\nNenhuma opacidade aninhada em texto da lateral.");
