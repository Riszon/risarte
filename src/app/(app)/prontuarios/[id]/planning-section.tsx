"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Layers,
  LayoutDashboard,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  OPTION_REVIEW_LABELS,
  PLAN_STATUS_LABELS,
  type PlanOption,
  type PlanStage,
  type TreatmentPlan,
} from "@/lib/planning";
import {
  PILLAR_LABELS,
  TREATMENT_PILLARS,
  type MethodologyPillar,
  type TreatmentPillar,
} from "@/lib/journey";
import { setTreatmentPillar } from "../../jornada/actions";
import {
  budgetTotalCents,
  formatBRL,
  formatMinutes,
  formatSessions,
  type BudgetItem,
  type PricedProcedure,
  type ProtocolRef,
  type RealStat,
} from "@/lib/pricing";
import { applyBenefit } from "@/lib/empresarial/pricing";
import type { ProgramBenefit } from "@/lib/empresarial/benefits";
import {
  addBudgetItem,
  addPlanOption,
  addPlanStage,
  createTreatmentPlan,
  editBudgetItem,
  editPlanOption,
  movePlanStage,
  removeBudgetItem,
  removePlanOption,
  removePlanStage,
  renamePlanStage,
  reopenTreatmentPlan,
  reviewPlanOption,
  saveDiagnosis,
  savePlanNarrative,
  setItemProvider,
  setItemStage,
  setPrimaryOption,
  submitTreatmentPlan,
} from "./planning-actions";
import { moveClientPhase } from "../../jornada/actions";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** cents → "150,00" for a text input (no currency symbol). */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Pilar sugerido automaticamente: soma o valor dos procedimentos por pilar
 * (entre os 4 pilares de tratamento) e devolve o de maior soma. Usa a opção
 * principal, ou todas as opções se não houver principal.
 */
function suggestTreatmentPillar(
  options: PlanOption[],
  catalog: PricedProcedure[]
): TreatmentPillar | null {
  const primary = options.find((o) => o.isPrimary);
  const items = primary ? primary.items : options.flatMap((o) => o.items);
  const sum = new Map<TreatmentPillar, number>();
  for (const it of items) {
    if (!it.procedureId) continue;
    const proc = catalog.find((c) => c.id === it.procedureId);
    const p = proc?.pillar;
    if (!p || !TREATMENT_PILLARS.includes(p as TreatmentPillar)) continue;
    sum.set(
      p as TreatmentPillar,
      (sum.get(p as TreatmentPillar) ?? 0) + it.quantity * it.unitPriceCents
    );
  }
  let best: TreatmentPillar | null = null;
  let bestSum = -1;
  for (const [p, s] of sum) {
    if (s > bestSum) {
      bestSum = s;
      best = p;
    }
  }
  return best;
}

export function PlanningSection({
  clientId,
  clientName,
  plan,
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
  plan: TreatmentPlan | null;
  canEdit: boolean;
  canReview: boolean;
  inPlanningPhase: boolean;
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  realStats: Record<string, RealStat>;
  currentPillar: MethodologyPillar | null;
  /** (Ficha) link para abrir o cockpit do Planner; ausente no próprio cockpit. */
  cockpitHref?: string;
  /** H4.5 Pedido 1: profissionais da unidade do cliente (para o Planner indicar). */
  providerOptions?: { id: string; name: string }[];
  /** Risarte Empresarial: cliente do programa → orçamento mostra a economia. */
  programActive?: boolean;
  programCompanyName?: string | null;
  programBenefits?: Record<string, ProgramBenefit>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [diagnosis, setDiagnosis] = useState(plan?.diagnosis ?? "");
  const [objectives, setObjectives] = useState(plan?.objectives ?? "");
  const [planningNotes, setPlanningNotes] = useState(plan?.planningNotes ?? "");
  const [optTitle, setOptTitle] = useState("");
  const [optDesc, setOptDesc] = useState("");
  const [optPrimary, setOptPrimary] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPrimary, setEditPrimary] = useState(false);

  const currentTreatment: TreatmentPillar | "" =
    currentPillar && TREATMENT_PILLARS.includes(currentPillar as TreatmentPillar)
      ? (currentPillar as TreatmentPillar)
      : "";
  const [pillarChoice, setPillarChoice] = useState<TreatmentPillar | "">(
    currentTreatment
  );

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(msg);
        after?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  // -- No plan yet -----------------------------------------------------------
  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plano de Tratamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && inPlanningPhase ? (
            <>
              <p className="text-sm text-muted-foreground">
                Nenhum plano iniciado. Comece o diagnóstico e as opções de
                tratamento deste cliente.
              </p>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => createTreatmentPlan(clientId),
                    "Plano iniciado."
                  )
                }
              >
                <ClipboardList className="mr-1 size-4" />
                Iniciar plano de tratamento
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {inPlanningPhase
                ? "Nenhum plano de tratamento criado ainda."
                : "O plano de tratamento é criado pelo Planner no Centro de Planejamento (Fase 3)."}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const options = plan.options;
  // The Planner/Admin always SEE prices; the Coordenador never does.
  const canSeePrices = canEdit;
  const suggestedPillar = canEdit
    ? suggestTreatmentPillar(options, catalog)
    : null;
  // After approval (or while awaiting it), the plan is locked for editing — the
  // Planner must "Reabrir para edição", which sends it back for re-approval.
  const canEditContent =
    canEdit && (plan.status === "draft" || plan.status === "returned");
  // H2.4: depois de enviado ao Comercial (cliente saiu da Fase 3), o botão de
  // reabrir some — só volta se o caso retornar ao Centro de Planejamento.
  const canReopen =
    canEdit &&
    inPlanningPhase &&
    (plan.status === "submitted" || plan.status === "approved");
  const allOptionsHaveItems =
    options.length > 0 && options.every((o) => o.items.length > 0);
  const canSubmit =
    canEditContent &&
    inPlanningPhase &&
    diagnosis.trim().length > 0 &&
    options.length > 0 &&
    allOptionsHaveItems;

  function saveDiag() {
    run(() => saveDiagnosis(plan!.id, diagnosis), "Diagnóstico salvo.");
  }

  function saveNarrative() {
    run(
      () => savePlanNarrative(plan!.id, objectives, planningNotes),
      "Objetivos e considerações salvos."
    );
  }

  // H2.3: envio direto — sem etapa de confirmação; só exige o pilar definido.
  function submitPlan() {
    startTransition(async () => {
      if (!pillarChoice) {
        toast.error("Defina o pilar da Metodologia antes de enviar.");
        return;
      }
      if (pillarChoice !== currentTreatment) {
        const r = await setTreatmentPillar(
          clientId,
          pillarChoice as TreatmentPillar
        );
        if (!r.ok) {
          toast.error(r.error ?? "Não foi possível definir o pilar.");
          return;
        }
      }
      const r = await submitTreatmentPlan(plan!.id);
      if (r.ok) {
        toast.success(`Plano de ${clientName} enviado para aprovação.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível enviar o plano.");
      }
    });
  }

  function addOption() {
    run(
      () =>
        addPlanOption(plan!.id, {
          title: optTitle,
          description: optDesc,
          isPrimary: optPrimary,
        }),
      "Opção adicionada.",
      () => {
        setOptTitle("");
        setOptDesc("");
        setOptPrimary(false);
      }
    );
  }

  function startEdit(o: PlanOption) {
    setEditingId(o.id);
    setEditTitle(o.title);
    setEditDesc(o.description ?? "");
    setEditPrimary(o.isPrimary);
  }

  function saveEdit(id: string) {
    run(
      () =>
        editPlanOption(id, {
          title: editTitle,
          description: editDesc,
          isPrimary: editPrimary,
        }),
      "Opção atualizada.",
      () => setEditingId(null)
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Plano de Tratamento</CardTitle>
          <div className="flex items-center gap-2">
            {cockpitHref && canEdit && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={cockpitHref} />}
              >
                <LayoutDashboard className="mr-1 size-4" />
                Abrir cockpit
              </Button>
            )}
            <Badge
              variant={plan.status === "approved" ? "secondary" : "outline"}
              className={
                plan.status === "approved" ? "" : "border-primary text-primary"
              }
            >
              {PLAN_STATUS_LABELS[plan.status]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.status === "returned" && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            Plano devolvido pelo Coordenador — veja as considerações em cada opção
            abaixo, ajuste e reenvie.
          </p>
        )}
        {plan.status === "submitted" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm text-primary">
            Enviado para aprovação do Coordenador Clínico
            {plan.submittedAt ? ` em ${fmtDateTime(plan.submittedAt)}` : ""}.
          </p>
        )}

        {/* Diagnóstico */}
        <div className="space-y-2">
          <Label htmlFor="plan-diagnosis">Diagnóstico</Label>
          {canEditContent ? (
            <>
              <textarea
                id="plan-diagnosis"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={4}
                placeholder="Resumo do diagnóstico do caso..."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={isPending || diagnosis === (plan.diagnosis ?? "")}
                onClick={saveDiag}
              >
                Salvar diagnóstico
              </Button>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              {plan.diagnosis || (
                <span className="text-muted-foreground">
                  Diagnóstico ainda não preenchido.
                </span>
              )}
            </p>
          )}
        </div>

        {/* Objetivos do tratamento + Considerações do planejamento (apresentação) */}
        <div className="space-y-2">
          <Label htmlFor="plan-objectives">Objetivos do tratamento</Label>
          {canEditContent ? (
            <>
              <textarea
                id="plan-objectives"
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                rows={3}
                placeholder="O que este tratamento busca alcançar (ex.: devolver a mastigação, harmonizar o sorriso)..."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
              <Label htmlFor="plan-notes">Considerações do planejamento</Label>
              <textarea
                id="plan-notes"
                value={planningNotes}
                onChange={(e) => setPlanningNotes(e.target.value)}
                rows={3}
                placeholder="Observações para a apresentação ao cliente (sequência, cuidados, alternativas)..."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  isPending ||
                  (objectives === (plan.objectives ?? "") &&
                    planningNotes === (plan.planningNotes ?? ""))
                }
                onClick={saveNarrative}
              >
                Salvar objetivos e considerações
              </Button>
            </>
          ) : (
            (plan.objectives || plan.planningNotes) && (
              <div className="space-y-1 text-sm">
                {plan.objectives && (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">Objetivos:</span>{" "}
                    {plan.objectives}
                  </p>
                )}
                {plan.planningNotes && (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">Considerações:</span>{" "}
                    {plan.planningNotes}
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {programActive && (
          <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
            <span className="font-medium text-gold">★ Risarte Empresarial</span>
            {programCompanyName ? ` — ${programCompanyName}.` : "."} O orçamento
            mostra o valor com o benefício do programa (a economia aparece em cada
            opção).
          </div>
        )}

        {/* Opções do plano (principal + alternativos) */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Opções de tratamento</h3>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma opção cadastrada. Adicione o plano principal e, se houver,
              alternativos.
            </p>
          ) : (
            <ul className="space-y-2">
              {options.map((o) => (
                <li
                  key={o.id}
                  className={cn(
                    "rounded-md border p-2 text-sm",
                    o.isPrimary && "border-gold bg-gold/5"
                  )}
                >
                  {editingId === o.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Título da opção"
                      />
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={3}
                        placeholder="Descrição (procedimentos, observações...)"
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editPrimary}
                          onChange={(e) => setEditPrimary(e.target.checked)}
                        />
                        Plano principal (recomendado)
                      </label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => saveEdit(o.id)}
                        >
                          Salvar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {o.isPrimary && (
                            <Star className="mr-1 inline size-3.5 fill-gold text-gold" />
                          )}
                          {o.title}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {o.isPrimary && (
                            <Badge className="bg-gold text-gold-foreground text-[10px]">
                              Plano principal
                            </Badge>
                          )}
                          {plan.status !== "draft" && (
                            <Badge
                              variant={
                                o.reviewStatus === "approved"
                                  ? "secondary"
                                  : o.reviewStatus === "rejected"
                                    ? "destructive"
                                    : "outline"
                              }
                              className="text-[10px]"
                            >
                              {OPTION_REVIEW_LABELS[o.reviewStatus]}
                            </Badge>
                          )}
                        </div>
                        {o.description && (
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                            {o.description}
                          </p>
                        )}
                      </div>
                      {canEditContent && (
                        <div className="flex shrink-0 items-center gap-1">
                          {!o.isPrimary && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={isPending}
                              onClick={() =>
                                run(
                                  () => setPrimaryOption(o.id),
                                  "Definido como plano principal."
                                )
                              }
                            >
                              Tornar principal
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Editar opção"
                            onClick={() => startEdit(o)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover opção"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => removePlanOption(o.id),
                                "Opção removida."
                              )
                            }
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <OptionBudget
                    optionId={o.id}
                    items={o.items}
                    stages={o.stages}
                    catalog={catalog}
                    protocols={protocols}
                    realStats={realStats}
                    providerOptions={providerOptions}
                    canEdit={canEditContent}
                    summaryOnly={!canSeePrices}
                    programBenefits={programActive ? programBenefits : undefined}
                  />
                  {o.reviewNotes && (
                    <p className="mt-1 rounded-md border bg-muted/30 p-2 text-xs">
                      <span className="font-medium">
                        Considerações do Coordenador:
                      </span>{" "}
                      {o.reviewNotes}
                    </p>
                  )}
                  {canReview && plan.status === "submitted" && (
                    <OptionReview optionId={o.id} optionTitle={o.title} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Adicionar opção */}
          {canEditContent && (
            <div className="space-y-2 rounded-md border border-dashed p-2">
              <Input
                value={optTitle}
                onChange={(e) => setOptTitle(e.target.value)}
                placeholder="Título da opção (ex.: Plano principal)"
              />
              <textarea
                value={optDesc}
                onChange={(e) => setOptDesc(e.target.value)}
                rows={2}
                placeholder="Descrição (procedimentos, observações...)"
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={optPrimary}
                  onChange={(e) => setOptPrimary(e.target.checked)}
                />
                Plano principal (recomendado)
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={!optTitle.trim() || isPending}
                onClick={addOption}
              >
                <Plus className="mr-1 size-4" />
                Adicionar opção
              </Button>
            </div>
          )}
        </div>

        {/* Pilar da Metodologia + envio para aprovação */}
        {canEditContent && (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1.5 rounded-md border p-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-3.5 text-gold" />
                Pilar da Metodologia
              </p>
              <p className="text-xs text-muted-foreground">
                Atual:{" "}
                {currentPillar ? PILLAR_LABELS[currentPillar] : "não definido"}
                {suggestedPillar && (
                  <>
                    {" "}
                    · Sugerido (por valor):{" "}
                    <strong>{PILLAR_LABELS[suggestedPillar]}</strong>
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pillarChoice}
                  onChange={(e) =>
                    setPillarChoice(e.target.value as TreatmentPillar | "")
                  }
                  className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Selecione...</option>
                  {TREATMENT_PILLARS.map((p) => (
                    <option key={p} value={p}>
                      {PILLAR_LABELS[p]}
                    </option>
                  ))}
                </select>
                {suggestedPillar && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPillarChoice(suggestedPillar)}
                  >
                    Usar sugerido
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={
                    !pillarChoice ||
                    pillarChoice === currentTreatment ||
                    isPending
                  }
                  onClick={() =>
                    run(
                      () =>
                        setTreatmentPillar(
                          clientId,
                          pillarChoice as TreatmentPillar
                        ),
                      "Pilar definido."
                    )
                  }
                >
                  Salvar pilar
                </Button>
              </div>
            </div>

            <Button
              disabled={!canSubmit || !pillarChoice || isPending}
              onClick={submitPlan}
            >
              <Send className="mr-1 size-4" />
              Enviar para aprovação do Coordenador
            </Button>
            {(!canSubmit || !pillarChoice) && inPlanningPhase && (
              <p className="text-xs text-muted-foreground">
                Para enviar: preencha o diagnóstico, tenha ao menos uma opção,
                lance os <strong>procedimentos</strong> (itens do orçamento) em{" "}
                <strong>cada opção</strong> e defina o{" "}
                <strong>pilar da Metodologia</strong> acima.
              </p>
            )}
          </div>
        )}

        {/* Plano travado (enviado/aprovado): o Planner pode reabrir para editar,
            mas a alteração volta para nova aprovação do Coordenador. */}
        {canReopen && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {plan.status === "approved"
                ? "Plano aprovado — para alterar, reabra; a alteração precisará de nova aprovação do Coordenador antes de ir ao Comercial."
                : "Plano enviado para aprovação — para alterar, reabra (cancela o envio atual)."}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(
                  () => reopenTreatmentPlan(plan.id),
                  "Plano reaberto para edição."
                )
              }
            >
              <Pencil className="mr-1 size-4" />
              Reabrir para edição
            </Button>
          </div>
        )}

        {/* H2.4: já foi ao Comercial — edição bloqueada (sem botão de reabrir). */}
        {canEdit &&
          plan.status === "approved" &&
          !inPlanningPhase && (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Plano enviado ao Comercial — a edição fica bloqueada. Se o caso
              voltar ao Centro de Planejamento (revisão), o plano poderá ser
              reaberto.
            </p>
          )}

        {/* Aprovação por opção (F4): o Coordenador decide cada opção acima. */}
        {canReview && plan.status === "submitted" && (
          <p className="border-t pt-3 text-sm text-muted-foreground">
            Avalie <strong>cada opção</strong> acima (Aprovar ou Reprovar). O plano
            é liberado ao Comercial quando todas as opções tiverem decisão e houver
            ao menos uma aprovada; se todas forem reprovadas, volta ao Planner.
          </p>
        )}

        {/* Envio ao Comercial após aprovação (Planner) */}
        {canEdit && plan.status === "approved" && inPlanningPhase && (
          <div className="space-y-2 border-t pt-3">
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <Check className="size-4 shrink-0" />
              Plano aprovado pelo Coordenador. Você pode enviar ao Comercial.
            </p>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => moveClientPhase(clientId, "commercial_conversion"),
                  `${clientName} enviado(a) à Conversão Comercial.`
                )
              }
            >
              <ArrowRight className="mr-1 size-4" />
              Enviar ao Comercial (Fase 4)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Budget lines + total for a single plan option (Etapa 5.2). */
function plannedText(it: BudgetItem): string | null {
  if (it.plannedSessions == null && it.plannedMinutes == null) return null;
  const parts: string[] = [];
  if (it.plannedSessions != null) parts.push(formatSessions(it.plannedSessions));
  if (it.plannedMinutes != null) parts.push(formatMinutes(it.plannedMinutes));
  return parts.join(" · ");
}

/**
 * H4.5: agrupa os itens por etapa (na ordem das etapas), com um grupo final
 * "Sem etapa" para os itens não classificados.
 */
function groupItemsByStage(
  items: BudgetItem[],
  stages: PlanStage[]
): { stage: PlanStage | null; items: BudgetItem[] }[] {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageIds = new Set(ordered.map((s) => s.id));
  const groups = ordered.map((stage) => ({
    stage: stage as PlanStage | null,
    items: items.filter((i) => i.stageId === stage.id),
  }));
  groups.push({
    stage: null,
    items: items.filter((i) => !i.stageId || !stageIds.has(i.stageId)),
  });
  return groups;
}

/** Total da opção com o benefício do programa aplicado (só benefícios disponíveis). */
function computeProgramTotal(
  items: BudgetItem[],
  benefits?: Record<string, ProgramBenefit>
): { chargedCents: number; savedCents: number } | null {
  if (!benefits) return null;
  let charged = 0;
  let full = 0;
  for (const it of items) {
    const line = it.quantity * it.unitPriceCents;
    full += line;
    const b = it.procedureId ? benefits[it.procedureId] : undefined;
    charged += b && b.available ? applyBenefit(b, line).chargedCents : line;
  }
  return { chargedCents: charged, savedCents: full - charged };
}

function ProgramSavings({
  program,
}: {
  program: { chargedCents: number; savedCents: number } | null;
}) {
  if (!program || program.savedCents <= 0) return null;
  return (
    <div className="mt-1 flex items-center justify-between rounded bg-gold/10 px-1.5 py-1 text-xs text-gold">
      <span>★ Com Risarte Empresarial</span>
      <span className="font-semibold">
        {formatBRL(program.chargedCents)} · economia {formatBRL(program.savedCents)}
      </span>
    </div>
  );
}

function OptionBudget({
  optionId,
  items,
  stages,
  catalog,
  protocols,
  realStats,
  providerOptions,
  canEdit,
  summaryOnly,
  programBenefits,
}: {
  optionId: string;
  items: BudgetItem[];
  /** H4.5: etapas do tratamento desta opção (ordenadas). */
  stages: PlanStage[];
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  realStats: Record<string, RealStat>;
  /** H4.5 Pedido 1: profissionais da unidade (para indicar por item). */
  providerOptions: { id: string; name: string }[];
  canEdit: boolean;
  /** Coordenador view: show only the option TOTAL, not per-item prices (F4). */
  summaryOnly: boolean;
  /** Risarte Empresarial: benefícios por procedimento (undefined = fora do programa). */
  programBenefits?: Record<string, ProgramBenefit>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [procId, setProcId] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [pSess, setPSess] = useState("");
  const [pMin, setPMin] = useState("");
  // Base (por 1 unidade) do protocolo, para reescalar ao mudar a quantidade.
  const [baseSess, setBaseSess] = useState(0);
  const [baseMin, setBaseMin] = useState(0);
  const [nStage, setNStage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eQty, setEQty] = useState("1");
  const [ePSess, setEPSess] = useState("");
  const [ePMin, setEPMin] = useState("");
  const [eStage, setEStage] = useState("");
  // H4.5: gestão das etapas.
  const [newStageName, setNewStageName] = useState("");
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [stageNameEdit, setStageNameEdit] = useState("");

  const total = budgetTotalCents(items);
  const program = computeProgramTotal(items, programBenefits);
  const pickedRef = procId ? protocols[procId] : undefined;
  const pickedReal = procId ? realStats[procId] : undefined;
  const orderedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const itemGroups = groupItemsByStage(items, stages);
  const providerName = (id: string | null) =>
    id ? (providerOptions.find((p) => p.id === id)?.name ?? null) : null;

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(msg);
        after?.();
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function pickProcedure(id: string) {
    setProcId(id);
    const p = catalog.find((c) => c.id === id);
    if (p) {
      setDesc(p.name);
      setPrice(centsToInput(p.effectivePriceCents));
    }
    // Base de sessões/tempo: protocolo da unidade (se houver) ou da Rede.
    const ref = protocols[id];
    const base = ref?.unit ?? ref?.network ?? null;
    const q = Math.max(1, Number(qty) || 1);
    setBaseSess(base ? base.count : 0);
    setBaseMin(base ? base.minutes : 0);
    setPSess(base ? String(base.count * q) : "");
    setPMin(base ? String(base.minutes * q) : "");
  }

  // Ao mudar a quantidade, reescala a sugestão de sessões/tempo (base × qtd).
  function changeQty(v: string) {
    setQty(v);
    const q = Math.max(1, Number(v) || 1);
    if (baseSess > 0) setPSess(String(baseSess * q));
    if (baseMin > 0) setPMin(String(baseMin * q));
  }

  if (!canEdit && items.length === 0) return null;

  // Coordenador (and other non-editors): only the procedures + the option TOTAL,
  // never the per-item prices (owner rule, F4).
  if (summaryOnly) {
    return (
      <div className="mt-2 rounded-md bg-muted/40 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Orçamento
          </span>
          <span className="text-sm font-semibold">{formatBRL(total)}</span>
        </div>
        <ProgramSavings program={program} />
        {items.length > 0 && (
          <div className="mt-1 space-y-1.5">
            {itemGroups.map(
              (g) =>
                g.items.length > 0 && (
                  <div key={g.stage?.id ?? "none"}>
                    {(g.stage || stages.length > 0) && (
                      <p className="flex items-center gap-1 text-xs font-medium">
                        <Layers className="size-3 text-muted-foreground" />
                        {g.stage ? g.stage.name : "Sem etapa"}
                      </p>
                    )}
                    <ul className="space-y-0.5 text-sm text-muted-foreground">
                      {g.items.map((it) => (
                        <li key={it.id}>
                          {it.quantity}× {it.description}
                          {plannedText(it) && (
                            <span className="text-xs"> — {plannedText(it)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md bg-muted/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Orçamento
        </span>
        <span className="text-sm font-semibold">{formatBRL(total)}</span>
      </div>
      <ProgramSavings program={program} />

      {canEdit && (
        <div className="mt-2 space-y-1 rounded-md border border-dashed p-2">
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" />
            Etapas do tratamento
          </p>
          {orderedStages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma etapa criada. Crie etapas (ex.: “Adequação”,
              “Reabilitação”) e organize os procedimentos abaixo por etapa.
            </p>
          ) : (
            <ul className="space-y-1">
              {orderedStages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1 text-sm">
                  {editingStageId === s.id ? (
                    <>
                      <Input
                        value={stageNameEdit}
                        onChange={(e) => setStageNameEdit(e.target.value)}
                        className="h-7 max-w-[200px]"
                        aria-label="Nome da etapa"
                      />
                      <Button
                        size="sm"
                        disabled={isPending || !stageNameEdit.trim()}
                        onClick={() =>
                          run(
                            () => renamePlanStage(s.id, stageNameEdit),
                            "Etapa renomeada.",
                            () => setEditingStageId(null)
                          )
                        }
                      >
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingStageId(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground">
                        {i + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Subir etapa"
                        disabled={isPending || i === 0}
                        onClick={() =>
                          run(
                            () => movePlanStage(s.id, "up"),
                            "Ordem das etapas atualizada."
                          )
                        }
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Descer etapa"
                        disabled={isPending || i === orderedStages.length - 1}
                        onClick={() =>
                          run(
                            () => movePlanStage(s.id, "down"),
                            "Ordem das etapas atualizada."
                          )
                        }
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Renomear etapa"
                        onClick={() => {
                          setEditingStageId(s.id);
                          setStageNameEdit(s.name);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover etapa"
                        disabled={isPending}
                        onClick={() =>
                          run(() => removePlanStage(s.id), "Etapa removida.")
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5">
            <Input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Nova etapa (ex.: Adequação do meio)"
              className="h-8 max-w-[240px]"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newStageName.trim() || isPending}
              onClick={() =>
                run(
                  () => addPlanStage(optionId, newStageName),
                  "Etapa adicionada.",
                  () => setNewStageName("")
                )
              }
            >
              <Plus className="mr-1 size-4" />
              Etapa
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-1 space-y-2">
          {itemGroups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.stage?.id ?? "none"}>
                  {(g.stage || stages.length > 0) && (
                    <p className="flex items-center gap-1 text-xs font-medium">
                      <Layers className="size-3 text-muted-foreground" />
                      {g.stage ? g.stage.name : "Sem etapa"}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {g.items.map((it) => (
                      <li key={it.id} className="text-sm">
                        {editingId === it.id ? (
                          <div className="space-y-1.5">
                            <Input
                              value={eDesc}
                              onChange={(e) => setEDesc(e.target.value)}
                              placeholder="Descrição"
                            />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Input
                                value={eQty}
                                onChange={(e) => setEQty(e.target.value)}
                                inputMode="numeric"
                                className="w-16"
                                aria-label="Quantidade"
                              />
                              <span className="text-xs text-muted-foreground">
                                ×
                              </span>
                              <span className="text-sm text-muted-foreground">
                                R$
                              </span>
                              <Input
                                value={ePrice}
                                onChange={(e) => setEPrice(e.target.value)}
                                inputMode="decimal"
                                className="w-28"
                                aria-label="Valor unitário"
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span>Sessões</span>
                              <Input
                                value={ePSess}
                                onChange={(e) => setEPSess(e.target.value)}
                                inputMode="numeric"
                                className="w-14"
                                aria-label="Sessões planejadas"
                              />
                              <span>· Tempo total (min)</span>
                              <Input
                                value={ePMin}
                                onChange={(e) => setEPMin(e.target.value)}
                                inputMode="numeric"
                                className="w-16"
                                aria-label="Tempo total planejado em minutos"
                              />
                            </div>
                            {orderedStages.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span>Etapa</span>
                                <select
                                  value={eStage}
                                  onChange={(e) => setEStage(e.target.value)}
                                  className="h-8 rounded-md border border-input bg-transparent px-1 text-sm"
                                  aria-label="Etapa do item"
                                >
                                  <option value="">Sem etapa</option>
                                  {orderedStages.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                disabled={isPending}
                                onClick={() =>
                                  run(
                                    () =>
                                      editBudgetItem(it.id, {
                                        description: eDesc,
                                        quantity: Number(eQty) || 1,
                                        price: ePrice,
                                        plannedSessions: Number(ePSess) || null,
                                        plannedMinutes: Number(ePMin) || null,
                                        stageId: eStage || null,
                                      }),
                                    "Item atualizado.",
                                    () => setEditingId(null)
                                  )
                                }
                              >
                                Salvar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block">
                                {it.description}{" "}
                                <span className="text-xs text-muted-foreground">
                                  {it.quantity} × {formatBRL(it.unitPriceCents)}
                                </span>
                              </span>
                              {plannedText(it) && (
                                <span className="block text-xs text-primary">
                                  Planejado: {plannedText(it)}
                                </span>
                              )}
                              {canEdit && orderedStages.length > 0 && (
                                <select
                                  value={it.stageId ?? ""}
                                  disabled={isPending}
                                  onChange={(e) =>
                                    run(
                                      () =>
                                        setItemStage(
                                          it.id,
                                          e.target.value || null
                                        ),
                                      "Etapa do item atualizada."
                                    )
                                  }
                                  className="mt-0.5 h-6 rounded border border-input bg-transparent px-1 text-[11px] text-muted-foreground"
                                  aria-label="Etapa do item"
                                >
                                  <option value="">Sem etapa</option>
                                  {orderedStages.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {canEdit && providerOptions.length > 0 && (
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                  Profissional indicado:{" "}
                                  <select
                                    value={it.suggestedProviderId ?? ""}
                                    disabled={isPending}
                                    onChange={(e) =>
                                      run(
                                        () =>
                                          setItemProvider(
                                            it.id,
                                            e.target.value || null
                                          ),
                                        "Profissional indicado atualizado."
                                      )
                                    }
                                    className="h-6 rounded border border-input bg-transparent px-1 text-[11px]"
                                    aria-label="Profissional indicado"
                                  >
                                    <option value="">
                                      Automático (pela regra)
                                    </option>
                                    {providerOptions.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              )}
                              {(!canEdit || providerOptions.length === 0) &&
                                providerName(it.suggestedProviderId) && (
                                  <span className="mt-0.5 block text-[11px] text-primary">
                                    Profissional indicado:{" "}
                                    {providerName(it.suggestedProviderId)}
                                  </span>
                                )}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="font-medium">
                                {formatBRL(it.quantity * it.unitPriceCents)}
                              </span>
                              {canEdit && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Editar item"
                                    onClick={() => {
                                      setEditingId(it.id);
                                      setEDesc(it.description);
                                      setEPrice(centsToInput(it.unitPriceCents));
                                      setEQty(String(it.quantity));
                                      setEPSess(
                                        it.plannedSessions != null
                                          ? String(it.plannedSessions)
                                          : ""
                                      );
                                      setEPMin(
                                        it.plannedMinutes != null
                                          ? String(it.plannedMinutes)
                                          : ""
                                      );
                                      setEStage(it.stageId ?? "");
                                    }}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Remover item"
                                    disabled={isPending}
                                    onClick={() =>
                                      run(
                                        () => removeBudgetItem(it.id),
                                        "Item removido."
                                      )
                                    }
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </>
                              )}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
        </div>
      )}

      {canEdit && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={procId}
              onChange={(e) => pickProcedure(e.target.value)}
              className="h-9 max-w-[180px] rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="">Item personalizado</option>
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatBRL(p.effectivePriceCents)})
                </option>
              ))}
            </select>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Descrição"
              className="max-w-[180px]"
            />
            <Input
              value={qty}
              onChange={(e) => changeQty(e.target.value)}
              inputMode="numeric"
              className="w-14"
              aria-label="Quantidade"
            />
            <span className="text-sm text-muted-foreground">R$</span>
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="w-24"
              aria-label="Valor unitário"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Sessões</span>
            <Input
              value={pSess}
              onChange={(e) => setPSess(e.target.value)}
              inputMode="numeric"
              className="w-14"
              aria-label="Sessões planejadas"
            />
            <span>· Tempo total (min)</span>
            <Input
              value={pMin}
              onChange={(e) => setPMin(e.target.value)}
              inputMode="numeric"
              className="w-16"
              aria-label="Tempo total planejado em minutos"
            />
            {orderedStages.length > 0 && (
              <>
                <span>· Etapa</span>
                <select
                  value={nStage}
                  onChange={(e) => setNStage(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-1 text-sm"
                  aria-label="Etapa do item"
                >
                  <option value="">Sem etapa</option>
                  {orderedStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!desc.trim() || isPending}
              onClick={() =>
                run(
                  () =>
                    addBudgetItem(optionId, {
                      procedureId: procId || null,
                      description: desc,
                      quantity: Number(qty) || 1,
                      price,
                      plannedSessions: Number(pSess) || null,
                      plannedMinutes: Number(pMin) || null,
                      stageId: nStage || null,
                    }),
                  "Item adicionado.",
                  () => {
                    setProcId("");
                    setDesc("");
                    setPrice("");
                    setQty("1");
                    setPSess("");
                    setPMin("");
                    setNStage("");
                  }
                )
              }
            >
              <Plus className="mr-1 size-4" />
              Item
            </Button>
          </div>
          {procId && Number(qty) > 1 && (
            <p className="text-xs text-amber-700">
              Você colocou {Number(qty)}× este procedimento — confirme as sessões
              e o tempo total (sugestão: base × {Number(qty)}).
            </p>
          )}
          {pickedRef && (
            <div className="rounded-md bg-muted/40 p-1.5 text-xs text-muted-foreground">
              <p>
                Base sugerida — Rede:{" "}
                {pickedRef.network
                  ? `${formatSessions(pickedRef.network.count)} · ${formatMinutes(pickedRef.network.minutes)}`
                  : "—"}
                {pickedRef.unit && (
                  <span className="text-primary">
                    {" "}
                    · Unidade: {formatSessions(pickedRef.unit.count)} ·{" "}
                    {formatMinutes(pickedRef.unit.minutes)}
                  </span>
                )}
              </p>
              <p>
                Média realizada na unidade:{" "}
                {pickedReal ? (
                  <span className="text-emerald-700">
                    {formatSessions(Math.round(pickedReal.avgSessions))} ·{" "}
                    {formatMinutes(Math.round(pickedReal.avgTotalMinutes))} (
                    {pickedReal.sample}{" "}
                    {pickedReal.sample === 1 ? "tratamento" : "tratamentos"})
                  </span>
                ) : (
                  <span className="italic">sem histórico ainda</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Coordenador's Approve/Reject control for a single plan option (F4). */
function OptionReview({
  optionId,
  optionTitle,
}: {
  optionId: string;
  optionTitle: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");

  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await reviewPlanOption(optionId, approve, notes);
      if (result.ok) {
        toast.success(
          approve
            ? `Opção “${optionTitle}” aprovada.`
            : `Opção “${optionTitle}” reprovada.`
        );
        setNotes("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Considerações (obrigatórias para reprovar)"
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={isPending} onClick={() => decide(true)}>
          <ThumbsUp className="mr-1 size-4" />
          Aprovar opção
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !notes.trim()}
          onClick={() => decide(false)}
        >
          <ThumbsDown className="mr-1 size-4" />
          Reprovar opção
        </Button>
        {!notes.trim() && (
          <span className="text-xs text-muted-foreground">
            Para reprovar, escreva as considerações.
          </span>
        )}
      </div>
    </div>
  );
}
