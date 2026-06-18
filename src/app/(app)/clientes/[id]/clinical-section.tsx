"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  CLINICAL_BUCKET,
  CLINICAL_MEDIA_KINDS,
  CLINICAL_MEDIA_LABELS,
  type ClinicalMediaKind,
} from "@/lib/clinical";
import {
  addClinicalNote,
  deleteClinicalMedia,
  recordClinicalMedia,
  recordConsent,
} from "./clinical-actions";
import { moveClientPhase } from "../../jornada/actions";

export type ConsentInfo = { grantedAt: string; recordedByName: string | null };
export type ClinicalNoteItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
};
export type ClinicalMediaItem = {
  id: string;
  kind: ClinicalMediaKind;
  originalName: string | null;
  url: string | null;
  createdAt: string;
  uploaderName: string | null;
  sizeBytes: number | null;
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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClinicalSection({
  clientId,
  clientName,
  clinicId,
  canEdit,
  consent,
  notes,
  media,
  canSendToPlanning,
}: {
  clientId: string;
  clientName: string;
  clinicId: string;
  canEdit: boolean;
  consent: ConsentInfo | null;
  notes: ClinicalNoteItem[];
  media: ClinicalMediaItem[];
  canSendToPlanning: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<ClinicalMediaKind>("photo");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    msg: string
  ) {
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

  function saveNote() {
    startTransition(async () => {
      const result = await addClinicalNote(clientId, note);
      if (result.ok) {
        toast.success("Consideração salva.");
        setNote("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function handleUpload() {
    if (!file) return;
    startTransition(async () => {
      const supabase = createBrowserClient();
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${clinicId}/${clientId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from(CLINICAL_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        toast.error(`Falha no envio do arquivo: ${upErr.message}`);
        return;
      }
      const result = await recordClinicalMedia(clientId, {
        kind,
        storagePath: path,
        originalName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (result.ok) {
        toast.success("Arquivo enviado.");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        toast.error(result.error ?? "Não foi possível registrar o arquivo.");
        // Remove the orphan object if the metadata insert failed.
        await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
      }
    });
  }

  const selectClass =
    "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Avaliação clínica</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Consent gate (LGPD). */}
        {consent ? (
          <p className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">
            <ShieldCheck className="size-4 shrink-0" />
            Consentimento registrado em {fmtDateTime(consent.grantedAt)}
            {consent.recordedByName ? ` por ${consent.recordedByName}` : ""}.
          </p>
        ) : canEdit ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              Registre o consentimento do paciente (TCLE + termo LGPD) antes de
              coletar fotos, exames ou considerações.
            </p>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                run(
                  () => recordConsent(clientId),
                  "Consentimento registrado."
                )
              }
            >
              Registrar consentimento do paciente
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Consentimento ainda não registrado.
          </p>
        )}

        {/* Data collection (only after consent, only for the coordinator). */}
        {canEdit && consent && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Adicionar arquivo (foto, radiografia, exame...)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ClinicalMediaKind)}
                  className={selectClass}
                >
                  {CLINICAL_MEDIA_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CLINICAL_MEDIA_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
                <Button
                  size="sm"
                  disabled={!file || isPending}
                  onClick={handleUpload}
                >
                  {isPending ? "Enviando..." : "Enviar arquivo"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clinical-note">Considerações clínicas</Label>
              <textarea
                id="clinical-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Observações da avaliação..."
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!note.trim() || isPending}
                onClick={saveNote}
              >
                Salvar consideração
              </Button>
            </div>

            {canSendToPlanning && (
              <Button
                disabled={isPending}
                onClick={() =>
                  run(
                    () => moveClientPhase(clientId, "planning_center"),
                    `${clientName} enviado(a) ao Centro de Planejamento.`
                  )
                }
              >
                <ArrowRight className="mr-1 size-4" />
                Enviar ao Centro de Planejamento
              </Button>
            )}
          </div>
        )}

        {/* Media list (visible to viewers too). */}
        {media.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">Arquivos</h3>
            <ul className="space-y-1.5">
              {media.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {CLINICAL_MEDIA_LABELS[m.kind]}
                      </Badge>
                      {m.url ? (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate font-medium hover:underline"
                        >
                          <Download className="size-3.5 shrink-0" />
                          {m.originalName ?? "arquivo"}
                        </a>
                      ) : (
                        <span className="truncate">
                          {m.originalName ?? "arquivo"}
                        </span>
                      )}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {fmtDateTime(m.createdAt)}
                      {m.uploaderName ? ` · ${m.uploaderName}` : ""}
                      {m.sizeBytes ? ` · ${fmtSize(m.sizeBytes)}` : ""}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover arquivo"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => deleteClinicalMedia(m.id),
                          "Arquivo removido."
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Considerations list. */}
        {notes.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">Considerações</h3>
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border p-2 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(n.createdAt)}
                    {n.authorName ? ` · ${n.authorName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
