"use client";

import { createContext, useContext, useState } from "react";
import type { TreatmentPlan } from "@/lib/planning";
import { planoQueAbre } from "@/lib/sequencia-do-plano";

/**
 * O PLANO SELECIONADO, UM SÓ NA TELA (OC-00009). O cockpit tinha duas escolhas: a
 * do seletor de planos e a do servidor, que abria o plano devolvido mesmo depois
 * de substituído. A janela de sequência mostrava um plano e o editor, outro.
 */
const Contexto = createContext<{
  planoId: string | null;
  setPlanoId: (id: string | null) => void;
} | null>(null);

export function PlanoSelecionadoProvider({
  plans,
  children,
}: {
  plans: TreatmentPlan[];
  children: React.ReactNode;
}) {
  const [planoId, setPlanoId] = useState<string | null>(() => planoQueAbre(plans)?.id ?? null);
  return <Contexto.Provider value={{ planoId, setPlanoId }}>{children}</Contexto.Provider>;
}

/** Nulo fora do cockpit: lá o seletor guarda a escolha sozinho. */
export const usePlanoSelecionado = () => useContext(Contexto);
