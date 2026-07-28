"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Plus, Stethoscope, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { concludeFromProgress } from "./clinical-progress-actions";

export type AttendanceSession = {
  id: string;
  label: string;
  stageName: string | null;
  plannedMinutes: number | null;
  status: string;
};

/** Sessão do cliente que NÃO estava programada para hoje, mas pode ser feita. */
export type ExtraSession = {
  id: string;
  label: string;
  stageName: string | null;
  plannedMinutes: number | null;
  /** Dentista indicado no planejamento (vazio = ainda sem dentista). */
  providerName: string | null;
};

/**
 * I7b: fecha o atendimento SEM sair do Desenvolvimento Clínico — o dentista
 * confirma o que foi feito, o que não foi (com motivo) e pode incluir uma
 * sessão que não estava programada para o dia. O botão só libera depois que a
 * anotação foi escrita (o banco recusa igual, é a barreira de verdade).
 */
export function AttendanceConcludeBlock({
  clientId,
  appointmentId,
  sessions,
  extraOptions,
  canConclude,
  noteWritten,
}: {
  clientId: string;
  appointmentId: string;
  sessions: AttendanceSession[];
  extraOptions: ExtraSession[];
  canConclude: boolean;
  noteWritten: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<Record<string, boolean>>(
    Object.fromEntries(sessions.map((s) => [s.id, true]))
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<ExtraSession[]>([]);
  const [picking, setPicking] = useState(false);

  const available = extraOptions.filter(
    (o) => !extras.some((e) => e.id === o.id)
  );

  function conclude() {
    const doneIds = sessions.filter((s) => done[s.id] ?? true).map((s) => s.id);
    const notDoneReasons: Record<string, string> = {};
    for (const s of sessions) {
      if (!(done[s.id] ?? true)) {
        const r = (reasons[s.id] ?? "").trim();
        if (r) notDoneReasons[s.id] = r;
      }
    }
    startTransition(async () => {
      const r = await concludeFromProgress({
        appointmentId,
        clientId,
        doneSessionIds: doneIds,
        extraSessionIds: extras.map((e) => e.id),
        reasons: notDoneReasons,
      });
      if (r.ok) {
        toast.success("Atendimento concluído.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível concluir.");
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
        <Stethoscope className="size-4 shrink-0" />
        Procedimentos deste atendimento
      </p>

      <ul className="space-y-1.5">
        {sessions.map((s) => {
          const isDone = done[s.id] ?? true;
          return (
            <li key={s.id} className="rounded-md border bg-background p-2">
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isDone}
                  disabled={!canConclude || isPending}
                  onChange={() =>
                    setDone((p) => ({ ...p, [s.id]: !(p[s.id] ?? true) }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "font-medium",
                      !isDone && "text-muted-foreground line-through"
                    )}
                  >
                    {s.label}
                  </span>
                  {s.stageName && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {s.stageName}
                    </span>
                  )}
                  {s.plannedMinutes ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {s.plannedMinutes} min
                    </span>
                  ) : null}
                </span>
                <Badge variant={isDone ? "default" : "outline"}>
                  {isDone ? "Feita" : "Não feita"}
                </Badge>
              </label>
              {!isDone && canConclude && (
                <Input
                  className="mt-2"
                  placeholder="Por que não foi feita? (opcional)"
                  value={reasons[s.id] ?? ""}
                  onChange={(e) =>
                    setReasons((p) => ({ ...p, [s.id]: e.target.value }))
                  }
                />
              )}
            </li>
          );
        })}

        {extras.map((e) => (
          <li
            key={e.id}
            className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm"
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{e.label}</span>
              {e.stageName && (
                <span className="ml-1 text-xs text-muted-foreground">
                  · {e.stageName}
                </span>
              )}
              <span className="ml-1 text-xs text-emerald-700">
                · fora do programado
              </span>
            </span>
            <button
              type="button"
              onClick={() => setExtras((p) => p.filter((x) => x.id !== e.id))}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remover"
              disabled={isPending}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      {canConclude && (
        <div className="space-y-2">
          {picking ? (
            <div className="rounded-md border bg-background p-2">
              <p className="mb-1 text-xs text-muted-foreground">
                Sessões do cliente que você pode executar agora (suas ou ainda
                sem dentista definido):
              </p>
              {available.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">
                  Nenhuma outra sessão disponível.
                </p>
              ) : (
                <ul className="space-y-1">
                  {available.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setExtras((p) => [...p, o]);
                          setPicking(false);
                        }}
                        className="w-full rounded-md border p-2 text-left text-sm hover:border-primary/40 hover:bg-muted/40"
                      >
                        <span className="font-medium">{o.label}</span>
                        {o.stageName && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {o.stageName}
                          </span>
                        )}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {o.providerName
                            ? `· ${o.providerName}`
                            : "· sem dentista definido"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => setPicking(false)}
              >
                Fechar
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPicking(true)}
              disabled={isPending}
            >
              <Plus className="mr-1 size-3.5" />
              Executar outra sessão
            </Button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              {noteWritten
                ? "O que não for marcado volta para “a agendar”."
                : "Descreva o Desenvolvimento Clínico abaixo para liberar a conclusão."}
            </p>
            <Button disabled={isPending || !noteWritten} onClick={conclude}>
              {isPending ? "Concluindo…" : "Concluir atendimento"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
