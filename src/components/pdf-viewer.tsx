"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * O VISUALIZADOR DE PDF EMBUTIDO (plano ZS0 §10, ZS4). Uso:
 *
 *   <PdfViewer url={urlAssinada} index={[{ title, firstPage }]} aside={...} />
 *
 * A URL é a assinada de 60 s que a Server Action devolve depois de conferir a
 * permissão e registrar a visualização. O desenho mora em
 * `pdf-viewer-core.tsx`, carregado só no navegador (o pdf.js não roda no
 * servidor). Sem botão de baixar — limite declarado no plano §14: isso tira
 * o botão, não o "salvar" do navegador.
 */

export type PdfViewerProps = {
  url: string;
  /** Índice do pacote: pula para a página inicial de cada documento. */
  index?: { title: string; firstPage: number }[];
  /** Painel ao lado (no celular, embaixo): a situação dos signatários. */
  aside?: ReactNode;
};

const Core = dynamic(() => import("./pdf-viewer-core"), {
  ssr: false,
  loading: () => (
    <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Preparando o visualizador…
    </p>
  ),
});

export function PdfViewer(props: PdfViewerProps) {
  return <Core {...props} />;
}
