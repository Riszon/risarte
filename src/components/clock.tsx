"use client";

import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * O RELÓGIO DO SISTEMA, na barra lateral.
 *
 * Pedido do dono em 05/09/2026, junto com o defeito de fuso da agenda — e os
 * dois assuntos são o mesmo assunto.
 *
 * ⚠️ MOSTRA O HORÁRIO DE SÃO PAULO, NÃO O DO APARELHO. A hora de negócio do
 * sistema é a de Brasília: é ela que decide se um horário já passou, em que dia
 * a parcela vence e a qual mês o lançamento pertence. Um computador configurado
 * em outro fuso (ou com a data errada) veria um relógio que combina com ele e
 * discorda do sistema — que é exatamente a confusão que este relógio existe
 * para evitar.
 *
 * O instante vem do `useNow()` compartilhado: `null` no servidor e no primeiro
 * desenho, para não haver discordância entre os dois (ver `use-now.ts`). Até
 * lá mostra um traço, nunca um horário parado — horário errado por um instante
 * é pior que ausência declarada.
 */
export function SystemClock({ collapsed = false }: { collapsed?: boolean }) {
  const agora = useNow();

  if (agora === null) {
    return (
      <p
        className={cn(
          "text-center text-xs text-sidebar-foreground/50",
          collapsed && "sr-only"
        )}
        aria-hidden
      >
        —
      </p>
    );
  }

  const instante = new Date(agora);
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(instante);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(instante);

  if (collapsed) {
    return (
      <p
        className="text-center text-xs font-medium tabular-nums text-sidebar-foreground/80"
        title={`${data} · ${hora} (horário de Brasília)`}
      >
        {hora.slice(0, 5)}
      </p>
    );
  }

  return (
    <p
      className="text-center text-xs text-sidebar-foreground/70"
      title="Horário de Brasília — é ele que o sistema usa para tudo"
    >
      <span className="capitalize">{data}</span>
      <br />
      <span className="font-medium tabular-nums text-gold">{hora}</span>
    </p>
  );
}
