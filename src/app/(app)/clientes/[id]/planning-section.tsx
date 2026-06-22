"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ClipboardList,
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
  budgetTotalCents,
  formatBRL,
  type BudgetItem,
  type PricedProcedure,
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

export function PlanningSection({
  clientId,
  clientName,
  plan,
  canEdit,
  canReview,
  inPlanningPhase,
  pillarSet,
  catalog,
}: {
  clientId: string;
  clientName: string;
  plan: TreatmentPlan | null;
  canEdit: boolean;
  canReview: boolean;
  inPlanningPhase: boolean;
  pillarSet: boolean;
  catalog: PricedProcedure[];
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
          <Badge
            variant={plan.status === "approved" ? "secondary" : "outline"}
            className={
              plan.status === "approved"
                ? ""
                : "border-primary text-primary"
            }
          >
            {PLAN_STATUS_LABELS[plan.status]}
          </Badge>
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

        {/* Envio para aprovação */}
        {canEditContent && (
          <div className="space-y-2 border-t pt-3">
            {!pillarSet && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="size-3.5" />
                Defina o pilar de tratamento na seção “Jornada Risarte” acima.
              </p>
            )}
            <Button
              disabled={!canSubmit || isPending}
              onClick={() =>
                run(
                  () => submitTreatmentPlan(plan.id),
                  `Plano de ${clientName} enviado para aprovação.`
                )
              }
            >
              <Send className="mr-1 size-4" />
              Enviar para aprovação do Coordenador
            </Button>
            {!canSubmit && inPlanningPhase && (
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
function OptionBudget({
  optionId,
  items,
  catalog,
  canEdit,
  summaryOnly,
}: {
  optionId: string;
  items: BudgetItem[];
  catalog: PricedProcedure[];
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eQty, setEQty] = useState("1");

  const total = budgetTotalCents(items);

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
                  <div className="flex items-center gap-1.5">
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
                    {it.description}{" "}
                    <span className="text-xs text-muted-foreground">
                      {it.quantity} × {formatBRL(it.unitPriceCents)}
                    </span>
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
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
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
            onChange={(e) => setQty(e.target.value)}
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
                  }),
                "Item adicionado.",
                () => {
                  setProcId("");
                  setDesc("");
                  setPrice("");
                  setQty("1");
                }
              )
            }
          >
            <Plus className="mr-1 size-4" />
            Item
          </Button>
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
