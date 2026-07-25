"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { removePprTier, savePprTier } from "../actions";

export type PprTierRow = {
  id: string;
  up_to_installments: number;
  discount_percent: number;
};

/**
 * Tabela de desconto por parcelamento (decisão 3 do dono): o sistema aplica
 * sozinho a faixa correspondente ao número de parcelas escolhido.
 */
export function PprTiersEditor({
  planId,
  tiers,
}: {
  planId: string;
  tiers: PprTierRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function save(form: FormData) {
    startTransition(async () => {
      const r = await savePprTier(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Faixa salva.");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await removePprTier(id, planId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível remover.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">
          Desconto por parcelamento
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Quanto de desconto o beneficiário ganha conforme parcela o tratamento.
          Vale a <strong>menor faixa que comporta</strong> o número de parcelas —
          ex.: 8× cai na faixa &quot;até 12×&quot;.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {tiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem faixas — este plano não dá desconto no parcelado.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tiers.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                <span>
                  Até <strong>{t.up_to_installments}×</strong> ={" "}
                  <strong>{t.discount_percent}%</strong> de desconto
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => remove(t.id)}
                  title="Remover faixa"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form action={save} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="planId" value={planId} />
          <label className="text-xs">
            <span className="text-muted-foreground">Até quantas parcelas</span>
            <Input name="upTo" type="number" min={2} className="w-32" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Desconto (%)</span>
            <Input name="discount" inputMode="decimal" className="w-32" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            <Plus className="mr-1 size-3.5" />
            Salvar faixa
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
