"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Paperclip, Repeat, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { CLINICAL_BUCKET } from "@/lib/clinical";
import {
  REQUEST_KIND_LABELS,
  type ClinicalRequestItem,
  type ClinicalRequestKind,
} from "@/lib/requests";
import {
  createClinicalRequest,
  recordRequestMedia,
  resolveClinicalRequest,
} from "./requests-actions";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function guessKind(type: string): string {
  const ct = type.toLowerCase();
  if (ct.startsWith("image/")) return "photo";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
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

export function RequestsSection({
  clientId,
  clinicId,
  canCreate,
  canResolve,
  requests,
}: {
  clientId: string;
  clinicId: string;
  canCreate: boolean;
  canResolve: boolean;
  requests: ClinicalRequestItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openKind, setOpenKind] = useState<ClinicalRequestKind | null>(null);
  const [body, setBody] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const openPlanRevision = requests.some(
    (r) => r.kind === "plan_revision" && r.status === "open"
  );

  function openNew(kind: ClinicalRequestKind) {
    setBody("");
    if (fileRef.current) fileRef.current.value = "";
    setOpenKind(kind);
  }

  function submit() {
    const kind = openKind;
    if (!kind) return;
    startTransition(async () => {
      const res = await createClinicalRequest({ clientId, kind, body });
      if (!res.ok || !res.id) {
        toast.error(res.error ?? "Não foi possível registrar o pedido.");
        return;
      }
      // Anexos (opcional): envia ao Storage e registra.
      const files = Array.from(fileRef.current?.files ?? []);
      let attached = 0;
      if (files.length > 0) {
        const supabase = createBrowserClient();
        for (const file of files) {
          try {
            const safe = file.name.replace(/[^\w.\-]+/g, "_");
            const path = `${clinicId}/${clientId}/${randomId()}-${safe}`;
            const { error: upErr } = await supabase.storage
              .from(CLINICAL_BUCKET)
              .upload(path, file, { contentType: file.type || undefined });
            if (upErr) {
              toast.error(`${file.name}: ${upErr.message}`);
              continue;
            }
            const rec = await recordRequestMedia({
              requestId: res.id,
              clientId,
              clinicId,
              kind: guessKind(file.type),
              storagePath: path,
              originalName: file.name,
              contentType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            });
            if (rec.ok) attached += 1;
            else {
              toast.error(`${file.name}: ${rec.error}`);
              await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
            }
          } catch (e) {
            toast.error(
              `${file.name}: ${e instanceof Error ? e.message : "erro"}`
            );
          }
        }
      }
      toast.success(
        `Pedido enviado ao coordenador${attached > 0 ? ` (${attached} anexo(s))` : ""}.`
      );
      setOpenKind(null);
      router.refresh();
    });
  }

  function resolve(reqId: string) {
    startTransition(async () => {
      const res = await resolveClinicalRequest(reqId, clientId, resolveNote);
      if (res.ok) {
        toast.success("Pedido resolvido.");
        setResolvingId(null);
        setResolveNote("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível resolver.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Pedidos ao coordenador</CardTitle>
          {canCreate && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => openNew("reevaluation")}
              >
                <Repeat className="mr-1 size-3" /> Sugerir reavaliação
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => openNew("plan_revision")}
              >
                <Send className="mr-1 size-3" /> Pedir revisão do plano
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {openPlanRevision && (
          <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="size-4 shrink-0" />
            Há um <strong>pedido de revisão do plano em aberto</strong> aguardando
            o coordenador clínico.
          </div>
        )}

        {requests.length > 0 ? (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge
                    variant={r.kind === "plan_revision" ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {REQUEST_KIND_LABELS[r.kind]}
                  </Badge>
                  {r.status === "open" ? (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                    >
                      Em aberto
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-800"
                    >
                      Resolvido
                    </Badge>
                  )}
                  <span>
                    {r.requesterName ?? "—"} · {fmtDateTime(r.createdAt)}
                  </span>
                </div>
                {r.body && (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
                )}
                {r.media.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {r.media.map((m) =>
                      m.url ? (
                        <a
                          key={m.id}
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent"
                        >
                          <Paperclip className="size-3" />
                          {m.name}
                        </a>
                      ) : null
                    )}
                  </div>
                )}
                {r.status === "resolved" && (
                  <p className="mt-1.5 flex items-start gap-1 text-xs text-emerald-700">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                    <span>
                      Resolvido por {r.resolvedByName ?? "—"}
                      {r.resolvedAt ? ` em ${fmtDateTime(r.resolvedAt)}` : ""}
                      {r.resolutionNote ? ` — ${r.resolutionNote}` : ""}
                    </span>
                  </p>
                )}
                {canResolve && r.status === "open" && (
                  <div className="mt-2">
                    {resolvingId === r.id ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          rows={2}
                          placeholder="Resposta / observação (opcional)"
                          className="w-full rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() => resolve(r.id)}
                          >
                            Confirmar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => setResolvingId(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => {
                          setResolveNote("");
                          setResolvingId(r.id);
                        }}
                      >
                        Marcar como resolvido
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-1 text-center text-sm text-muted-foreground">
            Nenhum pedido registrado.
          </p>
        )}
      </CardContent>

      <Dialog open={openKind !== null} onOpenChange={(o) => !o && setOpenKind(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {openKind ? REQUEST_KIND_LABELS[openKind] : ""}
            </DialogTitle>
            <DialogDescription>
              {openKind === "plan_revision"
                ? "Descreva por que o plano precisa ser revisto. O coordenador é avisado e o alerta se repete até ser resolvido."
                : "Descreva o motivo da sugestão de reavaliação. O coordenador clínico é avisado."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-body">Descrição</Label>
              <textarea
                id="req-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Ex.: notei reabsorção na região; sugiro reavaliar antes de seguir."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-files">
                Anexos (foto, vídeo, áudio, radiografia) — opcional
              </Label>
              <input
                id="req-files"
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf"
                className="block w-full text-sm file:mr-2 file:rounded-md file:border file:border-input file:bg-transparent file:px-2 file:py-1 file:text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenKind(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={submit} disabled={isPending}>
              Enviar ao coordenador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
