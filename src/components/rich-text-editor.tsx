"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";

export type RichTextEditorHandle = { getHTML: () => string };

/** Classes para renderizar o HTML gerado (listas/negrito etc.) — o reset do
 * Tailwind zera listas, então reforçamos aqui. Reutilizável para exibir e editar. */
export const RICH_TEXT_CLASS =
  "text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:underline [&_p]:my-1 [&_b]:font-semibold [&_strong]:font-semibold";

/**
 * Editor simples de texto com formatação (negrito, itálico, sublinhado, listas,
 * parágrafos), sem dependências — usa `contentEditable` + `execCommand`. O pai
 * lê o HTML via ref (`getHTML()`).
 */
export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  { initialHtml: string; placeholder?: string; rows?: number }
>(function RichTextEditor({ initialHtml, placeholder, rows = 10 }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    getHTML: () => editorRef.current?.innerHTML ?? "",
  }));

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command, false);
  }

  const btn =
    "inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={btn} onClick={() => exec("bold")} aria-label="Negrito">
          <Bold className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => exec("italic")} aria-label="Itálico">
          <Italic className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => exec("underline")} aria-label="Sublinhado">
          <Underline className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button type="button" className={btn} onClick={() => exec("insertUnorderedList")} aria-label="Lista com marcadores">
          <List className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => exec("insertOrderedList")} aria-label="Lista numerada">
          <ListOrdered className="size-4" />
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        style={{ minHeight: `${rows * 1.6}rem` }}
        className={`max-h-[55vh] overflow-y-auto rounded-lg border border-input bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring ${RICH_TEXT_CLASS}`}
      />
    </div>
  );
});
