"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ESCOPOS,
  ESCOPO_AJUDA,
  ESCOPO_ROTULO,
  GATILHOS,
  GATILHO_AJUDA,
  GATILHO_ROTULO,
  type ConfiguracaoDoPortao,
} from "@/lib/certificacao";
import { salvarPortao } from "./actions";

/**
 * Os dois eixos do documento, cada um numa coluna. São escolhas de UMA opção
 * entre duas, e cada opção carrega a frase que explica o que ela faz — a
 * diferença entre "coletiva" e "individual" não se adivinha pelo rótulo.
 */
export function PortaoEditor({ atual }: { atual: ConfiguracaoDoPortao }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarPortao(formData);
      if (r.ok) {
        toast.success("Regras de liberação salvas.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Como a liberação acontece</CardTitle>
        <CardDescription>
          Duas escolhas independentes: de quem depende a liberação, e o que
          acontece quando a missão é cumprida.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                De quem depende a liberação
              </legend>
              {ESCOPOS.map((op) => (
                <label
                  key={op}
                  className="flex cursor-pointer gap-3 rounded-lg border border-input p-3 hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
                >
                  <input
                    type="radio"
                    name="release_scope"
                    value={op}
                    defaultChecked={atual.release_scope === op}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {ESCOPO_ROTULO[op]}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {ESCOPO_AJUDA[op]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                O que acontece ao cumprir
              </legend>
              {GATILHOS.map((op) => (
                <label
                  key={op}
                  className="flex cursor-pointer gap-3 rounded-lg border border-input p-3 hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-accent/60"
                >
                  <input
                    type="radio"
                    name="release_trigger"
                    value={op}
                    defaultChecked={atual.release_trigger === op}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">
                      {GATILHO_ROTULO[op]}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {GATILHO_AJUDA[op]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar regras"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
