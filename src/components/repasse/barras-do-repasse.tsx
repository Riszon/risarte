"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/pricing";
import { formatIsoMonthBr } from "@/lib/dates";

/**
 * Repasse, Etapa 5 (0401) — as barras mês a mês: PRODUÇÃO e REPASSE lado a
 * lado (a página do dentista), ou só o REPASSE (Meus repasses — o dentista não
 * vê a produção).
 *
 * As duas séries diferem pela cor E pelo preenchimento (a produção é
 * contornada), para não depender só da cor. Passar o mouse mostra o mês; a
 * tabela da página traz os números para quem não lê o gráfico.
 */
export type BarraDoMes = { month: string; producao: number | null; repasse: number };

const L = 640;
const A = 200;
const M = { t: 12, r: 8, b: 28, l: 56 };

export function BarrasDoRepasse({
  meses,
  comProducao,
}: {
  meses: BarraDoMes[];
  comProducao: boolean;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  if (meses.length === 0) return null;
  const teto = Math.max(
    1,
    ...meses.map((m) => Math.max(m.repasse, comProducao ? (m.producao ?? 0) : 0))
  );
  const largura = (L - M.l - M.r) / meses.length;
  const barra = comProducao ? largura * 0.36 : largura * 0.6;
  const y = (v: number) => M.t + (1 - Math.max(0, v) / teto) * (A - M.t - M.b);
  const altura = (v: number) => A - M.b - y(v);
  const grade = [0, 0.5, 1].map((f) => Math.round(teto * f));
  const p = foco != null ? meses[foco] : null;
  const curto = (iso: string) => formatIsoMonthBr(iso).slice(0, 3);

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {comProducao && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden>
              <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Produção (valor vendido)
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <rect x="1" y="1" width="10" height="10" fill="var(--primary)" />
          </svg>
          Repasse
        </span>
      </div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        className="w-full"
        role="img"
        aria-label={comProducao ? "Produção e repasse por mês" : "Repasse por mês"}
      >
        {grade.map((g) => (
          <g key={g}>
            <line x1={M.l} x2={L - M.r} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity="0.12" />
            <text x={M.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
              {g >= 100000
                ? `${(g / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
                : formatBRL(g).replace(",00", "")}
            </text>
          </g>
        ))}
        {meses.map((m, i) => {
          const x0 = M.l + i * largura;
          const centro = x0 + largura / 2;
          return (
            <g key={m.month} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)}>
              <rect x={x0} y={M.t} width={largura} height={A - M.t - M.b} fill="transparent" />
              {comProducao && m.producao != null && (
                <rect
                  x={centro - barra - 1}
                  y={y(m.producao)}
                  width={barra}
                  height={altura(m.producao)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity={foco === i ? 1 : 0.7}
                />
              )}
              <rect
                x={comProducao ? centro + 1 : centro - barra / 2}
                y={y(m.repasse)}
                width={barra}
                height={altura(m.repasse)}
                fill="var(--primary)"
                opacity={foco === i ? 1 : 0.85}
              />
              <text x={centro} y={A - 10} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7">
                {curto(m.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="min-h-5 text-xs text-muted-foreground">
        {p
          ? `${formatIsoMonthBr(p.month)}: repasse ${formatBRL(p.repasse)}${
              comProducao ? ` · produção ${p.producao == null ? "—" : formatBRL(p.producao)}` : ""
            }`
          : "Passe o mouse sobre um mês para ver os valores."}
      </figcaption>
    </figure>
  );
}
