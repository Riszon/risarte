"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DECISION_QUESTIONS, type DecisionKind } from "@/lib/journey";
import { answerDecision } from "../../jornada/actions";

export type OpenDecision = {
  id: string;
  kind: DecisionKind;
  /** True only for the professional originally asked (drives "Não sei"). */
  isAssignee: boolean;
};

/**
 * As decisões obrigatórias, como linhas do painel "Precisa de atenção"
 * (28/10/2026): a pergunta e os botões na mesma linha. Antes era um cartão
 * vermelho inteiro por decisão, acima de tudo.
 */
export function PendingDecision({
  decisions,
  canAnswer,
}: {
  decisions: OpenDecision[];
  canAnswer: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (decisions.length === 0) return null;

  function answer(id: string, value: "yes" | "no" | "unsure") {
    startTransition(async () => {
      const result = await answerDecision(id, value);
      if (result.ok) {
        toast.success("Decisão registrada.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <>
      {decisions.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm"
        >
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive">Decisão obrigatória</p>
            <p className="mt-0.5 text-xs text-foreground/80">{DECISION_QUESTIONS[d.kind]}</p>
          </div>
          {canAnswer ? (
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button size="sm" disabled={isPending} onClick={() => answer(d.id, "yes")}>
                Sim
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => answer(d.id, "no")}
              >
                Não
              </Button>
              {d.kind === "needs_reevaluation" && d.isAssignee && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => answer(d.id, "unsure")}
                >
                  Não sei (encaminhar ao Coordenador)
                </Button>
              )}
            </div>
          ) : (
            <p className="shrink-0 text-xs text-muted-foreground">
              Aguardando o profissional responsável / Coordenador Clínico.
            </p>
          )}
        </li>
      ))}
    </>
  );
}
