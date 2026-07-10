"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinutes } from "@/lib/pricing";
import type { ProjectedSession } from "@/lib/planning";
import { setPlannedSessionGroup } from "../../prontuarios/[id]/planning-actions";

/**
 * H4.5 Pedido 2: o Planner monta os "atendimentos" — agrupa, sessão a sessão, o
 * que será feito no mesmo horário. Cada sessão projetada recebe um número de
 * atendimento; sessões com o mesmo número serão agendadas juntas ao iniciar o
 * tratamento.
 */
export function SessionJoinPlanner({
  sessions,
  canEdit,
}: {
  sessions: ProjectedSession[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (sessions.length === 0) return null;

  const usedGroups = [
    ...new Set(
      sessions
        .map((s) => s.groupNo)
        .filter((g): g is number => g != null)
    ),
  ].sort((a, b) => a - b);
  const nextGroup = usedGroups.length ? Math.max(...usedGroups) + 1 : 1;

  function change(s: ProjectedSession, value: string) {
    const groupNo = value === "" ? null : value === "new" ? nextGroup : Number(value);
    startTransition(async () => {
      const r = await setPlannedSessionGroup(s.itemId, s.sessionIndex, groupNo);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  // Agrupa por procedimento (para a lista) e por atendimento (para o resumo).
  const byProcedure = new Map<string, ProjectedSession[]>();
  for (const s of sessions) {
    const list = byProcedure.get(s.procedureName) ?? [];
    list.push(s);
    byProcedure.set(s.procedureName, list);
  }
  const groupSummary = usedGroups.map((g) => {
    const items = sessions.filter((s) => s.groupNo === g);
    const minutes = items.reduce((a, s) => a + (s.plannedMinutes ?? 0), 0);
    return { group: g, items, minutes };
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Link2 className="size-4 text-muted-foreground" />
          Atendimentos (juntar sessões)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Junte as sessões que serão feitas <strong>no mesmo horário</strong>:
          dê o mesmo <strong>número de atendimento</strong> a elas. O que não for
          agrupado segue como atendimento separado (a recepção pode juntar depois).
        </p>

        {groupSummary.length > 0 && (
          <div className="space-y-1.5">
            {groupSummary.map((gs) => (
              <div
                key={gs.group}
                className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">Atendimento {gs.group}</span>
                  <span className="text-xs text-muted-foreground">
                    {gs.items.length}{" "}
                    {gs.items.length === 1 ? "sessão" : "sessões"}
                    {gs.minutes > 0 ? ` · ${formatMinutes(gs.minutes)}` : ""}
                  </span>
                </p>
                <ul className="mt-0.5 text-xs text-muted-foreground">
                  {gs.items.map((it) => (
                    <li key={`${it.itemId}-${it.sessionIndex}`}>
                      {it.procedureName} — {it.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {[...byProcedure.entries()].map(([proc, list]) => (
            <div key={proc}>
              <p className="text-sm font-medium">{proc}</p>
              <ul className="mt-1 space-y-1">
                {list.map((s) => (
                  <li
                    key={`${s.itemId}-${s.sessionIndex}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {s.name}
                      {s.plannedMinutes ? (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {s.plannedMinutes} min
                        </span>
                      ) : null}
                    </span>
                    {canEdit ? (
                      <select
                        value={s.groupNo != null ? String(s.groupNo) : ""}
                        disabled={isPending}
                        onChange={(e) => change(s, e.target.value)}
                        className="h-8 rounded-md border border-input bg-transparent px-1 text-sm"
                        aria-label="Atendimento conjunto"
                      >
                        <option value="">Separado</option>
                        {usedGroups.map((g) => (
                          <option key={g} value={String(g)}>
                            Atendimento {g}
                          </option>
                        ))}
                        <option value="new">+ Novo atendimento</option>
                      </select>
                    ) : (
                      s.groupNo != null && (
                        <span className="text-xs text-primary">
                          Atendimento {s.groupNo}
                        </span>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
