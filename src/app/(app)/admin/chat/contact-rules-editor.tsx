"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  FRANCHISOR_ROLES,
  UNIT_ROLES,
  ROLE_LABELS,
  type UserRole,
} from "@/lib/roles";
import { Card, CardContent } from "@/components/ui/card";
import { setChatContactRule } from "./actions";

export function ContactRulesEditor({
  rules,
}: {
  rules: Record<string, boolean>;
}) {
  const [state, setState] = useState<Record<string, boolean>>(rules);
  const [isPending, startTransition] = useTransition();

  const key = (fr: UserRole, unit: UserRole) => `${fr}|${unit}`;
  const isAllowed = (fr: UserRole, unit: UserRole) => state[key(fr, unit)] ?? true;

  function toggle(fr: UserRole, unit: UserRole) {
    const next = !isAllowed(fr, unit);
    setState((s) => ({ ...s, [key(fr, unit)]: next }));
    startTransition(async () => {
      const r = await setChatContactRule({
        franchisorRole: fr,
        unitRole: unit,
        allowed: next,
      });
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        setState((s) => ({ ...s, [key(fr, unit)]: !next }));
      }
    });
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto p-3">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card p-2 text-left align-bottom">
                <span className="text-xs font-medium text-muted-foreground">
                  Franqueadora ↓ / Unidade →
                </span>
              </th>
              {UNIT_ROLES.map((u) => (
                <th
                  key={u}
                  className="min-w-[4.5rem] p-2 text-center align-bottom text-[11px] font-medium"
                >
                  {ROLE_LABELS[u]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FRANCHISOR_ROLES.map((fr) => (
              <tr key={fr} className="border-t">
                <td className="sticky left-0 z-10 bg-card p-2 text-[11px] font-medium">
                  {ROLE_LABELS[fr]}
                </td>
                {UNIT_ROLES.map((u) => (
                  <td key={u} className="p-2 text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer"
                      checked={isAllowed(fr, u)}
                      disabled={isPending}
                      onChange={() => toggle(fr, u)}
                      title={`${ROLE_LABELS[fr]} ↔ ${ROLE_LABELS[u]}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Marcado = essas duas funções podem trocar mensagens diretas entre a
          franqueadora e a unidade. Desmarcado = bloqueado. Salva
          automaticamente.
        </p>
      </CardContent>
    </Card>
  );
}
