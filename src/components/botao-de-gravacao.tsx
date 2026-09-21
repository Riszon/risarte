"use client";

import { useSyncExternalStore } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assinarGravacao,
  clienteGravando,
  nadaNoServidor,
  pedirGravacao,
} from "@/lib/gravacao";

/**
 * O BOTÃO DE GRAVAR DAS TELAS — que não grava: ele PEDE à barra de cima.
 *
 * Antes cada tela tinha o seu gravador (`audio-recorder.tsx`). Com a gravação
 * automática vivendo na barra (relato OC-00060), manter o gravador da tela
 * criaria dois caminhos para a mesma coisa: o Coordenador poderia estar sendo
 * gravado pela barra e apertar "Gravar consulta" aqui, ficando com **dois
 * arquivos, cada um com metade da conversa** — e nenhum dos dois com a
 * consulta inteira. Um caminho só; este botão é a porta manual dele.
 *
 * Quando a gravação já está correndo para este paciente, o botão some e dá
 * lugar ao aviso: a faixa do rodapé é quem manda parar.
 */
export function BotaoDeGravacao({
  clientId,
  clinicId,
  clientName,
}: {
  clientId: string;
  clinicId: string;
  clientName: string;
}) {
  // No servidor não há gravação; responder `null` nos dois primeiros desenhos
  // evita o desencontro entre servidor e navegador (a lição do `useNow`).
  const gravando = useSyncExternalStore(assinarGravacao, clienteGravando, nadaNoServidor);

  if (gravando === clientId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
        A consulta está sendo gravada — o controle fica na faixa embaixo.
      </p>
    );
  }

  if (gravando) {
    return (
      <p className="text-xs text-muted-foreground">
        Há outra consulta sendo gravada agora. Encerre-a antes de começar esta.
      </p>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() =>
        // Sem atendimento vinculado: começou à mão, então para à mão (ou no
        // teto de 2 horas). A parada automática precisa saber qual atendimento
        // acompanhar, e aqui não há um.
        pedirGravacao({ clientId, clinicId, clientName, appointmentId: null })
      }
    >
      <Mic className="mr-1 size-4" />
      Gravar a consulta
    </Button>
  );
}
