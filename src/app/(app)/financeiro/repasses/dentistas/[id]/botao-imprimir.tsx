"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Imprimir pelo navegador (salva em PDF) — decisão V6. */
export function BotaoImprimir() {
  return (
    <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer className="mr-1 size-3.5" />
      Imprimir / salvar em PDF
    </Button>
  );
}
