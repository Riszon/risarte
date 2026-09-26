"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  missaoDoPapel,
  PAPEIS_COM_MISSAO,
  resumoDaMissao,
  temMissao,
  type MetaDoTreino,
} from "@/lib/certificacao";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { salvarMissao } from "./actions";

/**
 * UM CARTÃO POR FUNÇÃO, salvo separadamente.
 *
 * ⚠️ Não é uma lista só com um botão no fim — foi o erro da proposta do
 * Empresarial em 24/09 ("ficou amontoado"). Aqui o Admin trabalha uma função
 * por vez, e errar um número na recepção não faz ele perder o que digitou nas
 * outras doze.
 *
 * ⚠️ E O CARTÃO COMEÇA FECHADO QUANDO NÃO TEM MISSÃO. São 13 funções e até 8
 * indicadores em cada uma: abertas todas de uma vez, a tela viraria a "lista
 * longa" de que o dono reclamou. Quem já foi configurado fica à vista — que é
 * o que se precisa conferir —; o resto está a um clique, não escondido.
 */
function CartaoDaFuncao({
  papel,
  metas,
}: {
  papel: UserRole;
  metas: MetaDoTreino[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const missao = missaoDoPapel(metas, papel);
  const exigeAlgo = temMissao(metas, papel);
  const resumo = resumoDaMissao(metas, papel);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await salvarMissao(papel, formData);
      if (r.ok) {
        toast.success(`Missão da função ${ROLE_LABELS[papel]} salva.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <Card className="overflow-hidden py-0">
      <details open={exigeAlgo} className="group">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 hover:bg-accent/40">
          <span className="min-w-0 space-y-1">
            <span className="block text-base font-semibold">
              {ROLE_LABELS[papel]}
            </span>
            <span className="block text-sm text-muted-foreground">
              {resumo ?? "Sem missão: quem tem esta função não é barrado."}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span
              className={
                exigeAlgo
                  ? "rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                  : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              }
            >
              {exigeAlgo ? "Com missão" : "Sem missão"}
            </span>
            <span
              aria-hidden
              className="text-muted-foreground transition-transform group-open:rotate-90"
            >
              ›
            </span>
          </span>
        </summary>

        <form onSubmit={onSubmit} className="space-y-4 border-t p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {missao.map(({ indicador, minimo }) => (
              <div key={indicador.chave} className="space-y-1.5">
                <Label htmlFor={`${papel}-${indicador.chave}`}>
                  {indicador.rotulo}
                </Label>
                <Input
                  id={`${papel}-${indicador.chave}`}
                  name={indicador.chave}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  defaultValue={minimo || ""}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {indicador.ajuda}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Deixe em branco (ou 0) o que não for exigido.
            </p>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </details>
    </Card>
  );
}

export function MissoesEditor({ metas }: { metas: MetaDoTreino[] }) {
  return (
    <div className="space-y-3">
      {PAPEIS_COM_MISSAO.map((papel) => (
        <CartaoDaFuncao key={papel} papel={papel} metas={metas} />
      ))}
    </div>
  );
}
