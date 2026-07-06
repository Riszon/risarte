"use client";

import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AJ3: cronômetro regressivo até a apresentação comercial. Quando `alarm` (o
 * plano ainda NÃO está pronto), destaca a urgência — vermelho a menos de 2 dias,
 * âmbar antes disso — para pressionar o Centro de Planejamento a não deixar
 * chegar o dia sem plano. Sem `alarm`, é só informativo (cinza).
 */
export function PresentationCountdown({
  startsAt,
  alarm = false,
  className,
}: {
  startsAt: string;
  alarm?: boolean;
  className?: string;
}) {
  // Date.now() só no inicializador/intervalo (nunca no render) — evita função
  // impura no corpo do componente.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(startsAt).getTime();
  const diff = target - now;

  let label: string;
  if (diff <= 0) {
    label = "é agora";
  } else {
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days >= 1) label = `faltam ${days}d ${hours}h`;
    else if (hours >= 1) label = `faltam ${hours}h ${mins}min`;
    else label = `faltam ${mins}min`;
  }

  const near = diff <= 48 * 3600_000; // menos de 2 dias
  const tone = alarm
    ? near
      ? "border-red-300 bg-red-50 text-red-700"
      : "border-amber-300 bg-amber-50 text-amber-800"
    : "border-border bg-muted/40 text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium",
        tone,
        className
      )}
    >
      <AlarmClock className="size-3" />
      {label}
    </span>
  );
}
