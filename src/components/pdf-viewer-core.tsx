"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PdfViewerProps } from "./pdf-viewer";

// O "trabalhador" do pdf.js sai do PRÓPRIO site (`public/pdfjs/`), nunca de
// CDN: o PDF do paciente não deve depender de terceiros para abrir. Tem de ser
// definido NESTE arquivo (o mesmo que usa <Document>), como pede o react-pdf.
// `pdf-worker.test.ts` confere que a cópia em `public/` é a da versão instalada.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * O VISUALIZADOR (ZS4) — só desenha. Carregado sem servidor por
 * `pdf-viewer.tsx` (o pdf.js usa APIs do navegador ao ser importado).
 * Páginas em rolagem contínua, largura que acompanha a tela (celular),
 * zoom, ir para a página e o índice que pula para o início de cada documento.
 * Não há botão de baixar: quem baixa usa a ação própria, com permissão e
 * registro.
 */
export default function PdfViewerCore({ url, index, aside }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // O arquivo inteiro de uma vez: a URL vale 60 s, e pedir pedaços depois
  // (range) falharia quando ela vencesse.
  const options = useMemo(() => ({ disableRange: true, disableStream: true, isEvalSupported: false, disableFontFace: true }), []);
  const file = useMemo(() => ({ url }), [url]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Qual página está à vista (para o "página X de N").
  useEffect(() => {
    const root = scroller.current;
    if (!root || numPages === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setPage(Number((visible.target as HTMLElement).dataset.page));
      },
      { root, threshold: [0.25, 0.5, 0.75] }
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [numPages, zoomIdx, width]);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), numPages || 1);
      pageRefs.current[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPage(target);
    },
    [numPages]
  );

  const pageWidth = Math.round(width * ZOOMS[zoomIdx]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col rounded-md border bg-muted/40">
        <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5 text-sm">
          <Button size="icon-sm" variant="ghost" aria-label="Página anterior" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums" aria-live="polite">
            {numPages ? `${page} de ${numPages}` : "—"}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Próxima página" disabled={!numPages || page >= numPages} onClick={() => goTo(page + 1)}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button size="icon-sm" variant="ghost" aria-label="Diminuir" disabled={zoomIdx === 0} onClick={() => setZoomIdx((z) => z - 1)}>
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-11 text-center tabular-nums">{Math.round(ZOOMS[zoomIdx] * 100)}%</span>
          <Button size="icon-sm" variant="ghost" aria-label="Aumentar" disabled={zoomIdx === ZOOMS.length - 1} onClick={() => setZoomIdx((z) => z + 1)}>
            <ZoomIn className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Ajustar à largura" onClick={() => setZoomIdx(2)}>
            <Maximize2 className="size-4" />
          </Button>
          {index && index.length > 0 && (
            <select
              aria-label="Ir para o documento"
              className="ml-auto max-w-[55%] truncate rounded-md border bg-background px-2 py-1 text-xs"
              value=""
              onChange={(e) => e.target.value && goTo(Number(e.target.value))}
            >
              <option value="">Ir para o documento…</option>
              {index.map((d, i) => (
                <option key={i} value={d.firstPage}>
                  {d.title} (pág. {d.firstPage})
                </option>
              ))}
            </select>
          )}
        </div>
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-auto p-3"
          onContextMenu={(e) => e.preventDefault()}
        >
          {error ? (
            <p className="py-10 text-center text-sm text-destructive">{error}</p>
          ) : (
            <Document
              file={file}
              options={options}
              onLoadSuccess={({ numPages: n }) => {
                pageRefs.current = [];
                setNumPages(n);
              }}
              onLoadError={() => setError("Não foi possível abrir o PDF. Feche e abra de novo (o link vale por pouco tempo).")}
              loading={
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Abrindo o PDF…
                </p>
              }
              className="flex flex-col items-center gap-3"
            >
              {width > 0 &&
                Array.from({ length: numPages }, (_, i) => (
                  <div
                    key={i}
                    data-page={i + 1}
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    className="shadow-sm"
                  >
                    <Page pageNumber={i + 1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                  </div>
                ))}
            </Document>
          )}
        </div>
      </div>
      {aside && <aside className="max-h-40 shrink-0 overflow-auto lg:max-h-none lg:w-72">{aside}</aside>}
    </div>
  );
}
