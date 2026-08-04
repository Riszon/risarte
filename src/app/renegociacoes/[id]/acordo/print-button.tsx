"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-100"
    >
      Imprimir / salvar em PDF
    </button>
  );
}
