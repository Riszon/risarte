import { FilterForm } from "@/components/filter-form";
import type { Recorte } from "./recorte";

const campo = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

/** Faixa de filtros: aplica sozinha ao mudar (padrão do sistema, FilterForm). */
export function FiltrosRecorte({
  r,
  campanhas,
  extra,
}: {
  r: Recorte;
  campanhas?: { id: string; nome: string }[];
  extra?: React.ReactNode;
}) {
  return (
    <FilterForm className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
      <label className="grid gap-1 text-xs text-muted-foreground">
        De
        <input type="date" name="de" defaultValue={r.de} className={campo} />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Até
        <input type="date" name="ate" defaultValue={r.ate} className={campo} />
      </label>
      {r.franqueadora && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Unidade
          <select name="unidade" defaultValue={r.unidadeId ?? ""} className={campo}>
            <option value="">Rede inteira</option>
            {r.unidades.map((u) => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        </label>
      )}
      {campanhas && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Campanha
          <select name="campanha" defaultValue={r.campanhaId ?? ""} className={campo}>
            <option value="">Todas</option>
            {campanhas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </label>
      )}
      {extra}
    </FilterForm>
  );
}
