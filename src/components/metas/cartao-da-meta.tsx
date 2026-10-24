import Link from "next/link";
import { Gift, Lock, Target, Trophy } from "lucide-react";
import { formatIsoDateBr } from "@/lib/dates";
import {
  DESFECHO_LABEL,
  FAROL_LABEL,
  FAROL_LABEL_LIMITE,
  SITUACAO_COR,
  SITUACAO_LABEL,
  formatarPct,
  formatarValor,
  type Meta,
} from "@/lib/metas/regras";
import type { ResumoDaMeta } from "@/lib/metas/resumo";
import { BarraDaMeta } from "./barra-da-meta";

/** O cartão de uma meta no painel e no Início. */
export function CartaoDaMeta({
  meta,
  resumo,
  onde,
  compacto = false,
  minha = null,
  posicoes = null,
}: {
  meta: Meta;
  resumo: ResumoDaMeta;
  /** "Rede toda", "Unidade Centro" — já montado. */
  onde: string;
  compacto?: boolean;
  /** Meta individual no Início: a barra da própria pessoa. */
  minha?: { pct: number | null; valor: number | null; alvo: number | null } | null;
  /** M4 (Q4): "Sua unidade: 3º de 12" e "Você: 2º de 8" — só com o ranking ligado. */
  posicoes?: { unidade: { lugar: number; de: number } | null; voce: { lugar: number; de: number } | null } | null;
}) {
  const ind = resumo.indicador;
  const unidade = ind?.unidade ?? "count";
  const s = resumo.situacao;
  const medivel = s === "active" || s === "paused" || s === "closing" || s === "finished";
  const atingida = s === "finished" && (meta.outcome === "achieved" || meta.outcome === "stretch");
  const recompensa = meta.outcome === "stretch" && meta.stretch_reward_text ? meta.stretch_reward_text : meta.reward_text;

  return (
    <Link
      href={`/metas/${meta.id}`}
      className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium group-hover:text-primary">{meta.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ind?.rotulo ?? meta.indicator} · {onde}
          </p>
        </div>
        {atingida ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            <Trophy className="size-3.5" aria-hidden /> {DESFECHO_LABEL[meta.outcome as "achieved" | "stretch"]}
          </span>
        ) : (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SITUACAO_COR[s]}`}>
            {SITUACAO_LABEL[s]}
          </span>
        )}
      </div>

      {medivel ? (
        resumo.erro ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">{resumo.erro}</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{resumo.rotuloDoPeriodo}</span>
              <span className="font-semibold tabular-nums">{formatarPct(resumo.pct)}</span>
            </div>
            <BarraDaMeta
              pct={resumo.pct}
              pctSuper={resumo.pctSuper}
              farol={resumo.farol}
              limite={resumo.limite}
              esperado={s === "active" && ind?.tipo === "sum" ? resumo.esperado : null}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {resumo.escondido ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" aria-hidden /> Números do financeiro só para a gestão
                </span>
              ) : resumo.alvo != null ? (
                <span className="tabular-nums">
                  {formatarValor(unidade, resumo.valor)} de {formatarValor(unidade, resumo.alvo)}
                </span>
              ) : resumo.pessoas ? (
                <span>Média dos participantes</span>
              ) : (
                <span />
              )}
              {resumo.pessoas && (
                <span>
                  {resumo.pessoas.atingiram} de {resumo.pessoas.total} já atingiram
                </span>
              )}
            </div>
            {minha && (
              <div className="space-y-1 rounded-lg bg-muted/40 p-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium">Você</span>
                  <span className="tabular-nums">
                    {minha.valor != null && minha.alvo != null && (
                      <span className="text-muted-foreground">
                        {formatarValor(unidade, minha.valor)} de {formatarValor(unidade, minha.alvo)} ·{" "}
                      </span>
                    )}
                    {formatarPct(minha.pct)}
                  </span>
                </div>
                <BarraDaMeta pct={minha.pct} tamanho="sm" farol={(minha.pct ?? 0) >= 100 ? "verde" : "neutro"} />
              </div>
            )}
            {posicoes && (posicoes.unidade || posicoes.voce) && (
              <p className="flex flex-wrap gap-x-3 text-xs">
                {posicoes.unidade && (
                  <span>
                    <span className="text-muted-foreground">Sua unidade:</span>{" "}
                    <strong className="tabular-nums">
                      {posicoes.unidade.lugar}º de {posicoes.unidade.de}
                    </strong>
                  </span>
                )}
                {posicoes.voce && (
                  <span>
                    <span className="text-muted-foreground">Você:</span>{" "}
                    <strong className="tabular-nums">
                      {posicoes.voce.lugar}º de {posicoes.voce.de}
                    </strong>
                  </span>
                )}
              </p>
            )}
            {!compacto && s === "active" && (
              <p className="text-xs">
                <span className="font-medium">{(resumo.limite ? FAROL_LABEL_LIMITE : FAROL_LABEL)[resumo.farol]}</span>
                {resumo.projecao != null && (
                  <span className="text-muted-foreground">
                    {resumo.limite
                      ? ` · no ritmo atual, chega a ${formatarPct(resumo.projecao)} do limite`
                      : ` · no ritmo atual, termina em ${formatarPct(resumo.projecao)}`}
                  </span>
                )}
                {resumo.diasRestantes != null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {resumo.diasRestantes === 1 ? "último dia" : `${resumo.diasRestantes} dias restantes`}
                  </span>
                )}
              </p>
            )}
            {s === "finished" && meta.outcome && !atingida && (
              <p className="inline-flex items-center gap-1 text-xs font-medium">
                <Target className="size-3.5" aria-hidden /> {DESFECHO_LABEL[meta.outcome]}
              </p>
            )}
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          {s === "scheduled"
            ? `Começa em ${formatIsoDateBr(meta.starts_on)}`
            : s === "draft"
              ? "Rascunho — ainda não aparece para a equipe."
              : meta.status_reason
                ? `Motivo: ${meta.status_reason}`
                : ""}
        </p>
      )}

      {recompensa && s !== "cancelled" && (
        <p className="inline-flex min-w-0 items-center gap-1 text-xs">
          <Gift className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
          <span className="truncate">
            <span className="text-muted-foreground">{atingida ? "Conquistado:" : "Reconhecimento:"}</span> {recompensa}
          </span>
        </p>
      )}

      <p className="mt-auto text-xs text-muted-foreground">
        {formatIsoDateBr(meta.starts_on)} a {formatIsoDateBr(meta.ends_on)}
        {meta.periodicity === "monthly" ? " · mensal" : ""} · {meta.code}
      </p>
    </Link>
  );
}
