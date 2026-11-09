"use client";

// Horário de funcionamento POR DIA DA SEMANA (0368 — Rita, Fase 0A.4).
// ⚠️ DA8: a agenda da equipe ainda usa o horário geral do cartão de cima; este
// é o que a assistente virtual vai informar aos pacientes (e passará a valer
// na agenda na Fase 1).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WEEKDAY_NAMES } from "@/lib/agenda-settings";
import type { HorarioDoDia } from "@/lib/unidade-publica";
import { salvarHorarioPorDia, usarHorarioDaRede } from "./horario-feriados-actions";

export function HorarioPorDiaEditor({
  clinicId,
  dias,
  origem,
  podeEditar,
}: {
  /** Nulo = o padrão da rede. */
  clinicId: string | null;
  dias: HorarioDoDia[];
  /** De onde vêm os dias mostrados: da própria unidade ou herdados da rede. */
  origem: "unidade" | "rede";
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<HorarioDoDia[]>(dias);
  const muda = (weekday: number, patch: Partial<HorarioDoDia>) =>
    setD((lista) => lista.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)));

  function salvar() {
    start(async () => {
      const r = await salvarHorarioPorDia(clinicId, d);
      if (r.ok) {
        toast.success("Horário por dia salvo.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function voltarParaRede() {
    if (!clinicId) return;
    start(async () => {
      const r = await usarHorarioDaRede(clinicId);
      if (r.ok) {
        toast.success("A unidade voltou a seguir o horário da rede.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  // Segunda primeiro, domingo no fim (como as pessoas leem a semana).
  const ordem = [1, 2, 3, 4, 5, 6, 0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {clinicId ? "Horário por dia da semana" : "Horário padrão da rede, por dia"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {clinicId
            ? origem === "rede"
              ? "Esta unidade segue o horário padrão da rede. Salvar aqui cria o horário próprio da unidade."
              : "Horário próprio desta unidade."
            : "Vale para toda unidade que não tiver horário próprio."}{" "}
          É o horário que a assistente virtual vai informar aos pacientes. A
          agenda da equipe continua usando o horário do cartão acima por
          enquanto.
        </p>
        <div className="space-y-2">
          {ordem.map((w) => {
            const x = d.find((y) => y.weekday === w)!;
            return (
              <div key={w} className="space-y-1 rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-16 font-medium">{WEEKDAY_NAMES[w]}</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!x.closed}
                      disabled={!podeEditar}
                      onChange={(e) =>
                        muda(w, e.target.checked
                          ? { closed: false, open: x.open || "08:00", close: x.close || "18:00" }
                          : { closed: true })
                      }
                    />
                    aberto
                  </label>
                  {x.closed ? (
                    <span className="text-muted-foreground">fechado</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Input type="time" aria-label={`${WEEKDAY_NAMES[w]}: abre`} className="w-[6.5rem]" value={x.open} disabled={!podeEditar} onChange={(e) => muda(w, { open: e.target.value })} />
                      <span>às</span>
                      <Input type="time" aria-label={`${WEEKDAY_NAMES[w]}: fecha`} className="w-[6.5rem]" value={x.close} disabled={!podeEditar} onChange={(e) => muda(w, { close: e.target.value })} />
                    </span>
                  )}
                </div>
                {!x.closed && (
                  <div className="flex flex-wrap items-center gap-2 sm:pl-[4.5rem]">
                    <span className="text-muted-foreground">almoço</span>
                    <span className="flex items-center gap-2">
                      <Input type="time" aria-label={`${WEEKDAY_NAMES[w]}: almoço começa`} className="w-[6.5rem]" value={x.lunchStart} disabled={!podeEditar} onChange={(e) => muda(w, { lunchStart: e.target.value })} />
                      <span>às</span>
                      <Input type="time" aria-label={`${WEEKDAY_NAMES[w]}: almoço termina`} className="w-[6.5rem]" value={x.lunchEnd} disabled={!podeEditar} onChange={(e) => muda(w, { lunchEnd: e.target.value })} />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Sem almoço: deixe os dois campos do almoço vazios.</p>
        {podeEditar ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={salvar}>
              {pending ? "Salvando..." : "Salvar horário por dia"}
            </Button>
            {clinicId && origem === "unidade" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={voltarParaRede}>
                Voltar ao padrão da rede
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Só o Admin Master muda o horário padrão da rede.</p>
        )}
      </CardContent>
    </Card>
  );
}
