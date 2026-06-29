"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  formatAnswer,
  groupBySection,
  isAnswerAlerting,
  kindSupportsDetail,
  YES_NO_OPTIONS,
  YES_NO_UNKNOWN_OPTIONS,
  type AnamnesisQuestion,
  type AnswerValue,
  type FilledAnswer,
  type QuestionKind,
} from "@/lib/anamnesis";
import { saveAnamnesisFill, type FillAnswerInput } from "./anamnesis-actions";

export type FillTemplate = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  questions: AnamnesisQuestion[];
};

export type CurrentFill = {
  id: string;
  templateId: string | null;
  templateName: string | null;
  filledAt: string;
  filledByName: string | null;
  answers: FilledAnswer[];
};

export type FillHistoryItem = {
  id: string;
  filledAt: string;
  filledByName: string | null;
  templateName: string | null;
  noChanges: boolean;
};

const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm";

type AdhocDraft = {
  tempId: string;
  section: string;
  label: string;
  kind: QuestionKind;
  value: AnswerValue;
  addToUnit: boolean;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Entrada de uma pergunta (por tipo). Definida no módulo (regra static-components).
// ---------------------------------------------------------------------------
function QuestionField({
  q,
  value,
  detail,
  onValue,
  onDetail,
}: {
  q: AnamnesisQuestion;
  value: AnswerValue;
  detail: string;
  onValue: (v: AnswerValue) => void;
  onDetail: (d: string) => void;
}) {
  const optsForKind =
    q.kind === "yes_no"
      ? YES_NO_OPTIONS.map((o) => ({ ...o }))
      : q.kind === "yes_no_unknown"
        ? YES_NO_UNKNOWN_OPTIONS.map((o) => ({ ...o }))
        : (q.options ?? []).map((o) => ({ value: o, label: o }));

  return (
    <div className="space-y-1.5">
      <Label className="font-normal">
        {q.label}
        {q.required && <span className="text-destructive"> *</span>}
      </Label>

      {q.kind === "short_text" ? (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValue(e.target.value)}
        />
      ) : q.kind === "long_text" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onValue(e.target.value)}
          rows={3}
          className={inputClass}
        />
      ) : q.kind === "multi_choice" ? (
        <div className="flex flex-wrap gap-2">
          {optsForKind.map((o) => {
            const arr = Array.isArray(value) ? value : [];
            const checked = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm",
                  checked && "border-primary bg-primary/5"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    onValue(
                      e.target.checked
                        ? [...arr, o.value]
                        : arr.filter((v) => v !== o.value)
                    )
                  }
                  className="size-3.5 accent-primary"
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : (
        // yes_no / yes_no_unknown / single_choice → botões de escolha única
        <div className="flex flex-wrap gap-2">
          {optsForKind.map((o) => (
            <Button
              key={o.value}
              type="button"
              size="sm"
              variant={value === o.value ? "default" : "outline"}
              onClick={() => onValue(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {kindSupportsDetail(q.kind) && q.detailPrompt && value === "sim" && (
        <Input
          value={detail}
          onChange={(e) => onDetail(e.target.value)}
          placeholder={q.detailPrompt}
        />
      )}
    </div>
  );
}

export function AnamnesisFill({
  clientId,
  canEdit,
  hasConsent,
  templates,
  current,
  history,
}: {
  clientId: string;
  canEdit: boolean;
  hasConsent: boolean;
  templates: FillTemplate[];
  current: CurrentFill | null;
  history: FillHistoryItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const defaultTemplateId =
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? null;
  const [templateId, setTemplateId] = useState<string | null>(
    current?.templateId ?? defaultTemplateId
  );
  const [answers, setAnswers] = useState<
    Record<string, { value: AnswerValue; detail: string }>
  >({});
  const [adhoc, setAdhoc] = useState<AdhocDraft[]>([]);

  const template = templates.find((t) => t.id === templateId) ?? null;

  function startFill(fromCurrent: boolean) {
    if (fromCurrent && current) {
      setTemplateId(current.templateId ?? defaultTemplateId);
      const map: Record<string, { value: AnswerValue; detail: string }> = {};
      const ad: AdhocDraft[] = [];
      for (const a of current.answers) {
        if (a.questionId) {
          map[a.questionId] = { value: a.value, detail: a.detail ?? "" };
        } else {
          ad.push({
            tempId: a.id,
            section: a.section ?? "",
            label: a.label,
            kind: a.kind,
            value: a.value,
            addToUnit: false,
          });
        }
      }
      setAnswers(map);
      setAdhoc(ad);
    } else {
      setTemplateId(defaultTemplateId);
      setAnswers({});
      setAdhoc([]);
    }
    setEditing(true);
  }

  function setValue(qid: string, value: AnswerValue) {
    setAnswers((prev) => ({
      ...prev,
      [qid]: { value, detail: prev[qid]?.detail ?? "" },
    }));
  }
  function setDetail(qid: string, detail: string) {
    setAnswers((prev) => ({
      ...prev,
      [qid]: { value: prev[qid]?.value ?? null, detail },
    }));
  }

  function save() {
    if (!template) {
      toast.error("Escolha uma ficha para preencher.");
      return;
    }
    // Validação das obrigatórias.
    const missing = template.questions.find((q) => {
      if (!q.required) return false;
      const v = answers[q.id]?.value;
      return v == null || v === "" || (Array.isArray(v) && v.length === 0);
    });
    if (missing) {
      toast.error(`Responda a pergunta obrigatória: "${missing.label}".`);
      return;
    }

    const payloadAnswers: FillAnswerInput[] = template.questions.map((q) => ({
      questionId: q.id,
      section: q.section,
      label: q.label,
      kind: q.kind,
      value: answers[q.id]?.value ?? null,
      detail: answers[q.id]?.detail?.trim() || null,
      isAdhoc: false,
      sortOrder: q.sortOrder,
      alertWhen: q.alertWhen,
      alertMessage: q.alertMessage,
    }));
    adhoc.forEach((a, i) => {
      if (!a.label.trim()) return;
      payloadAnswers.push({
        questionId: null,
        section: a.section.trim() || "Perguntas adicionais",
        label: a.label.trim(),
        kind: a.kind,
        value: a.value,
        detail: null,
        isAdhoc: true,
        sortOrder: 9000 + i,
        alertWhen: null,
        alertMessage: null,
        addToUnit: a.addToUnit,
      });
    });

    startTransition(async () => {
      const result = await saveAnamnesisFill(clientId, {
        templateId: template.id,
        templateName: template.name,
        answers: payloadAnswers,
      });
      if (result.ok) {
        toast.success("Anamnese salva.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  // ---- Render --------------------------------------------------------------
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="size-4" />
          Anamnese
        </CardTitle>
        {canEdit && hasConsent && !editing && current && (
          <Button variant="outline" size="sm" onClick={() => startFill(true)}>
            <Pencil className="mr-1 size-3.5" />
            Atualizar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && !hasConsent && (
          <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            Registre o consentimento do paciente (acima) antes de preencher a
            anamnese.
          </p>
        )}

        {editing && canEdit && hasConsent && template ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Ficha de anamnese</Label>
              <select
                value={templateId ?? ""}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setAnswers({});
                  setAdhoc([]);
                }}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {groupBySection(template.questions).map((g) => (
              <div key={g.section} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.section}
                </h3>
                {g.questions.map((q) => (
                  <QuestionField
                    key={q.id}
                    q={q}
                    value={answers[q.id]?.value ?? null}
                    detail={answers[q.id]?.detail ?? ""}
                    onValue={(v) => setValue(q.id, v)}
                    onDetail={(d) => setDetail(q.id, d)}
                  />
                ))}
              </div>
            ))}

            {/* Perguntas adicionais (ad-hoc) ----------------------------- */}
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Perguntas adicionais
              </p>
              {adhoc.map((a, i) => (
                <div key={a.tempId} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={a.label}
                      onChange={(e) =>
                        setAdhoc((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Pergunta específica..."
                    />
                    <select
                      value={a.kind}
                      onChange={(e) =>
                        setAdhoc((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  kind: e.target.value as QuestionKind,
                                  value: null,
                                }
                              : x
                          )
                        )
                      }
                      className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="yes_no">Sim/Não</option>
                      <option value="short_text">Texto</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover pergunta"
                      onClick={() =>
                        setAdhoc((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {a.kind === "yes_no" ? (
                    <div className="flex gap-2">
                      {YES_NO_OPTIONS.map((o) => (
                        <Button
                          key={o.value}
                          type="button"
                          size="sm"
                          variant={a.value === o.value ? "default" : "outline"}
                          onClick={() =>
                            setAdhoc((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, value: o.value } : x
                              )
                            )
                          }
                        >
                          {o.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      value={typeof a.value === "string" ? a.value : ""}
                      onChange={(e) =>
                        setAdhoc((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Resposta..."
                    />
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={a.addToUnit}
                      onChange={(e) =>
                        setAdhoc((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, addToUnit: e.target.checked } : x
                          )
                        )
                      }
                      className="size-3.5 accent-primary"
                    />
                    Salvar esta pergunta na ficha da minha unidade (próximos
                    pacientes)
                  </label>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAdhoc((prev) => [
                    ...prev,
                    {
                      tempId: `new-${Date.now()}-${prev.length}`,
                      section: "",
                      label: "",
                      kind: "yes_no",
                      value: null,
                      addToUnit: false,
                    },
                  ])
                }
              >
                <Plus className="mr-1 size-4" />
                Adicionar pergunta
              </Button>
            </div>

            <div className="flex gap-2">
              <Button disabled={isPending} onClick={save}>
                {isPending ? "Salvando..." : "Salvar anamnese"}
              </Button>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => setEditing(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : current ? (
          <ReadView current={current} />
        ) : (
          !editing && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Anamnese ainda não preenchida.
              </p>
              {canEdit && hasConsent && templates.length > 0 && (
                <Button size="sm" onClick={() => startFill(false)}>
                  Preencher anamnese
                </Button>
              )}
              {canEdit && hasConsent && templates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma ficha de anamnese configurada. Peça ao Admin para criar
                  uma em Administração → Fichas de Anamnese.
                </p>
              )}
            </div>
          )
        )}

        {history.length > 1 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Histórico de versões ({history.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-muted-foreground">
                  {fmtDateTime(h.filledAt)}
                  {h.filledByName ? ` · ${h.filledByName}` : ""}
                  {h.templateName ? ` · ${h.templateName}` : ""}
                  {h.noChanges ? " · sem alterações" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Leitura da ficha atual (módulo).
// ---------------------------------------------------------------------------
function ReadView({ current }: { current: CurrentFill }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {current.templateName ? `Ficha: ${current.templateName} · ` : ""}
        Preenchida em {fmtDateTime(current.filledAt)}
        {current.filledByName ? ` por ${current.filledByName}` : ""}
      </p>
      {groupBySection(
        current.answers.map((a) => ({
          id: a.id,
          templateId: "",
          clinicId: null,
          section: a.section,
          label: a.label,
          kind: a.kind,
          options: null,
          detailPrompt: null,
          required: false,
          sortOrder: a.sortOrder,
          alertWhen: a.alertWhen,
          alertMessage: a.alertMessage,
        }))
      ).map((g) => (
        <div key={g.section} className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.section}
          </h3>
          <ul className="space-y-1">
            {g.questions.map((q) => {
              const a = current.answers.find((x) => x.id === q.id)!;
              const alerting = isAnswerAlerting(a.value, a.alertWhen);
              return (
                <li key={a.id} className="text-sm">
                  <span className="text-muted-foreground">{a.label}: </span>
                  <span className={cn("font-medium", alerting && "text-destructive")}>
                    {formatAnswer(a.value, a.kind)}
                    {alerting && <AlertTriangle className="ml-1 inline size-3.5" />}
                  </span>
                  {a.detail && (
                    <span className="text-muted-foreground"> — {a.detail}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
