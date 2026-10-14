"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { anteriorServeParaVoltar } from "@/lib/voltar";

/**
 * A SETA "VOLTAR" DA BARRA DE CIMA (relato OC-00101).
 *
 * Faz o mesmo que a seta do navegador: volta à tela anterior do jeito que ela
 * estava — a mesma aba, os mesmos filtros, porque as telas guardam isso no
 * endereço. Não é um "ir para a tela mãe": quem veio da Auditoria para a ficha
 * de um cliente volta para a Auditoria, não para a lista de clientes.
 *
 * ⚠️ COMO ELA SABE SE HÁ TELA ANTERIOR. O navegador moderno conta o histórico
 * da aba (a "Navigation API": `navigation.entries()`), e a regra
 * `anteriorServeParaVoltar` diz se a entrada anterior é uma tela do riSZon.
 * Sem ela (navegador antigo), a seta acende se a aba tem qualquer histórico —
 * no pior caso, volta para o login, que manda para dentro de novo.
 *
 * ⚠️ NO SERVIDOR A SETA NASCE APAGADA. O servidor não tem histórico; a
 * resposta dele é "não", e o navegador acende ao desenhar
 * (`useSyncExternalStore` — mesma razão do `useNow`).
 */

type EntradaDoHistorico = { url: string | null; index: number };
type NavegacaoDoNavegador = EventTarget & {
  currentEntry: EntradaDoHistorico | null;
  entries(): EntradaDoHistorico[];
};

function navegacao(): NavegacaoDoNavegador | undefined {
  return (window as unknown as { navigation?: NavegacaoDoNavegador }).navigation;
}

function lerSePodeVoltar(): boolean {
  const nav = navegacao();
  if (!nav?.currentEntry) return window.history.length > 1;
  const indice = nav.currentEntry.index;
  if (indice <= 0) return false;
  const anterior = nav.entries().find((e) => e.index === indice - 1);
  return anteriorServeParaVoltar(anterior?.url, window.location.origin);
}

function assinar(avisar: () => void): () => void {
  // ⚠️ AVISAR DEPOIS, NUNCA NA HORA. O Next grava o endereço novo dentro de
  // uma fase do React em que redesenhar é proibido; avisar ali mesmo deu
  // "useInsertionEffect must not schedule updates" no console (visto na tela).
  const depois = () => queueMicrotask(avisar);
  const nav = navegacao();
  nav?.addEventListener("currententrychange", depois);
  window.addEventListener("popstate", depois);
  return () => {
    nav?.removeEventListener("currententrychange", depois);
    window.removeEventListener("popstate", depois);
  };
}

export function BotaoVoltar() {
  // Trocar de tela redesenha a seta (e a pergunta é refeita).
  usePathname();
  const podeVoltar = useSyncExternalStore(assinar, lerSePodeVoltar, () => false);
  const rotulo = podeVoltar ? "Voltar à tela anterior" : "Não há tela anterior";

  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      disabled={!podeVoltar}
      title={rotulo}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-35"
      )}
    >
      <ArrowLeft className="size-[18px]" />
      <span className="sr-only">{rotulo}</span>
    </button>
  );
}
