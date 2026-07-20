"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  MapPin,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FLOW_LABELS,
  stepsForFlow,
  type EvaluationFlowKind,
} from "@/lib/evaluation-steps";

/**
 * Espinha do Cockpit do Coordenador (Bloco B): o roteiro passo a passo da
 * avaliação (Fase 2) ou reavaliação (Fase 6). O coordenador segue a sequência e
 * marca cada passo como concluído para acompanhar o progresso da consulta.
 * (O progresso vive na sessão da tela; persistência durável no servidor entra
 * num refino.)
 */
export function StepGuide({ kind }: { kind: EvaluationFlowKind }) {
  const steps = stepsForFlow(kind);

  const [done, setDone] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);

  function toggleDone(n: number) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function reset() {
    setDone(new Set());
  }

  function goTo(anchor: string) {
    document
      .getElementById(anchor)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const doneCount = done.size;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <ClipboardList className="size-4 text-gold" />
        <span className="text-sm font-semibold">
          Roteiro da {FLOW_LABELS[kind]}
        </span>
        <span className="text-xs text-muted-foreground">
          {doneCount} de {steps.length} passos
        </span>
        {/* Barra de progresso */}
        <div className="ml-1 hidden h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:block">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {doneCount > 0 && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3.5" />
              Reiniciar
            </button>
          )}
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            aria-label={guideOpen ? "Recolher roteiro" : "Expandir roteiro"}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                !guideOpen && "-rotate-90"
              )}
            />
          </button>
        </div>
      </div>

      {guideOpen && (
        <ol className="divide-y">
          {steps.map((step) => {
            const isDone = done.has(step.n);
            const isOpen = expanded === step.n;
            return (
              <li key={step.n}>
                <div className="flex items-start gap-2 p-2.5">
                  {/* Marcar concluído */}
                  <button
                    type="button"
                    onClick={() => toggleDone(step.n)}
                    aria-label={
                      isDone ? "Desmarcar passo" : "Marcar passo como concluído"
                    }
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                      isDone
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-muted-foreground/30 text-muted-foreground hover:border-gold"
                    )}
                  >
                    {isDone ? <Check className="size-3.5" /> : step.n}
                  </button>
                  {/* Título + descrição (encolhe/expande) */}
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : step.n)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <span
                        className={cn(
                          "text-sm font-medium",
                          isDone && "text-muted-foreground line-through"
                        )}
                      >
                        {step.title}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          !isOpen && "-rotate-90"
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div className="mt-1 space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {step.description}
                        </p>
                        {step.anchor && (
                          <button
                            type="button"
                            onClick={() => goTo(step.anchor!)}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                          >
                            <MapPin className="size-3.5" />
                            Ir para as ferramentas
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
