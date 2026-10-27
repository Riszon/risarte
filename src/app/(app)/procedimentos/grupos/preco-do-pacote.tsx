"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldAlert, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import {
  ACRESCIMO_MAXIMO,
  ajusteDoItem,
  ajusteDoPreco,
  ajusteDoTotal,
  ajusteEfetivo,
  ajusteParaUmSo,
  ajusteValido,
  minimoValido,
  pisoDoPacote,
  precoNoPacote,
  temDistribuicaoPropria,
  textoDoAjuste,
  totaisDoGrupo,
} from "@/lib/procedimentos/grupos";
import { lerPercentual, percentualParaCampo } from "@/lib/finance/repasse-percentual";
import { definirPrecoDoPacote } from "./actions";

type Tipo = "desconto" | "acrescimo";
/** GP9 (0328): de onde sai o desconto (ou o acréscimo) do pacote. */
type Modo = "igual" | "um" | "cada";

type Item = {
  procedureId: string;
  quantidade: number;
  nome: string;
  /** O percentual próprio (0328); nulo = o do grupo; undefined = não lido. */
  ajustePercent?: number | null;
};

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O PREÇO DO PACOTE (0325), o MÍNIMO NA NEGOCIAÇÃO (0326) e DE ONDE SAI O
 * DESCONTO (0328), pedidos do dono em 27/10/2026. O Admin Master digita o
 * TOTAL ou o PERCENTUAL e vê o outro; tudo fica gravado em % (vale para
 * qualquer número de dentes). Os totais aqui são de referência — preço padrão
 * da rede, um de cada; no plano cada item recebe o seu % sobre o preço da
 * unidade.
 *
 * O desconto pode sair igual de todos (como era), de um procedimento só, ou de
 * cada um na medida escolhida. O mínimo TRAVA a negociação (GP7).
 */
export function PrecoDoPacote({
  grupoId,
  itens,
  precoDe,
  ajustePercent,
  minimoPercent,
  podeDefinir,
}: {
  grupoId: string;
  itens: Item[];
  precoDe: Map<string, number>;
  /** Nulo = o banco sem a 0325. */
  ajustePercent: number | null;
  /** Nulo = sem mínimo; undefined = o banco sem a 0326. */
  minimoPercent: number | null | undefined;
  podeDefinir: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [modo, setModo] = useState<Modo>("igual");
  const [tipo, setTipo] = useState<Tipo>("desconto");
  const [percentual, setPercentual] = useState("");
  const [total, setTotal] = useState("");
  const [umSo, setUmSo] = useState("");
  const [totalUmSo, setTotalUmSo] = useState("");
  const [precoDeCada, setPrecoDeCada] = useState<Record<string, string>>({});
  const [minimo, setMinimo] = useState("");
  const [minimoTotal, setMinimoTotal] = useState("");

  const preco = (id: string) => precoDe.get(id) ?? 0;
  const atual = ajustePercent ?? 0;
  const { tabelaCents, pacoteCents } = totaisDoGrupo(itens, preco, atual);
  const efetivoAtual = ajusteDoTotal(pacoteCents, tabelaCents) ?? 0;
  const temMinimo = minimoPercent !== undefined;
  // Sem ler o percentual de cada procedimento (banco sem a 0328), só "igual".
  const distribuicaoLida = itens.every((i) => i.ajustePercent !== undefined);
  const proprios = itens.filter((i) => i.ajustePercent != null);

  if (ajustePercent === null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Total de referência (preço padrão da rede, um de cada): {formatBRL(tabelaCents)}. O
        preço do pacote aparece quando o banco receber a atualização 0325.
      </p>
    );
  }

  // ---- o rascunho, conforme o modo -------------------------------------------
  const assinado = (t: Tipo, p: number) => (t === "desconto" ? -p : p);
  const pctDigitado = lerPercentual(percentual);
  const ajusteIgual = pctDigitado === null ? (percentual.trim() === "" ? 0 : null) : assinado(tipo, pctDigitado);
  const totalUmSoCents = totalUmSo.trim() ? parseBRLToCents(totalUmSo) : null;
  const ajusteDoUmSo =
    umSo && totalUmSoCents !== null ? ajusteParaUmSo(itens, preco, umSo, totalUmSoCents) : null;
  const ajusteDeCada: Record<string, number | null> = Object.fromEntries(
    itens.map((i) => {
      const t = (precoDeCada[i.procedureId] ?? "").trim();
      if (!t) return [i.procedureId, 0];
      const c = parseBRLToCents(t);
      // O campo é o preço do item no pacote × a quantidade (como a coluna Tabela).
      const p = c === null ? null : ajusteDoPreco(c, preco(i.procedureId) * i.quantidade);
      return [i.procedureId, p !== null && ajusteValido(p) ? p : null];
    })
  );
  // O que vai para o banco: o % do grupo e o % próprio de cada procedimento.
  const rascunho: { grupo: number; itens: { procedureId: string; percent: number | null }[] } | null =
    modo === "igual"
      ? ajusteIgual === null
        ? null
        : { grupo: ajusteIgual, itens: [] }
      : modo === "um"
        ? ajusteDoUmSo === null
          ? null
          : { grupo: 0, itens: [{ procedureId: umSo, percent: ajusteDoUmSo }] }
        : Object.values(ajusteDeCada).some((p) => p === null)
          ? null
          : {
              grupo: 0,
              itens: itens
                .filter((i) => (ajusteDeCada[i.procedureId] ?? 0) !== 0)
                .map((i) => ({ procedureId: i.procedureId, percent: ajusteDeCada[i.procedureId] })),
            };
  const itensDoRascunho: Item[] | null = rascunho
    ? itens.map((i) => ({
        ...i,
        ajustePercent: rascunho.itens.find((x) => x.procedureId === i.procedureId)?.percent ?? null,
      }))
    : null;
  const previa = rascunho && itensDoRascunho ? totaisDoGrupo(itensDoRascunho, preco, rascunho.grupo) : null;
  const efetivoDoRascunho =
    rascunho && itensDoRascunho ? (ajusteEfetivo(itensDoRascunho, preco, rascunho.grupo) ?? rascunho.grupo) : null;

  const minimoRascunho = minimo.trim() === "" ? null : lerPercentual(minimo);
  const problemaDoMinimo =
    temMinimo && efetivoDoRascunho !== null && !(minimo.trim() !== "" && minimoRascunho === null)
      ? minimoValido(minimoRascunho, efetivoDoRascunho)
      : null;

  function abrir() {
    const proprio = temDistribuicaoPropria(itens);
    setModo(proprio ? (proprios.length === 1 && atual === 0 ? "um" : "cada") : "igual");
    setTipo(atual > 0 ? "acrescimo" : "desconto");
    setPercentual(atual ? percentualParaCampo(Math.abs(atual)) : "");
    setTotal(atual ? centsToInput(pacoteCents) : "");
    setUmSo(proprios.length === 1 ? proprios[0].procedureId : (itens[0]?.procedureId ?? ""));
    setTotalUmSo(proprio ? centsToInput(pacoteCents) : "");
    setPrecoDeCada(
      Object.fromEntries(
        itens.map((i) => {
          const pct = ajusteDoItem(i, atual);
          return [i.procedureId, pct ? centsToInput(precoNoPacote(preco(i.procedureId), pct) * i.quantidade) : ""];
        })
      )
    );
    setMinimo(minimoPercent ? percentualParaCampo(minimoPercent) : "");
    setMinimoTotal(minimoPercent ? centsToInput(pisoDoPacote(tabelaCents, minimoPercent)) : "");
    setEditando(true);
  }

  function aoDigitarPercentual(texto: string, t: Tipo = tipo) {
    setPercentual(texto);
    const p = lerPercentual(texto);
    if (p === null || tabelaCents <= 0) return;
    const s = assinado(t, p);
    if (ajusteValido(s)) setTotal(centsToInput(totaisDoGrupo(itens.map((i) => ({ ...i, ajustePercent: null })), preco, s).pacoteCents));
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

  function aoDigitarMinimo(texto: string) {
    setMinimo(texto);
    const p = lerPercentual(texto);
    if (texto.trim() === "") setMinimoTotal("");
    else if (p !== null && tabelaCents > 0) setMinimoTotal(centsToInput(pisoDoPacote(tabelaCents, p)));
  }

  function aoDigitarMinimoTotal(texto: string) {
    setMinimoTotal(texto);
    if (texto.trim() === "") {
      setMinimo("");
      return;
    }
    const cents = parseBRLToCents(texto);
    if (cents === null || tabelaCents <= 0) return;
    setMinimo(percentualParaCampo(Math.round((cents / tabelaCents) * 10000) / 100));
  }

  function salvar() {
    if (!rascunho) return;
    if (!ajusteValido(rascunho.grupo)) {
      toast.error(`O desconto vai até 99,99% e o acréscimo até ${ACRESCIMO_MAXIMO}%.`);
      return;
    }
    startTransition(async () => {
      const r = await definirPrecoDoPacote(
        grupoId,
        rascunho.grupo,
        temMinimo ? minimoRascunho : undefined,
        // Sem ler a distribuição (banco sem a 0328), grava como antes.
        distribuicaoLida && temMinimo ? rascunho.itens : undefined,
        efetivoDoRascunho ?? undefined
      );
      if (r.ok) {
        toast.success("Preço do pacote salvo.");
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
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5">
            <Tag className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium">Preço do pacote:</span>
            {pacoteCents !== tabelaCents ? (
              <span>
                de <span className="tabular-nums line-through">{formatBRL(tabelaCents)}</span> por{" "}
                <strong className="tabular-nums">{formatBRL(pacoteCents)}</strong>{" "}
                <span className={efetivoAtual < 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                  ({textoDoAjuste(efetivoAtual)})
                </span>
              </span>
            ) : (
              <span>
                <strong className="tabular-nums">{formatBRL(tabelaCents)}</strong>{" "}
                <span className="text-muted-foreground">(sem ajuste — cada item pelo preço do catálogo)</span>
              </span>
            )}
          </p>
          {proprios.length > 0 && (
            <p className="pl-5 text-muted-foreground">
              Sai de:{" "}
              {proprios
                .map((i) => `${i.nome} (${textoDoAjuste(i.ajustePercent ?? 0)})`)
                .join(" · ")}
              {atual !== 0 && ` · os demais, ${textoDoAjuste(atual)}`}
            </p>
          )}
          {temMinimo && (
            <p className="flex flex-wrap items-center gap-1.5">
              <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">Mínimo na negociação:</span>
              {minimoPercent ? (
                <span>
                  <strong className="tabular-nums">{formatBRL(pisoDoPacote(tabelaCents, minimoPercent))}</strong>{" "}
                  <span className="text-muted-foreground">
                    ({percentualParaCampo(minimoPercent)}% da tabela — abaixo disso, só com autorização do Gerente)
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">sem mínimo (vale o teto de desconto da unidade)</span>
              )}
            </p>
          )}
        </div>
        {podeDefinir && !editando && (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={abrir}>
            {pacoteCents !== tabelaCents || minimoPercent ? "Alterar" : "Definir preço e mínimo"}
          </Button>
        )}
      </div>

      {editando && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <p className="text-[11px] font-medium">Preço do pacote</p>
          <label className="block">
            <span className="text-[10px] text-muted-foreground">De onde sai o desconto (ou o acréscimo)</span>
            <select
              aria-label="De onde sai o desconto"
              value={modo}
              onChange={(e) => setModo(e.target.value as Modo)}
              className="block h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
            >
              <option value="igual">Um pouco de cada — o mesmo % em todos</option>
              <option value="um" disabled={!distribuicaoLida}>De um procedimento só</option>
              <option value="cada" disabled={!distribuicaoLida}>Escolher o preço de cada um</option>
            </select>
          </label>

          {modo === "igual" && (
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
          )}

          {modo === "um" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-[10px] text-muted-foreground">O desconto sai de</span>
                <select
                  aria-label="Procedimento que absorve o desconto"
                  value={umSo}
                  onChange={(e) => setUmSo(e.target.value)}
                  className="block h-8 max-w-64 rounded-lg border border-input bg-transparent px-2 text-xs"
                >
                  {itens.map((i) => (
                    <option key={i.procedureId} value={i.procedureId}>
                      {i.nome} ({formatBRL(preco(i.procedureId) * i.quantidade)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] text-muted-foreground">Total do pacote</span>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                  <Input
                    aria-label="Total do pacote com o desconto num procedimento só"
                    className="h-8 w-32 pl-7 text-xs tabular-nums"
                    inputMode="decimal"
                    placeholder={centsToInput(tabelaCents)}
                    value={totalUmSo}
                    onChange={(e) => setTotalUmSo(e.target.value)}
                  />
                </div>
              </label>
              {totalUmSoCents !== null && ajusteDoUmSo === null && (
                <p className="pb-2 text-destructive">
                  Não fecha: o desconto passa do preço desse procedimento (ou o acréscimo passa de {ACRESCIMO_MAXIMO}%).
                </p>
              )}
            </div>
          )}

          {modo === "cada" && (
            <table className="w-full text-left">
              <thead className="text-[10px] text-muted-foreground">
                <tr>
                  <th className="py-0.5 font-medium">Procedimento</th>
                  <th className="py-0.5 font-medium">Tabela</th>
                  <th className="py-0.5 font-medium">No pacote</th>
                  <th className="py-0.5 font-medium">Ajuste</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const pct = ajusteDeCada[i.procedureId];
                  return (
                    <tr key={i.procedureId} className="border-t">
                      <td className="py-1 pr-2">
                        {i.nome}
                        {i.quantidade > 1 && ` × ${i.quantidade}`}
                      </td>
                      <td className="py-1 pr-2 tabular-nums">{formatBRL(preco(i.procedureId) * i.quantidade)}</td>
                      <td className="py-1 pr-2">
                        <div className="relative">
                          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                          <Input
                            aria-label={`${i.nome} — preço no pacote`}
                            className="h-7 w-28 pl-7 text-xs tabular-nums"
                            inputMode="decimal"
                            placeholder={centsToInput(preco(i.procedureId) * i.quantidade)}
                            value={precoDeCada[i.procedureId] ?? ""}
                            onChange={(e) => setPrecoDeCada((d) => ({ ...d, [i.procedureId]: e.target.value }))}
                          />
                        </div>
                      </td>
                      <td className={pct === null ? "py-1 text-destructive" : "py-1 tabular-nums text-muted-foreground"}>
                        {pct === null ? "fora do limite" : textoDoAjuste(pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {previa && efetivoDoRascunho !== null && (
            <div className="space-y-0.5">
              <p>
                No pacote: de <span className="tabular-nums line-through">{formatBRL(previa.tabelaCents)}</span> por{" "}
                <strong className="tabular-nums">{formatBRL(previa.pacoteCents)}</strong> ({textoDoAjuste(efetivoDoRascunho)}).
              </p>
              {modo !== "igual" && itensDoRascunho && (
                <p className="text-muted-foreground">
                  {itensDoRascunho
                    .map((i) => {
                      const pct = ajusteDoItem(i, rascunho?.grupo ?? 0);
                      return `${i.nome}: ${formatBRL(precoNoPacote(preco(i.procedureId), pct) * i.quantidade)}${pct ? ` (${textoDoAjuste(pct)})` : ""}`;
                    })
                    .join(" · ")}
                </p>
              )}
            </div>
          )}

          {temMinimo && (
            <>
              <p className="pt-1 text-[11px] font-medium">Mínimo na negociação (opcional)</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">% da tabela</span>
                  <div className="relative">
                    <Input
                      aria-label="Mínimo em percentual da tabela"
                      className="h-8 w-24 pr-6 text-xs tabular-nums"
                      inputMode="decimal"
                      placeholder="Ex.: 80"
                      value={minimo}
                      onChange={(e) => aoDigitarMinimo(e.target.value)}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
                  </div>
                </label>
                <span className="pb-2 text-muted-foreground">=</span>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Total mínimo</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                    <Input
                      aria-label="Total mínimo em R$"
                      className="h-8 w-32 pl-7 text-xs tabular-nums"
                      inputMode="decimal"
                      placeholder="sem mínimo"
                      disabled={tabelaCents <= 0}
                      value={minimoTotal}
                      onChange={(e) => aoDigitarMinimoTotal(e.target.value)}
                    />
                  </div>
                </label>
              </div>
              {problemaDoMinimo && <p className="text-destructive">{problemaDoMinimo}</p>}
            </>
          )}

          <p className="text-[10px] text-muted-foreground">
            Digite o total <strong>ou</strong> o percentual: o outro aparece sozinho. O desconto
            pode sair <strong>um pouco de cada</strong> (o mesmo % em todos), de{" "}
            <strong>um procedimento só</strong>, ou do jeito que você escolher em cada um. Fica
            gravado o percentual de cada procedimento, aplicado sobre o preço do catálogo da
            unidade — por isso vale para qualquer número de dentes. Os totais aqui são de referência
            (preço padrão da rede, um de cada). O preço vale para os planos enviados a partir de
            agora.
            {temMinimo &&
              " O mínimo vale na negociação: se o desconto do Comercial deixar o pacote abaixo dele, a negociação espera a autorização do Gerente."}{" "}
            O repasse ao dentista não muda: o desconto sai da margem da clínica.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={
                isPending ||
                rascunho === null ||
                Boolean(problemaDoMinimo) ||
                (temMinimo && minimo.trim() !== "" && minimoRascunho === null)
              }
              onClick={salvar}
            >
              Salvar preço do pacote
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={isPending} onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
