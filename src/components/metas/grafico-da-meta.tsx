"use client";

import { useState } from "react";
import { formatIsoDateBr } from "@/lib/dates";

/**
 * REALIZADO × ESPERADO, dia a dia (só para indicador que SOMA).
 *
 * Duas séries, um eixo só (o percentual da meta). O realizado é a linha cheia
 * na cor do ambiente; o esperado é tracejado e neutro — a diferença não
 * depende só da cor. Passar o mouse mostra o dia; a tabela abaixo traz os
 * números para quem não lê o gráfico.
 */
export type PontoDoGrafico = { dia: string; realizado: number | null; esperado: number };

const L = 640;
const A = 180;
const M = { t: 12, r: 12, b: 24, l: 40 };

export function GraficoDaMeta({ pontos }: { pontos: PontoDoGrafico[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  if (pontos.length < 2) return null;
  const teto = Math.max(100, ...pontos.map((p) => Math.max(p.realizado ?? 0, p.esperado)));
  const x = (i: number) => M.l + (i / (pontos.length - 1)) * (L - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / teto) * (A - M.t - M.b);
  const linha = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const grade = [0, 50, 100].concat(teto > 100 ? [Math.round(teto)] : []);
  const p = foco != null ? pontos[foco] : null;

  function mover(e: React.MouseEvent<SVGRectElement>) {
    const caixa = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - caixa.left) / caixa.width;
    const i = Math.round(rel * (pontos.length - 1));
    setFoco(Math.max(0, Math.min(pontos.length - 1, i)));
  }

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke="var(--primary)" strokeWidth="2" />
          </svg>
          Realizado (acumulado)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Esperado para estar no ritmo
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Realizado acumulado comparado ao esperado, em percentual da meta">
          {grade.map((g) => (
            <g key={g}>
              <line x1={M.l} x2={L - M.r} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
              <text x={M.l - 6} y={y(g) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
                {g}%
              </text>
            </g>
          ))}
          <text x={M.l} y={A - 6} className="fill-muted-foreground" fontSize="10">
            {formatIsoDateBr(pontos[0].dia)}
          </text>
          <text x={L - M.r} y={A - 6} textAnchor="end" className="fill-muted-foreground" fontSize="10">
            {formatIsoDateBr(pontos[pontos.length - 1].dia)}
          </text>
          <polyline
            points={linha(pontos.map((q) => q.esperado))}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
          <polyline
            points={linha(pontos.map((q) => q.realizado))}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {foco != null && p && (
            <g>
              <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={A - M.b} stroke="var(--foreground)" strokeOpacity="0.25" />
              {p.realizado != null && (
                <circle cx={x(foco)} cy={y(p.realizado)} r="4" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
              )}
            </g>
          )}
          <rect
            x={M.l}
            y={M.t}
            width={L - M.l - M.r}
            height={A - M.t - M.b}
            fill="transparent"
            onMouseMove={mover}
            onMouseLeave={() => setFoco(null)}
          />
        </svg>
        {p && foco != null && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
            style={{ left: `${(x(foco) / L) * 100}%`, transform: foco > pontos.length / 2 ? "translateX(-105%)" : "translateX(5%)" }}
          >
            <p className="font-medium">{formatIsoDateBr(p.dia)}</p>
            <p>Realizado: {p.realizado == null ? "—" : `${p.realizado.toFixed(1).replace(".", ",")}%`}</p>
            <p className="text-muted-foreground">Esperado: {p.esperado.toFixed(1).replace(".", ",")}%</p>
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Ver os números</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-0.5 font-normal">Dia</th>
              <th className="py-0.5 text-right font-normal">Realizado</th>
              <th className="py-0.5 text-right font-normal">Esperado</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pontos.map((q) => (
              <tr key={q.dia}>
                <td>{formatIsoDateBr(q.dia)}</td>
                <td className="text-right">{q.realizado == null ? "—" : `${q.realizado.toFixed(1).replace(".", ",")}%`}</td>
                <td className="text-right">{q.esperado.toFixed(1).replace(".", ",")}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
