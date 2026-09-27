"use client";

import { AlarmClock } from "lucide-react";
import { nomeDoAvisoDeApresentacao } from "@/lib/avisos-de-agendar";
import { AvisoDeAgendar } from "./aviso-de-agendar";

/**
 * AJ4/AJ6: pop-up para a recepção quando há cliente esperando o agendamento da
 * apresentação comercial. Desde o OC-00080 (0283) ele só sai quando a
 * apresentação é agendada; ver `AvisoDeAgendar`.
 */
export function UrgentSchedulingPopup() {
  return (
    <AvisoDeAgendar
      padraoDoTitulo="%agendar apresenta%"
      titulo="Agendar apresentação comercial"
      icone={<AlarmClock className="size-5" />}
      corDoTitulo="text-red-700"
      descricao={(n) =>
        (n === 1
          ? "1 cliente aguardando o agendamento da apresentação comercial."
          : `${n} clientes aguardando o agendamento da apresentação comercial.`) +
        " Agende o quanto antes."
      }
      quandoSai="quando a apresentação comercial for agendada"
      nomeDoCliente={(i) => nomeDoAvisoDeApresentacao(i.title, i.body)}
    />
  );
}
