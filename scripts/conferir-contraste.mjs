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
    if (seletor) camadas.push(bloco((luz === "escuro" ? ".dark " : "") + seletor));

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
