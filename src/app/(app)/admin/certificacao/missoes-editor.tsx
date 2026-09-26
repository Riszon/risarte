"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  dependeDeTerceiro,
  missaoDependeSoDeTerceiros,
  missaoDoPapel,
  PAPEIS_COM_MISSAO,
  resumoDaMissao,
  temMissao,
  type Indicador,
  type MetaDoTreino,
} from "@/lib/certificacao";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { salvarMissao } from "./actions";

type LinhaDaMissao = { indicador: Indicador; minimo: number };

/**
 * Um campo por indicador, com TUDO o que o Admin precisa para decidir o
 * número: o que é contado, onde a pessoa faz aquilo, e se aquilo depende de
 * alguém ter feito algo antes.
 *
 * ⚠️ O `onde` não é enfeite. É com ele que o Admin julga se dá para treinar:
 * "recebimentos de mercadoria" parece uma boa meta até perceber que exige um
 * pedido de compra feito antes, por outra pessoa.
 */
function CampoDoIndicador({
  papel,
  indicador,
  minimo,
}: {
  papel: UserRole;
  indicador: Indicador;
  minimo: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${papel}-${indicador.chave}`} className="leading-snug">
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
      <p className="text-xs text-muted-foreground">{indicador.ajuda}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Onde:</span> {indicador.onde}
      </p>
      {dependeDeTerceiro(indicador) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          ⚠️ Depende de alguém ter feito algo antes.
        </p>
      )}
    </div>
  );
}

function Grupo({
  papel,
  linhas,
}: {
  papel: UserRole;
  linhas: LinhaDaMissao[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {linhas.map(({ indicador, minimo }) => (
        <CampoDoIndicador
          key={indicador.chave}
          papel={papel}
          indicador={indicador}
          minimo={minimo}
        />
      ))}
    </div>
  );
}

/**
 * UM CARTÃO POR FUNÇÃO, salvo separadamente.
 *
 * ⚠️ Não é uma lista só com um botão no fim — foi o erro da proposta do
 * Empresarial em 24/09 ("ficou amontoado"). Aqui o Admin trabalha uma função
 * por vez, e errar um número na recepção não faz ele perder o que digitou nas
 * outras doze.
 *
 * ⚠️ DUAS CAMADAS DE DOBRA, porque são 79 indicadores em 13 funções:
 *   1. o cartão da função começa fechado quando ainda não tem meta;
 *   2. dentro dele, as COMPLEMENTARES começam fechadas.
 * Abertas todas de uma vez, a recepcionista sozinha mostraria 16 campos — a
 * "lista longa" de que o dono já reclamou uma vez. O que é trabalho de todo
 * dia fica à vista; o resto está a um clique, não escondido.
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
  const soTerceiros = missaoDependeSoDeTerceiros(metas, papel);

  const essenciais = missao.filter((m) => m.indicador.nivel === "essencial");
  const complementares = missao.filter(
    (m) => m.indicador.nivel === "complementar"
  );
  const complementaresUsadas = complementares.some((m) => m.minimo > 0);

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

        <form onSubmit={onSubmit} className="space-y-5 border-t p-4">
          {soTerceiros && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm">
              ⚠️ <strong>Esta missão só tem ações que dependem de outra
              pessoa.</strong> Quem tiver esta função pode ficar travado sem ter
              como resolver sozinho. Considere incluir ao menos uma ação que ela
              faça do zero.
            </p>
          )}

          {essenciais.length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Trabalho do dia a dia</h3>
                <p className="text-xs text-muted-foreground">
                  O que esta função faz o tempo todo. É por aqui que se começa.
                </p>
              </div>
              <Grupo papel={papel} linhas={essenciais} />
            </div>
          )}

          {complementares.length > 0 && (
            <details open={complementaresUsadas} className="group/compl">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm hover:bg-accent/40">
                <span
                  aria-hidden
                  className="text-muted-foreground transition-transform group-open/compl:rotate-90"
                >
                  ›
                </span>
                <span className="font-medium">
                  Acontece de vez em quando ({complementares.length})
                </span>
                <span className="text-xs text-muted-foreground">
                  — só se quiser aprofundar o treino
                </span>
              </summary>
              <div className="pt-4">
                <Grupo papel={papel} linhas={complementares} />
              </div>
            </details>
          )}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
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
