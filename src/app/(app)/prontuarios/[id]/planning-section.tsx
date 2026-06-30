"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ClipboardList,
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
} from "@/lib/pricing";
import {
  addBudgetItem,
  addPlanOption,
  createTreatmentPlan,
  editBudgetItem,
  editPlanOption,
  removeBudgetItem,
  removePlanOption,
  reopenTreatmentPlan,
  reviewPlanOption,
  saveDiagnosis,
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
  currentPillar,
  cockpitHref,
}: {
  clientId: string;
  clientName: string;
  plan: TreatmentPlan | null;
  canEdit: boolean;
  canReview: boolean;
  inPlanningPhase: boolean;
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  currentPillar: MethodologyPillar | null;
  /** (Ficha) link para abrir o cockpit do Planner; ausente no próprio cockpit. */
  cockpitHref?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [diagnosis, setDiagnosis] = useState(plan?.diagnosis ?? "");
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
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

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
  const canReopen =
    canEdit && (plan.status === "submitted" || plan.status === "approved");
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

  // Confirma o pilar (sugerido ou escolhido) e envia o plano para aprovação.
  function confirmSubmitPlan() {
    startTransition(async () => {
      if (pillarChoice && pillarChoice !== currentTreatment) {
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
        setConfirmingSubmit(false);
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
                    catalog={catalog}
                    protocols={protocols}
                    canEdit={canEditContent}
                    summaryOnly={!canSeePrices}
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

            {confirmingSubmit ? (
              <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <p className="text-sm">
                  Confirme o <strong>pilar</strong> deste tratamento antes de
                  enviar.
                  {suggestedPillar && (
                    <>
                      {" "}
                      Sugerido pelo sistema:{" "}
                      <strong>{PILLAR_LABELS[suggestedPillar]}</strong>.
                    </>
                  )}{" "}
                  A decisão final é sua.
                </p>
                <select
                  value={pillarChoice}
                  onChange={(e) =>
                    setPillarChoice(e.target.value as TreatmentPillar | "")
                  }
                  className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Selecione o pilar...</option>
                  {TREATMENT_PILLARS.map((p) => (
                    <option key={p} value={p}>
                      {PILLAR_LABELS[p]}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button
                    disabled={!pillarChoice || isPending}
                    onClick={confirmSubmitPlan}
                  >
                    <Send className="mr-1 size-4" />
                    Confirmar pilar e enviar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingSubmit(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={!canSubmit || isPending}
                onClick={() => {
                  setPillarChoice(
                    (currentTreatment || suggestedPillar || "") as
                      | TreatmentPillar
                      | ""
                  );
                  setConfirmingSubmit(true);
                }}
              >
                <Send className="mr-1 size-4" />
                Enviar para aprovação do Coordenador
              </Button>
            )}
            {!canSubmit && inPlanningPhase && !confirmingSubmit && (
              <p className="text-xs text-muted-foreground">
                Para enviar: preencha o diagnóstico, tenha ao menos uma opção e
                lance os <strong>procedimentos</strong> (itens do orçamento) em{" "}
                <strong>cada opção</strong>.
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

function OptionBudget({
  optionId,
  items,
  catalog,
  protocols,
  canEdit,
  summaryOnly,
}: {
  optionId: string;
  items: BudgetItem[];
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  canEdit: boolean;
  /** Coordenador view: show only the option TOTAL, not per-item prices (F4). */
  summaryOnly: boolean;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eQty, setEQty] = useState("1");
  const [ePSess, setEPSess] = useState("");
  const [ePMin, setEPMin] = useState("");

  const total = budgetTotalCents(items);
  const pickedRef = procId ? protocols[procId] : undefined;

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
        {items.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {items.map((it) => (
              <li key={it.id}>
                {it.quantity}× {it.description}
                {plannedText(it) && (
                  <span className="text-xs"> — {plannedText(it)}</span>
                )}
              </li>
            ))}
          </ul>
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

      {items.length > 0 && (
        <ul className="mt-1 space-y-1">
          {items.map((it) => (
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
                    <span className="text-xs text-muted-foreground">×</span>
                    <span className="text-sm text-muted-foreground">R$</span>
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
                    }),
                  "Item adicionado.",
                  () => {
                    setProcId("");
                    setDesc("");
                    setPrice("");
                    setQty("1");
                    setPSess("");
                    setPMin("");
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
                Média realizada (unidade / dentista):{" "}
                <span className="italic">sem histórico ainda</span> — será
                preenchida com as execuções.
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
