"use client";

import { useState } from "react";
import { BookMarked, KeyRound, MonitorPlay, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { marcarBoasVindasVistas } from "@/app/(app)/boas-vindas-actions";

/**
 * BOAS-VINDAS NO PRIMEIRO LOGIN (0263) — pedido do dono, 19/09/2026.
 *
 * Aparece uma vez, no Início do sistema real. O texto muda com a situação da
 * pessoa, porque o próximo passo é outro:
 *   - SÓ INÍCIO (recém-chegado, sistema real ainda não liberado): comece pelo
 *     treino — é o caminho que o dono desenhou (cadastro no real, treino no
 *     treino, liberação do real ao fim do treinamento);
 *   - SISTEMA LIBERADO: os módulos da função estão no menu.
 * Fechar de qualquer jeito (botão, X, Esc, clique fora) conta como visto.
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

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 h-1 w-12 rounded-full bg-gold" />
          <DialogTitle className="text-xl">
            Bem-vindo(a) ao riSZon, {primeiroNome}!
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Que bom ter você na Risarte. O riSZon é o nosso sistema: é nele que
            a jornada de cada paciente acontece — do primeiro contato ao
            acompanhamento depois do tratamento — e é nele que a equipe trabalha
            junta, cada um na sua função.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 text-sm">
          <li className="flex gap-3">
            <MonitorPlay className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
            <span>
              {soInicio ? (
                <>
                  <b>Seu primeiro passo é o riSZon Treino.</b> Lá você usa o
                  sistema completo, com dados de mentira, no seu ritmo e sem
                  medo de errar. Quando terminar o treinamento, a Franqueadora
                  libera para você o sistema do dia a dia. O atalho do treino
                  está aqui no Início, e o login é o mesmo.
                </>
              ) : (
                <>
                  <b>Seu acesso está liberado.</b> No menu da esquerda estão os
                  módulos da sua função. Na dúvida, faça antes no{" "}
                  <b>riSZon Treino</b> — o mesmo sistema, com dados de mentira.
                  O atalho está aqui no Início.
                </>
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
            <span>
              <b>Troque a sua senha</b> em <b>Perfil → Minha senha</b>. A senha
              nova vale aqui e no treino.
            </span>
          </li>
          <li className="flex gap-3">
            <BookMarked className="mt-0.5 size-5 shrink-0 text-gold-tinta" />
            <span>
              <b>Ficou com dúvida?</b> O <b>Manual</b> (o livro, no alto da
              tela) explica cada parte do sistema, sempre na versão que está no
              ar.
            </span>
          </li>
        </ul>

        <DialogFooter>
          <Button onClick={fechar}>
            <Sparkles className="mr-1 size-4" />
            Vamos começar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
