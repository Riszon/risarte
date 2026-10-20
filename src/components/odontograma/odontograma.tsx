"use client";

// O DESENHO DO ODONTOGRAMA (OD1, passo 4). Só desenha: onde cada face fica,
// a dentição pela idade e a cor de cada marca moram em
// `src/lib/odontograma/desenho.ts` (puro e testado).
//
// Modos da OD1: `compact` (miniatura, sem números nem legenda) e `leitura`
// (a aba da ficha). Os modos que GRAVAM (diagnóstico, plano, execução) chegam
// nas fases seguintes — aqui nada é clicável além da troca de dentição.

import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ROTULO_DA_DENTICAO,
  corDaMarca,
  descricaoDoDente,
  ehSuperior,
  faceDoLado,
  fileiras,
  type Denticao,
  type Lado,
  type MarcaNoDente,
} from "@/lib/odontograma/desenho";
import { cn } from "@/lib/utils";

const CELULA = 40; // largura de um dente
const VAO = 4; // entre dentes
const MEIO = 14; // a linha do meio da boca
const COROA = 30;
const RAIZ = 14;
const NUMERO = 12;
const ALTURA_DA_FILEIRA = COROA + RAIZ + NUMERO + 10;

const CLASSE_DA_COR = {
  planejado: "fill-red-500/80 dark:fill-red-500/70",
  existente: "fill-blue-600/80 dark:fill-blue-500/70",
  ausente: "fill-zinc-400/80 dark:fill-zinc-500/70",
} as const;
const TRACO_DA_COR = {
  planejado: "stroke-red-600 dark:stroke-red-400",
  existente: "stroke-blue-700 dark:stroke-blue-400",
  ausente: "stroke-zinc-500 dark:stroke-zinc-400",
} as const;

/** Os 5 polígonos da coroa (quadrado com o miolo), na posição (x, y). */
function poligonos(x: number, y: number): Record<Lado, string> {
  const s = COROA;
  const m = s * 0.3; // a margem do miolo
  const p = (pts: [number, number][]) => pts.map(([a, b]) => `${x + a},${y + b}`).join(" ");
  return {
    topo: p([[0, 0], [s, 0], [s - m, m], [m, m]]),
    base: p([[m, s - m], [s - m, s - m], [s, s], [0, s]]),
    esquerda: p([[0, 0], [m, m], [m, s - m], [0, s]]),
    direita: p([[s, 0], [s, s], [s - m, s - m], [s - m, m]]),
    centro: p([[m, m], [s - m, m], [s - m, s - m], [m, s - m]]),
  };
}

const LADOS: Lado[] = ["topo", "base", "esquerda", "direita", "centro"];

function Dente({
  dente,
  nome,
  facesDoDente,
  marcas,
  x,
  y,
  compacto,
  selecionado = false,
  onDente,
}: {
  dente: string;
  nome: string;
  facesDoDente: string[];
  marcas: MarcaNoDente[];
  x: number;
  y: number;
  compacto: boolean;
  selecionado?: boolean;
  /** No modo diagnóstico, tocar no dente o seleciona. */
  onDente?: (dente: string) => void;
}) {
  const sup = ehSuperior(dente);
  const cx = x + (CELULA - COROA) / 2;
  // Arcada de cima: raiz em cima, número em cima de tudo. De baixo: o espelho.
  const yRaiz = sup ? y + NUMERO : y + COROA + 2;
  const yCoroa = sup ? y + NUMERO + RAIZ + 2 : y;
  const yNumero = sup ? y + NUMERO - 3 : y + COROA + RAIZ + NUMERO + 1;
  const pol = poligonos(cx, yCoroa);
  const doDente = marcas.filter((m) => m.dente === dente);

  const marcaDaFace = (face: string) =>
    doDente.find((m) => m.local === "face" && m.faces.includes(face));
  const marcaDaRaiz = doDente.find((m) => m.local === "root");
  const marcaDoDente = doDente.find((m) => m.local === "crown" || m.local === "whole_tooth");
  const ausente = doDente.find((m) => corDaMarca(m).classe === "ausente");

  const raiz = sup
    ? `M ${cx + 6} ${yRaiz + RAIZ} L ${cx + COROA / 2} ${yRaiz} L ${cx + COROA - 6} ${yRaiz + RAIZ} Z`
    : `M ${cx + 6} ${yRaiz} L ${cx + COROA / 2} ${yRaiz + RAIZ} L ${cx + COROA - 6} ${yRaiz} Z`;
  const corRaiz = marcaDaRaiz ? corDaMarca(marcaDaRaiz) : null;

  const descricao = descricaoDoDente(dente, nome, marcas);
  const tocavel = onDente
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-pressed": selecionado,
        onClick: () => onDente(dente),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onDente(dente);
          }
        },
        className: "cursor-pointer outline-none [&:focus-visible>rect:first-of-type]:stroke-ring",
      }
    : { role: "img" as const };

  return (
    <g {...tocavel} aria-label={descricao}>
      <title>{descricao}</title>
      {/* A área de toque é o dente inteiro (coroa, raiz e número), não só a face. */}
      {onDente && (
        <rect
          x={x - VAO / 2}
          y={y - 2}
          width={CELULA + VAO}
          height={ALTURA_DA_FILEIRA - 6}
          rx={4}
          className={cn(selecionado ? "fill-gold/20 stroke-gold" : "fill-transparent stroke-transparent")}
          strokeWidth={2}
        />
      )}
      <path
        d={raiz}
        className={cn(
          "stroke-foreground/40",
          corRaiz ? CLASSE_DA_COR[corRaiz.classe] : "fill-muted"
        )}
        strokeWidth={1}
        strokeDasharray={corRaiz?.tracejado ? "3 2" : undefined}
      />
      {LADOS.map((lado) => {
        const face = faceDoLado(dente, lado);
        const tem = facesDoDente.includes(face);
        const marca = tem ? marcaDaFace(face) : undefined;
        const cor = marca ? corDaMarca(marca) : null;
        return (
          <polygon
            key={lado}
            points={pol[lado]}
            data-face={tem ? face : undefined}
            className={cn(
              "stroke-foreground/50",
              cor ? CLASSE_DA_COR[cor.classe] : tem ? "fill-card" : "fill-muted"
            )}
            strokeWidth={cor?.tracejado ? 1.5 : 1}
            strokeDasharray={cor?.tracejado ? "3 2" : undefined}
          />
        );
      })}
      {marcaDoDente && (
        <rect
          x={cx - 2}
          y={yCoroa - 2}
          width={COROA + 4}
          height={COROA + 4}
          rx={3}
          fill="none"
          className={TRACO_DA_COR[corDaMarca(marcaDoDente).classe]}
          strokeWidth={2}
          strokeDasharray={corDaMarca(marcaDoDente).tracejado ? "4 2" : undefined}
        />
      )}
      {ausente && (
        <g className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth={2}>
          <line x1={cx} y1={yCoroa} x2={cx + COROA} y2={yCoroa + COROA} />
          <line x1={cx + COROA} y1={yCoroa} x2={cx} y2={yCoroa + COROA} />
        </g>
      )}
      {!compacto && (
        <text
          x={x + CELULA / 2}
          y={yNumero}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] tabular-nums"
        >
          {dente}
        </text>
      )}
      {!compacto && doDente.length > 0 && (
        <text
          x={x + CELULA / 2}
          y={sup ? yCoroa + COROA + 9 : yCoroa - 3}
          textAnchor="middle"
          className="fill-foreground text-[8px] font-semibold"
        >
          {[...new Set(doDente.map((m) => m.simbolo))].join(" ")}
        </text>
      )}
    </g>
  );
}

export type OdontogramaProps = {
  /** `diagnostico` (OD2) = a leitura com os dentes tocáveis (`onDente`). */
  modo: "compact" | "leitura" | "diagnostico";
  /** Dentes selecionados (modo diagnóstico). */
  selecionados?: string[];
  onDente?: (dente: string) => void;
  /** Chamado quando a pessoa troca a dentição (quem pode, guarda). */
  onDenticao?: (d: Denticao) => void;
  /** Vai na linha dos botões de dentição (ex.: o filtro das marcas). */
  extra?: ReactNode;
  /** Dentição de partida (pela idade); em `leitura` a pessoa troca no botão. */
  denticaoInicial: Denticao;
  /** Por que essa dentição veio marcada — frase inteira (ex.: "Dentição sugerida pela idade (8 anos)."). */
  motivoDaDenticao?: string;
  /** Nome oficial (TUSS) de cada dente, pelo código FDI. */
  nomes: Record<string, string>;
  /** Faces que cada dente tem (dental_tooth_faces). */
  faces: Record<string, string[]>;
  marcas?: MarcaNoDente[];
  className?: string;
};

export function Odontograma({
  modo,
  denticaoInicial,
  motivoDaDenticao,
  nomes,
  faces,
  marcas = [],
  className,
  selecionados = [],
  onDente,
  onDenticao,
  extra,
}: OdontogramaProps) {
  const [denticao, setDenticao] = useState<Denticao>(denticaoInicial);
  const compacto = modo === "compact";
  const tocavel = modo === "diagnostico" ? onDente : undefined;
  const linhas = fileiras(denticao);
  const larguraDaFileira = 16 * CELULA + 15 * VAO + MEIO;
  const altura = linhas.length * ALTURA_DA_FILEIRA + (linhas.length > 2 ? 8 : 0) + 6;

  const desenho = (
    <svg
      viewBox={`0 0 ${larguraDaFileira} ${altura}`}
      className={cn("h-auto w-full", compacto && "max-w-40")}
      role="group"
      aria-label={`Odontograma, dentição ${ROTULO_DA_DENTICAO[denticao].toLowerCase()}`}
    >
      {/* A linha do meio e a que separa as arcadas: guia de leitura. */}
      <line
        x1={larguraDaFileira / 2}
        x2={larguraDaFileira / 2}
        y1={0}
        y2={altura}
        className="stroke-border"
        strokeWidth={1}
      />
      <line
        x1={0}
        x2={larguraDaFileira}
        y1={(linhas.length / 2) * ALTURA_DA_FILEIRA + (linhas.length > 2 ? 4 : 0)}
        y2={(linhas.length / 2) * ALTURA_DA_FILEIRA + (linhas.length > 2 ? 4 : 0)}
        className="stroke-border"
        strokeWidth={1}
      />
      {linhas.map((fileira, i) => {
        // Decídua tem 10 dentes: centraliza a fileira sob a permanente.
        const sobra = (16 - fileira.dentes.length) / 2;
        const y = i * ALTURA_DA_FILEIRA + (linhas.length > 2 && i >= linhas.length / 2 ? 8 : 0) + 3;
        return (
          <g key={`${fileira.arcada}-${fileira.denticao}`}>
            {fileira.dentes.map((dente, j) => {
              const pos = sobra + j;
              const x = pos * (CELULA + VAO) + (pos >= 8 ? MEIO : 0);
              return (
                <Dente
                  key={dente}
                  dente={dente}
                  nome={nomes[dente] ?? "dente"}
                  facesDoDente={faces[dente] ?? []}
                  marcas={marcas}
                  x={x}
                  y={y}
                  compacto={compacto}
                  selecionado={selecionados.includes(dente)}
                  onDente={tocavel}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );

  if (compacto) return <div className={className}>{desenho}</div>;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Dentição" className="inline-flex rounded-md border p-0.5">
          {(Object.keys(ROTULO_DA_DENTICAO) as Denticao[]).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={denticao === d}
              onClick={() => {
                if (d === denticao) return;
                setDenticao(d);
                onDenticao?.(d);
              }}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                denticao === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ROTULO_DA_DENTICAO[d]}
            </button>
          ))}
        </div>
        {extra}
        {motivoDaDenticao && (
          <p className="text-xs text-muted-foreground">
            {motivoDaDenticao} Dá para trocar nos botões.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">{desenho}</div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Vista de frente: o lado direito do paciente fica à esquerda da tela.
      </p>
      <Legenda />
    </div>
  );
}

function Amostra({ classe, tracejado }: { classe: keyof typeof CLASSE_DA_COR | "vazio"; tracejado?: boolean }) {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
      <rect
        x={1}
        y={1}
        width={12}
        height={12}
        rx={2}
        className={cn("stroke-foreground/50", classe === "vazio" ? "fill-card" : CLASSE_DA_COR[classe])}
        strokeWidth={1}
        strokeDasharray={tracejado ? "3 2" : undefined}
      />
    </svg>
  );
}

function Legenda() {
  return (
    <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Como ler o desenho</summary>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <li className="flex items-center gap-2">
          <Amostra classe="planejado" /> Vermelho: a realizar (do plano) ou achado a tratar (cárie, fratura, lesão…)
        </li>
        <li className="flex items-center gap-2">
          <Amostra classe="existente" /> Azul: existente ou já realizado
        </li>
        <li className="flex items-center gap-2">
          <Amostra classe="ausente" /> Cinza com X: dente ausente
        </li>
        <li className="flex items-center gap-2">
          <Amostra classe="existente" tracejado /> Contorno tracejado: sugestão, ainda não definida
        </li>
        <li className="flex items-center gap-2 sm:col-span-2">
          <Amostra classe="vazio" /> Cada dente tem 5 faces: V (vestibular, de fora), P ou L
          (palatina ou lingual, de dentro), M (mesial, para o meio da boca), D (distal) e,
          no centro, O (oclusal) ou I (incisal). Ao lado de cada marca vai o símbolo da
          situação — a cor nunca é a única informação.
        </li>
      </ul>
    </details>
  );
}
