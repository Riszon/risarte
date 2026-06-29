"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QUESTION_KINDS,
  QUESTION_KIND_LABELS,
  kindSupportsDetail,
  kindUsesOptions,
  groupBySection,
  type AnamnesisQuestion,
  type QuestionKind,
} from "@/lib/anamnesis";
import {
  addNetworkQuestion,
  createTemplate,
  deleteQuestion,
  updateQuestion,
  updateTemplate,
  type QuestionPayload,
} from "./actions";

export type ManagedTemplate = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  questions: AnamnesisQuestion[];
};

const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm";
const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

type Draft = {
  section: string;
  label: string;
  kind: QuestionKind;
  optionsText: string;
  detailPrompt: string;
  required: boolean;
  alertEnabled: boolean;
  alertMessage: string;
  alertValue: string;
  alertOptions: string[];
};

function emptyDraft(): Draft {
  return {
    section: "",
    label: "",
    kind: "yes_no",
    optionsText: "",
    detailPrompt: "",
    required: false,
    alertEnabled: false,
    alertMessage: "",
    alertValue: "sim",
    alertOptions: [],
  };
}

function questionToDraft(q: AnamnesisQuestion): Draft {
  return {
    section: q.section ?? "",
    label: q.label,
    kind: q.kind,
    optionsText: (q.options ?? []).join("\n"),
    detailPrompt: q.detailPrompt ?? "",
    required: q.required,
    alertEnabled: Boolean(q.alertWhen),
    alertMessage: q.alertMessage ?? "",
    alertValue:
      q.alertWhen && "equals" in q.alertWhen ? q.alertWhen.equals : "sim",
    alertOptions:
      q.alertWhen && "any_of" in q.alertWhen ? q.alertWhen.any_of : [],
  };
}

function draftToPayload(d: Draft): QuestionPayload {
  return {
    section: d.section,
    label: d.label,
    kind: d.kind,
    options: d.optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean),
    detailPrompt: d.detailPrompt,
    required: d.required,
    alertEnabled: d.alertEnabled,
    alertMessage: d.alertMessage,
    alertValue: d.alertValue,
    alertOptions: d.alertOptions,
  };
}

// ---------------------------------------------------------------------------
// Editor de pergunta (módulo: evita re-criar o componente a cada render).
// ---------------------------------------------------------------------------
function QuestionEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const parsedOptions = d.optionsText
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Seção</Label>
          <Input
            value={d.section}
            onChange={(e) => set({ section: e.target.value })}
            placeholder="Ex.: Saúde geral"
          />
        </div>
        <div className="space-y-1">
          <Label>Tipo de resposta</Label>
          <select
            value={d.kind}
            onChange={(e) => set({ kind: e.target.value as QuestionKind })}
            className={`${selectClass} w-full`}
          >
            {QUESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {QUESTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Pergunta</Label>
        <textarea
          value={d.label}
          onChange={(e) => set({ label: e.target.value })}
          rows={2}
          className={inputClass}
          placeholder="Texto da pergunta..."
        />
      </div>

      {kindUsesOptions(d.kind) && (
        <div className="space-y-1">
          <Label>Opções (uma por linha)</Label>
          <textarea
            value={d.optionsText}
            onChange={(e) => set({ optionsText: e.target.value })}
            rows={4}
            className={inputClass}
            placeholder={"Opção 1\nOpção 2\nOpção 3"}
          />
        </div>
      )}

      {kindSupportsDetail(d.kind) && (
        <div className="space-y-1">
          <Label>Campo de detalhe ao responder “Sim” (opcional)</Label>
          <Input
            value={d.detailPrompt}
            onChange={(e) => set({ detailPrompt: e.target.value })}
            placeholder="Ex.: Qual? Explique."
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={d.required}
          onChange={(e) => set({ required: e.target.checked })}
          className="size-4 accent-primary"
        />
        Resposta obrigatória
      </label>

      {d.kind !== "short_text" && d.kind !== "long_text" && (
        <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50/40 p-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={d.alertEnabled}
              onChange={(e) => set({ alertEnabled: e.target.checked })}
              className="size-4 accent-primary"
            />
            <AlertTriangle className="size-4 text-amber-600" />
            Gerar alerta no prontuário
          </label>
          {d.alertEnabled && (
            <div className="space-y-2 pl-6">
              {d.kind === "multi_choice" ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Alertar quando marcar qualquer uma destas opções:
                  </p>
                  {parsedOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Liste as opções acima primeiro.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {parsedOptions.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={d.alertOptions.includes(opt)}
                            onChange={(e) =>
                              set({
                                alertOptions: e.target.checked
                                  ? [...d.alertOptions, opt]
                                  : d.alertOptions.filter((o) => o !== opt),
                              })
                            }
                            className="size-3.5 accent-primary"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : d.kind === "single_choice" ? (
                <div className="space-y-1">
                  <Label>Alertar quando a resposta for:</Label>
                  <select
                    value={d.alertValue}
                    onChange={(e) => set({ alertValue: e.target.value })}
                    className={`${selectClass} w-full`}
                  >
                    <option value="">Selecione...</option>
                    {parsedOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Alerta quando a resposta for <strong>Sim</strong>.
                </p>
              )}
              <div className="space-y-1">
                <Label>Mensagem do alerta</Label>
                <Input
                  value={d.alertMessage}
                  onChange={(e) => set({ alertMessage: e.target.value })}
                  placeholder="Ex.: Paciente gestante."
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onSave(d)}>
          {busy ? "Salvando..." : "Salvar pergunta"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function TemplateManager({
  templates,
}: {
  templates: ManagedTemplate[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(
    templates[0]?.id ?? null
  );
  const [newTemplate, setNewTemplate] = useState<{
    open: boolean;
    name: string;
    description: string;
  }>({ open: false, name: "", description: "" });
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  // null = nenhum; "new" = nova pergunta; outro = id da pergunta em edição.
  const [questionEditor, setQuestionEditor] = useState<string | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(msg);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function saveNewTemplate() {
    run(
      () => createTemplate(newTemplate.name, newTemplate.description),
      "Ficha criada."
    );
    setNewTemplate({ open: false, name: "", description: "" });
  }

  function saveQuestion(d: Draft, questionId: string | null) {
    const payload = draftToPayload(d);
    const action = questionId
      ? () => updateQuestion(questionId, payload)
      : () => addNetworkQuestion(selected!.id, payload);
    run(action, questionId ? "Pergunta atualizada." : "Pergunta adicionada.");
    setQuestionEditor(null);
  }

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      {/* Lista de fichas ------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Fichas</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setNewTemplate((s) => ({ ...s, open: !s.open }))
            }
          >
            <Plus className="mr-1 size-3.5" />
            Nova
          </Button>
        </div>
        {newTemplate.open && (
          <div className="space-y-2 rounded-md border p-2">
            <Input
              value={newTemplate.name}
              onChange={(e) =>
                setNewTemplate((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="Nome da ficha (ex.: Cirúrgica)"
            />
            <Input
              value={newTemplate.description}
              onChange={(e) =>
                setNewTemplate((s) => ({ ...s, description: e.target.value }))
              }
              placeholder="Descrição (opcional)"
            />
            <Button size="sm" disabled={isPending} onClick={saveNewTemplate}>
              Criar ficha
            </Button>
          </div>
        )}
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  setSelectedId(t.id);
                  setQuestionEditor(null);
                  setEditingMeta(false);
                }}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                  t.id === selectedId ? "border-primary bg-primary/5" : ""
                }`}
              >
                <span className="truncate">
                  {t.name}
                  {t.isDefault && (
                    <span className="ml-1 text-xs text-gold">★</span>
                  )}
                </span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {t.questions.length}
                  {!t.isActive && " · inativa"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Ficha selecionada ---------------------------------------------- */}
      {selected ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{selected.name}</CardTitle>
              {selected.description && (
                <p className="text-sm text-muted-foreground">
                  {selected.description}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingMeta((v) => !v);
                setMetaName(selected.name);
                setMetaDesc(selected.description ?? "");
              }}
            >
              <Pencil className="mr-1 size-3.5" />
              Editar ficha
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingMeta && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="space-y-1">
                  <Label>Nome</Label>
                  <Input
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Descrição</Label>
                  <Input
                    value={metaDesc}
                    onChange={(e) => setMetaDesc(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      run(
                        () =>
                          updateTemplate(selected.id, {
                            name: metaName,
                            description: metaDesc,
                            isActive: selected.isActive,
                          }),
                        "Ficha salva."
                      );
                      setEditingMeta(false);
                    }}
                  >
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () =>
                          updateTemplate(selected.id, {
                            name: selected.name,
                            description: selected.description ?? "",
                            isActive: !selected.isActive,
                          }),
                        selected.isActive ? "Ficha desativada." : "Ficha ativada."
                      )
                    }
                  >
                    {selected.isActive ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </div>
            )}

            {groupBySection(selected.questions).map((group) => (
              <div key={group.section} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.section}
                </h3>
                <ul className="space-y-2">
                  {group.questions.map((q) =>
                    questionEditor === q.id ? (
                      <li key={q.id}>
                        <QuestionEditor
                          initial={questionToDraft(q)}
                          busy={isPending}
                          onSave={(d) => saveQuestion(d, q.id)}
                          onCancel={() => setQuestionEditor(null)}
                        />
                      </li>
                    ) : (
                      <li
                        key={q.id}
                        className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{q.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {QUESTION_KIND_LABELS[q.kind]}
                            {q.required && " · obrigatória"}
                            {q.alertWhen && " · ⚠ alerta"}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Editar pergunta"
                            onClick={() => setQuestionEditor(q.id)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remover pergunta"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => deleteQuestion(q.id),
                                "Pergunta removida."
                              )
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}

            {selected.questions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Esta ficha ainda não tem perguntas.
              </p>
            )}

            {questionEditor === "new" ? (
              <QuestionEditor
                initial={emptyDraft()}
                busy={isPending}
                onSave={(d) => saveQuestion(d, null)}
                onCancel={() => setQuestionEditor(null)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuestionEditor("new")}
              >
                <Plus className="mr-1 size-4" />
                Adicionar pergunta
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Crie a primeira ficha de anamnese.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
