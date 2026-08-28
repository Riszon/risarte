"use client";

import { useSyncExternalStore } from "react";

/**
 * O relógio que anda — e que NÃO EXISTE NO SERVIDOR.
 *
 * Devolve `null` enquanto a página é desenhada no servidor e no primeiro
 * desenho do navegador; logo depois, o instante atual, renovado a cada segundo.
 *
 * **Por que não começar já com `Date.now()`.** A tela é desenhada duas vezes:
 * uma no servidor, para chegar pronta, e outra no navegador, para ganhar vida.
 * Se as duas perguntarem as horas, recebem respostas diferentes — o servidor
 * escreve "0:03" e o navegador, um segundo depois, "0:04". O React trata essa
 * diferença como erro grave (*hydration mismatch*), joga fora a árvore inteira
 * e a redesenha, deixando um erro no console a cada abertura da tela de
 * Atendimento.
 *
 * Não quebrava nada visível, e é justamente esse o problema: **erro que sempre
 * aparece é erro que ninguém lê** — e a varredura de telas (camada 2) procura
 * exatamente marcas de erro na página.
 *
 * `useSyncExternalStore` existe para este caso: ele usa a resposta do servidor
 * (`null`) também no primeiro desenho do navegador, e só depois troca pelo
 * valor de verdade. Não há instante em que os dois discordem.
 *
 * Quem usa deve mostrar um traço enquanto for `null`, nunca um zero: "0:00" é
 * um número, e número errado por um instante é pior que ausência declarada.
 *
 * **Um relógio só para a tela toda.** O painel de Atendimento tem um cronômetro
 * por paciente na fila; um intervalo por componente faria dezenas de despertadores
 * correndo em paralelo para marcar o mesmo segundo.
 */

let agora = Date.now();
const ouvintes = new Set<() => void>();
let relogio: ReturnType<typeof setInterval> | null = null;

function inscrever(avisar: () => void): () => void {
  ouvintes.add(avisar);
  if (relogio === null) {
    // O módulo pode ter sido carregado há minutos; acerta as horas ao ligar.
    agora = Date.now();
    relogio = setInterval(() => {
      agora = Date.now();
      for (const o of ouvintes) o();
    }, 1000);
  }
  return () => {
    ouvintes.delete(avisar);
    if (ouvintes.size === 0 && relogio !== null) {
      clearInterval(relogio);
      relogio = null;
    }
  };
}

/** Precisa devolver sempre o MESMO valor entre avisos, senão o React gira em falso. */
const instante = () => agora;
const noServidor = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(inscrever, instante, noServidor);
}
