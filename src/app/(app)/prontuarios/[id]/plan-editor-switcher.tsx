"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CornerUpLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  PLAN_STAGE_LABELS,
  PLAN_STAGE_STYLES,
  planStage,
  type TreatmentPlan,
} from "@/lib/planning";
import type {
  PricedProcedure,
  ProtocolRef,
  RealStat,
} from "@/lib/pricing";
import type { MethodologyPillar } from "@/lib/journey";
import type { ProgramBenefit } from "@/lib/empresarial/benefits";
import { PlanningSection } from "./planning-section";
import { PlanLifecycleBar, type LifecycleCaps } from "./plan-lifecycle-bar";
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
  lifecycleCaps = { presentation: false, commercial: false, treatment: false },
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
  lifecycleCaps?: LifecycleCaps;
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
          {plans.map((pl, i) => {
            const st = planStage(pl);
            return (
              <button
                key={pl.id}
                type="button"
                disabled={isPending}
                onClick={() => setSelectedPlanId(pl.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  pl.id === selected?.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "inline-block size-2 rounded-full border",
                    PLAN_STAGE_STYLES[st]
                  )}
                  aria-hidden
                />
                Plano {plans.length - i} · {PLAN_STAGE_LABELS[st]} ·{" "}
                {new Date(pl.createdAt).toLocaleDateString("pt-BR")}
              </button>
            );
          })}
        </div>
      )}

      {/* Situação SEMPRE visível do plano selecionado (mesmo com um plano só). */}
      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Situação do plano:</span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-medium",
              PLAN_STAGE_STYLES[planStage(selected)]
            )}
          >
            {PLAN_STAGE_LABELS[planStage(selected)]}
          </span>
        </div>
      )}

      {/* COM: plano DEVOLVIDO pelo Comercial — considerações em destaque até o
          plano ser reaprovado pelo Coordenador. */}
      {selected &&
        selected.commercialReturnNote &&
        selected.status !== "approved" && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-900">
              <CornerUpLeft className="size-4" />
              DEVOLVIDO PELO COMERCIAL
              {selected.commercialReturnedAt && (
                <span className="font-normal text-rose-700">
                  em{" "}
                  {new Date(selected.commercialReturnedAt).toLocaleDateString(
                    "pt-BR"
                  )}
                </span>
              )}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-rose-900">
              {selected.commercialReturnNote}
            </p>
            <p className="mt-1.5 text-xs text-rose-700/90">
              Ajuste este plano (o mesmo plano — não crie um novo) e envie de
              novo para a aprovação do Coordenador. Todo o caminho fica no
              histórico do plano.
            </p>
          </div>
        )}

      {/* Histórico próprio do plano selecionado (linha do tempo completa). */}
      {selected && selected.events.length > 0 && (
        <div className="flex justify-end">
          <Dialog>
            <DialogTrigger
              render={
                <Button type="button" variant="outline" size="sm">
                  <History className="mr-1 size-3.5" />
                  Histórico do plano
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                    {selected.events.length}
                  </span>
                </Button>
              }
            />
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Histórico do plano</DialogTitle>
                <DialogDescription>
                  Tudo o que aconteceu com este plano, do rascunho ao fim.
                </DialogDescription>
              </DialogHeader>
              <ul className="space-y-0">
                {selected.events.map((e) => (
                  <li key={e.id} className="relative flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "mt-1.5 size-2.5 shrink-0 rounded-full",
                          e.type === "devolvido_comercial" ||
                            e.type === "devolvido_coordenador"
                            ? "bg-rose-500"
                            : e.type === "aprovado_coordenador" ||
                                e.type === "lifecycle_aceito" ||
                                e.type === "lifecycle_concluido"
                              ? "bg-emerald-500"
                              : "bg-primary"
                        )}
                      />
                      <span className="w-px flex-1 bg-border" />
                    </div>
                    <div className="min-w-0 flex-1 pb-3 text-sm">
                      <p
                        className={cn(
                          "whitespace-pre-wrap",
                          e.type === "devolvido_comercial" &&
                            "font-medium text-rose-800"
                        )}
                      >
                        {e.description ?? e.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {e.actorName ? ` · ${e.actorName}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Situação (linha do tempo única) do plano selecionado, quando já aprovado. */}
      {selected && selected.status === "approved" && (
        <PlanLifecycleBar
          planId={selected.id}
          stage={planStage(selected)}
          caps={lifecycleCaps}
        />
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
