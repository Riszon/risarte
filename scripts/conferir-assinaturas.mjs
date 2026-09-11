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
  ["unidades (claro)", "public/marca/odontologia-horizontal-claro.svg"],
  ["unidades (escuro)", "public/marca/odontologia-horizontal-branco.svg"],
  ["franqueadora", "public/marca/franchising-horizontal-claro.svg"],
  ["empresarial", "public/marca/empresarial-horizontal-branco.svg"],
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

/** A caixa de cada caminho do desenho (aproximada — ver nota abaixo). */
function caixas(svg, arquivo) {
  const ds = [...svg.matchAll(/\bd\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ds.length === 0) {
    throw new Error(`RÉGUA VAZIA: ${arquivo} não tem caminhos para medir.`);
  }
  // ⚠️ APROXIMAÇÃO DECLARADA: os pontos de controle das curvas entram na conta,
  // então a caixa sai igual ou MAIOR que a real, nunca menor. Para comparar
  // proporções entre arquivos do mesmo desenhista, o erro é o mesmo dos dois
  // lados e não muda a conclusão.
  return ds
    .map((d) => {
      const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k + 1 < n.length; k += 2) {
        const x = n[k];
        const y = n[k + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return { x0, x1, y0, y1, h: y1 - y0 };
    })
    .filter((c) => Number.isFinite(c.h))
    .sort((a, b) => a.x0 - b.x0);
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

  medidas.push({ nome, letraNaTela, alturaFinal });
  console.log(
    `  ${nome.padEnd(20)} letras ${((mediana / vb.h) * 100).toFixed(0).padStart(3)}% do quadro` +
      ` · desenha ${alturaFinal.toFixed(1).padStart(4)}px de altura` +
      ` → palavra com ${letraNaTela.toFixed(1)}px  (${quantas} letras medidas)`
  );
}

const maior = Math.max(...medidas.map((m) => m.letraNaTela));
const menor = Math.min(...medidas.map((m) => m.letraNaTela));
const diferenca = ((maior - menor) / maior) * 100;

console.log(
  `\nMaior palavra ${maior.toFixed(1)}px, menor ${menor.toFixed(1)}px — diferença de ${diferenca.toFixed(0)}%.`
);

// Acima de 10% a diferença deixa de ser ajuste fino e passa a ser lida como
// "esta marca é menor que a outra" — que foi o que o dono viu, com 32%.
const LIMITE = 10;
if (diferenca > LIMITE) {
  console.log(
    `\nFALHA: acima de ${LIMITE}% as assinaturas parecem de tamanhos diferentes.` +
      `\nAjustar a altura em \`app-sidebar.tsx\` ou recompor o arquivo.`
  );
  process.exit(1);
}
console.log("\nAs três assinaturas leem no mesmo tamanho.");
