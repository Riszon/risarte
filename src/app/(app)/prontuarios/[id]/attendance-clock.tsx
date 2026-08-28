"use client";

import Link from "next/link";
import { AlarmClock, Timer, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";

export type WaitingClient = {
  clientId: string | null;
  name: string;
  checkedInAt: string;
  providerName: string | null;
};

function fmtElapsed(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r > 0 ? `${h}h ${r}min` : `${h}h`;
}

/**
 * I7c: relógio do atendimento na tela do dentista — quanto tempo já dura o
 * atendimento, quanto o cliente esperou na recepção e quem está na sala de
 * espera agora (com o tempo de cada um).
 */
export function AttendanceClock({
  calledAt,
  checkedInAt,
  waiting,
  waitingAlertMinutes,
}: {
  calledAt: string | null;
  checkedInAt: string | null;
  waiting: WaitingClient[];
  waitingAlertMinutes: number | null;
}) {
  const now = useNow();
  // O QUE APARECE depende de `calledAt`, não do relógio: assim o servidor e o
  // navegador desenham a MESMA frase, e só o número chega depois. Trocar a
  // frase inteira faria a tela piscar de "vai começar" para "em andamento".
  const serviceSec =
    now !== null && calledAt
      ? Math.floor((now - new Date(calledAt).getTime()) / 1000)
      : null;
  const waitedMin =
    checkedInAt && calledAt
      ? Math.max(
          0,
          Math.round(
            (new Date(calledAt).getTime() - new Date(checkedInAt).getTime()) /
              60000
          )
        )
      : null;
  const alertSec = waitingAlertMinutes ? waitingAlertMinutes * 60 : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-background p-2.5 text-sm">
        {calledAt ? (
          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-violet-700">
            <Timer className="size-4" />
            Em atendimento há{" "}
            {serviceSec === null ? "—" : fmtElapsed(serviceSec)}
          </span>
        ) : (
          <span className="text-muted-foreground">
            O cronômetro começa quando o cliente é chamado.
          </span>
        )}
        {waitedMin !== null && (
          <span className="text-muted-foreground">
            Esperou <strong>{fmtDur(waitedMin)}</strong> na recepção
          </span>
        )}
      </div>

      {waiting.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <Users className="size-4 shrink-0" />
            {waiting.length === 1
              ? "1 pessoa na sala de espera"
              : `${waiting.length} pessoas na sala de espera`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {waiting.map((w) => {
              const sec =
                now === null
                  ? null
                  : Math.floor((now - new Date(w.checkedInAt).getTime()) / 1000);
              const late = alertSec !== null && sec !== null && sec >= alertSec;
              return (
                <li
                  key={`${w.clientId ?? w.name}-${w.checkedInAt}`}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <AlarmClock
                    className={cn(
                      "size-3 shrink-0",
                      late ? "text-red-600" : "text-amber-700"
                    )}
                  />
                  {w.clientId ? (
                    <Link
                      href={`/prontuarios/${w.clientId}`}
                      className="font-medium text-amber-900 hover:underline"
                    >
                      {w.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-amber-900">{w.name}</span>
                  )}
                  <span
                    className={cn(
                      "tabular-nums",
                      late ? "font-semibold text-red-600" : "text-amber-800"
                    )}
                  >
                    aguardando {sec === null ? "—" : fmtElapsed(sec)}
                  </span>
                  {w.providerName && (
                    <span className="text-amber-700">· {w.providerName}</span>
                  )}
                  {late && (
                    <span className="animate-pulse rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">
                      Espera longa
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
