"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { CLINICAL_BUCKET } from "@/lib/clinical";
import { recordClinicalMedia } from "./clinical-actions";

/** Pick a mime type the browser can actually record. */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "dat";
}

export function AudioRecorder({
  clientId,
  clinicId,
  onDone,
}: {
  clientId: string;
  clinicId: string;
  onDone: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isPending, startTransition] = useTransition();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>("audio/webm");

  function stopTracks() {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function handleStop() {
    const mime = mimeRef.current;
    const blob = new Blob(chunksRef.current, { type: mime });
    if (blob.size === 0) {
      toast.error("A gravação ficou vazia.");
      return;
    }
    startTransition(async () => {
      const supabase = createBrowserClient();
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      const name = `consulta-${stamp}.${extFor(mime)}`;
      const path = `${clinicId}/${clientId}/${crypto.randomUUID()}-${name}`;
      const { error: upErr } = await supabase.storage
        .from(CLINICAL_BUCKET)
        .upload(path, blob, { contentType: mime });
      if (upErr) {
        toast.error(`Falha ao enviar a gravação: ${upErr.message}`);
        return;
      }
      const result = await recordClinicalMedia(clientId, {
        kind: "audio",
        storagePath: path,
        originalName: name,
        contentType: mime,
        sizeBytes: blob.size,
      });
      if (result.ok) {
        toast.success("Gravação salva.");
        onDone();
      } else {
        toast.error(result.error ?? "Não foi possível registrar a gravação.");
        await supabase.storage.from(CLINICAL_BUCKET).remove([path]);
      }
    });
  }

  async function start() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      toast.error("Seu navegador não permite gravar áudio aqui.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime ?? "audio/webm";
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = handleStop;
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error(
        "Não foi possível acessar o microfone. Verifique a permissão do navegador."
      );
    }
  }

  function stop() {
    recorderRef.current?.stop();
    stopTracks();
    setRecording(false);
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {recording ? (
        <>
          <Button size="sm" variant="destructive" onClick={stop}>
            <Square className="mr-1 size-3.5" />
            Parar ({mmss})
          </Button>
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            Gravando…
          </span>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={start}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1 size-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Mic className="mr-1 size-4" />
              Gravar consulta
            </>
          )}
        </Button>
      )}
    </div>
  );
}
