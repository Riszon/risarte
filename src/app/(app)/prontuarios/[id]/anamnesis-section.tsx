"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { saveAnamnesis } from "./clinical-actions";

export type AnamnesisData = {
  chiefComplaint: string | null;
  healthHistory: string | null;
  dentalHistory: string | null;
  lifestyle: string | null;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type AnamnesisRevision = {
  id: string;
  editedAt: string;
  editedByName: string | null;
};

type FieldKey = "chiefComplaint" | "healthHistory" | "dentalHistory" | "lifestyle";

const FIELDS: { key: FieldKey; label: string; placeholder: string }[] = [
  {
    key: "chiefComplaint",
    label: "Queixa principal",
    placeholder: "Motivo da consulta, o que mais incomoda o paciente...",
  },
  {
    key: "healthHistory",
    label: "Histórico de saúde",
    placeholder:
      "Doenças, alergias, medicações em uso, cirurgias, gestação, etc.",
  },
  {
    key: "dentalHistory",
    label: "Histórico odontológico",
    placeholder:
      "Tratamentos anteriores, frequência de visitas, sensibilidade, traumas...",
  },
  {
    key: "lifestyle",
    label: "Estilo de vida",
    placeholder: "Higiene, alimentação, tabagismo, bruxismo, hábitos...",
  },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AnamnesisSection({
  clientId,
  canEdit,
  hasConsent,
  anamnesis,
  history,
}: {
  clientId: string;
  canEdit: boolean;
  hasConsent: boolean;
  anamnesis: AnamnesisData | null;
  history: AnamnesisRevision[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hasData =
    Boolean(anamnesis) &&
    Boolean(
      anamnesis?.chiefComplaint ||
        anamnesis?.healthHistory ||
        anamnesis?.dentalHistory ||
        anamnesis?.lifestyle
    );
  // Coordenador sem dados começa já no formulário; com dados, em leitura.
  const [editing, setEditing] = useState(canEdit && hasConsent && !hasData);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    chiefComplaint: anamnesis?.chiefComplaint ?? "",
    healthHistory: anamnesis?.healthHistory ?? "",
    dentalHistory: anamnesis?.dentalHistory ?? "",
    lifestyle: anamnesis?.lifestyle ?? "",
  });

  function save() {
    startTransition(async () => {
      const result = await saveAnamnesis(clientId, {
        chiefComplaint: values.chiefComplaint,
        healthHistory: values.healthHistory,
        dentalHistory: values.dentalHistory,
        lifestyle: values.lifestyle,
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

  const stamp = anamnesis
    ? anamnesis.updatedAt
      ? `Atualizada em ${fmtDateTime(anamnesis.updatedAt)}${
          anamnesis.updatedByName ? ` por ${anamnesis.updatedByName}` : ""
        }`
      : `Preenchida em ${fmtDateTime(anamnesis.createdAt)}${
          anamnesis.createdByName ? ` por ${anamnesis.createdByName}` : ""
        }`
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="size-4" />
          Anamnese
        </CardTitle>
        {canEdit && hasConsent && !editing && hasData && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            Editar
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

        {editing && canEdit && hasConsent ? (
          <div className="space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`anam-${f.key}`}>{f.label}</Label>
                <textarea
                  id={`anam-${f.key}`}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  rows={3}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={save}>
                {isPending ? "Salvando..." : "Salvar anamnese"}
              </Button>
              {hasData && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    // Volta aos valores salvos e fecha o formulário.
                    setValues({
                      chiefComplaint: anamnesis?.chiefComplaint ?? "",
                      healthHistory: anamnesis?.healthHistory ?? "",
                      dentalHistory: anamnesis?.dentalHistory ?? "",
                      lifestyle: anamnesis?.lifestyle ?? "",
                    });
                    setEditing(false);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        ) : hasData ? (
          <div className="space-y-3">
            {FIELDS.map((f) => {
              const value = anamnesis?.[f.key];
              return (
                <div key={f.key}>
                  <p className="text-xs font-medium text-muted-foreground">
                    {f.label}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">
                    {value && value.trim() ? value : "—"}
                  </p>
                </div>
              );
            })}
            {stamp && (
              <p className="text-xs text-muted-foreground">{stamp}</p>
            )}
          </div>
        ) : (
          !editing && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Anamnese ainda não preenchida.
              </p>
              {canEdit && hasConsent && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Preencher anamnese
                </Button>
              )}
            </div>
          )
        )}

        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Histórico de versões ({history.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-muted-foreground">
                  Versão anterior salva em {fmtDateTime(h.editedAt)}
                  {h.editedByName ? ` por ${h.editedByName}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
