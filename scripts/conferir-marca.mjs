// CONFERE OS SVGs CONVERTIDOS CONTRA OS PNGs OFICIAIS — e só então dá nome a eles.
//
// ⚠️ POR QUE ESTA CONFERÊNCIA EXISTE. `ai-para-svg.mjs` reescreve, na mão,
// operadores de PDF em caminhos de SVG. Um sinal trocado numa curva de Bézier,
// um eixo Y não invertido, uma regra de preenchimento errada — nada disso
// levanta erro. O script terminaria dizendo "19 SVGs gerados" e entregaria uma
// arte **plausível e errada**, que é o pior tipo de defeito: ninguém desconfia,
// e a logomarca deformada só é notada por um cliente, meses depois.
//
// ⚠️ E ELA JÁ PEGOU UM ERRO REAL (09/09/2026): na primeira execução eu havia
// pareado horizontal com vertical. Os 87% de divergência não eram do conversor,
// eram do meu mapeamento — e sem esta régua o sistema teria nascido com a
// logomarca vertical no lugar da horizontal.
//
// COMO ELA MEDE. Compara o CANAL ALFA, não a cor: é a SILHUETA que denuncia
// curva torta, caminho invertido ou eixo espelhado.
//
// ⚠️ E O QUE ELA NÃO CONSEGUE MEDIR, declarado: a versão "para fundo escuro"
// tem EXATAMENTE a mesma silhueta da normal — só as cores mudam. Silhueta não
// separa as duas. Quem separa é a paleta que o conversor extraiu, e é por isso
// que a tabela abaixo traz a cor esperada de cada arquivo e ela é conferida.
//
// ⚠️ A RÉGUA CRUA NÃO SERVE, E ISSO FOI MEDIDO, NÃO SUPOSTO. Comparar pixel a
// pixel dá 2% a 6% de divergência mesmo numa conversão perfeita, e o número
// OSCILA com a resolução em vez de cair (1,86% a 256 px, 5,75% a 1200 px). A
// causa é desencontro de sub-pixel entre os dois recortes: o `trim` do SVG
// desenhado e o do PNG não param exatamente no mesmo lugar.
//
// Por isso a régua é "divergência ALÉM DE UM PIXEL": um pixel só conta como
// erro se não houver nenhum pixel correspondente na vizinhança imediata do
// outro lado. **Diferença mais fina que um pixel não é deformação.** Com essa
// régua a mesma arte dá 0,000% em 256, 600 e 1200 px — e um erro estrutural
// (horizontal trocada por vertical) dá mais de 80%. Entre um e outro não há
// zona cinzenta, e é isso que faz o limite de 0,05% ser honesto em vez de
// frouxo.
//
// Uso: node scripts/conferir-marca.mjs

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SVG = "docs/marca/extraido/svg";
const PNG = "docs/marca/extraido";
const DESTINO = "public/marca";
const LADO = 600;
const LIMITE = 0.05; // % da silhueta divergente ALÉM de um pixel de tolerância

/**
 * página → [nome final, PNG de referência, cores esperadas]
 *
 * As cores vêm do brandbook: turquesa #01a7b5, marinho #003257, bordô #711e38,
 * off-white #efeee9. A versão "clara" é a que troca a cor do símbolo por
 * off-white para viver sobre fundo escuro — o PNG oficial dela tem fundo
 * transparente, então a silhueta é idêntica à da normal.
 */
const ARTES = [
  ["pagina-09.svg", "odontologia-vertical",         "risarte odontologia vertical.png",              ["#003257", "#01a7b5"]],
  ["pagina-10.svg", "odontologia-horizontal",       "risarte odontologia horizontal.png",            ["#003257", "#01a7b5"]],
  ["pagina-11.svg", "odontologia-horizontal-claro", "risarte odontologia horizontal.png",            ["#efeee9", "#01a7b5"]],
  ["pagina-12.svg", "odontologia-vertical-claro",   "risarte odontologia vertical.png",              ["#efeee9", "#01a7b5"]],
  ["pagina-13.svg", "franchising-vertical",         "Risarte franchising vertical.png",              ["#01a7b5", "#003257"]],
  ["pagina-14.svg", "franchising-horizontal",       "Risarte franchising horizontal.png",            ["#01a7b5", "#003257"]],
  ["pagina-15.svg", "franchising-vertical-claro",   "Risarte franchising vertical.png",              ["#efeee9", "#003257"]],
  ["pagina-16.svg", "franchising-horizontal-claro", "Risarte franchising horizontal.png",            ["#efeee9", "#003257"]],
  ["pagina-17.svg", "empresarial-vertical",         "risarte empresarial vertical.png",              ["#003257", "#711e38"]],
  ["pagina-18.svg", "empresarial-horizontal",       "risarte empresarial horizontal.png",            ["#003257", "#711e38"]],
  ["pagina-19.svg", "empresarial-horizontal-claro", "risarte empresarial horizontal.png",            ["#efeee9", "#711e38"]],
  ["pagina-20.svg", "empresarial-vertical-claro",   "risarte empresarial vertical.png",              ["#efeee9", "#711e38"]],
];

async function silhueta(entrada) {
  return sharp(entrada, { density: 500 })
    .ensureAlpha()
    .trim({ threshold: 10 })
    .resize(LADO, LADO, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extractChannel(3)
    .raw()
    .toBuffer();
}

let falhas = 0;
const aprovados = [];

console.log("Conferindo os SVGs contra os PNGs da agência...\n");

for (const [arquivo, nome, png, cores] of ARTES) {
  const a = join(SVG, arquivo);
  const b = join(PNG, png);
  if (!existsSync(a) || !existsSync(b)) {
    console.log(`  FALTA  ${nome}`);
    falhas++;
    continue;
  }

  const texto = readFileSync(a, "utf8");
  const usadas = [...new Set([...texto.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]))];
  const corOk =
    cores.every((c) => usadas.includes(c)) && usadas.length === cores.length;

  const [x, y] = await Promise.all([silhueta(a), silhueta(b)]);

  const aceso = (m, i) => m[i] > 127;
  /** Há pixel aceso encostando nesta posição, do outro lado? */
  const vizinho = (m, i) => {
    const py = Math.floor(i / LADO), px = i % LADO;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = py + dy, xx = px + dx;
        if (yy < 0 || xx < 0 || yy >= LADO || xx >= LADO) continue;
        if (aceso(m, yy * LADO + xx)) return true;
      }
    }
    return false;
  };

  let dif = 0, marc = 0;
  for (let i = 0; i < x.length; i++) {
    const px = aceso(x, i), py = aceso(y, i);
    if (px || py) marc++;
    if (px !== py && (px ? !vizinho(y, i) : !vizinho(x, i))) dif++;
  }
  const pct = marc ? (dif / marc) * 100 : 100;

  const ok = pct <= LIMITE && corOk;
  if (ok) aprovados.push([nome, texto]);
  else falhas++;

  console.log(
    `  ${ok ? "OK   " : "FALHA"} ${nome.padEnd(30)} ${pct.toFixed(2).padStart(5)}% forma · ` +
      `cores ${corOk ? "conferem" : `DIVERGEM (achei ${usadas.join(" ")})`}`
  );
}

console.log(`\n${ARTES.length} conferida(s), ${falhas} falha(s).`);

if (falhas) {
  console.log(
    "\n⚠️  NADA foi copiado para public/marca. Silhueta ou cor divergente\n" +
      "   significa arte deformada, e marca deformada é problema de marca."
  );
  process.exit(1);
}

mkdirSync(DESTINO, { recursive: true });
for (const [nome, texto] of aprovados) {
  writeFileSync(join(DESTINO, `${nome}.svg`), texto);
}
console.log(`${aprovados.length} arte(s) aprovada(s) copiada(s) para ${DESTINO}/`);

// --------------------------------------------------------------- o símbolo
// O losango sozinho NÃO veio em arquivo próprio, e ele é o que cabe num ícone
// de 24 px, na aba do navegador e na barra lateral encolhida. Ele é o caminho
// MAIS À ESQUERDA da assinatura horizontal — e é um caminho só, com o sorriso
// vazado (por isso o sorriso assume a cor do fundo, exatamente como a arte
// original faz).
const SIMBOLOS = [
  ["odontologia-horizontal", "simbolo-marinho"],
  ["franchising-horizontal", "simbolo-turquesa"],
  ["odontologia-horizontal-claro", "simbolo-claro"],
];

for (const [origem, nome] of SIMBOLOS) {
  const texto = aprovados.find(([n]) => n === origem)?.[1];
  if (!texto) continue;

  const caminhos = [...texto.matchAll(/<path d="([^"]+)" fill="([^"]+)"([^>]*)\/>/g)];
  let melhor = null;
  for (const c of caminhos) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of c[1].matchAll(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g)) {
      const x = Number(p[1]), y = Number(p[2]);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!melhor || x0 < melhor.x0) melhor = { c, x0, x1, y0, y1 };
  }
  if (!melhor) continue;

  const l = melhor.x1 - melhor.x0, a = melhor.y1 - melhor.y0;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.toFixed(3)} ${a.toFixed(3)}" ` +
    `width="${l.toFixed(3)}" height="${a.toFixed(3)}" role="img">` +
    `<g transform="translate(${(-melhor.x0).toFixed(3)} ${melhor.y1.toFixed(3)}) scale(1 -1)">` +
    `<path d="${melhor.c[1]}" fill="${melhor.c[2]}"${melhor.c[3]}/></g></svg>`;
  writeFileSync(join(DESTINO, `${nome}.svg`), svg);
  console.log(`  símbolo ${nome.padEnd(18)} ${melhor.c[2]}  ${l.toFixed(0)}×${a.toFixed(0)}`);
}

// ------------------------------------------------- versão TODA BRANCA (escuro)
// Pedido do dono (09/09/2026): "a logo no modo escuro deve ser toda branca".
// A variante da agência para fundo escuro mantém o complemento colorido
// (turquesa/marinho/bordô); sobre o marinho profundo do modo escuro isso fica
// apagado. A versão monocromática negativa resolve — e é operação de marca
// prevista, não invenção: é a mesma arte, numa cor só.
for (const [nome, texto] of aprovados) {
  if (!nome.endsWith("-claro")) continue;
  const branco = texto.replace(/fill="#[0-9a-f]{6}"/g, `fill="${"#efeee9"}"`);
  writeFileSync(join(DESTINO, `${nome.replace("-claro", "-branco")}.svg`), branco);
}
console.log("  versões monocromáticas (toda branca) geradas");

// ------------------------------------------------------------- o PATTERN
// ⚠️ O PATTERN É RECONSTRUÍDO EM VETOR, não copiado do PNG. O PNG da agência
// tem cor fixa: serviria para UM ambiente numa luz só, e o sistema precisa de
// seis combinações. Reconstruído a partir do símbolo, ele é recolorível, pesa
// menos de 2 KB e não serrilha.
//
// A regra de cor vem do próprio pattern oficial, conferida nas três artes:
// **o losango COM sorriso leva a cor CENTRAL; o losango liso leva o DETALHE.**
const simbolo = readFileSync(join(DESTINO, "simbolo-marinho.svg"), "utf8");
const dCheio = simbolo.match(/ d="([^"]+)"/)[1];
const gTransf = simbolo.match(/<g transform="([^"]+)"/)[1];
// O losango liso é o sub-caminho de maior ÁREA — não o de texto mais longo.
// ⚠️ A primeira versão escolhia pelo comprimento da string e pegava o SORRISO:
// ele é uma curva, tem 478 caracteres, enquanto o losango tem 261. O pattern
// saiu com meia-luas soltas no lugar dos losangos, e só a conferência visual
// pegou. Medida errada escolhe com confiança a coisa errada.
const subs = dCheio.split(/(?=M)/).filter(Boolean);
const area = (d) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of d.matchAll(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g)) {
    const x = Number(m[1]), y = Number(m[2]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return (x1 - x0) * (y1 - y0);
};
const dLiso = subs.reduce((a, b) => (area(a) >= area(b) ? a : b));
const vb = simbolo.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const [lw, lh] = [Number(vb[1]), Number(vb[2])];

// ⚠️ A PROPORÇÃO FOI MEDIDA, NÃO ESTIMADA A OLHO. Eu havia lido "42% da
// largura do ladrilho" olhando a arte oficial, e o pattern saiu ralo demais.
// A régua que resolveu foi a FRAÇÃO DE ÁREA COBERTA: o oficial cobre 61,8% e a
// primeira tentativa cobria 26,0% — daí o fator. Densidade é o que o olho
// percebe num padrão; distância entre centros, não.
const T = 100;                       // largura do ladrilho
const esc = (T * 0.648) / lw;        // losango ≈ 65% da largura do ladrilho
const TH = T * (297 / 365);          // altura do ladrilho, na razão do original
const dx = (lw * esc) / 2, dy = (lh * esc) / 2;

const PATTERNS = {
  "unidades":    ["#003257", "#01a7b5"],
  "franchising": ["#01a7b5", "#003257"],
  "empresarial": ["#003257", "#711e38"],
  // No escuro o marinho some contra o fundo: quem vai ao pattern é a versão
  // clara de cada cor. Sem isso, metade do desenho desapareceria.
  "unidades-escuro":    ["#3fc9d6", "#01a7b5"],
  "franchising-escuro": ["#3fc9d6", "#01a7b5"],
  "empresarial-escuro": ["#3fc9d6", "#c05a76"],
  // ⚠️ MONOCROMÁTICO, para o pattern aplicado SOBRE a barra lateral. Ali o
  // fundo é a própria cor do ambiente, e o pattern colorido desapareceria
  // justamente na cor que identifica aquele ambiente. Em off-white e baixa
  // opacidade ele funciona sobre marinho, turquesa ou bordô, sem exceção.
  "branco": ["#efeee9", "#efeee9"],
};

for (const [nome, [central, detalhe]] of Object.entries(PATTERNS)) {
  const peca = (d, cor, cx, cy) =>
    `<g transform="translate(${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)}) scale(${esc.toFixed(5)})">` +
    `<g transform="${gTransf}"><path d="${d}" fill="${cor}"/></g></g>`;

  const pecas = [
    // Os quatro cantos fazem o ladrilho fechar sem emenda.
    peca(dCheio, central, 0, 0),
    peca(dCheio, central, T, 0),
    peca(dCheio, central, 0, TH),
    peca(dCheio, central, T, TH),
    peca(dLiso, detalhe, T / 2, TH / 2),
  ].join("");

  writeFileSync(
    join(DESTINO, `pattern-${nome}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${T} ${TH.toFixed(2)}" width="${T}" height="${TH.toFixed(2)}">${pecas}</svg>`
  );
}
console.log(`  ${Object.keys(PATTERNS).length} pattern(s) reconstruído(s) em vetor`);
