"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PLAN_STAGE_LABELS,
  PLAN_STAGE_STYLES,
  type PlanLifecycle,
  type PlanTimelineStage,
} from "@/lib/planning";
import { setPlanLifecycle } from "./planning-actions";

/** Quem pode marcar cada grupo de situações (vem do papel do usuário na unidade). */
export type LifecycleCaps = {
  /** Planner/Admin — pode marcar "aguardando apresentação". */
  presentation: boolean;
  /** Consultor Comercial/Admin — apresentado / aceito / reprovado. */
  commercial: boolean;
  /** Dentista/Coordenador/Recepção/Gerente/Admin — em tratamento / concluído. */
  treatment: boolean;
};

type Cap = keyof LifecycleCaps;

/** Botões de avanço disponíveis conforme o estágio atual e o papel do usuário. */
const TRANSITIONS: {
  to: PlanLifecycle;
  label: string;
  cap: Cap;
  from: PlanTimelineStage[];
  tone?: "default" | "good" | "bad";
}[] = [
  {
    to: "aguardando_apresentacao",
    label: "Enviar para apresentação",
    cap: "presentation",
    from: ["aprovado_coordenador"],
  },
  {
    to: "apresentado",
    label: "Marcar como apresentado",
    cap: "commercial",
    from: ["aprovado_coordenador", "aguardando_apresentacao"],
  },
  {
    to: "aceito",
    label: "Cliente aceitou",
    cap: "commercial",
    from: ["apresentado"],
    tone: "good",
  },
  {
    to: "reprovado",
    label: "Cliente não aceitou",
    cap: "commercial",
    from: ["apresentado"],
    tone: "bad",
  },
  {
    to: "em_tratamento",
    label: "Iniciar tratamento",
    cap: "treatment",
    from: ["aceito"],
    tone: "good",
  },
  {
    to: "concluido",
    label: "Concluir tratamento",
    cap: "treatment",
    from: ["em_tratamento"],
  },
];

/**
 * Barra da SITUAÇÃO do plano (linha do tempo única). Mostra a etiqueta colorida
 * do estágio atual e os botões de avanço que o papel do usuário permite. Cancelar
 * e Suspender NÃO ficam aqui — terão ação própria (Fases 6/7).
 */
export function PlanLifecycleBar({
  planId,
  stage,
  caps,
}: {
  planId: string;
  stage: PlanTimelineStage;
  caps: LifecycleCaps;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const actions = TRANSITIONS.filter(
    (t) => caps[t.cap] && t.from.includes(stage)
  );

  function advance(to: PlanLifecycle, label: string) {
    startTransition(async () => {
      const r = await setPlanLifecycle(planId, to);
      if (r.ok) {
        toast.success(`Situação atualizada: ${label}.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível mudar a situação.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Situação:</span>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
          PLAN_STAGE_STYLES[stage]
        )}
      >
        {PLAN_STAGE_LABELS[stage]}
      </span>

      {actions.length > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {actions.map((a) => (
            <button
              key={a.to}
              type="button"
              disabled={isPending}
              onClick={() => advance(a.to, a.label)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                a.tone === "good" &&
                  "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                a.tone === "bad" &&
                  "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
                (!a.tone || a.tone === "default") && "hover:bg-muted"
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
