"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ImageOff,
  Link2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  mediaPreviewType,
  type ClinicalMediaItem,
  type ClinicalMediaKind,
} from "@/lib/clinical";
import { deleteClinicalMedia } from "./clinical-actions";

const CATEGORY_ORDER: ClinicalMediaKind[] = [
  "photo",
  "video",
  "audio",
  "radiograph",
  "exam",
  "document",
  "scan",
];

const CATEGORY_HEADINGS: Record<ClinicalMediaKind, string> = {
  photo: "Fotos",
  video: "Vídeos",
  audio: "Áudios",
  radiograph: "Radiografias",
  exam: "Exames",
  document: "Documentos",
  scan: "Escaneamento",
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

function metaLine(m: ClinicalMediaItem): string {
  return [
    fmtDateTime(m.createdAt),
    m.uploaderName ?? null,
    m.sizeBytes ? fmtSize(m.sizeBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: ClinicalMediaItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const touchX = useRef<number | null>(null);
  // Track which image src failed to load; derived per-index (no effect needed —
  // when the index changes, m.url changes and `failed` recomputes to false).
  const [erredSrc, setErredSrc] = useState<string | null>(null);
  const m = items[index];
  const failed = erredSrc !== null && erredSrc === (m?.url ?? "");

  const prev = () => onIndex((index - 1 + items.length) % items.length);
  const next = () => onIndex((index + 1) % items.length);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  if (!m) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
        if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
        touchX.current = null;
      }}
    >
      <button
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Fechar"
      >
        <X className="size-5" />
      </button>
      {items.length > 1 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="Anterior"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}
      {failed ? (
        <div
          className="flex flex-col items-center gap-2 rounded-md bg-white/10 p-6 text-center text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <ImageOff className="size-8" />
          <p className="text-sm">
            Não foi possível exibir esta imagem no navegador
            <br />
            (formato não suportado, ex.: HEIC do iPhone).
          </p>
          {m.url && (
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              Abrir / baixar o arquivo
            </a>
          )}
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={m.url ?? ""}
          alt={m.originalName ?? "imagem"}
          className="max-h-[80vh] max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
          onError={() => setErredSrc(m.url ?? "")}
        />
      )}
      {items.length > 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="Próxima"
        >
          <ChevronRight className="size-6" />
        </button>
      )}
      <div
        className="mt-3 max-w-full text-center text-xs text-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        {m.originalName ?? "imagem"} · {metaLine(m)} · {index + 1}/{items.length}
      </div>
    </div>
  );
}

export function MediaGallery({
  media,
  canEdit,
}: {
  media: ClinicalMediaItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<{
    items: ClinicalMediaItem[];
    index: number;
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());

  if (media.length === 0) return null;

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteClinicalMedia(id);
      if (result.ok) {
        toast.success("Arquivo removido.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const byKind = new Map<ClinicalMediaKind, ClinicalMediaItem[]>();
  for (const m of media) {
    const list = byKind.get(m.kind) ?? [];
    list.push(m);
    byKind.set(m.kind, list);
  }

  function DeleteButton({ id }: { id: string }) {
    if (!canEdit) return null;
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Remover arquivo"
        disabled={isPending}
        onClick={() => remove(id)}
      >
        <Trash2 className="size-4" />
      </Button>
    );
  }

  function Row({ m }: { m: ClinicalMediaItem }) {
    const pv = mediaPreviewType(m);
    return (
      <li className="rounded-md border p-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {m.externalUrl ? (
              <a
                href={m.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 truncate font-medium hover:underline"
              >
                <Link2 className="size-3.5 shrink-0" />
                {m.originalName ?? m.externalUrl}
              </a>
            ) : (
              <span className="font-medium">{m.originalName ?? "arquivo"}</span>
            )}
            <p className="text-xs text-muted-foreground">{metaLine(m)}</p>
          </div>
          <div className="flex shrink-0 items-center">
            {m.url && pv === "pdf" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => toggle(m.id)}
              >
                <Eye className="mr-1 size-3.5" />
                {expanded.has(m.id) ? "Ocultar" : "Visualizar"}
              </Button>
            )}
            {m.url && (
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                aria-label="Abrir/baixar"
              >
                <Download className="size-4" />
              </a>
            )}
            <DeleteButton id={m.id} />
          </div>
        </div>
        {m.url && pv === "video" && (
          <video
            controls
            preload="none"
            src={m.url}
            className="mt-1 max-h-56 w-full max-w-sm rounded border"
          />
        )}
        {m.url && pv === "audio" && (
          <audio
            controls
            preload="none"
            src={m.url}
            className="mt-1 h-8 w-full max-w-xs"
          />
        )}
        {m.url && pv === "pdf" && expanded.has(m.id) && (
          <iframe
            src={m.url}
            title={m.originalName ?? "documento"}
            className="mt-1 h-96 w-full rounded border"
          />
        )}
      </li>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Arquivos</h3>
      {CATEGORY_ORDER.map((kind) => {
        const items = byKind.get(kind);
        if (!items || items.length === 0) return null;
        const images = items.filter(
          (m) => m.url && mediaPreviewType(m) === "image"
        );
        const rest = items.filter(
          (m) => !(m.url && mediaPreviewType(m) === "image")
        );
        return (
          <div key={kind} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {CATEGORY_HEADINGS[kind]} ({items.length})
            </p>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((m, i) =>
                  failed.has(m.id) ? (
                    <a
                      key={m.id}
                      href={m.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${m.originalName ?? "imagem"} · ${metaLine(m)}`}
                      className="flex size-20 flex-col items-center justify-center gap-1 rounded border bg-muted/40 p-1 text-center text-[9px] text-muted-foreground"
                    >
                      <ImageOff className="size-5" />
                      <span className="line-clamp-2 break-all">
                        {m.originalName ?? "abrir"}
                      </span>
                    </a>
                  ) : (
                    <button
                      key={m.id}
                      type="button"
                      title={`${m.originalName ?? "imagem"} · ${metaLine(m)}`}
                      onClick={() => setLightbox({ items: images, index: i })}
                      className="group relative"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.url ?? ""}
                        alt={m.originalName ?? "imagem"}
                        className="size-20 rounded border object-cover transition group-hover:opacity-90"
                        onError={() =>
                          setFailed((prev) => new Set(prev).add(m.id))
                        }
                      />
                    </button>
                  )
                )}
              </div>
            )}
            {rest.length > 0 && (
              <ul className="space-y-1.5">
                {rest.map((m) => (
                  <Row key={m.id} m={m} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) =>
            setLightbox((lb) => (lb ? { ...lb, index: i } : lb))
          }
        />
      )}
    </div>
  );
}
