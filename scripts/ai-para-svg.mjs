// CONVERTE O `LOGOS.ai` DA MARCA EM SVG — um por página.
//
// ⚠️ POR QUE ESTE SCRIPT EXISTE. As 20 logomarcas chegaram só em PNG
// 1080×1080. PNG serve para o tamanho em que foi exportado e mais nada: amplia
// serrilhado, e num sistema que roda de celular a monitor 4K isso aparece. O
// `LOGOS.ai`, porém, é um PDF de 20 páginas com **zero imagens embutidas** —
// vetor puro, com o texto já convertido em contorno. A arte certa estava lá o
// tempo todo; faltava a chave.
//
// ⚠️ E POR QUE NÃO USAR UMA FERRAMENTA PRONTA. Não há Inkscape nem pdf2svg
// nesta máquina, e `convert` aqui é o `convert.exe` do Windows (o de sistema de
// arquivos), não o do ImageMagick — confiar nele apagaria dados em vez de
// converter imagem. Node com `zlib` já basta: o conteúdo de página do PDF é uma
// lista de operadores de caminho, e SVG é outra.
//
// **A CONVERSÃO É CONFERIDA, NÃO SUPOSTA** (`npm run marca:conferir`): cada SVG
// é desenhado e comparado, pixel a pixel, com o PNG oficial da mesma arte.
// Conversor de vetor que erra um sinal produz uma imagem plausível e errada —
// e "plausível e errada" é o defeito que ninguém vê a tempo.
//
// Uso: node scripts/ai-para-svg.mjs [entrada.ai] [pasta-de-saida]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

const ENTRADA = process.argv[2] ?? "docs/marca/LOGOS.ai";
const SAIDA = process.argv[3] ?? "docs/marca/extraido/svg";

// --------------------------------------------------------------- ler o PDF
/**
 * Objetos do PDF, por número. Aceita tanto o objeto solto quanto o que mora
 * dentro de um "object stream" comprimido (`/Type /ObjStm`) — o Illustrator usa
 * os dois, e ignorar o segundo faria metade das páginas sumir sem erro nenhum.
 */
function lerObjetos(buf) {
  const s = buf.toString("latin1");
  const objetos = new Map();

  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const inicio = m.index + m[0].length;
    const fimObj = s.indexOf("endobj", inicio);
    const corpo = s.slice(inicio, fimObj);
    const posStream = corpo.indexOf("stream");
    let dic = corpo;
    let dados = null;
    if (posStream !== -1) {
      dic = corpo.slice(0, posStream);
      // `stream` é seguido de CRLF ou LF, nunca de CR sozinho.
      let p = inicio + posStream + "stream".length;
      if (s[p] === "\r") p++;
      if (s[p] === "\n") p++;
      const fim = s.indexOf("endstream", p);
      dados = buf.subarray(p, fim);
      if (/FlateDecode/.test(dic)) {
        try {
          dados = inflateSync(dados);
        } catch {
          dados = null; // fluxo que não infla não é conteúdo de página
        }
      }
    }
    objetos.set(num, { dic, dados });
  }
  return objetos;
}

/** As páginas, na ordem em que aparecem na árvore /Pages. */
function paginas(objetos) {
  const ordem = [];
  const visto = new Set();

  const raiz = [...objetos.entries()].find(([, o]) =>
    /\/Type\s*\/Pages/.test(o.dic)
  );
  if (!raiz) throw new Error("não achei a árvore de páginas");

  const desce = (num) => {
    if (visto.has(num)) return;
    visto.add(num);
    const o = objetos.get(num);
    if (!o) return;
    if (/\/Type\s*\/Page\b/.test(o.dic)) {
      ordem.push(num);
      return;
    }
    const kids = o.dic.match(/\/Kids\s*\[([^\]]*)\]/);
    if (!kids) return;
    for (const k of kids[1].matchAll(/(\d+)\s+0\s+R/g)) desce(Number(k[1]));
  };

  desce(raiz[0]);
  return ordem;
}

// ------------------------------------------------- interpretar os operadores
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const aplica = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const n = (v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(3)));

function hex(r, g, b) {
  const c = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Percorre o conteúdo da página e devolve os caminhos já em coordenadas de
 * página (a matriz de transformação é embutida em cada ponto).
 *
 * **O eixo Y do PDF cresce para CIMA e o do SVG para BAIXO.** A inversão é
 * feita UMA vez, no `<g>` que envolve tudo — inverter ponto a ponto pareceria
 * mais direto e quebraria as curvas de Bézier, porque os pontos de controle
 * teriam de ser espelhados junto.
 */
function interpretar(texto) {
  const caminhos = [];
  const pilha = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let cor = "#000000";
  let d = "";
  let atual = [0, 0];
  let inicioSub = [0, 0];
  let pulando = 0; // profundidade de `q` dentro de um bloco recortado

  const numeros = [];
  const P = (x, y) => aplica(ctm, x, y).map(n);

  // Tokeniza: número, nome (/Algo), operador.
  const tokens = texto.match(/\/[^\s/\[\]<>()]+|-?\d*\.?\d+|[A-Za-z'"*]+|\[|\]/g) ?? [];

  for (const t of tokens) {
    if (/^-?\d*\.?\d+$/.test(t)) {
      numeros.push(Number(t));
      continue;
    }
    if (t.startsWith("/") || t === "[" || t === "]") continue;

    switch (t) {
      case "q":
        pilha.push({ ctm, cor });
        break;
      case "Q": {
        const p = pilha.pop();
        if (p) ({ ctm, cor } = p);
        break;
      }
      case "cm":
        if (numeros.length >= 6) ctm = mul(numeros.slice(-6), ctm);
        break;

      case "m": {
        const [x, y] = numeros.slice(-2);
        const p = P(x, y);
        d += `M${p[0]} ${p[1]}`;
        atual = [x, y];
        inicioSub = [x, y];
        break;
      }
      case "l": {
        const [x, y] = numeros.slice(-2);
        const p = P(x, y);
        d += `L${p[0]} ${p[1]}`;
        atual = [x, y];
        break;
      }
      case "c": {
        const [x1, y1, x2, y2, x3, y3] = numeros.slice(-6);
        const a = P(x1, y1), b = P(x2, y2), c = P(x3, y3);
        d += `C${a[0]} ${a[1]} ${b[0]} ${b[1]} ${c[0]} ${c[1]}`;
        atual = [x3, y3];
        break;
      }
      // `v` usa o ponto atual como primeiro controle; `y`, o final como segundo.
      case "v": {
        const [x2, y2, x3, y3] = numeros.slice(-4);
        const a = P(atual[0], atual[1]), b = P(x2, y2), c = P(x3, y3);
        d += `C${a[0]} ${a[1]} ${b[0]} ${b[1]} ${c[0]} ${c[1]}`;
        atual = [x3, y3];
        break;
      }
      case "y": {
        const [x1, y1, x3, y3] = numeros.slice(-4);
        const a = P(x1, y1), c = P(x3, y3);
        d += `C${a[0]} ${a[1]} ${c[0]} ${c[1]} ${c[0]} ${c[1]}`;
        atual = [x3, y3];
        break;
      }
      case "h":
        d += "Z";
        atual = inicioSub;
        break;
      case "re": {
        const [x, y, w, hh] = numeros.slice(-4);
        const p1 = P(x, y), p2 = P(x + w, y), p3 = P(x + w, y + hh), p4 = P(x, y + hh);
        d += `M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}L${p3[0]} ${p3[1]}L${p4[0]} ${p4[1]}Z`;
        break;
      }

      case "sc":
      case "scn":
      case "rg":
      case "g":
      case "k": {
        // Só cor sem padrão: 1 número = cinza, 3 = RGB, 4 = CMYK.
        const nums = numeros.filter((v) => Number.isFinite(v));
        if (t === "g" || nums.length === 1) {
          const v = nums.at(-1) ?? 0;
          cor = hex(v, v, v);
        } else if (t === "k" || nums.length === 4) {
          const [c, m2, y2, k] = nums.slice(-4);
          cor = hex((1 - c) * (1 - k), (1 - m2) * (1 - k), (1 - y2) * (1 - k));
        } else if (nums.length >= 3) {
          const [r, g2, b2] = nums.slice(-3);
          cor = hex(r, g2, b2);
        }
        break;
      }

      // ⚠️ `W n` define RECORTE, não desenho. O Illustrator abre toda página
      // com um retângulo de recorte do tamanho da prancheta; tratá-lo como
      // preenchimento pintaria um quadrado sólido por cima de tudo — a arte
      // sumiria e o SVG pareceria "só um fundo".
      case "W":
      case "W*":
        pulando = 1;
        break;

      case "n":
        d = "";
        pulando = 0;
        break;

      case "f":
      case "f*":
      case "F":
      case "b":
      case "b*":
      case "B":
      case "B*":
        if (d && !pulando) {
          caminhos.push({ d, cor, par: t === "f*" || t === "B*" || t === "b*" });
        }
        d = "";
        break;

      case "S":
      case "s":
        d = ""; // contorno: a marca é toda preenchida; traço aqui seria ruído
        break;

      default:
        break;
    }
    if (!/^[a-zA-Z]/.test(t)) continue;
    numeros.length = 0;
  }

  return caminhos;
}

// ------------------------------------------------------------------ recorte
/** Caixa que envolve os caminhos, para o SVG nascer sem margem sobrando. */
function caixa(caminhos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of caminhos) {
    for (const p of c.d.matchAll(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g)) {
      const x = Number(p[1]), y = Number(p[2]);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

// -------------------------------------------------------------------- saída
function svgDe(caminhos, altura) {
  const b = caixa(caminhos);
  // O eixo Y é invertido AQUI, uma vez só (ver o comentário em `interpretar`).
  const largura = b.x1 - b.x0;
  const alt = b.y1 - b.y0;
  const corpo = caminhos
    .map(
      (c) =>
        `<path d="${c.d}" fill="${c.cor}"${c.par ? ' fill-rule="evenodd"' : ""}/>`
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(largura)} ${n(alt)}" ` +
    `width="${n(largura)}" height="${n(alt)}" role="img">` +
    `<g transform="translate(${n(-b.x0)} ${n(b.y1)}) scale(1 -1)">${corpo}</g></svg>`
  ).replace(/scale\(1 -1\)/, `scale(1 -1)`) + (altura ? "" : "");
}

// --------------------------------------------------------------------- main
const buf = readFileSync(ENTRADA);
const objetos = lerObjetos(buf);
const págs = paginas(objetos);
mkdirSync(SAIDA, { recursive: true });

console.log(`${págs.length} páginas em ${ENTRADA}\n`);

let feitos = 0;
for (const [i, num] of págs.entries()) {
  const pág = objetos.get(num);
  const ref = pág.dic.match(/\/Contents\s+(\d+)\s+0\s+R/);
  if (!ref) {
    console.log(`  página ${i + 1}: sem conteúdo`);
    continue;
  }
  const conteudo = objetos.get(Number(ref[1]))?.dados;
  if (!conteudo) {
    console.log(`  página ${i + 1}: conteúdo ilegível`);
    continue;
  }
  const caminhos = interpretar(conteudo.toString("latin1"));
  if (!caminhos.length) {
    console.log(`  página ${i + 1}: nenhum caminho`);
    continue;
  }
  const arquivo = join(SAIDA, `pagina-${String(i + 1).padStart(2, "0")}.svg`);
  writeFileSync(arquivo, svgDe(caminhos));
  const cores = [...new Set(caminhos.map((c) => c.cor))];
  console.log(
    `  página ${String(i + 1).padStart(2)}: ${String(caminhos.length).padStart(3)} caminhos · ${cores.join(" ")}`
  );
  feitos++;
}

console.log(`\n${feitos} SVG(s) em ${SAIDA}`);
console.log("⚠️  Conferir com `npm run marca:conferir` antes de usar qualquer um.");
