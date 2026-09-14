"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPresentation, savePresentation } from "./actions";

export type Bloco = { titulo: string; corpo: string };

export function ApresentacaoEditor({
  leadId,
  title,
  subtitle,
  blocos,
  personalizada,
}: {
  leadId: string;
  title: string;
  subtitle: string | null;
  blocos: Bloco[];
  /** false = está usando o padrão da rede. */
  personalizada: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState<Bloco[]>(blocos);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await savePresentation(leadId, formData);
      if (r.ok) {
        toast.success("Apresentação salva para esta empresa.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function restaurar() {
    startTransition(async () => {
      const r = await resetPresentation(leadId);
      if (r.ok) {
        toast.success("Voltou a usar o padrão da rede.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Apresentação do programa</p>
            <p className="text-xs text-muted-foreground">
              {personalizada
                ? "Esta empresa tem uma apresentação própria."
                : "Usando o padrão da rede. Ao salvar, esta empresa passa a ter a sua — o padrão continua valendo para as outras."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              nativeButton={false}
              render={
                <Link href={`/empresarial/funil/${leadId}/apresentacao`} />
              }
            >
              <FileText className="mr-1 size-3.5" />
              Abrir e salvar em PDF
            </Button>
            {personalizada && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={isPending}
                onClick={restaurar}
              >
                Voltar ao padrão da rede
              </Button>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="title">Título</Label>
              <Input id="title" name="title" defaultValue={title} required />
            </div>
            <div>
              <Label htmlFor="subtitle">Subtítulo</Label>
              <Input
                id="subtitle"
                name="subtitle"
                defaultValue={subtitle ?? ""}
              />
            </div>
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
                    onClick={() =>
                      setLista((atual) => atual.filter((_, j) => j !== i))
                    }
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
              onClick={() =>
                setLista((atual) => [...atual, { titulo: "", corpo: "" }])
              }
            >
              <Plus className="mr-1 size-3.5" />
              Novo bloco
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar apresentação desta empresa
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
