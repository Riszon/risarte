"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoMonthBr } from "@/lib/dates";

// Gráficos do Painel de Dívidas (fase 6). SVG à mão, como os do repasse e
// das metas — sem biblioteca. Regras de leitura:
//   * um eixo só (nunca dois), em R$;
//   * cores da paleta categórica validada, em ordem FIXA (a série guarda a
//     cor, o filtro não repinta), clara e escura;
//   * duas séries ou mais → legenda; o número exato está na dica ao passar o
//     mouse e na tabela ("Ver os números"), nunca só na cor.

const COR_DA_SERIE = [
  { fill: "fill-[#2a78d6] dark:fill-[#3987e5]", stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]", bg: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { fill: "fill-[#eb6834] dark:fill-[#d95926]", stroke: "stroke-[#eb6834] dark:stroke-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
  { fill: "fill-[#1baf7a] dark:fill-[#199e70]", stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]", bg: "bg-[#1baf7a] dark:bg-[#199e70]" },
  { fill: "fill-[#eda100] dark:fill-[#c98500]", stroke: "stroke-[#eda100] dark:stroke-[#c98500]", bg: "bg-[#eda100] dark:bg-[#c98500]" },
  { fill: "fill-[#e87ba4] dark:fill-[#d55181]", stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]", bg: "bg-[#e87ba4] dark:bg-[#d55181]" },
  { fill: "fill-[#008300] dark:fill-[#008300]", stroke: "stroke-[#008300] dark:stroke-[#008300]", bg: "bg-[#008300] dark:bg-[#008300]" },
] as const;

/** Rótulo curto do eixo: "R$ 12 mil", "R$ 1,2 mi". */
export function reaisCurtos(cents: number): string {
  const r = cents / 100;
  if (Math.abs(r) >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(r) >= 1_000) return `R$ ${(r / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${r.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Teto "redondo" do eixo e as três linhas da grade. */
function escala(maximo: number): number[] {
  const m = Math.max(maximo, 100);
  const pot = 10 ** Math.floor(Math.log10(m));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p * 4 >= m) ?? pot * 10;
  return [0, passo, passo * 2, passo * 3, passo * 4].filter((v, i) => i === 0 || v - passo < m);
}

/** "2026-11-01" → "11/26" (o eixo; a dica e a tabela mostram "11/2026"). */
const mesCurto = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

function Legenda({ itens }: { itens: { rotulo: string; cor: number; contorno?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((i) => (
        <span key={i.rotulo} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block size-2.5 rounded-sm", COR_DA_SERIE[i.cor % COR_DA_SERIE.length].bg)} />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: (string | number)[][] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Ver os números</summary>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-muted-foreground">
            <tr>{cabecalho.map((c, i) => <th key={i} className={cn("px-2 py-1", i > 0 && "text-right")}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l, k) => (
              <tr key={k} className="border-t">
                {l.map((c, i) => <td key={i} className={cn("px-2 py-1", i > 0 && "text-right tabular-nums")}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ------------------------------------------------------------- linhas

export type SerieDeLinha = { chave: string; rotulo: string; valores: (number | null)[] };

/**
 * Linhas mês a mês (um eixo, em R$). Passar o mouse num mês mostra a linha
 * vertical e o valor de cada série. O último ponto pode ser "ao vivo" (mês
 * corrente): aparece vazado.
 */
export function GraficoDeLinhas({
  meses,
  series,
  ultimoAoVivo,
  rotulo,
  largura = 640,
}: {
  meses: string[];
  series: SerieDeLinha[];
  ultimoAoVivo: boolean;
  rotulo: string;
  /** Largura do desenho: perto da largura real na tela, para a letra não encolher. */
  largura?: number;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const L = largura, A = 220;
  const M = { t: 12, r: 16, b: 26, l: 64 };
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null));
  const grade = escala(Math.max(0, ...todos));
  const teto = grade[grade.length - 1] || 1;
  const passoX = meses.length > 1 ? (L - M.l - M.r) / (meses.length - 1) : 0;
  const x = (i: number) => (meses.length > 1 ? M.l + i * passoX : (M.l + L - M.r) / 2);
  const y = (v: number) => M.t + (1 - v / teto) * (A - M.t - M.b);

  return (
    <figure className="space-y-2">
      {series.length > 1 && <Legenda itens={series.map((s, i) => ({ rotulo: s.rotulo, cor: i }))} />}
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label={rotulo} onMouseLeave={() => setFoco(null)}>
          {grade.map((g) => (
            <g key={g}>
              <line x1={M.l} x2={L - M.r} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity="0.1" />
              <text x={M.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">{reaisCurtos(g)}</text>
            </g>
          ))}
          {meses.map((m, i) => (
            <text key={m} x={x(i)} y={A - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
              {mesCurto(m)}
              {ultimoAoVivo && i === meses.length - 1 ? "*" : ""}
            </text>
          ))}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={A - M.b} stroke="currentColor" strokeOpacity="0.3" />}
          {series.map((s, si) => {
            const cor = COR_DA_SERIE[si % COR_DA_SERIE.length];
            const pts = s.valores.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            return (
              <g key={s.chave}>
                {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" strokeWidth="2" strokeLinejoin="round" className={cor.stroke} />}
                {s.valores.map((v, i) =>
                  v === null ? null : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={foco === i ? 5 : 4}
                      strokeWidth="2"
                      className={cn(cor.stroke, ultimoAoVivo && i === meses.length - 1 ? "fill-background" : cor.fill)}
                    />
                  )
                )}
              </g>
            );
          })}
          {/* Faixas invisíveis, maiores que o ponto, para a dica. */}
          {meses.map((m, i) => (
            <rect
              key={m}
              x={meses.length > 1 ? x(i) - passoX / 2 : M.l}
              width={meses.length > 1 ? passoX : L - M.l - M.r}
              y={M.t}
              height={A - M.t - M.b}
              fill="transparent"
              onMouseEnter={() => setFoco(i)}
            />
          ))}
        </svg>
        {foco !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1 text-xs shadow"
            style={{ left: `${Math.min(70, (x(foco) / L) * 100)}%` }}
          >
            <p className="font-medium">
              {formatIsoMonthBr(meses[foco])}
              {ultimoAoVivo && foco === meses.length - 1 ? " (até hoje)" : ""}
            </p>
            {series.map((s, si) => (
              <p key={s.chave} className="flex items-center gap-1.5">
                <span className={cn("inline-block size-2 rounded-sm", COR_DA_SERIE[si % COR_DA_SERIE.length].bg)} />
                {series.length > 1 ? `${s.rotulo}: ` : ""}
                <span className="tabular-nums">{s.valores[foco] === null ? "—" : formatBRL(s.valores[foco]!)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <Tabela
        cabecalho={["Mês", ...series.map((s) => s.rotulo)]}
        linhas={meses.map((m, i) => [
          `${formatIsoMonthBr(m)}${ultimoAoVivo && i === meses.length - 1 ? " (até hoje)" : ""}`,
          ...series.map((s) => (s.valores[i] === null ? "—" : formatBRL(s.valores[i]!))),
        ])}
      />
    </figure>
  );
}

// --------------------------------------------------- barras horizontais

export type BarraHorizontal = { chave: string; rotulo: string; valorCents: number; quantidade?: number };

/** Ranking (credor, categoria, natureza, devedor): uma cor só, o valor na ponta. */
export function BarrasHorizontais({ itens, rotulo }: { itens: BarraHorizontal[]; rotulo: string }) {
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">Nada a mostrar com este filtro.</p>;
  const teto = Math.max(1, ...itens.map((i) => i.valorCents));
  const total = itens.reduce((t, i) => t + i.valorCents, 0);
  return (
    <figure className="space-y-1.5" aria-label={rotulo}>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li
            key={i.chave}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs"
            title={`${i.rotulo}: ${formatBRL(i.valorCents)}${i.quantidade ? ` · ${i.quantidade} dívida(s)` : ""} · ${Math.round((i.valorCents / Math.max(total, 1)) * 100)}%`}
          >
            <span className="truncate">{i.rotulo}</span>
            <span className="h-3 rounded-r bg-muted/40">
              <span className={cn("block h-3 rounded-r", COR_DA_SERIE[0].bg)} style={{ width: `${Math.max(1, (i.valorCents / teto) * 100)}%` }} />
            </span>
            <span className="tabular-nums">{reaisCurtos(i.valorCents)}</span>
          </li>
        ))}
      </ul>
      <Tabela
        cabecalho={["", "Valor", "Dívidas", "%"]}
        linhas={itens.map((i) => [i.rotulo, formatBRL(i.valorCents), i.quantidade ?? "—", `${Math.round((i.valorCents / Math.max(total, 1)) * 100)}%`])}
      />
    </figure>
  );
}

// ---------------------------------------------------- barras verticais

export type GrupoDeBarras = { chave: string; rotulo: string; valores: (number | null)[] };

/** Barras por categoria do eixo X (aging; pago e novas por mês). Uma cor por série. */
export function BarrasVerticais({
  eixo,
  series,
  rotulo,
  largura: larguraDoDesenho = 640,
}: {
  eixo: string[];
  series: GrupoDeBarras[];
  rotulo: string;
  largura?: number;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const L = larguraDoDesenho, A = 200;
  const M = { t: 12, r: 8, b: 26, l: 64 };
  const grade = escala(Math.max(0, ...series.flatMap((s) => s.valores.map((v) => v ?? 0))));
  const teto = grade[grade.length - 1] || 1;
  const largura = (L - M.l - M.r) / Math.max(eixo.length, 1);
  const barra = Math.min(36, (largura * 0.7) / series.length);
  const y = (v: number) => M.t + (1 - v / teto) * (A - M.t - M.b);

  return (
    <figure className="space-y-2">
      {series.length > 1 && <Legenda itens={series.map((s, i) => ({ rotulo: s.rotulo, cor: i }))} />}
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="w-full" role="img" aria-label={rotulo} onMouseLeave={() => setFoco(null)}>
          {grade.map((g) => (
            <g key={g}>
              <line x1={M.l} x2={L - M.r} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity="0.1" />
              <text x={M.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">{reaisCurtos(g)}</text>
            </g>
          ))}
          {eixo.map((rot, i) => {
            const x0 = M.l + i * largura + (largura - barra * series.length - 2 * (series.length - 1)) / 2;
            return (
              <g key={rot} onMouseEnter={() => setFoco(i)}>
                <rect x={M.l + i * largura} y={M.t} width={largura} height={A - M.t - M.b} fill={foco === i ? "currentColor" : "transparent"} fillOpacity={0.04} />
                {series.map((s, si) => {
                  const v = s.valores[i] ?? 0;
                  const h = Math.max(0, A - M.b - y(v));
                  return v > 0 ? (
                    <rect key={s.chave} x={x0 + si * (barra + 2)} y={y(v)} width={barra} height={h} rx={3} className={COR_DA_SERIE[si % COR_DA_SERIE.length].fill} />
                  ) : null;
                })}
                <text x={M.l + i * largura + largura / 2} y={A - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">{rot}</text>
              </g>
            );
          })}
        </svg>
        {foco !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1 text-xs shadow"
            style={{ left: `${Math.min(70, ((M.l + foco * largura) / L) * 100)}%` }}
          >
            <p className="font-medium">{eixo[foco]}</p>
            {series.map((s, si) => (
              <p key={s.chave} className="flex items-center gap-1.5">
                <span className={cn("inline-block size-2 rounded-sm", COR_DA_SERIE[si % COR_DA_SERIE.length].bg)} />
                {series.length > 1 ? `${s.rotulo}: ` : ""}
                <span className="tabular-nums">{s.valores[foco] === null ? "—" : formatBRL(s.valores[foco]!)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <Tabela
        cabecalho={["", ...series.map((s) => s.rotulo)]}
        linhas={eixo.map((rot, i) => [rot, ...series.map((s) => (s.valores[i] === null ? "—" : formatBRL(s.valores[i]!)))])}
      />
    </figure>
  );
}
