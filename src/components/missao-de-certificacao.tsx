"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  missaoEstaValendo,
  podeIniciar,
  recadoDaMatricula,
  type Matricula,
  type Medicao,
} from "@/lib/certificacao";
import { ProgressoDaMissao } from "@/components/progresso-da-missao";
import { ROLE_LABELS } from "@/lib/roles";
import { formatAnyDateBr } from "@/lib/dates";
import { iniciarMinhaMissao } from "@/app/(app)/missao-actions";

export type MissaoNaTela = Pick<
  Matricula,
  "id" | "role" | "status" | "started_at"
> & {
  /** "3 × cadastros · 2 × primeiros agendamentos" */
  resumo: string | null;
  /** Data limite da reciclagem (ISO), quando a turma tem prazo. */
  prazo: string | null;
  /** O acesso ao sistema real foi suspenso por causa desta reciclagem. */
  suspenso: boolean;
  /** Só existe depois do clique; antes dele não há o que medir. */
  medicao: Medicao | null;
};

/**
 * O CARTÃO DA CONVOCAÇÃO, na tela de Início.
 *
 * ⚠️ ESTE CARTÃO É O CONTRATO COM A PESSOA. Ele diz, antes do clique, duas
 * coisas que ela precisa saber para decidir:
 *
 *   1. o que exatamente ela vai precisar cumprir;
 *   2. que, ATÉ CLICAR, nada do que ela fizer está sendo contado.
 *
 * A segunda é a mais importante. Sem ela, a pessoa evita usar o treino com
 * medo de "gastar a chance" — e o ambiente de treino, que existe justamente
 * para errar sem custo, deixa de ser usado.
 */
export function MissaoDeCertificacao({ missao }: { missao: MissaoNaTela }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const valendo = missaoEstaValendo(missao);

  function comecar() {
    startTransition(async () => {
      const r = await iniciarMinhaMissao(missao.id);
      if (r.ok) {
        toast.success("Missão iniciada. A partir de agora o seu trabalho conta.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível iniciar.");
      }
    });
  }

  return (
    <div
      className={
        valendo
          ? "rounded-xl border border-primary/40 bg-primary/5 p-4"
          : "rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
      }
    >
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="font-semibold">
              {valendo
                ? "Sua missão de certificação está valendo"
                : "Você foi convocado para a certificação"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Função: {ROLE_LABELS[missao.role]}
            </p>
          </div>

          <p className="text-sm">{recadoDaMatricula(missao)}</p>

          {/* ⚠️ A PESSOA PRECISA SABER O QUE ESTÁ EM JOGO. Uma reciclagem com
              prazo que não aparece na tela é um prazo que ninguém cumpre — e a
              suspensão chegaria como surpresa, de madrugada. */}
          {missao.suspenso && (
            <p className="rounded-md bg-amber-500/15 p-3 text-sm font-medium">
              ⚠️ Seu acesso ao sistema real está suspenso até você concluir esta
              reciclagem.
            </p>
          )}

          {!missao.suspenso && missao.prazo && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm">
              <strong>Prazo: {formatAnyDateBr(missao.prazo)}.</strong> Você
              continua trabalhando normalmente até lá. Depois dessa data, quem
              não tiver concluído fica sem acesso ao sistema real.
            </p>
          )}

          {valendo && missao.medicao ? (
            <div className="rounded-lg border border-input bg-background p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Seu progresso no treino:
              </p>
              <ProgressoDaMissao medicao={missao.medicao} />
            </div>
          ) : missao.resumo ? (
            <div className="rounded-lg border border-input bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">
                O que você precisa fazer no treino:
              </p>
              <p className="mt-1 text-sm">{missao.resumo}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A missão desta função ainda não foi definida. Fale com o Admin
              antes de começar.
            </p>
          )}

          {valendo && missao.started_at && (
            <p className="text-xs text-muted-foreground">
              Começou em {formatAnyDateBr(missao.started_at)}. O que você fez
              antes disso não conta.
            </p>
          )}

          {podeIniciar(missao) && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                onClick={comecar}
                disabled={isPending || !missao.resumo}
              >
                {isPending ? "Começando…" : "Aceitar e começar a missão"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Sem pressa: enquanto não clicar, nada é contado.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
