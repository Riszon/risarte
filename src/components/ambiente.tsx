"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

export type Ambiente = "unidades" | "franchising" | "empresarial";

/**
 * O ambiente também viaja por contexto, e não só pelo atributo no HTML, porque
 * a ASSINATURA é um arquivo diferente por frente — CSS troca cor, não troca
 * arte. Sem isto, cada componente que desenha a logo teria de refazer a mesma
 * dedução, e um dia as duas discordariam.
 */
const AmbienteContexto = createContext<Ambiente>("unidades");

export function useAmbiente(): Ambiente {
  return useContext(AmbienteContexto);
}

/**
 * QUEM DECIDE A COR DA TELA.
 *
 * A identidade tem três frentes (brandbook) e o sistema tem três ambientes. A
 * regra, decidida pelo dono em 09/09/2026, tem **duas metades**:
 *
 * 1. o sistema segue a **unidade ativa** — Franqueadora (`franchisor`) usa a
 *    assinatura Franchising, em turquesa; unidade usa Odontologia, em marinho;
 * 2. as telas de **`/empresarial` mandam na própria cor**, mesmo com uma
 *    unidade ativa. *"O Empresarial é um lugar, não um chapéu."*
 *
 * ⚠️ POR QUE ISTO É COMPONENTE DE NAVEGADOR. Só ele sabe o endereço da tela:
 * componente de servidor não enxerga o caminho sem um cabeçalho vindo do proxy,
 * e mexer no proxy para isso custaria bem mais do que vale. `usePathname()`
 * também roda na montagem do lado do servidor, então a cor certa já vem no
 * primeiro desenho — não há aquele piscar de trocar de cor depois de carregar.
 *
 * ⚠️ E POR QUE ELE ENVOLVE TUDO, inclusive a barra lateral. Se envolvesse só o
 * conteúdo, abrir o Empresarial deixaria a lateral na cor da unidade e a tela
 * ficaria com duas identidades ao mesmo tempo — pior que não ter nenhuma.
 */
export function Ambiente({
  tipoDaClinica,
  children,
  className,
}: {
  /** `type` da clínica ativa. Nulo enquanto ninguém escolheu unidade. */
  tipoDaClinica: "franchisor" | "franchise_unit" | null;
  children: ReactNode;
  className?: string;
}) {
  const caminho = usePathname();

  const ambiente: Ambiente = caminho?.startsWith("/empresarial")
    ? "empresarial"
    : tipoDaClinica === "franchisor"
      ? "franchising"
      : "unidades";

  return (
    <AmbienteContexto.Provider value={ambiente}>
      <div data-ambiente={ambiente} className={className}>
        {children}
      </div>
    </AmbienteContexto.Provider>
  );
}
