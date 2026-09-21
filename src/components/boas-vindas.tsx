"use client";

import { useState } from "react";
import { BookMarked, KeyRound, MonitorPlay, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComNegrito } from "@/components/com-negrito";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BOAS_VINDAS } from "@/lib/textos-automaticos";
import { marcarBoasVindasVistas } from "@/app/(app)/boas-vindas-actions";

/**
 * BOAS-VINDAS NOS PRIMEIROS ACESSOS (0263 + 0265) — pedido do dono.
 *
 * Aparece no Início do sistema real, nos 3 primeiros dias em que a pessoa entra
 * (uma vez por dia): uma vez só é pouco para quem chega com tudo novo na
 * frente. O texto muda com a situação, porque o próximo passo é outro:
 *   - SÓ INÍCIO (recém-chegado): comece pelo treino — é o caminho que o dono
 *     desenhou (cadastro no real, treino no treino, liberação do real no fim);
 *   - SISTEMA LIBERADO: os módulos da função estão no menu.
 *
 * O TEXTO NÃO MORA AQUI: vem de `textos-automaticos.ts`, para a tela de
 * Orientações mostrar exatamente o que a equipe recebe (pedido do dono,
 * 20/09/2026). Fechar de qualquer jeito conta como visto.
 */
export function BoasVindas({
  primeiroNome,
  soInicio,
}: {
  primeiroNome: string;
  soInicio: boolean;
}) {
  const [aberto, setAberto] = useState(true);

  function fechar() {
    setAberto(false);
    void marcarBoasVindasVistas();
  }

  const linhas = [
    {
      icone: <MonitorPlay className="mt-0.5 size-5 shrink-0 text-gold-tinta" />,
      texto: soInicio
        ? BOAS_VINDAS.proximoPasso.recemChegado
        : BOAS_VINDAS.proximoPasso.liberado,
    },
    {
      icone: <KeyRound className="mt-0.5 size-5 shrink-0 text-gold-tinta" />,
      texto: BOAS_VINDAS.senha,
    },
    {
      icone: <BookMarked className="mt-0.5 size-5 shrink-0 text-gold-tinta" />,
      texto: BOAS_VINDAS.manual,
    },
  ];

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 h-1 w-12 rounded-full bg-gold" />
          <DialogTitle className="text-xl">
            {BOAS_VINDAS.titulo(primeiroNome)}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {BOAS_VINDAS.abertura}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 text-sm">
          {linhas.map((l, i) => (
            <li key={i} className="flex gap-3">
              {l.icone}
              <span>
                <ComNegrito texto={l.texto} />
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={fechar}>
            <Sparkles className="mr-1 size-4" />
            {BOAS_VINDAS.botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
