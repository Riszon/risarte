"use client";

import { PartyPopper } from "lucide-react";
import { motivoDoAvisoDeInicio, nomeDoAvisoDeFechamento } from "@/lib/avisos-de-agendar";
import { AvisoDeAgendar } from "./aviso-de-agendar";

/**
 * COM4: pop-up FORTE para a recepção quando uma venda é fechada — fale com o
 * cliente e agende o início na hora. Desde o OC-00080 (0283) ele só sai quando
 * o "Início de Tratamento" é agendado; ver `AvisoDeAgendar`.
 */
export function TreatmentStartPopup() {
  return (
    <AvisoDeAgendar
      padraoDoTitulo="%iniciar tratamento%"
      titulo="Fechamento! Iniciar tratamento"
      icone={<PartyPopper className="size-5" />}
      corDoTitulo="text-emerald-700"
      descricao={(n) =>
        n === 1
          ? "1 cliente fechou o plano. Fale com o cliente, dê as boas-vindas e agende o início."
          : `${n} clientes fecharam o plano. Fale com eles e agende o início do tratamento.`
      }
      quandoSai="quando o início do tratamento for agendado"
      nomeDoCliente={(i) => nomeDoAvisoDeFechamento(i.title, i.body)}
      // AP20 (0284): o aviso que VOLTOU diz por quê — cancelado ou faltou.
      detalhe={(i) => {
        const m = motivoDoAvisoDeInicio(i.body);
        return m ? m.charAt(0).toUpperCase() + m.slice(1) + "." : null;
      }}
    />
  );
}
