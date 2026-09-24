"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  paraQuemVale,
  rotuloDaCarencia,
  rotuloDoBeneficio,
  rotuloDoUso,
  type BeneficioDaProposta,
} from "@/lib/empresarial/beneficios-da-proposta";
import { excluirGrupoDeBeneficios, salvarGrupoDeBeneficios } from "./actions";

export type GrupoView = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  itens: (BeneficioDaProposta & { nome: string })[];
};

/**
 * OS GRUPOS DE BENEFÍCIOS DA REDE (OC-00083, H2).
 *
 * Existem para o consultor não configurar procedimento por procedimento em
 * toda proposta. São da REDE por decisão do dono: grupo de cada um faria as
 * propostas da rede deixarem de se parecer.
 *
 * ⚠️ LIMITE DECLARADO: aqui se renomeia, liga, desliga e apaga o grupo —
 * **não se editam os benefícios dele**. Para mudar o conteúdo, aplique o
 * grupo numa proposta, ajuste lá e guarde como grupo novo. É uma tela a menos
 * mantendo a mesma conta em dois lugares, e a tela diz isso em vez de esconder.
 */
export function GruposDeBeneficios({ grupos }: { grupos: GrupoView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState<string | null>(null);

  function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarGrupoDeBeneficios(formData);
      if (r.ok) {
        toast.success("Grupo salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function excluir(id: string) {
    startTransition(async () => {
      const r = await excluirGrupoDeBeneficios(id);
      if (r.ok) {
        toast.success("Grupo excluído.");
        setConfirmando(null);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Grupos de benefícios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Combinações prontas para aplicar numa proposta sem configurar
          procedimento por procedimento. Elas são <strong>da rede</strong>: o
          que se muda aqui vale para toda proposta daqui em diante — as que já
          aplicaram o grupo guardaram os benefícios na linha delas e não mudam.
        </p>

        {grupos.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            Ainda não há grupo nenhum. Monte os benefícios na aba{" "}
            <strong>Proposta</strong> de uma empresa e use{" "}
            <em>Guardar esta combinação como grupo da rede</em>.
          </p>
        ) : (
          grupos.map((g) => (
            <div key={g.id} className="space-y-2 rounded-md border p-3">
              <form onSubmit={salvar} className="space-y-2">
                <input type="hidden" name="group_id" value={g.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`name_${g.id}`}>Nome</Label>
                    <Input id={`name_${g.id}`} name="name" defaultValue={g.name} required />
                  </div>
                  <div>
                    <Label htmlFor={`desc_${g.id}`}>Para que serve</Label>
                    <Input
                      id={`desc_${g.id}`}
                      name="description"
                      defaultValue={g.description ?? ""}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={g.isActive}
                      className="size-4"
                    />
                    Disponível para aplicar
                  </label>
                  <Button type="submit" size="sm" disabled={isPending}>
                    Salvar
                  </Button>
                  {confirmando === g.id ? (
                    <>
                      <span className="text-xs text-destructive">
                        Apagar de vez? As propostas que já usaram não mudam.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => excluir(g.id)}
                      >
                        Apagar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      aria-label={`Excluir o grupo ${g.name}`}
                      onClick={() => setConfirmando(g.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </form>

              <ul className="divide-y rounded-md bg-muted/30 text-sm">
                {g.itens.length === 0 ? (
                  <li className="p-2 text-muted-foreground">
                    Grupo sem benefício nenhum — aplicar não faria nada.
                  </li>
                ) : (
                  g.itens.map((b) => {
                    const uso = rotuloDoUso(b);
                    const carencia = rotuloDaCarencia(b);
                    return (
                      <li key={b.procedureId} className="flex flex-wrap gap-x-2 p-2">
                        <span className="min-w-40 flex-1 font-medium">{b.nome}</span>
                        <span>{rotuloDoBeneficio(b)}</span>
                        <span className="w-full text-xs text-muted-foreground">
                          {paraQuemVale(b)}
                          {uso ? ` · ${uso}` : ""}
                          {carencia ? ` · ${carencia}` : ""}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ))
        )}

        <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          ⚠️ Os benefícios de um grupo <strong>não se editam aqui</strong>. Para
          mudar o conteúdo, aplique o grupo na proposta de uma empresa, ajuste o
          que precisar e guarde como grupo novo — assim a mesma conta não vive
          em dois lugares.
        </p>
      </CardContent>
    </Card>
  );
}
