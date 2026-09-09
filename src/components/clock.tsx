"use client";

import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { useNow } from "@/lib/use-now";

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
export function SystemClock() {
  const agora = useNow();

  if (agora === null) {
    // Um traço, nunca um horário parado: número errado por um instante é pior
    // que ausência declarada.
    return (
      <p className="hidden text-xs tabular-nums text-muted-foreground sm:block" aria-hidden>
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

  return (
    <p
      className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block"
      title="Horário de Brasília — é ele que o sistema usa para tudo: agenda, vencimentos e competência"
    >
      {/* A DATA some antes da hora quando a tela aperta: quem olha o relógio no
          meio do expediente quer saber a HORA; o dia ele já sabe. */}
      <span className="hidden capitalize lg:inline">{data} · </span>
      <span className="font-medium tabular-nums text-foreground">{hora}</span>
    </p>
  );
}
