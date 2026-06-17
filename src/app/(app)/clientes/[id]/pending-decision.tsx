"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DECISION_QUESTIONS, type DecisionKind } from "@/lib/journey";
import { answerDecision } from "../../jornada/actions";

export type OpenDecision = {
  id: string;
  kind: DecisionKind;
  /** True only for the professional originally asked (drives "Não sei"). */
  isAssignee: boolean;
};

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
        <Card key={d.id} className="border-destructive bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="size-4" />
              Decisão obrigatória
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{DECISION_QUESTIONS[d.kind]}</p>
            {canAnswer ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => answer(d.id, "yes")}
                >
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
              <p className="text-xs text-muted-foreground">
                Aguardando definição do profissional responsável / Coordenador
                Clínico.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
