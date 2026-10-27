"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseBRLToCents } from "@/lib/pricing";
import {
  lerPercentual,
  percentualDoValor,
  percentualParaCampo,
  valorDoPercentual,
} from "@/lib/finance/repasse-percentual";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O par R$ ⇄ % do repasse (pedido do dono, 27/10/2026). Digita um, aparece o
 * outro, calculado sobre o preço padrão.
 *
 * Quem manda é o R$ (é o que fica gravado — `repasse-percentual.ts`). O campo
 * de % só guarda o que a pessoa digitou ENQUANTO ela está nele; fora dele, ele
 * mostra o percentual do valor. Assim, trocar o preço depois de digitar o %
 * mantém o R$ e mostra o novo percentual — exatamente o que vai ser gravado.
 */
export function RepasseValorOuPercentual({
  valor,
  onValor,
  precoCents,
  compacto = false,
  rotulo,
}: {
  /** O valor em R$, como texto do campo ("150,00"). */
  valor: string;
  onValor: (valor: string) => void;
  /** Preço padrão sobre o qual o % é calculado; nulo/0 = sem preço. */
  precoCents: number | null;
  /** Versão pequena, para a linha de cada nível. */
  compacto?: boolean;
  rotulo?: string;
}) {
  const [digitandoPercentual, setDigitandoPercentual] = useState<string | null>(
    null
  );
  const temPreco = precoCents != null && precoCents > 0;
  const valorCents = valor.trim() ? parseBRLToCents(valor) : null;
  const percentualDerivado =
    temPreco && valorCents != null
      ? percentualDoValor(valorCents, precoCents)
      : null;
  const campoPercentual =
    digitandoPercentual ??
    (percentualDerivado != null ? percentualParaCampo(percentualDerivado) : "");

  function aoDigitarPercentual(texto: string) {
    setDigitandoPercentual(texto);
    if (!temPreco) return;
    if (texto.trim() === "") {
      onValor("");
      return;
    }
    const p = lerPercentual(texto);
    if (p === null) return;
    const v = valorDoPercentual(p, precoCents);
    if (v !== null) onValor(centsToInput(v));
  }

  const caixa = compacto ? "h-7 text-xs" : "";
  return (
    <div className={cn("flex items-end gap-1.5", compacto && "gap-1")}>
      <label className="block min-w-0 flex-1">
        {rotulo && (
          <span className="text-[10px] text-muted-foreground">{rotulo}</span>
        )}
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">
            R$
          </span>
          <Input
            aria-label={rotulo ? `${rotulo} — valor em R$` : "Repasse em R$"}
            className={cn("pl-7 tabular-nums", caixa, compacto && "w-24")}
            inputMode="decimal"
            placeholder={compacto ? "—" : "0,00"}
            value={valor}
            onChange={(e) => onValor(e.target.value)}
          />
        </div>
      </label>
      <span className="pb-1.5 text-[11px] text-muted-foreground">=</span>
      <label className="block">
        <div className="relative">
          <Input
            aria-label={
              rotulo ? `${rotulo} — percentual do preço` : "Repasse em percentual"
            }
            className={cn(
              "pr-6 tabular-nums",
              caixa,
              compacto ? "w-[4.75rem]" : "w-24"
            )}
            inputMode="decimal"
            placeholder={temPreco ? "%" : "—"}
            disabled={!temPreco}
            title={
              temPreco
                ? "Digite o percentual do preço padrão; o valor em R$ é calculado."
                : "Defina o preço padrão para lançar em percentual."
            }
            value={temPreco ? campoPercentual : ""}
            onChange={(e) => aoDigitarPercentual(e.target.value)}
            onBlur={() => setDigitandoPercentual(null)}
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground">
            %
          </span>
        </div>
      </label>
    </div>
  );
}
