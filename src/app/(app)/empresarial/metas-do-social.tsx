"use client";

import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONDICAO_ROTULO,
  CONDICAO_UNIDADE,
  TIPOS_DE_CONDICAO,
  metasParaGravar,
  rotuloDaMeta,
  type MetaSocial,
  type TipoDeCondicao,
} from "@/lib/empresarial/riso-social";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Uma linha do editor: os números ficam em texto enquanto se digita. */
export type LinhaDeMeta = {
  id: string;
  indicacoes: string;
  /** Vazio = rende uma vez só. */
  renova: string;
  condicoes: { tipo: TipoDeCondicao; minimo: string }[];
};

const emReais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function metasParaLinhas(metas: readonly MetaSocial[]): LinhaDeMeta[] {
  return metas.map((m) => ({
    id: m.id,
    indicacoes: String(m.indicacoes),
    renova: m.renovaMeses != null ? String(m.renovaMeses) : "",
    condicoes: m.condicoes.map((c) => ({
      tipo: c.tipo,
      minimo:
        c.tipo === "TREATMENT_SPEND"
          ? emReais(c.minimo)
          : c.tipo === "FEES_UP_TO_DATE"
            ? ""
            : String(c.minimo),
    })),
  }));
}

const numero = (s: string) => Number.parseInt(s.replace(/\D/g, ""), 10) || 0;

/** A linha em texto → a meta (gasto em centavos). Vai no `metas_json`. */
function linhaParaMeta(l: LinhaDeMeta): MetaSocial {
  return {
    id: l.id,
    indicacoes: numero(l.indicacoes),
    renovaMeses: l.renova.trim() ? numero(l.renova) : null,
    condicoes: l.condicoes.map((c) => ({
      tipo: c.tipo,
      minimo:
        c.tipo === "TREATMENT_SPEND"
          ? Math.round(
              (Number.parseFloat(c.minimo.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0) * 100
            )
          : c.tipo === "FEES_UP_TO_DATE"
            ? 0
            : numero(c.minimo),
    })),
  };
}

const PLACEHOLDER: Record<TipoDeCondicao, string> = {
  EMPLOYEE_COUNT: "20",
  DEPENDENT_COUNT: "10",
  TIME_IN_PROGRAM: "6",
  ATTENDANCE: "80",
  TREATMENT_SPEND: "50.000,00",
  FEES_UP_TO_DATE: "",
};

const novoId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * O EDITOR DAS METAS DO RISO+ SOCIAL (1035) — o mesmo na proposta e na empresa.
 *
 * Cada meta: as condições "pelo menos" (todas ao mesmo tempo), quantas
 * indicações rende e, se quiser, "renova a cada N meses". Embaixo, a meta
 * escrita por extenso — é a mesma frase que sai no documento, então quem
 * monta lê o que a empresa vai ler. Tudo vai num campo só (`metas_json`).
 */
export function MetasDoSocial({
  linhas,
  aoMudar,
}: {
  linhas: LinhaDeMeta[];
  aoMudar: (nova: LinhaDeMeta[]) => void;
}) {
  const trocar = (i: number, campo: Partial<LinhaDeMeta>) =>
    aoMudar(linhas.map((l, j) => (j === i ? { ...l, ...campo } : l)));
  const trocarCondicao = (i: number, k: number, minimo: string) =>
    trocar(i, {
      condicoes: linhas[i].condicoes.map((c, j) => (j === k ? { ...c, minimo } : c)),
    });

  return (
    <div className="space-y-2">
      <input type="hidden" name="metas_no_formulario" value="1" />
      <input
        type="hidden"
        name="metas_json"
        value={JSON.stringify(metasParaGravar(linhas.map(linhaParaMeta)))}
      />
      {linhas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma meta. Sem meta, a empresa não conquista indicações sozinha — só
          as fichas avulsas liberadas pelo gestor.
        </p>
      )}
      {linhas.map((l, i) => {
        const usados = new Set(l.condicoes.map((c) => c.tipo));
        const livres = TIPOS_DE_CONDICAO.filter((t) => !usados.has(t));
        return (
          <div key={l.id} className="space-y-2 rounded-md border p-2">
            <div className="flex flex-wrap items-end gap-2">
              <p className="flex-1 text-sm font-medium">Meta {i + 1}</p>
              <label className="text-xs">
                Rende (indicações)
                <Input
                  value={l.indicacoes}
                  onChange={(e) => trocar(i, { indicacoes: e.target.value })}
                  inputMode="numeric"
                  placeholder="1"
                  aria-label={`Indicações da meta ${i + 1}`}
                  className="h-8 w-24"
                />
              </label>
              <label className="text-xs">
                Renova a cada (meses)
                <Input
                  value={l.renova}
                  onChange={(e) => trocar(i, { renova: e.target.value })}
                  inputMode="numeric"
                  placeholder="uma vez só"
                  aria-label={`Renovação da meta ${i + 1}`}
                  className="h-8 w-28"
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                aria-label={`Tirar a meta ${i + 1}`}
                onClick={() => aoMudar(linhas.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Condições — todas precisam valer ao mesmo tempo:
            </p>
            {l.condicoes.length === 0 && (
              <p className="text-xs text-destructive">Inclua ao menos uma condição.</p>
            )}
            {l.condicoes.map((c, k) => (
              <div key={c.tipo} className="flex flex-wrap items-center gap-2 pl-2">
                <span className="min-w-44 text-sm">{CONDICAO_ROTULO[c.tipo]}</span>
                {c.tipo === "FEES_UP_TO_DATE" ? (
                  <span className="text-xs text-muted-foreground">
                    nenhuma mensalidade vencida sem pagamento
                  </span>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">pelo menos</span>
                    <Input
                      value={c.minimo}
                      onChange={(e) => trocarCondicao(i, k, e.target.value)}
                      inputMode={c.tipo === "TREATMENT_SPEND" ? "decimal" : "numeric"}
                      placeholder={PLACEHOLDER[c.tipo]}
                      aria-label={`${CONDICAO_ROTULO[c.tipo]}, mínimo, meta ${i + 1}`}
                      className="h-8 w-28"
                    />
                    <span className="text-xs text-muted-foreground">
                      {CONDICAO_UNIDADE[c.tipo]}
                      {c.tipo === "ATTENDANCE" ? " nos últimos 12 meses" : ""}
                    </span>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5"
                  aria-label={`Tirar a condição ${CONDICAO_ROTULO[c.tipo]} da meta ${i + 1}`}
                  onClick={() =>
                    trocar(i, { condicoes: l.condicoes.filter((_, j) => j !== k) })
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            {livres.length > 0 && (
              <div className="flex items-center gap-2 pl-2">
                <Plus className="size-3.5 text-muted-foreground" />
                <select
                  aria-label={`Incluir condição na meta ${i + 1}`}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    trocar(i, {
                      condicoes: [
                        ...l.condicoes,
                        { tipo: e.target.value as TipoDeCondicao, minimo: "" },
                      ],
                    })
                  }
                  className={selectClass}
                >
                  <option value="">Incluir condição…</option>
                  {livres.map((t) => (
                    <option key={t} value={t}>
                      {CONDICAO_ROTULO[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{rotuloDaMeta(linhaParaMeta(l))}</p>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          aoMudar([...linhas, { id: novoId(), indicacoes: "1", renova: "", condicoes: [] }])
        }
      >
        <Plus className="mr-1 size-3.5" />
        Nova meta
      </Button>
    </div>
  );
}
