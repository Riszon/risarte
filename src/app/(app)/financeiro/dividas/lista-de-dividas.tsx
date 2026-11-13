"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  AGING_BANDS,
  AGING_LABELS,
  DEBT_STATUSES,
  FILTROS_VAZIOS,
  ORDENACOES,
  ORDENACAO_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_TONE,
  diasEmAtraso,
  filtrarDividas,
  ordenarDividas,
  totaisDaLista,
  valorDevido,
  type DebtFilters,
  type DebtListRow,
  type Ordenacao,
} from "@/lib/finance/dividas";
import type { BaseDasDividas } from "./dados";
import { FormularioDaDivida, SELECT_CLASS } from "./formulario-da-divida";

/**
 * A lista do Levantamento de Dívidas (0404): busca, os filtros da 3.9 que já
 * existem na fase 1, ordenação e os totais do rodapé RESPEITANDO os filtros.
 * A conta mora em `src/lib/finance/dividas.ts` (testada).
 */
export function ListaDeDividas({
  base,
  linhas,
  hoje,
  podeLancar,
}: {
  base: BaseDasDividas;
  linhas: DebtListRow[];
  hoje: string;
  podeLancar: boolean;
}) {
  const [filtros, setFiltros] = useState<DebtFilters>(FILTROS_VAZIOS);
  const [ordem, setOrdem] = useState<Ordenacao>("vencimento");
  const [novo, setNovo] = useState(false);
  const [maisFiltros, setMaisFiltros] = useState(false);

  const muda = (p: Partial<DebtFilters>) => setFiltros((f) => ({ ...f, ...p }));
  const visiveis = useMemo(
    () => ordenarDividas(filtrarDividas(linhas, filtros, hoje), ordem),
    [linhas, filtros, hoje, ordem]
  );
  const totais = totaisDaLista(visiveis);
  const algumFiltro = Object.values(filtros).some((v) => v !== "");

  const credoresComDivida = useMemo(() => {
    const ids = new Set(linhas.map((l) => l.supplierId));
    return base.credores.filter((c) => ids.has(c.id));
  }, [linhas, base.credores]);
  const categoriasRaiz = base.categorias.filter((c) => c.parentId === null);
  const subcategorias = base.categorias.filter((c) => c.parentId === filtros.categoria && filtros.categoria !== "");
  const nomeDaEtiqueta = new Map(base.etiquetas.map((t) => [t.id, t.nome]));

  const filtro = (rotulo: string, valor: string, onChange: (v: string) => void, opcoes: { value: string; label: string }[]) => (
    <label className="block min-w-40 flex-1">
      <Label className="text-[11px]">{rotulo}</Label>
      <select className={SELECT_CLASS} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-56 flex-[2]">
          <Label className="text-[11px]">Buscar</Label>
          <Input
            className="h-9"
            placeholder="Código, credor, contrato, descrição"
            value={filtros.busca}
            onChange={(e) => muda({ busca: e.target.value })}
          />
        </label>
        {filtro("Devedor", filtros.devedor, (v) => muda({ devedor: v }), base.devedores.map((d) => ({ value: d.id, label: d.nome })))}
        {filtro("Situação", filtros.situacao, (v) => muda({ situacao: v }), DEBT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })))}
        {filtro(
          "Faixa de atraso",
          filtros.faixa,
          (v) => muda({ faixa: v }),
          [{ value: "a_vencer", label: "Ainda não venceu" }, ...AGING_BANDS.map((b) => ({ value: b, label: AGING_LABELS[b] }))]
        )}
        <label className="block min-w-48">
          <Label className="text-[11px]">Ordenar por</Label>
          <select className={SELECT_CLASS} value={ordem} onChange={(e) => setOrdem(e.target.value as Ordenacao)}>
            {ORDENACOES.map((o) => (
              <option key={o} value={o}>{ORDENACAO_LABELS[o]}</option>
            ))}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setMaisFiltros((x) => !x)}>
          {maisFiltros ? "Menos filtros" : "Mais filtros"}
        </Button>
        {algumFiltro && (
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setFiltros(FILTROS_VAZIOS)}>
            <X className="size-4" /> Limpar
          </Button>
        )}
        {podeLancar && (
          <Button type="button" size="sm" className="ml-auto h-9" onClick={() => setNovo(true)}>
            <Plus className="size-4" /> Nova dívida
          </Button>
        )}
      </div>

      {maisFiltros && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
          {filtro("Credor", filtros.credor, (v) => muda({ credor: v }), credoresComDivida.map((c) => ({ value: c.id, label: c.nome })))}
          {filtro("Tipo do credor", filtros.tipoDoCredor, (v) => muda({ tipoDoCredor: v }), base.tiposDeCredor.map((k) => ({ value: k.code, label: k.label })))}
          {filtro("Categoria", filtros.categoria, (v) => muda({ categoria: v, subcategoria: "" }), categoriasRaiz.map((c) => ({ value: c.id, label: c.nome })))}
          {subcategorias.length > 0 &&
            filtro("Subcategoria", filtros.subcategoria, (v) => muda({ subcategoria: v }), subcategorias.map((c) => ({ value: c.id, label: c.nome })))}
          {filtro("Natureza", filtros.natureza, (v) => muda({ natureza: v }), base.naturezas.map((n) => ({ value: n.code, label: n.label })))}
          {filtro("Etiqueta", filtros.etiqueta, (v) => muda({ etiqueta: v }), base.etiquetas.map((t) => ({ value: t.id, label: t.nome })))}
          {filtro("Prioridade", filtros.prioridade, (v) => muda({ prioridade: v }), PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })))}
          {filtro("Responsável", filtros.responsavel, (v) => muda({ responsavel: v }), base.responsaveis.map((p) => ({ value: p.id, label: p.nome })))}
          <label className="block">
            <Label className="text-[11px]">Vence de</Label>
            <Input className="h-9" type="date" value={filtros.vencimentoDe} onChange={(e) => muda({ vencimentoDe: e.target.value })} />
          </label>
          <label className="block">
            <Label className="text-[11px]">até</Label>
            <Input className="h-9" type="date" value={filtros.vencimentoAte} onChange={(e) => muda({ vencimentoAte: e.target.value })} />
          </label>
        </div>
      )}

      {linhas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma dívida cadastrada ainda.
            {podeLancar && " Use “Nova dívida” para lançar a primeira. A importação da planilha chega na fase 4."}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Código</th>
                <th className="px-2 py-2">Devedor</th>
                <th className="px-2 py-2">Credor</th>
                <th className="px-2 py-2">Vencimento</th>
                <th className="px-2 py-2">Situação</th>
                <th className="px-2 py-2 text-right">Valor devido</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => {
                const atraso = diasEmAtraso(r.dueDate, hoje);
                return (
                  <tr key={r.id} className="border-t align-top hover:bg-muted/30">
                    <td className="whitespace-nowrap px-2 py-2">
                      <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/financeiro/dividas/${r.id}`}>
                        {r.code}
                      </Link>
                      {r.groupCode && <span className="block text-[11px] text-muted-foreground">{r.groupCode}</span>}
                    </td>
                    <td className="px-2 py-2">{r.clinicName}</td>
                    <td className="px-2 py-2">
                      {r.supplierName}
                      <span className="block text-[11px] text-muted-foreground">
                        {[r.contractNumber, r.installmentLabel, r.description].filter(Boolean).join(" · ")}
                      </span>
                      {(r.tagIds.length > 0 || r.needsSplit) && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {r.needsSplit && (
                            <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                              Desdobrar{r.bundledCount > 1 ? ` (${r.bundledCount})` : ""}
                            </span>
                          )}
                          {r.tagIds.map((t) => (
                            <span key={t} className="rounded bg-muted px-1.5 text-[10px]">{nomeDaEtiqueta.get(t) ?? "etiqueta"}</span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {formatIsoDateBr(r.dueDate)}
                      {atraso > 0 && <span className="block text-[11px] text-muted-foreground">{atraso} dia{atraso === 1 ? "" : "s"} de atraso</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-xs", STATUS_TONE[r.status])}>{STATUS_LABELS[r.status]}</span>
                      {r.priority && <span className="block text-[11px] text-muted-foreground">Prioridade {PRIORITY_LABELS[r.priority].toLowerCase()}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatBRL(valorDevido(r))}</td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                    Nenhuma dívida com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-xs">
              <tr>
                <td colSpan={5} className="px-2 py-2">
                  {totais.quantidade} dívida{totais.quantidade === 1 ? "" : "s"}
                  {algumFiltro && " (com os filtros)"} · valor original {formatBRL(totais.originalCents)}
                  {totais.contestadaJudicialCents > 0 && ` · contestadas/judiciais ${formatBRL(totais.contestadaJudicialCents)}`}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{formatBRL(totais.devidoCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Valor devido = o valor atualizado informado, senão o original. Pagamentos, propostas e economia entram nas próximas fases.
      </p>

      {novo && <FormularioDaDivida base={base} inicial={null} aberto={novo} onFechar={() => setNovo(false)} />}
    </div>
  );
}
