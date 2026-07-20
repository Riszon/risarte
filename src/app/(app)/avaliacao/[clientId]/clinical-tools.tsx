"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Paperclip,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  CLINICAL_BUCKET,
  CLINICAL_MEDIA_KINDS,
  CLINICAL_MEDIA_LABELS,
  evaluationLabel,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
  type ClinicalNoteItem,
  type ConsentInfo,
  type EvaluationRound,
} from "@/lib/clinical";
import { guessKind, maybeConvertHeic, randomId } from "@/lib/clinical-upload";
import {
  addClinicalNote,
  addExternalMedia,
  editClinicalNote,
  openNewEvaluation,
  recordClinicalMedia,
  recordConsent,
} from "../../prontuarios/[id]/clinical-actions";
import { sendToPlanningCenter } from "../../jornada/actions";
import { AudioRecorder } from "../../prontuarios/[id]/audio-recorder";
import { MediaGallery } from "../../prontuarios/[id]/media-gallery";

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm";

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ---- Consentimento (LGPD) — pré-requisito da coleta ------------------------
export function ConsentGate({
  clientId,
  consent,
  canEdit,
}: {
  clientId: string;
  consent: ConsentInfo | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (consent) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
        <ShieldCheck className="size-3.5 shrink-0" />
        Consentimento registrado em {fmtDateTime(consent.grantedAt)}
        {consent.recordedByName ? ` · ${consent.recordedByName}` : ""}
      </p>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/5 p-2.5">
      <p className="text-xs text-muted-foreground">
        Registre o consentimento do paciente (LGPD) antes de coletar dados,
        fotos ou gravação.
      </p>
      {canEdit && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await recordConsent(clientId);
              if (r.ok) {
                toast.success("Consentimento registrado.");
                router.refresh();
              } else {
                toast.error(r.error ?? "Algo deu errado.");
              }
            })
          }
        >
          <ShieldCheck className="mr-1 size-4" />
          Registrar consentimento
        </Button>
      )}
    </div>
  );
}

// ---- Considerações clínicas (adicionar + listar/editar) --------------------
export function ConsiderationsBlock({
  clientId,
  notes,
  canEdit,
  evalById,
}: {
  clientId: string;
  notes: ClinicalNoteItem[];
  canEdit: boolean;
  evalById: Map<string, EvaluationRound>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  function save() {
    startTransition(async () => {
      const r = await addClinicalNote(clientId, note);
      if (r.ok) {
        toast.success("Consideração salva.");
        setNote("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const r = await editClinicalNote(id, editingBody);
      if (r.ok) {
        toast.success("Consideração atualizada.");
        setEditingId(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="space-y-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Observações da avaliação, queixa principal, relatos do cliente..."
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
          />
          <Button size="sm" variant="outline" disabled={!note.trim() || isPending} onClick={save}>
            Salvar consideração
          </Button>
        </div>
      )}

      {notes.length > 0 && (
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
                    <Button size="sm" disabled={isPending} onClick={() => saveEdit(n.id)}>
                      Salvar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
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
                  <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                    {n.evaluationId && evalById.has(n.evaluationId) && (
                      <span className="mr-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                        {evaluationLabel(evalById.get(n.evaluationId)!)}
                      </span>
                    )}
                    <span>
                      {fmtDateTime(n.createdAt)}
                      {n.authorName ? ` · ${n.authorName}` : ""}
                      {n.clinicName ? ` · ${n.clinicName}` : ""}
                    </span>
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Coleta de mídia (upload + link + galeria) -----------------------------
export function MediaCollectionBlock({
  clientId,
  clinicId,
  media,
  canEdit,
  hasConsent,
}: {
  clientId: string;
  clinicId: string;
  media: ClinicalMediaItem[];
  canEdit: boolean;
  hasConsent: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<{ file: File; kind: ClinicalMediaKind }[]>([]);
  const [linkKind, setLinkKind] = useState<ClinicalMediaKind>("scan");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setPicked((prev) => [
      ...prev,
      ...Array.from(list).map((file) => ({ file, kind: guessKind(file) })),
    ]);
  }

  function uploadAll() {
    if (picked.length === 0) return;
    startTransition(async () => {
      const supabase = createBrowserClient();
      let okCount = 0;
      for (const item of picked) {
        try {
          const conv = await maybeConvertHeic(item.file);
          const safe = conv.name.replace(/[^\w.\-]+/g, "_");
          const path = `${clinicId}/${clientId}/${randomId()}-${safe}`;
          const { error: upErr } = await supabase.storage
            .from(CLINICAL_BUCKET)
            .upload(path, conv.blob, { contentType: conv.type || undefined });
          if (upErr) {
            toast.error(`${item.file.name}: ${upErr.message}`);
            continue;
          }
          const r = await recordClinicalMedia(clientId, {
            kind: item.kind,
            storagePath: path,
            originalName: conv.name,
            contentType: conv.type || "application/octet-stream",
            sizeBytes: conv.blob.size,
          });
          if (r.ok) okCount += 1;
          else {
            toast.error(`${item.file.name}: ${r.error}`);
            await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
          }
        } catch (e) {
          toast.error(
            `${item.file.name}: ${e instanceof Error ? e.message : "erro inesperado"}`
          );
        }
      }
      if (okCount > 0) {
        toast.success(okCount === 1 ? "Arquivo enviado." : `${okCount} arquivos enviados.`);
        setPicked([]);
        router.refresh();
      }
    });
  }

  function addLink() {
    startTransition(async () => {
      const r = await addExternalMedia(clientId, {
        kind: linkKind,
        url: linkUrl,
        label: linkLabel,
      });
      if (r.ok) {
        toast.success("Link adicionado.");
        setLinkUrl("");
        setLinkLabel("");
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {canEdit && hasConsent && (
        <>
          {/* Upload de arquivos */}
          <div className="space-y-2">
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
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Paperclip className="mr-1 size-4" />
              Fotos, radiografias, exames, vídeos...
            </Button>
            {picked.length > 0 && (
              <ul className="space-y-1.5 rounded-md border p-2">
                {picked.map((item, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        setPicked((prev) =>
                          prev.map((p, i) =>
                            i === index ? { ...p, kind: e.target.value as ClinicalMediaKind } : p
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
                      onClick={() => setPicked((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {picked.length > 0 && (
              <Button size="sm" disabled={isPending} onClick={uploadAll}>
                {isPending
                  ? "Enviando..."
                  : picked.length > 1
                    ? `Enviar ${picked.length} arquivos`
                    : "Enviar arquivo"}
              </Button>
            )}
          </div>

          {/* Link externo (ex.: escaneamento) */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={linkKind}
              onChange={(e) => setLinkKind(e.target.value as ClinicalMediaKind)}
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
              placeholder="https://... (link)"
              className="max-w-xs"
            />
            <Input
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              placeholder="Descrição (opcional)"
              className="max-w-[160px]"
            />
            <Button size="sm" variant="outline" disabled={!linkUrl.trim() || isPending} onClick={addLink}>
              Adicionar link
            </Button>
          </div>
        </>
      )}

      <MediaGallery media={media} canEdit={canEdit} />
    </div>
  );
}

// ---- Gravação da consulta --------------------------------------------------
export function AudioBlock({
  clientId,
  clinicId,
  hasConsent,
}: {
  clientId: string;
  clinicId: string;
  hasConsent: boolean;
}) {
  const router = useRouter();
  if (!hasConsent) {
    return (
      <p className="text-xs text-muted-foreground">
        A gravação fica disponível após registrar o consentimento.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <AudioRecorder clientId={clientId} clinicId={clinicId} onDone={() => router.refresh()} />
      <p className="text-xs text-muted-foreground">
        Fica guardada de forma privada, junto dos demais arquivos.
      </p>
    </div>
  );
}

// ---- Rodadas: iniciar reavaliação ------------------------------------------
export function RoundsBlock({
  clientId,
  evaluations,
  canEdit,
}: {
  clientId: string;
  evaluations: EvaluationRound[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const openRound = evaluations.find((e) => e.status === "open") ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {openRound ? (
        <span className="text-sm text-muted-foreground">
          Rodada atual: <strong>{evaluationLabel(openRound)}</strong>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">Nenhuma rodada aberta ainda.</span>
      )}
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await openNewEvaluation(clientId, "reavaliacao");
              if (r.ok) {
                toast.success("Nova reavaliação iniciada.");
                router.refresh();
              } else {
                toast.error(r.error ?? "Algo deu errado.");
              }
            })
          }
        >
          <Plus className="mr-1 size-4" />
          Iniciar reavaliação
        </Button>
      )}
    </div>
  );
}

// ---- Enviar ao Centro de Planejamento --------------------------------------
export function SendToPlanningBlock({
  clientId,
  clientName,
  canSend,
  blocked,
  blockMessage,
}: {
  clientId: string;
  clientName: string;
  canSend: boolean;
  blocked: boolean;
  blockMessage: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (!canSend) {
    return (
      <p className="text-xs text-muted-foreground">
        O envio ao Centro de Planejamento é feito no momento certo do fluxo.
      </p>
    );
  }
  if (blocked) {
    return (
      <div className="space-y-1">
        <Button disabled>
          <ArrowRight className="mr-1 size-4" />
          Enviar ao Centro de Planejamento
        </Button>
        <p className="text-xs text-destructive">{blockMessage}</p>
      </div>
    );
  }
  return (
    <Button
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await sendToPlanningCenter(clientId);
          if (r.ok) {
            toast.success(`${clientName} enviado(a) ao Centro de Planejamento.`);
            router.refresh();
          } else {
            toast.error(r.error ?? "Algo deu errado.");
          }
        })
      }
    >
      <ArrowRight className="mr-1 size-4" />
      Enviar ao Centro de Planejamento
    </Button>
  );
}
