"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NetworkTab, OrigemDaRede } from "@/lib/finance/network-areas";
import { abrirNaUnidade, voltarParaRede } from "./abrir-na-unidade-actions";

/**
 * OC-00121, K2 — o botão que entra na unidade e abre o relatório dela.
 *
 * Unidade fora do escopo de quem olha (o Financeiro da Franqueadora com escopo
 * "Específicas") aparece na lista, mas sem o botão: o número da rede vem do
 * banco, e a troca de unidade segue o seletor dele.
 */
export function BotaoAbrirNaUnidade({
  clinicId,
  nome,
  aba,
  de,
  ate,
  origem,
}: {
  clinicId: string;
  nome: string;
  aba: NetworkTab;
  de: string;
  ate: string;
  origem: OrigemDaRede;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 px-2 text-xs"
      disabled={isPending}
      aria-label={`Abrir ${nome}`}
      onClick={() =>
        startTransition(async () => {
          const r = await abrirNaUnidade({ clinicId, aba, de, ate, origem });
          // Deu certo = o servidor já mandou para a unidade; só volta aqui o erro.
          if (r && !r.ok) toast.error(r.error);
        })
      }
    >
      {isPending ? "Abrindo…" : "Abrir na unidade"}
      <ArrowUpRight className="ml-1 size-3" />
    </Button>
  );
}

/** A faixa no alto do Financeiro da unidade aberta pela rede. */
export function FaixaVoltarParaRede({ unidade }: { unidade: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="mx-auto mt-3 flex max-w-5xl flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
      <span>
        Você abriu <strong>{unidade}</strong> pelo Painel da rede. Aqui tudo é
        desta unidade.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 text-xs"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const r = await voltarParaRede();
            if (r && !r.ok) toast.error(r.error);
          })
        }
      >
        <ArrowLeft className="mr-1 size-3" />
        {isPending ? "Voltando…" : "Voltar para a rede"}
      </Button>
    </div>
  );
}
