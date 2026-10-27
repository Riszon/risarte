"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Vantagem, VantagemEscolhida } from "@/lib/empresarial/vantagens";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-xs";

/**
 * ESCOLHER AS OUTRAS VANTAGENS E ESCREVER O DETALHE (1033).
 *
 * O mesmo componente no grupo (Configurações) e na proposta: as duas telas
 * fazem a mesma pergunta, e duas versões dela passariam a divergir.
 *
 * Manda para o formulário `vant_i` (a vantagem) e `vant_det_i` (o detalhe), e
 * a marca `vantagens_no_formulario` — sem ela o servidor não sabe se a lista
 * veio vazia de propósito ou se o bloco nem estava na tela.
 */
export function VantagensEscolhidas({
  catalogo,
  lista,
  aoMudar,
  dicaDoDetalhe = "Detalhe desta empresa (ex.: 2 palestras por ano)",
}: {
  catalogo: Vantagem[];
  lista: VantagemEscolhida[];
  aoMudar: (nova: VantagemEscolhida[]) => void;
  dicaDoDetalhe?: string;
}) {
  const porId = new Map(catalogo.map((v) => [v.id, v]));
  // Só as DISPONÍVEIS entram na lista de escolha; a que foi desativada e já
  // estava escolhida continua aparecendo — tirá-la é decisão de quem edita.
  const disponiveis = catalogo.filter(
    (v) => v.isActive && !lista.some((e) => e.perkId === v.id)
  );

  return (
    <div className="space-y-1">
      <input type="hidden" name="vantagens_no_formulario" value="1" />
      {lista.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">Nenhuma vantagem escolhida.</p>
      )}
      {lista.map((e, i) => {
        const v = porId.get(e.perkId);
        return (
          <div key={e.perkId} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <input type="hidden" name={`vant_${i}`} value={e.perkId} />
            <div className="min-w-40 flex-1">
              <p className="text-sm font-medium">
                {v?.name ?? "(vantagem)"}
                {v && !v.isActive && (
                  <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                    (indisponível na rede)
                  </span>
                )}
              </p>
              {v?.description && (
                <p className="text-xs text-muted-foreground">{v.description}</p>
              )}
            </div>
            <Input
              name={`vant_det_${i}`}
              value={e.detail ?? ""}
              maxLength={500}
              aria-label={`Detalhe de ${v?.name ?? "vantagem"}`}
              placeholder={dicaDoDetalhe}
              onChange={(ev) =>
                aoMudar(
                  lista.map((x, j) => (j === i ? { ...x, detail: ev.target.value } : x))
                )
              }
              className="h-8 min-w-56 flex-[2] text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Tirar ${v?.name ?? "a vantagem"}`}
              onClick={() => aoMudar(lista.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <select
        aria-label="Incluir outra vantagem"
        value=""
        onChange={(ev) =>
          ev.target.value && aoMudar([...lista, { perkId: ev.target.value, detail: null }])
        }
        className={selectClass}
        disabled={disponiveis.length === 0}
      >
        <option value="">
          {catalogo.length === 0
            ? "— nenhuma vantagem cadastrada em Configurações —"
            : disponiveis.length === 0
              ? "— todas as vantagens já foram escolhidas —"
              : "+ Incluir outra vantagem"}
        </option>
        {disponiveis.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}
