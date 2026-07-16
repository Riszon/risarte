import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// A logo/símbolo vêm em PNG BRANCO (fundo transparente). Usamos o desenho como
// MÁSCARA e pintamos com a cor atual (bg-current ← text-*), então a mesma arte
// aparece em branco (fundo navy), navy ou dourado (fundo claro) sem novo arquivo.
function maskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

/** Símbolo da Risarte (o losango). Defina a altura e a cor via `text-*`. */
export function RisarteMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Risarte"
      className={cn("inline-block aspect-[728/917] bg-current", className)}
      style={maskStyle("/risarte-simbolo-branco.png")}
    />
  );
}

/** Logomarca completa (símbolo + "Risarte Odontologia"). Altura + cor via `text-*`. */
export function RisarteWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Risarte Odontologia"
      className={cn("inline-block aspect-[1465/548] bg-current", className)}
      style={maskStyle("/risarte-logo-branca.png")}
    />
  );
}
