"use client";

import { Label } from "@/components/ui/label";
import { UNIT_SCOPES, UNIT_SCOPE_LABELS, type UnitScope } from "@/lib/roles";

/**
 * Lets the Admin Master choose which franchise units a franchisor-role user
 * can access: all / specific (multi-select) / none.
 */
export function UnitAccessControl({
  units,
  scope,
  unitIds,
  onChange,
  idPrefix,
  soTodas = false,
}: {
  units: { id: string; name: string }[];
  scope: UnitScope;
  unitIds: string[];
  onChange: (scope: UnitScope, unitIds: string[]) => void;
  idPrefix: string;
  /** AP67: a função só aceita "Todas" (Financeiro da Franqueadora). */
  soTodas?: boolean;
}) {
  if (soTodas) {
    return (
      <div className="space-y-1 rounded-md border bg-muted/30 p-2">
        <Label className="text-xs">Acesso às unidades franqueadas</Label>
        <p className="text-sm">
          {UNIT_SCOPE_LABELS.all} — o Financeiro da Franqueadora trabalha sempre com todas as
          unidades.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <Label className="text-xs">Acesso às unidades franqueadas</Label>
      <div className="flex flex-wrap gap-3">
        {UNIT_SCOPES.map((s) => (
          <label
            key={s}
            className="flex items-center gap-1.5 text-sm"
            htmlFor={`${idPrefix}-${s}`}
          >
            <input
              id={`${idPrefix}-${s}`}
              type="radio"
              name={`${idPrefix}-scope`}
              checked={scope === s}
              onChange={() => onChange(s, unitIds)}
              className="accent-primary"
            />
            {UNIT_SCOPE_LABELS[s]}
          </label>
        ))}
      </div>
      {scope === "specific" && (
        <div className="grid grid-cols-2 gap-1 pt-1">
          {units.map((u) => (
            <label key={u.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={unitIds.includes(u.id)}
                onChange={(e) =>
                  onChange(
                    "specific",
                    e.target.checked
                      ? [...unitIds, u.id]
                      : unitIds.filter((x) => x !== u.id)
                  )
                }
                className="size-3.5 accent-primary"
              />
              {u.name}
            </label>
          ))}
          {units.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma unidade cadastrada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
