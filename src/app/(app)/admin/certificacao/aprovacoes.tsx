"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { formatAnyDateBr } from "@/lib/dates";
import type { ItemDoRetrato } from "@/lib/certificacao-conclusao";
import { aprovarConclusoes } from "./actions";

export type ConclusaoPendente = {
  id: string;
  full_name: string | null;
  role: UserRole;
  clinic_id: string | null;
  clinic_name: string;
  turma: string | null;
  completed_at: string | null;
  retrato: ItemDoRetrato[];
};

/**
 * AGUARDANDO APROVAÇÃO (0281) — gatilho "aprovação".
 *
 * O Admin vê os NÚMEROS que a pessoa atingiu (o retrato gravado na conclusão)
 * antes de aprovar: aprovar às cegas faria do gatilho "aprovação" um clique
 * sem conteúdo. Agrupado por unidade porque, na coletiva, a unidade só abre
 * quando o grupo todo for aprovado — daí o "aprovar todos desta unidade".
 */
export function AprovacoesPendentes({ pendentes }: { pendentes: ConclusaoPendente[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const porUnidade = new Map<string, ConclusaoPendente[]>();
  for (const p of pendentes) {
    const chave = p.clinic_name || "(sem unidade)";
    porUnidade.set(chave, [...(porUnidade.get(chave) ?? []), p]);
  }

  /** `rotulo`: "Fulana" (uma pessoa) ou "Unidade X" (a unidade inteira). */
  function aprovar(ids: string[], rotulo: string) {
    startTransition(async () => {
      const r = await aprovarConclusoes(ids);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível aprovar.");
      } else {
        toast.success(
          r.recusadas && r.recusadas.length > 0
            ? `${rotulo}: ${r.aprovadas} aprovada(s); ${r.recusadas.length} não (já aprovadas ou erro).`
            : ids.length === 1
              ? `Aprovação registrada: ${rotulo}. O sistema real foi liberado.`
              : `${rotulo}: ${r.aprovadas} aprovada(s). O sistema real foi liberado.`
        );
      }
      router.refresh();
    });
  }

  return (
    <Card className="border-emerald-500/40">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Aguardando a sua aprovação ({pendentes.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Cumpriram a missão no treino. Confira os números e aprove: o
              certificado é gravado e o sistema real abre na unidade.
            </p>
          </div>
        </div>

        {[...porUnidade].map(([unidade, lista]) => (
          <div key={unidade} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{unidade}</span>
              {lista.length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => aprovar(lista.map((p) => p.id), unidade)}
                >
                  Aprovar todos desta unidade ({lista.length})
                </Button>
              )}
            </div>
            <ul className="divide-y text-sm">
              {lista.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.full_name ?? "(sem nome)"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ROLE_LABELS[p.role] ?? p.role}
                      {p.turma ? ` · turma ${p.turma}` : ""}
                      {p.completed_at ? ` · cumpriu em ${formatAnyDateBr(p.completed_at)}` : ""}
                    </span>
                    {p.retrato.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {p.retrato.map((i) => (
                          <span key={i.chave} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                            {i.rotulo}: <strong>{i.feito ?? "—"}</strong> de {i.minimo}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                        Os números da conclusão não foram guardados.
                      </span>
                    )}
                  </span>
                  <Button size="sm" disabled={isPending} onClick={() => aprovar([p.id], p.full_name ?? "a pessoa")}>
                    Aprovar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
