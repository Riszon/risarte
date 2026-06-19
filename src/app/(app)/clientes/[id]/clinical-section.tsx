"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Paperclip,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  CLINICAL_BUCKET,
  CLINICAL_MEDIA_KINDS,
  CLINICAL_MEDIA_LABELS,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
  type ClinicalNoteItem,
  type ConsentInfo,
} from "@/lib/clinical";
import {
  addClinicalNote,
  addExternalMedia,
  editClinicalNote,
  recordClinicalMedia,
  recordConsent,
} from "./clinical-actions";
import { AudioRecorder } from "./audio-recorder";
import { MediaGallery } from "./media-gallery";
import { moveClientPhase } from "../../jornada/actions";

export type { ConsentInfo, ClinicalNoteItem, ClinicalMediaItem };

/** Crypto-safe id that also works in non-secure contexts (LAN IP, etc.). */
function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function guessKind(file: File): ClinicalMediaKind {
  const t = file.type;
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/")) return "photo";
  if (t === "application/pdf") return "exam";
  return "document";
}

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

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

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
  const [picked, setPicked] = useState<{ file: File; kind: ClinicalMediaKind }[]>(
    []
  );
  const [linkKind, setLinkKind] = useState<ClinicalMediaKind>("scan");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
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

  function saveEdit(id: string) {
    startTransition(async () => {
      const result = await editClinicalNote(id, editingBody);
      if (result.ok) {
        toast.success("Consideração atualizada.");
        setEditingId(null);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const items = Array.from(list).map((file) => ({
      file,
      kind: guessKind(file),
    }));
    setPicked((prev) => [...prev, ...items]);
  }

  function handleUploadAll() {
    if (picked.length === 0) return;
    startTransition(async () => {
      const supabase = createBrowserClient();
      let okCount = 0;
      for (const item of picked) {
        try {
          const safe = item.file.name.replace(/[^\w.\-]+/g, "_");
          const path = `${clinicId}/${clientId}/${randomId()}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from(CLINICAL_BUCKET)
            .upload(path, item.file, {
              contentType: item.file.type || undefined,
            });
          if (upErr) {
            toast.error(`${item.file.name}: ${upErr.message}`);
            continue;
          }
          const result = await recordClinicalMedia(clientId, {
            kind: item.kind,
            storagePath: path,
            originalName: item.file.name,
            contentType: item.file.type || "application/octet-stream",
            sizeBytes: item.file.size,
          });
          if (result.ok) {
            okCount += 1;
          } else {
            toast.error(`${item.file.name}: ${result.error}`);
            await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
          }
        } catch (e) {
          toast.error(
            `${item.file.name}: ${e instanceof Error ? e.message : "erro inesperado"}`
          );
        }
      }
      if (okCount > 0) {
        toast.success(
          okCount === 1 ? "Arquivo enviado." : `${okCount} arquivos enviados.`
        );
        setPicked([]);
        router.refresh();
      }
    });
  }

  function addLink() {
    startTransition(async () => {
      const result = await addExternalMedia(clientId, {
        kind: linkKind,
        url: linkUrl,
        label: linkLabel,
      });
      if (result.ok) {
        toast.success("Link adicionado.");
        setLinkUrl("");
        setLinkLabel("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

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
                run(() => recordConsent(clientId), "Consentimento registrado.")
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
            {/* Multi-file upload. */}
            <div className="space-y-2">
              <Label>Arquivos (fotos, radiografias, exames, vídeos...)</Label>
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => {
                  onPick(e.target.files);
                  e.target.value = "";
                }}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="mr-1 size-4" />
                Escolher arquivos
              </Button>
              {picked.length > 0 && (
                <ul className="space-y-1.5 rounded-md border p-2">
                  {picked.map((item, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.file.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({fmtSize(item.file.size)})
                        </span>
                      </span>
                      <select
                        value={item.kind}
                        onChange={(e) =>
                          setPicked((prev) =>
                            prev.map((p, i) =>
                              i === index
                                ? { ...p, kind: e.target.value as ClinicalMediaKind }
                                : p
                            )
                          )
                        }
                        className={selectClass}
                      >
                        {CLINICAL_MEDIA_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {CLINICAL_MEDIA_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover da lista"
                        onClick={() =>
                          setPicked((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                disabled={picked.length === 0 || isPending}
                onClick={handleUploadAll}
              >
                {isPending
                  ? "Enviando..."
                  : picked.length > 1
                    ? `Enviar ${picked.length} arquivos`
                    : "Enviar arquivo"}
              </Button>
            </div>

            {/* External link (e.g. a 3D scan link). */}
            <div className="space-y-2">
              <Label>Adicionar link (ex.: escaneamento)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={linkKind}
                  onChange={(e) =>
                    setLinkKind(e.target.value as ClinicalMediaKind)
                  }
                  className={selectClass}
                >
                  {CLINICAL_MEDIA_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CLINICAL_MEDIA_LABELS[k]}
                    </option>
                  ))}
                </select>
                <Input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="max-w-xs"
                />
                <Input
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="max-w-[180px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!linkUrl.trim() || isPending}
                  onClick={addLink}
                >
                  Adicionar link
                </Button>
              </div>
            </div>

            {/* Audio recording. */}
            <div className="space-y-2">
              <Label>Gravação da consulta</Label>
              <AudioRecorder
                clientId={clientId}
                clinicId={clinicId}
                onDone={() => router.refresh()}
              />
              <p className="text-xs text-muted-foreground">
                Permitida após o consentimento. Fica guardada de forma privada,
                junto dos demais arquivos.
              </p>
            </div>

            {/* New consideration. */}
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

        {/* Media gallery: grouped by category, photo lightbox, inline previews. */}
        <MediaGallery media={media} canEdit={canEdit} />

        {/* Considerations list (editable). */}
        {notes.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">Considerações</h3>
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md border p-2 text-sm">
                  {editingId === n.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => saveEdit(n.id)}
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
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="whitespace-pre-wrap">{n.body}</p>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Editar consideração"
                            onClick={() => {
                              setEditingId(n.id);
                              setEditingBody(n.body);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fmtDateTime(n.createdAt)}
                        {n.authorName ? ` · ${n.authorName}` : ""}
                        {n.updatedAt
                          ? ` · editado em ${fmtDateTime(n.updatedAt)}${
                              n.editedByName ? ` por ${n.editedByName}` : ""
                            }`
                          : ""}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
