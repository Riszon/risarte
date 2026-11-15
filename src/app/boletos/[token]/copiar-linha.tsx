"use client";

import { useState } from "react";

/** Copia a linha digitável do boleto (a página pública da lista, 4015). */
export function CopiarLinha({ linha }: { linha: string }) {
  const [copiou, setCopiou] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center rounded-md border px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(linha);
          setCopiou(true);
          setTimeout(() => setCopiou(false), 2000);
        } catch {
          window.prompt("Copie a linha digitável:", linha);
        }
      }}
    >
      {copiou ? "Copiada!" : "Copiar linha digitável"}
    </button>
  );
}
