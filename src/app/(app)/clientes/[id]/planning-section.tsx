"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardList, Pencil, Plus, Send, Sparkles, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PLAN_STATUS_LABELS,
  type PlanOption,
  type TreatmentPlan,
} from "@/lib/planning";
import {
  addPlanOption,
  createTreatmentPlan,
  editPlanOption,
  removePlanOption,
  saveDiagnosis,
  submitTreatmentPlan,
} from "./planning-actions";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PlanningSection({
  clientId,
  clientName,
  plan,
  canEdit,
  inPlanningPhase,
  pillarSet,
}: {
  clientId: string;
  clientName: string;
  plan: TreatmentPlan | null;
  canEdit: boolean;
  inPlanningPhase: boolean;
  pillarSet: boolean;
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
  const canSubmit =
    canEdit &&
    plan.status !== "approved" &&
    inPlanningPhase &&
    diagnosis.trim().length > 0 &&
    options.length > 0;

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
        {plan.status === "returned" && plan.reviewNotes && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            Devolvido pelo Coordenador: {plan.reviewNotes}
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
          {canEdit ? (
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
                <li key={o.id} className="rounded-md border p-2 text-sm">
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
                          {o.isPrimary && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              (principal)
                            </span>
                          )}
                        </p>
                        {o.description && (
                          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                            {o.description}
                          </p>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
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
                </li>
              ))}
            </ul>
          )}

          {/* Adicionar opção */}
          {canEdit && (
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
        {canEdit && plan.status !== "approved" && (
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
                Para enviar, preencha o diagnóstico e adicione ao menos uma
                opção de plano.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
