/**
 * O TAMANHO QUE A PALAVRA "RISARTE" REALMENTE DESENHA NA BARRA LATERAL.
 *
 * ⚠️ O DONO VIU E EU MEDI A COISA ERRADA NA PRIMEIRA TENTATIVA (10/09/2026).
 * Ele disse: *"gostei do tamanho da logo das Unidades; Franqueadora e
 * Empresarial estão menores"*. Minha primeira régua mediu a **caixa de tinta
 * inteira** contra o quadro, achou 100% nos três e concluiu "estão iguais" —
 * uma resposta correta para a pergunta errada.
 *
 * A causa está na composição de cada arquivo. Os três NÃO são o mesmo desenho
 * em escalas diferentes: na assinatura de Odontologia a palavra ocupa 57% da
 * altura do quadro; nas outras duas, 38%, porque o símbolo ali é
 * proporcionalmente maior. Com a mesma classe de altura, a palavra sai um terço
 * menor — e o símbolo sai igual, que foi o que enganou a primeira medição.
 *
 * O que esta régua mede é **a altura das letras**, que é o que o olho compara.
 *
 * ⚠️ RÉGUA VAZIA GRITA: arquivo sem viewBox, sem caminhos, ou onde não se
 * consiga separar símbolo de palavra levanta erro. "Não consegui medir" nunca
 * pode sair como "estão iguais" — foi exatamente assim que a primeira versão
 * desta régua me deu confiança numa conclusão falsa.
 */
import { readFileSync } from "node:fs";

const NO_SIDEBAR = [
  ["unidades (claro)", "public/marca/odontologia-lockup-claro.svg"],
  ["unidades (escuro)", "public/marca/odontologia-lockup-branco.svg"],
  ["franqueadora", "public/marca/franchising-lockup.svg"],
  ["empresarial", "public/marca/empresarial-lockup.svg"],
];

/**
 * Espaço que a assinatura tem na barra lateral, em pixels.
 *
 * Barra `w-64` (256) − `px-4` (32) − `gap-2.5` (10) − botão de minimizar (~28).
 * A altura vem da classe em `app-sidebar.tsx`; a LARGURA costuma ser quem
 * manda, porque `object-contain` encaixa a imagem na menor das duas.
 */
const LARGURA_DISPONIVEL = 186;

/**
 * A ALTURA VEM DO CÓDIGO, não de um número que eu escrevi aqui.
 *
 * ⚠️ Se esta régua guardasse a própria cópia da altura, ela mediria a minha
 * SUPOSIÇÃO: alguém mudaria a classe na barra lateral e ela continuaria dizendo
 * "está tudo certo" sobre um tamanho que não existe mais. É o mesmo cuidado do
 * teste que lê a migração das faixas de prazo.
 */
function alturaDaClasse() {
  const tsx = readFileSync("src/components/app-sidebar.tsx", "utf8");
  const m = /<AssinaturaDoAmbiente[^>]*className="([^"]*)"/.exec(tsx);
  if (!m) {
    throw new Error(
      "RÉGUA VAZIA: não achei <AssinaturaDoAmbiente className=…> em app-sidebar.tsx."
    );
  }
  const h = /\bh-(\d+(?:\.\d+)?)\b/.exec(m[1]);
  if (!h) {
    throw new Error(
      `RÉGUA VAZIA: a assinatura não tem classe de altura \`h-N\` (classes: "${m[1]}").`
    );
  }
  return Number(h[1]) * 4; // Tailwind: 1 unidade = 0.25rem = 4px
}

const ALTURA_DA_CLASSE = alturaDaClasse();

function viewBoxDe(svg, arquivo) {
  const m = /viewBox\s*=\s*"([^"]+)"/.exec(svg);
  if (!m) throw new Error(`RÉGUA VAZIA: ${arquivo} não tem viewBox.`);
  const [, , w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`RÉGUA VAZIA: viewBox ilegível em ${arquivo}.`);
  }
  return { w, h };
}

/**
 * A caixa de cada caminho — JÁ COM AS TRANSFORMAÇÕES APLICADAS.
 *
 * ⚠️ A PRIMEIRA VERSÃO DESTA FUNÇÃO LIA SÓ OS NÚMEROS DO `d="…"` E IGNORAVA OS
 * `<g transform>`. Para os arquivos oficiais isso não mudava nada (todos têm um
 * único grupo de espelhamento); assim que o lockup passou a escalar o texto
 * dentro de um grupo próprio, a régua continuou medindo o desenho **de antes**
 * da escala — e acusou 34% de diferença num arquivo que já estava certo.
 *
 * É a mesma família de erro do dia inteiro: a conta estava certa, a entrada é
 * que não era o que a tela desenha.
 *
 * ⚠️ E SÓ ENTENDE `translate` E `scale`. Qualquer outra transformação
 * (`rotate`, `matrix`, `skew`) levanta erro em vez de ser ignorada — ignorar
 * seria voltar exatamente ao defeito acima, medindo o desenho errado com
 * confiança.
 */
function caixas(svg, arquivo) {
  const pedacos = [...svg.matchAll(/<g\b([^>]*)>|<\/g>|<path\b[^>]*\bd="([^"]+)"/g)];
  if (pedacos.length === 0) {
    throw new Error(`RÉGUA VAZIA: ${arquivo} não tem caminhos para medir.`);
  }

  // Transformação acumulada: x' = sx·x + tx, y' = sy·y + ty.
  const pilha = [{ sx: 1, sy: 1, tx: 0, ty: 0 }];
  const atual = () => pilha[pilha.length - 1];
  const compor = (fora, dentro) => ({
    sx: fora.sx * dentro.sx,
    sy: fora.sy * dentro.sy,
    tx: fora.sx * dentro.tx + fora.tx,
    ty: fora.sy * dentro.ty + fora.ty,
  });

  function lerTransform(attrs, arquivo) {
    const m = /transform\s*=\s*"([^"]*)"/.exec(attrs);
    if (!m) return { sx: 1, sy: 1, tx: 0, ty: 0 };
    const texto = m[1];
    const desconhecida = texto.replace(/(translate|scale)\s*\([^)]*\)/g, "").trim();
    if (desconhecida) {
      throw new Error(
        `RÉGUA VAZIA: ${arquivo} tem transformação que eu não sei aplicar: "${desconhecida}".`
      );
    }
    let t = { sx: 1, sy: 1, tx: 0, ty: 0 };
    for (const parte of texto.matchAll(/(translate|scale)\s*\(([^)]*)\)/g)) {
      const n = parte[2].trim().split(/[\s,]+/).map(Number);
      const passo =
        parte[1] === "translate"
          ? { sx: 1, sy: 1, tx: n[0] ?? 0, ty: n[1] ?? 0 }
          : { sx: n[0] ?? 1, sy: n[1] ?? n[0] ?? 1, tx: 0, ty: 0 };
      t = compor(t, passo);
    }
    return t;
  }

  const out = [];
  for (const p of pedacos) {
    if (p[0].startsWith("</g")) {
      pilha.pop();
      continue;
    }
    if (p[0].startsWith("<g")) {
      pilha.push(compor(atual(), lerTransform(p[1], arquivo)));
      continue;
    }
    // ⚠️ APROXIMAÇÃO DECLARADA: os pontos de controle das curvas entram na
    // conta, então a caixa sai igual ou MAIOR que a real, nunca menor. Para
    // comparar proporções entre desenhos da mesma família, o erro é o mesmo dos
    // dois lados e não muda a conclusão.
    const n = (p[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const t = atual();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k + 1 < n.length; k += 2) {
      const x = t.sx * n[k] + t.tx;
      const y = t.sy * n[k + 1] + t.ty;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (Number.isFinite(y1 - y0)) out.push({ x0, x1, y0, y1, h: y1 - y0 });
  }

  if (out.length === 0) {
    throw new Error(`RÉGUA VAZIA: ${arquivo} não tem caminhos medíveis.`);
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

/**
 * A altura das LETRAS.
 *
 * O símbolo é o caminho mais à esquerda e ocupa a altura toda do quadro; as
 * letras vêm depois dele. A altura da palavra é a **mediana** das alturas das
 * letras — a mediana, e não o máximo, porque letras com acento ou haste alta
 * (o "t" de Risarte) esticariam a medida e fariam a palavra parecer maior do
 * que se lê.
 */
function alturaDasLetras(cs, arquivo) {
  const simbolo = cs[0];
  const letras = cs.filter((c) => c.x0 > simbolo.x1);
  if (letras.length < 3) {
    throw new Error(
      `RÉGUA VAZIA: não consegui separar as letras do símbolo em ${arquivo} ` +
        `(achei ${letras.length} caminho(s) à direita do símbolo).`
    );
  }
  const alturas = letras.map((c) => c.h).sort((a, b) => a - b);
  return { mediana: alturas[Math.floor(alturas.length / 2)], quantas: letras.length };
}

console.log("Assinatura na barra lateral — o tamanho da palavra, que é o que se lê:\n");

const medidas = [];
for (const [nome, arquivo] of NO_SIDEBAR) {
  const svg = readFileSync(arquivo, "utf8");
  const vb = viewBoxDe(svg, arquivo);
  const cs = caixas(svg, arquivo);
  const { mediana, quantas } = alturaDasLetras(cs, arquivo);

  // `object-contain`: vale a MENOR das duas restrições.
  const alturaPelaLargura = LARGURA_DISPONIVEL / (vb.w / vb.h);
  const alturaFinal = Math.min(ALTURA_DA_CLASSE, alturaPelaLargura);
  const letraNaTela = (mediana / vb.h) * alturaFinal;

  // ⚠️ O SÍMBOLO TAMBÉM É MEDIDO, e essa foi a lição de 10/09/2026. A primeira
  // correção igualou a PALAVRA esticando a altura — e, ao fazer isso,
  // desigualou o SÍMBOLO. O dono viu na hora: *"o símbolo e a palavra devem
  // casar, pois se não casarem, quando faz a mudança da franqueadora para uma
  // unidade já dá pra perceber a diferença"*. A barra fica parada e só a marca
  // troca: qualquer um dos dois fora de escala aparece.
  const simboloNaTela = (cs[0].h / vb.h) * alturaFinal;

  medidas.push({ nome, letraNaTela, simboloNaTela, alturaFinal });
  console.log(
    `  ${nome.padEnd(20)} desenha ${alturaFinal.toFixed(1).padStart(4)}px` +
      ` → símbolo ${simboloNaTela.toFixed(1).padStart(4)}px` +
      ` · palavra ${letraNaTela.toFixed(1).padStart(4)}px  (${quantas} letras medidas)`
  );
}

function espalhamento(valores) {
  const maior = Math.max(...valores);
  const menor = Math.min(...valores);
  return { maior, menor, pct: ((maior - menor) / maior) * 100 };
}

const daPalavra = espalhamento(medidas.map((m) => m.letraNaTela));
const doSimbolo = espalhamento(medidas.map((m) => m.simboloNaTela));

console.log(
  `\n  palavra: ${daPalavra.menor.toFixed(1)}–${daPalavra.maior.toFixed(1)}px` +
    ` → diferença de ${daPalavra.pct.toFixed(0)}%` +
    `\n  símbolo: ${doSimbolo.menor.toFixed(1)}–${doSimbolo.maior.toFixed(1)}px` +
    ` → diferença de ${doSimbolo.pct.toFixed(0)}%`
);

// Acima de 10% a diferença deixa de ser ajuste fino e passa a ser lida como
// "esta marca é menor que a outra" — que foi o que o dono viu, com 31%.
const LIMITE = 10;
const falhas = [];
if (daPalavra.pct > LIMITE) falhas.push(`a PALAVRA varia ${daPalavra.pct.toFixed(0)}%`);
if (doSimbolo.pct > LIMITE) falhas.push(`o SÍMBOLO varia ${doSimbolo.pct.toFixed(0)}%`);

if (falhas.length > 0) {
  console.log(
    `\nFALHA: ${falhas.join(" e ")} (limite ${LIMITE}%).` +
      `\nTrocar de ambiente mostraria o pulo. Se a arte tiver proporções` +
      `\ndiferentes, altura nenhuma resolve — rode \`npm run marca:lockup\`.`
  );
  process.exit(1);
}
console.log("\nSímbolo e palavra casam nos três ambientes.");
