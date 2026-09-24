"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { selectClass } from "./campos";
import { saveLeadClinics } from "./actions";

export type Unidade = { id: string; name: string };

/**
 * AS UNIDADES DA PARCERIA (OC-00083, I3).
 *
 * Pedido do dono: indicar a **unidade principal** da parceria e as outras onde
 * os beneficiários poderão ser atendidos.
 *
 * ⚠️ A PRINCIPAL ENTRA SEMPRE na lista, marcada e sem poder ser desmarcada —
 * a unidade que responde pela empresa não atender seria a primeira surpresa
 * desagradável, e ninguém pensaria em marcá-la duas vezes.
 *
 * ⚠️ E NENHUMA UNIDADE ESCOLHIDA NÃO É "NENHUMA UNIDADE ATENDE": é "não
 * combinamos restrição", que é como todas as parcerias funcionam hoje. A tela
 * diz isso, senão a lista vazia pareceria um erro.
 */
export function UnidadesDaParceria({
  leadId,
  unidades,
  principal,
  vinculadas,
}: {
  leadId: string;
  unidades: Unidade[];
  principal: string | null;
  vinculadas: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [escolhidaPrincipal, setEscolhidaPrincipal] = useState(principal ?? "");
  const [marcadas, setMarcadas] = useState<string[]>(vinculadas);

  function alternar(id: string) {
    setMarcadas((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveLeadClinics(leadId, formData);
      if (r.ok) {
        toast.success("Unidades da parceria salvas.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Unidades da parceria</p>
          <p className="text-xs text-muted-foreground">
            Onde os beneficiários desta empresa podem ser atendidos. Sem nenhuma
            escolhida, o programa <strong>não limita unidade</strong> — é como
            todas as parcerias funcionam hoje.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="max-w-sm">
            <Label htmlFor="main_clinic_id">Unidade principal</Label>
            <select
              id="main_clinic_id"
              name="main_clinic_id"
              value={escolhidaPrincipal}
              onChange={(e) => setEscolhidaPrincipal(e.target.value)}
              className={selectClass}
            >
              <option value="">— a definir —</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              É a unidade que responde pela empresa. Ela entra na lista abaixo
              automaticamente.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium">Também podem atender</p>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {unidades.map((u) => {
                const ehPrincipal = u.id === escolhidaPrincipal;
                return (
                  <label key={u.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="clinic_ids"
                      value={u.id}
                      checked={ehPrincipal || marcadas.includes(u.id)}
                      disabled={ehPrincipal}
                      onChange={() => alternar(u.id)}
                      className="size-4"
                    />
                    <span className={ehPrincipal ? "text-muted-foreground" : ""}>
                      {u.name}
                      {ehPrincipal && " (principal)"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar as unidades
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
