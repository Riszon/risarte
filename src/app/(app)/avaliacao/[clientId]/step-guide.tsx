"use client";

import { useState } from "react";
import { ChevronDown, ClipboardList, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FLOW_LABELS,
  stepsForFlow,
  type EvaluationFlowKind,
} from "@/lib/evaluation-steps";
import { GuidanceDialog } from "./guidance-dialog";

/**
 * Espinha do Cockpit do Coordenador (Bloco B): o roteiro da avaliação (Fase 2)
 * ou reavaliação (Fase 6). É a ESTRUTURA informativa do fluxo — o coordenador
 * NÃO preenche nada aqui. Alguns passos existem só para orientar (ex.: quebra-
 * gelo); os que têm coleta trazem um atalho para as ferramentas abaixo. A
 * "Orientação da rede" (editável pelo Admin) fica a um clique para consulta.
 */
export function StepGuide({
  kind,
  guidance,
  canEditGuidance,
}: {
  kind: EvaluationFlowKind;
  guidance: string | null;
  canEditGuidance: boolean;
}) {
  const steps = stepsForFlow(kind);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);

  function goTo(anchor: string) {
    document
      .getElementById(anchor)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <ClipboardList className="size-4 text-gold" />
        <span className="text-sm font-semibold">
          Roteiro da {FLOW_LABELS[kind]}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {steps.length} momentos da consulta
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <GuidanceDialog
            kind={kind}
            content={guidance}
            canEdit={canEditGuidance}
          />
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
            const isOpen = expanded === step.n;
            return (
              <li key={step.n}>
                <div className="flex items-start gap-2 p-2.5">
                  <span
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-xs font-semibold text-gold-foreground"
                    aria-hidden
                  >
                    {step.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : step.n)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <span className="text-sm font-medium">{step.title}</span>
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
