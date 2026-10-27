"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  ACRESCIMO_MAXIMO,
  ajusteDoTotal,
  ajusteValido,
  textoDoAjuste,
  totaisDoGrupo,
} from "@/lib/procedimentos/grupos";
import { lerPercentual, percentualParaCampo } from "@/lib/finance/repasse-percentual";
import { definirPrecoDoPacote } from "./actions";

type Tipo = "desconto" | "acrescimo";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O PREÇO DO PACOTE (0325, pedido do dono, 27/10/2026). O Admin Master digita
 * o TOTAL do pacote ou o PERCENTUAL de desconto/acréscimo, e vê o outro. O que
 * fica gravado é o percentual (GP5): vale para qualquer quantidade de dentes e
 * acompanha o catálogo. O total aqui é de referência — preço padrão da rede,
 * um de cada; no plano cada item recebe o mesmo % sobre o preço da unidade.
 */
export function PrecoDoPacote({
  grupoId,
  itens,
  precoDe,
  ajustePercent,
  podeDefinir,
}: {
  grupoId: string;
  itens: { procedureId: string; quantidade: number }[];
  precoDe: Map<string, number>;
  /** Nulo = o banco sem a 0325. */
  ajustePercent: number | null;
  podeDefinir: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("desconto");
  const [percentual, setPercentual] = useState("");
  const [total, setTotal] = useState("");

  const preco = (id: string) => precoDe.get(id) ?? 0;
  const atual = ajustePercent ?? 0;
  const { tabelaCents, pacoteCents } = totaisDoGrupo(itens, preco, atual);

  if (ajustePercent === null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Total de referência (preço padrão da rede, um de cada): {formatBRL(tabelaCents)}. O
        preço do pacote aparece quando o banco receber a atualização 0325.
      </p>
    );
  }

  const assinado = (t: Tipo, p: number) => (t === "desconto" ? -p : p);
  const pctDigitado = lerPercentual(percentual);
  const rascunho = pctDigitado === null ? null : assinado(tipo, pctDigitado);
  const previa = rascunho !== null && ajusteValido(rascunho) ? totaisDoGrupo(itens, preco, rascunho) : null;

  function abrir() {
    setTipo(atual > 0 ? "acrescimo" : "desconto");
    setPercentual(atual ? percentualParaCampo(Math.abs(atual)) : "");
    setTotal(atual ? centsToInput(pacoteCents) : "");
    setEditando(true);
  }

  function aoDigitarPercentual(texto: string, t: Tipo = tipo) {
    setPercentual(texto);
    const p = lerPercentual(texto);
    if (p === null || tabelaCents <= 0) return;
    const s = assinado(t, p);
    if (ajusteValido(s)) setTotal(centsToInput(totaisDoGrupo(itens, preco, s).pacoteCents));
  }

  function aoDigitarTotal(texto: string) {
    setTotal(texto);
    const cents = texto.trim() ? parseBRLToCents(texto) : null;
    if (cents === null) return;
    const p = ajusteDoTotal(cents, tabelaCents);
    if (p === null) return;
    setTipo(p > 0 ? "acrescimo" : "desconto");
    setPercentual(p === 0 ? "" : percentualParaCampo(Math.abs(p)));
  }

  function salvar(valor: number) {
    if (!ajusteValido(valor)) {
      toast.error(`O desconto vai até 99,99% e o acréscimo até ${ACRESCIMO_MAXIMO}%.`);
      return;
    }
    startTransition(async () => {
      const r = await definirPrecoDoPacote(grupoId, valor);
      if (r.ok) {
        toast.success(valor ? "Preço do pacote salvo." : "Ajuste tirado: cada item pelo preço do catálogo.");
        setEditando(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar o preço do pacote.");
      }
    });
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5">
          <Tag className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">Preço do pacote:</span>
          {atual ? (
            <span>
              de <span className="tabular-nums line-through">{formatBRL(tabelaCents)}</span> por{" "}
              <strong className="tabular-nums">{formatBRL(pacoteCents)}</strong>{" "}
              <span className={atual < 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                ({textoDoAjuste(atual)})
              </span>
            </span>
          ) : (
            <span>
              <strong className="tabular-nums">{formatBRL(tabelaCents)}</strong>{" "}
              <span className="text-muted-foreground">(sem ajuste — cada item pelo preço do catálogo)</span>
            </span>
          )}
        </p>
        {podeDefinir && !editando && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={abrir}>
            {atual ? "Alterar" : "Definir desconto ou acréscimo"}
          </Button>
        )}
      </div>

      {editando && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-[10px] text-muted-foreground">Ajuste</span>
              <select
                aria-label="Desconto ou acréscimo"
                value={tipo}
                onChange={(e) => {
                  const t = e.target.value as Tipo;
                  setTipo(t);
                  aoDigitarPercentual(percentual, t);
                }}
                className="block h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
              >
                <option value="desconto">Desconto</option>
                <option value="acrescimo">Acréscimo</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-muted-foreground">Percentual</span>
              <div className="relative">
                <Input
                  aria-label="Percentual do ajuste"
                  className="h-8 w-24 pr-6 text-xs tabular-nums"
                  inputMode="decimal"
                  placeholder="Ex.: 10"
                  value={percentual}
                  onChange={(e) => aoDigitarPercentual(e.target.value)}
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
              </div>
            </label>
            <span className="pb-2 text-muted-foreground">=</span>
            <label className="block">
              <span className="text-[10px] text-muted-foreground">Total do pacote</span>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                <Input
                  aria-label="Total do pacote em R$"
                  className="h-8 w-32 pl-7 text-xs tabular-nums"
                  inputMode="decimal"
                  placeholder={centsToInput(tabelaCents)}
                  disabled={tabelaCents <= 0}
                  value={total}
                  onChange={(e) => aoDigitarTotal(e.target.value)}
                />
              </div>
            </label>
          </div>
          {previa && rascunho !== null && (
            <p>
              No pacote: de <span className="tabular-nums line-through">{formatBRL(previa.tabelaCents)}</span> por{" "}
              <strong className="tabular-nums">{formatBRL(previa.pacoteCents)}</strong> ({textoDoAjuste(rascunho)}).
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Digite o total <strong>ou</strong> o percentual: o outro aparece sozinho. Fica gravado o
            percentual, que cada item recebe sobre o preço do catálogo da unidade — por isso vale
            para qualquer número de dentes. O total aqui é de referência (preço padrão da rede, um de
            cada). Vale para os planos enviados a partir de agora; o que já foi enviado não muda. O
            repasse ao dentista não muda: o desconto sai da margem da clínica.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={isPending || rascunho === null}
              onClick={() => rascunho !== null && salvar(rascunho)}
            >
              Salvar preço do pacote
            </Button>
            {atual !== 0 && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={isPending} onClick={() => salvar(0)}>
                Tirar o ajuste
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={isPending} onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
