"use client";

/**
 * 4020a (cuidado 1): acima deste valor, o estorno de cartão (parcial ou total) só
 * vai ao Asaas com a confirmação do Gerente ou do franqueado — nunca de quem pediu.
 * Em branco = todo estorno de cartão precisa da confirmação.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salvarLimiteDoEstornoDeCartao } from "@/app/(app)/central/split-actions";

export function LimiteDoEstornoDeCartao({ inicialCentavos, podeEditar }: { inicialCentavos: number | null; podeEditar: boolean }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [valor, setValor] = useState(inicialCentavos == null ? "" : (inicialCentavos / 100).toFixed(2).replace(".", ","));
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">Estorno de cartão: acima de quanto o Gerente ou o franqueado confirma (R$)</span>
      <div className="flex gap-2">
        <Input className="max-w-40" value={valor} placeholder="em branco" inputMode="decimal" disabled={!podeEditar || pendente} onChange={(e) => setValor(e.target.value)} />
        {podeEditar && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() =>
              start(async () => {
                const t = valor.trim().replace(/\./g, "").replace(",", ".");
                const n = t ? Number(t) : null;
                if (n != null && (!Number.isFinite(n) || n < 0)) return void toast.error("Use vírgula para os centavos.");
                const r = await salvarLimiteDoEstornoDeCartao(n == null ? null : Math.round(n * 100));
                if (!r.ok) return void toast.error(r.error ?? "Não foi possível gravar.");
                toast.success("Gravado.");
                router.refresh();
              })
            }
          >
            Gravar
          </Button>
        )}
      </div>
      <span className="block text-xs text-muted-foreground">
        No cartão, o estorno sai na hora e não pode ser desfeito. Acima deste valor, quem pede não confirma sozinho. Em branco
        = todo estorno de cartão precisa da confirmação.
      </span>
    </label>
  );
}
