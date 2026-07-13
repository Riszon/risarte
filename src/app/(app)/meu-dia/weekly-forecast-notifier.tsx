"use client";

import { useEffect, useRef } from "react";
import { notifyWeeklyForecast } from "../agenda/actions";

/** H4.6 E4: ao abrir o Meu Dia (do dentista), dispara em 2º plano o aviso da
 * próxima semana. A RPC só age no fim de semana e deduplica por semana. */
export function WeeklyForecastNotifier() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void notifyWeeklyForecast().catch(() => {});
  }, []);
  return null;
}
