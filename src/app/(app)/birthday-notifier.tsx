"use client";

import { useEffect, useRef } from "react";
import {
  notifyTreatmentAlerts,
  notifyUnitBirthdays,
} from "./prontuarios/actions";

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
    // best-effort — nunca interfere na navegação.
    notifyUnitBirthdays(clinicId).catch(() => {});
    // H4.5 Lote 5: alertas de tratamento (sessão atrasada / plano parado).
    notifyTreatmentAlerts(clinicId).catch(() => {});
  }, [clinicId]);
  return null;
}
