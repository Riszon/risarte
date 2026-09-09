"use client";

import { Clock } from "lucide-react";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * O PAINEL DO RELÓGIO — o instrumento que faltava.
 *
 * O defeito de 05/09/2026 (a agenda recusando remarcação por "horário no
 * passado") era uma discordância de relógio entre o servidor e quem estava na
 * tela. Não havia como VER isso: os dois relógios existiam, mas nunca lado a
 * lado, e o sintoma chegava disfarçado de regra de negócio.
 *
 * Aqui os três aparecem juntos, e a diferença — se houver — vira texto em vez
 * de virar um erro que ninguém explica.
 *
 * **A tolerância é de 2 minutos, e não de segundos**, porque o horário do
 * servidor é o do momento em que a página foi montada: o tempo que ela levou
 * para chegar conta como diferença. Apertar isso faria o aviso acender em toda
 * conexão lenta, e aviso que acende à toa é aviso que ninguém lê.
 */
export function PainelDoRelogio({
  servidorIso,
  fusoDoServidor,
}: {
  servidorIso: string;
  fusoDoServidor: string;
}) {
  const agora = useNow();

  const formatar = (instante: Date, timeZone?: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(instante);

  if (agora === null) {
    return (
      <div className="mb-6 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Lendo o relógio…</p>
      </div>
    );
  }

  const instante = new Date(agora);
  const fusoDoAparelho = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // O servidor mandou o instante em que desenhou a página; o aparelho está
  // lendo o dele agora. Só a diferença GRANDE interessa.
  const diferencaMin = Math.round(
    (agora - new Date(servidorIso).getTime()) / 60_000
  );
  const relogioTorto = Math.abs(diferencaMin) >= 2;
  const fusoDiferente = fusoDoAparelho !== BRAZIL_TIME_ZONE;

  return (
    <div className="mb-6 rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-3">
        <Clock className="size-5 shrink-0 text-gold" />
        <div>
          <p className="text-sm font-medium capitalize tabular-nums">
            {formatar(instante, BRAZIL_TIME_ZONE)}
          </p>
          <p className="text-xs text-muted-foreground">
            Horário de Brasília — é este que o sistema usa para tudo: agenda,
            vencimentos e competência.
          </p>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Seu aparelho:</dt>
          <dd className={cn("tabular-nums", fusoDiferente && "text-amber-600")}>
            {fusoDoAparelho}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Servidor:</dt>
          <dd className="tabular-nums">{fusoDoServidor}</dd>
        </div>
      </dl>

      {(relogioTorto || fusoDiferente) && (
        <div className="border-t px-4 py-3 text-xs">
          {relogioTorto && (
            <p className="text-amber-700 dark:text-amber-500">
              <strong className="font-medium">
                O relógio do seu computador está{" "}
                {diferencaMin > 0 ? "adiantado" : "atrasado"} em cerca de{" "}
                {Math.abs(diferencaMin)}{" "}
                {Math.abs(diferencaMin) === 1 ? "minuto" : "minutos"}
              </strong>{" "}
              em relação ao servidor. Isso faz horários parecerem passados (ou
              futuros) quando não são. Acerte a data e a hora do computador.
            </p>
          )}
          {fusoDiferente && (
            <p className="mt-1 text-amber-700 dark:text-amber-500">
              Seu computador está no fuso <strong>{fusoDoAparelho}</strong>, e
              não no de São Paulo. O sistema continua certo — mas o relógio do
              seu computador vai mostrar outra hora.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
