"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarPropostaDaRede } from "./actions";

export type Bloco = { titulo: string; corpo: string };

/**
 * O MODELO DE PROPOSTA DA REDE (1014).
 *
 * É daqui que toda proposta nasce: o prazo de validade padrão e os blocos de
 * texto que descrevem o programa. A empresa que precisar de algo diferente
 * ajusta na aba Proposta dela, e o modelo daqui continua valendo para as
 * outras — a mesma cascata da apresentação.
 *
 * ⚠️ Mexer aqui muda a proposta de TODO MUNDO que ainda não personalizou. Por
 * isso a tela inteira é do gestor do programa, e a RLS confirma.
 */
export function PropostaDaRede({
  validDays,
  blocos,
}: {
  validDays: number;
  blocos: Bloco[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState<Bloco[]>(blocos);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarPropostaDaRede(formData);
      if (r.ok) {
        toast.success("Modelo da rede salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proposta comercial (modelo da rede)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="max-w-xs">
            <Label htmlFor="valid_days">Validade padrão da proposta (dias)</Label>
            <Input
              id="valid_days"
              name="valid_days"
              type="number"
              min={1}
              max={365}
              defaultValue={validDays}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Vale para toda proposta que não tiver prazo próprio. Mudar aqui
              não altera proposta já impressa — o documento é montado na hora,
              com o prazo que valer naquele momento.
            </p>
          </div>

          <div>
            <p className="text-sm font-medium">Blocos de texto do documento</p>
            <p className="text-xs text-muted-foreground">
              ⚠️ Não escreva valores aqui. Mensalidade, quem paga, carência e
              implantação são impressos a partir do que foi negociado com cada
              empresa — repeti-los no texto criaria um número que envelhece
              sozinho.
            </p>
          </div>

          <div className="space-y-2">
            {lista.map((b, i) => (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    name={`titulo_${i}`}
                    defaultValue={b.titulo}
                    placeholder="Título do bloco"
                    className="h-8 flex-1 text-sm font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    aria-label={`Apagar o bloco ${i + 1}`}
                    onClick={() => setLista((atual) => atual.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <textarea
                  name={`corpo_${i}`}
                  defaultValue={b.corpo}
                  rows={3}
                  placeholder="O que este bloco diz"
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLista((atual) => [...atual, { titulo: "", corpo: "" }])}
            >
              <Plus className="mr-1 size-3.5" />
              Novo bloco
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar o modelo da rede
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
