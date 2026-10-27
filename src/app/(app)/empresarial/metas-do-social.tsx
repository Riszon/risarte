"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  META_ROTULO,
  TIPOS_DE_META,
  rotuloDaMeta,
  type MetaSocial,
  type TipoDeMeta,
} from "@/lib/empresarial/riso-social";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Uma linha do editor: os números ficam em texto enquanto se digita. */
export type LinhaDeMeta = {
  tipo: TipoDeMeta;
  aCada: string;
  indicacoes: string;
  percentual: string;
};

export function metasParaLinhas(metas: readonly MetaSocial[]): LinhaDeMeta[] {
  return metas.map((m) => ({
    tipo: m.tipo,
    aCada:
      m.tipo === "TREATMENT_SPEND"
        ? (m.aCada / 100).toFixed(2).replace(".", ",")
        : String(m.aCada),
    indicacoes: String(m.indicacoes),
    percentual: m.percentual != null ? String(m.percentual) : "",
  }));
}

/** A linha em texto → a meta, para a frase de conferência ao lado. */
function linhaParaMeta(l: LinhaDeMeta): MetaSocial {
  return {
    tipo: l.tipo,
    aCada:
      l.tipo === "TREATMENT_SPEND"
        ? Math.round((Number.parseFloat(l.aCada.replace(/\./g, "").replace(",", ".")) || 0) * 100)
        : Number.parseInt(l.aCada, 10) || 0,
    indicacoes: Number.parseInt(l.indicacoes, 10) || 0,
    percentual: l.tipo === "ATTENDANCE" ? Number.parseInt(l.percentual, 10) || 0 : null,
  };
}

const UNIDADE: Record<TipoDeMeta, string> = {
  EMPLOYEE_COUNT: "titulares ativos",
  TIME_IN_PROGRAM: "meses de programa",
  ATTENDANCE: "meses (período)",
  TREATMENT_SPEND: "reais em tratamento",
};

/**
 * O EDITOR DAS METAS DO RISO+ SOCIAL (1034) — o mesmo na proposta e na empresa.
 *
 * Cada linha: o gatilho, "a cada quanto", quantas indicações rende e, no
 * comparecimento, o percentual. Ao lado, a meta escrita por extenso — é a
 * mesma frase que sai no documento, então quem monta lê o que a empresa vai
 * ler.
 */
export function MetasDoSocial({
  linhas,
  aoMudar,
}: {
  linhas: LinhaDeMeta[];
  aoMudar: (nova: LinhaDeMeta[]) => void;
}) {
  const usados = new Set(linhas.map((l) => l.tipo));
  const livres = TIPOS_DE_META.filter((t) => !usados.has(t));
  const trocar = (i: number, campo: Partial<LinhaDeMeta>) =>
    aoMudar(linhas.map((l, j) => (j === i ? { ...l, ...campo } : l)));

  return (
    <div className="space-y-2">
      <input type="hidden" name="metas_no_formulario" value="1" />
      {linhas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma meta. Sem meta, a empresa não conquista indicações sozinha — só
          as fichas liberadas à mão pelo gestor.
        </p>
      )}
      {linhas.map((l, i) => (
        <div key={l.tipo} className="space-y-1 rounded-md border p-2">
          <input type="hidden" name={`meta_tipo_${i}`} value={l.tipo} />
          <div className="flex flex-wrap items-end gap-2">
            <p className="min-w-44 flex-1 text-sm font-medium">{META_ROTULO[l.tipo]}</p>
            <label className="text-xs">
              A cada
              <Input
                name={`meta_acada_${i}`}
                value={l.aCada}
                onChange={(e) => trocar(i, { aCada: e.target.value })}
                inputMode={l.tipo === "TREATMENT_SPEND" ? "decimal" : "numeric"}
                placeholder={l.tipo === "TREATMENT_SPEND" ? "50.000,00" : "12"}
                className="h-8 w-28"
              />
            </label>
            <span className="pb-2 text-xs text-muted-foreground">{UNIDADE[l.tipo]}</span>
            {l.tipo === "ATTENDANCE" && (
              <label className="text-xs">
                Comparecimento mínimo (%)
                <Input
                  name={`meta_pct_${i}`}
                  value={l.percentual}
                  onChange={(e) => trocar(i, { percentual: e.target.value })}
                  inputMode="numeric"
                  placeholder="80"
                  className="h-8 w-24"
                />
              </label>
            )}
            <label className="text-xs">
              Rende (indicações)
              <Input
                name={`meta_ind_${i}`}
                value={l.indicacoes}
                onChange={(e) => trocar(i, { indicacoes: e.target.value })}
                inputMode="numeric"
                placeholder="1"
                className="h-8 w-24"
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Tirar a meta ${META_ROTULO[l.tipo]}`}
              onClick={() => aoMudar(linhas.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{rotuloDaMeta(linhaParaMeta(l))}</p>
        </div>
      ))}
      {livres.length > 0 && (
        <div className="flex items-center gap-2">
          <Plus className="size-3.5 text-muted-foreground" />
          <select
            aria-label="Incluir meta"
            value=""
            onChange={(e) =>
              e.target.value &&
              aoMudar([
                ...linhas,
                {
                  tipo: e.target.value as TipoDeMeta,
                  aCada: "",
                  indicacoes: "1",
                  percentual: e.target.value === "ATTENDANCE" ? "80" : "",
                },
              ])
            }
            className={selectClass}
          >
            <option value="">Incluir meta…</option>
            {livres.map((t) => (
              <option key={t} value={t}>
                {META_ROTULO[t]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
