"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addPprPerk, removePprPerk } from "../actions";

export type PprPerkRow = { id: string; label: string; sort_order: number };

/** Lista de vantagens do plano — é o texto que o cliente vê na venda e no contrato. */
export function PprPerksEditor({
  planId,
  perks,
}: {
  planId: string;
  perks: PprPerkRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function add(form: FormData) {
    startTransition(async () => {
      const r = await addPprPerk(form);
      if (!r.ok) toast.error(r.error ?? "Não foi possível adicionar.");
      else router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await removePprPerk(id, planId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível remover.");
      else router.refresh();
    });
  }

  const nextOrder = perks.length > 0 ? Math.max(...perks.map((p) => p.sort_order)) + 1 : 1;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Vantagens do plano</CardTitle>
        <p className="text-sm text-muted-foreground">
          Aparecem na apresentação da venda e no contrato de adesão, nesta ordem.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {perks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma vantagem cadastrada.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {perks.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm"
              >
                <span className="flex items-start gap-1.5">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold"
                    aria-hidden
                  />
                  {p.label}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => remove(p.id)}
                  title="Remover"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form action={add} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="sortOrder" value={nextOrder} />
          <label className="min-w-0 flex-1 text-xs">
            <span className="text-muted-foreground">Nova vantagem</span>
            <Input name="label" placeholder="Ex.: Limpeza grátis a cada 4 meses" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            <Plus className="mr-1 size-3.5" />
            Adicionar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
