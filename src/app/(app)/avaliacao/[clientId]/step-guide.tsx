"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FLOW_LABELS,
  stepsForFlow,
  type EvaluationFlowKind,
} from "@/lib/evaluation-steps";
import { GuidanceDialog } from "./guidance-dialog";

/**
 * Espinha do Cockpit do Coordenador (Bloco B): o roteiro da avaliação (Fase 2)
 * ou reavaliação (Fase 6). É a ESTRUTURA do fluxo — cada passo traz DENTRO dele
 * as ferramentas daquele momento (fotos, considerações, gravação, envio). Os
 * passos começam recolhidos; o coordenador abre o passo em que está trabalhando.
 * A "Orientações" (editável pelo Admin) fica a um clique para consulta.
 */
export function StepGuide({
  kind,
  guidance,
  canEditGuidance,
  toolsByStep = {},
}: {
  kind: EvaluationFlowKind;
  guidance: string | null;
  canEditGuidance: boolean;
  toolsByStep?: Record<number, ReactNode>;
}) {
  const steps = stepsForFlow(kind);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <ClipboardList className="size-4 text-gold" />
        <span className="text-sm font-semibold">Roteiro da {FLOW_LABELS[kind]}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {steps.length} momentos da consulta
        </span>
        <div className="ml-auto">
          <GuidanceDialog kind={kind} content={guidance} canEdit={canEditGuidance} />
        </div>
      </div>

      <ol className="divide-y">
        {steps.map((step) => {
          const isOpen = expanded === step.n;
          const tools = toolsByStep[step.n];
          return (
            <li key={step.n}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : step.n)}
                className="flex w-full items-start gap-2 p-2.5 text-left"
              >
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-xs font-semibold text-gold-foreground"
                  aria-hidden
                >
                  {step.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{step.title}</span>
                    <span className="flex items-center gap-1.5">
                      {tools != null && (
                        <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-gold-foreground">
                          ferramentas
                        </span>
                      )}
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          !isOpen && "-rotate-90"
                        )}
                      />
                    </span>
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 px-2.5 pb-3 pl-10">
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                  {tools != null && <div>{tools}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
