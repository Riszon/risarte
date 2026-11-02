"use client";

import { Wand2 } from "lucide-react";
import { gerarCpfDeTeste } from "@/lib/cpf-de-teste";
import { isTreino } from "@/lib/environment";

/** Só no treino: preenche o campo com um CPF válido inventado. Na produção não aparece. */
export function BotaoCpfDeTeste({ onGerar }: { onGerar: (cpf: string) => void }) {
  if (!isTreino()) return null;
  return (
    <button
      type="button"
      onClick={() => onGerar(gerarCpfDeTeste())}
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline dark:text-amber-300"
    >
      <Wand2 className="size-3.5" aria-hidden />
      Gerar CPF de teste (só no treino)
    </button>
  );
}
