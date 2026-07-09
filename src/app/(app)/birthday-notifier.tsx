"use client";

import { useEffect, useRef } from "react";
import { notifyUnitBirthdays } from "./prontuarios/actions";

/**
 * Perf: dispara o aviso de aniversariantes em SEGUNDO PLANO (depois que a tela
 * inicial já apareceu), em vez de bloquear o render da home com ~4 idas ao
 * banco. O gate de papel/permissão continua no servidor (a home só monta este
 * componente quando é o caso) e o RPC já garante um aviso por dia.
 */
export function BirthdayNotifier({ clinicId }: { clinicId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    notifyUnitBirthdays(clinicId).catch(() => {
      // best-effort — nunca interfere na navegação.
    });
  }, [clinicId]);
  return null;
}
