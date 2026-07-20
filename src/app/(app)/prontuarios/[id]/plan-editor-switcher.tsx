"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PLAN_STATUS_LABELS, type TreatmentPlan } from "@/lib/planning";
import type {
  PricedProcedure,
  ProtocolRef,
  RealStat,
} from "@/lib/pricing";
import type { MethodologyPillar } from "@/lib/journey";
import type { ProgramBenefit } from "@/lib/empresarial/benefits";
import { PlanningSection } from "./planning-section";
import { createTreatmentPlan } from "./planning-actions";

/**
 * Dono da seleção de plano: mostra a lista de TODOS os planos do cliente (nenhum
 * escondido) e renderiza o editor do plano escolhido. Remonta o editor via `key`
 * ao trocar de plano (estado limpo, sem arrastar texto de um plano para o outro).
 * "Novo plano" cria um plano adicional (em branco ou copiando) e o seleciona.
 */
export function PlanEditorSwitcher({
  clientId,
  clientName,
  plans,
  canEdit,
  canReview,
  inPlanningPhase,
  catalog,
  protocols,
  realStats,
  currentPillar,
  cockpitHref,
  providerOptions = [],
  programActive = false,
  programCompanyName = null,
  programBenefits = {},
}: {
  clientId: string;
  clientName: string;
  plans: TreatmentPlan[];
  canEdit: boolean;
  canReview: boolean;
  inPlanningPhase: boolean;
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  realStats: Record<string, RealStat>;
  currentPillar: MethodologyPillar | null;
  cockpitHref?: string;
  providerOptions?: { id: string; name: string }[];
  programActive?: boolean;
  programCompanyName?: string | null;
  programBenefits?: Record<string, ProgramBenefit>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => {
    const editable = plans.find(
      (p) => p.status === "draft" || p.status === "returned"
    );
    return (editable ?? plans[0])?.id ?? null;
  });

  const selected =
    plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;

  function newPlan(copyFromId?: string) {
    startTransition(async () => {
      const r = await createTreatmentPlan(clientId, copyFromId);
      if (r.ok) {
        toast.success(
          copyFromId ? "Cópia criada para revisão." : "Novo plano criado."
        );
        if (r.planId) setSelectedPlanId(r.planId);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível criar o plano.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Lista de planos do cliente — nenhum é escondido/apagado. */}
      {plans.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/30 p-2">
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            Planos deste cliente:
          </span>
          {plans.map((pl, i) => (
            <button
              key={pl.id}
              type="button"
              disabled={isPending}
              onClick={() => setSelectedPlanId(pl.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                pl.id === selected?.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:bg-muted"
              )}
            >
              Plano {plans.length - i} · {PLAN_STATUS_LABELS[pl.status]} ·{" "}
              {new Date(pl.createdAt).toLocaleDateString("pt-BR")}
            </button>
          ))}
        </div>
      )}

      <PlanningSection
        key={selected?.id ?? "none"}
        clientId={clientId}
        clientName={clientName}
        plan={selected}
        canEdit={canEdit}
        canReview={canReview}
        inPlanningPhase={inPlanningPhase}
        catalog={catalog}
        protocols={protocols}
        realStats={realStats}
        currentPillar={currentPillar}
        cockpitHref={cockpitHref}
        providerOptions={providerOptions}
        programActive={programActive}
        programCompanyName={programCompanyName}
        programBenefits={programBenefits}
        onNewPlan={newPlan}
      />
    </div>
  );
}
