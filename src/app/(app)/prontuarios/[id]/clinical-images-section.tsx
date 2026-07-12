"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, RotateCcw } from "lucide-react";
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
import { CLINICAL_BUCKET, type ClinicalMediaKind } from "@/lib/clinical";
import { recordCameraCapture } from "./clinical-actions";

export type ClinicalImageItem = {
  id: string;
  url: string | null;
  kind: string;
  name: string;
};

const CAPTURE_KINDS: { value: ClinicalMediaKind; label: string }[] = [
  { value: "photo", label: "Foto" },
  { value: "radiograph", label: "Radiografia" },
  { value: "scan", label: "Escaneamento" },
];

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function ClinicalImagesSection({
  clientId,
  clinicId,
  canCapture,
  hasConsent,
  showGallery,
  images,
}: {
  clientId: string;
  clinicId: string;
  canCapture: boolean;
  hasConsent: boolean;
  showGallery: boolean;
  images: ClinicalImageItem[];
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [captured, setCaptured] = useState<{ blob: Blob; url: string } | null>(
    null
  );
  const [kind, setKind] = useState<ClinicalMediaKind>("photo");
  const [error, setError] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startStream(id?: string) {
    setError(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput"
      );
      setDevices(devs);
      if (!id && devs[0]) setDeviceId(devs[0].deviceId);
    } catch {
      setError(
        "Não foi possível acessar a câmera. Verifique as permissões do navegador e se há uma câmera conectada."
      );
    }
  }

  function clearCaptured() {
    setCaptured((c) => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
  }

  async function openDialog() {
    clearCaptured();
    setKind("photo");
    setOpen(true);
    await startStream();
  }

  function closeDialog() {
    stopStream();
    clearCaptured();
    setOpen(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) setCaptured({ blob, url: URL.createObjectURL(blob) });
      },
      "image/jpeg",
      0.9
    );
  }

  function save() {
    if (!captured) return;
    startSaving(async () => {
      const supabase = createBrowserClient();
      const path = `${clinicId}/${clientId}/${randomId()}-captura.jpg`;
      const { error: upErr } = await supabase.storage
        .from(CLINICAL_BUCKET)
        .upload(path, captured.blob, { contentType: "image/jpeg" });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const res = await recordCameraCapture(clientId, {
        kind,
        storagePath: path,
        originalName: "Captura da câmera.jpg",
        contentType: "image/jpeg",
        sizeBytes: captured.blob.size,
      });
      if (res.ok) {
        toast.success("Imagem salva no prontuário.");
        closeDialog();
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível salvar a imagem.");
        await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
      }
    });
  }

  useEffect(() => () => stopStream(), []);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Imagens do prontuário</CardTitle>
          {canCapture && (
            <Button
              size="sm"
              onClick={openDialog}
              disabled={!hasConsent || saving}
            >
              <Camera className="mr-1 size-4" /> Capturar da câmera
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {canCapture && !hasConsent && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Registre o consentimento do paciente (aba Clínico) antes de capturar
            imagens.
          </p>
        )}

        {showGallery ? (
          images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((m) =>
                m.url ? (
                  <a
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-md border"
                    title={m.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.url}
                      alt={m.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </a>
                ) : null
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma imagem no prontuário ainda.
            </p>
          )
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Capturar da câmera</DialogTitle>
            <DialogDescription>
              Escolha a câmera, enquadre e tire a foto. A imagem é salva no
              prontuário do paciente.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : (
            <div className="space-y-3">
              {devices.length > 1 && !captured && (
                <div className="space-y-1.5">
                  <Label htmlFor="cam-device">Câmera</Label>
                  <select
                    id="cam-device"
                    value={deviceId}
                    onChange={(e) => {
                      setDeviceId(e.target.value);
                      void startStream(e.target.value);
                    }}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {devices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Câmera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="overflow-hidden rounded-md border bg-black">
                {captured ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={captured.url}
                    alt="Foto capturada"
                    className="mx-auto max-h-72 w-auto"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="mx-auto max-h-72 w-auto"
                  />
                )}
              </div>

              {!captured && (
                <div className="space-y-1.5">
                  <Label htmlFor="cam-kind">Tipo</Label>
                  <select
                    id="cam-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as ClinicalMediaKind)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {CAPTURE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {captured ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    clearCaptured();
                    void startStream(deviceId || undefined);
                  }}
                  disabled={saving}
                >
                  <RotateCcw className="mr-1 size-4" /> Tirar outra
                </Button>
                <Button onClick={save} disabled={saving}>
                  Salvar no prontuário
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog} disabled={saving}>
                  Cancelar
                </Button>
                <Button onClick={takePhoto} disabled={!!error || saving}>
                  <Camera className="mr-1 size-4" /> Tirar foto
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
