"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MinusCircle, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { PRIORITY_LABELS, centavosDoCampo, valorDevido, type DebtListRow } from "@/lib/finance/dividas";
import { simularQuitacao, type ItemDoSimulador } from "@/lib/finance/dividas-simulador";
import { caixaProjetado } from "./actions";

// O SIMULADOR DE QUITAÇÃO (fase 8, 3.12 do pedido): as dívidas escolhidas na
// lista, quanto custa quitar o conjunto (proposta ou devido + custas), a
// economia e a ordem sugerida. Cada CNPJ paga com o próprio caixa: o valor
// disponível é por devedor (sugerido pelo caixa projetado). Só tela.

const emTexto = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function SimuladorDeQuitacao({ linhas, onFechar }: { linhas: DebtListRow[]; onFechar: () => void }) {
  const itens: ItemDoSimulador[] = useMemo(
    () =>
      linhas.map((r) => ({
        id: r.id,
        code: r.code,
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        supplierName: r.supplierName,
        devidoCents: valorDevido(r),
        propostaCents: r.propostaCents,
        propostaValidade: r.propostaValidade,
        custasCents: r.custasCents,
        prioridade: r.priority,
        comRestricao: r.negativada || r.protestada || r.judicial,
      })),
    [linhas]
  );
  const [texto, setTexto] = useState<Record<string, string>>({});
  const [caixa, setCaixa] = useState<Record<string, { menorCents: number; diaDoMenor: string; saldoHojeCents: number }>>({});
  const [lendo, setLendo] = useState(false);

  const disponivel = useMemo(() => {
    const d: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(texto)) {
      const c = centavosDoCampo(v);
      d[k] = c === null || Number.isNaN(c) ? null : c;
    }
    return d;
  }, [texto]);
  const s = useMemo(() => simularQuitacao(itens, disponivel), [itens, disponivel]);

  const usarCaixa = async () => {
    setLendo(true);
    try {
      const r = await caixaProjetado(s.devedores.map((d) => d.clinicId));
      if (!r.ok || !r.caixas) return toast.error(r.error ?? "Não foi possível ler o caixa.");
      setCaixa(r.caixas);
      setTexto((t) => {
        const novo = { ...t };
        for (const [k, v] of Object.entries(r.caixas!)) novo[k] = emTexto(Math.max(0, v.menorCents));
        return novo;
      });
    } finally {
      setLendo(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Simulador de quitação — {itens.length} dívida{itens.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <Numero rotulo="Devido" valor={formatBRL(s.totais.devidoCents)} />
            <Numero rotulo="Custo para quitar tudo" valor={formatBRL(s.totais.custoCents)} nota={s.totais.custasCents > 0 ? `com ${formatBRL(s.totais.custasCents)} de custas` : "sem custas"} />
            <Numero rotulo="Economia" valor={formatBRL(s.totais.economiaCents)} nota="só onde há proposta" />
            <Numero rotulo="Sem proposta" valor={String(s.totais.semProposta)} nota="entram pelo valor devido" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={lendo} onClick={usarCaixa}>
              <Wallet className="size-4" /> {lendo ? "Lendo o caixa…" : "Usar o caixa projetado"}
            </Button>
            <span className="text-xs text-muted-foreground">
              O menor saldo previsto para os próximos 30 dias de cada CNPJ — gastar mais que isso deixaria o caixa negativo em algum dia. Dá
              para mudar o valor.
            </span>
          </div>

          {s.devedores.map((d) => (
            <div key={d.clinicId} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="font-medium">{d.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Custo para quitar as {d.itens.length}: {formatBRL(d.custoCents)}
                    {caixa[d.clinicId] &&
                      ` · caixa hoje ${formatBRL(caixa[d.clinicId].saldoHojeCents)}, menor em 30 dias ${formatBRL(caixa[d.clinicId].menorCents)} (${formatIsoDateBr(caixa[d.clinicId].diaDoMenor)})`}
                  </p>
                </div>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Disponível para quitar (R$)</span>
                  <Input
                    className="h-8 w-36 text-right"
                    inputMode="decimal"
                    placeholder="—"
                    value={texto[d.clinicId] ?? ""}
                    onChange={(e) => setTexto({ ...texto, [d.clinicId]: e.target.value })}
                  />
                </label>
              </div>
              <ol className="divide-y rounded-md border">
                {d.itens.map((i) => (
                  <li key={i.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1.5", i.cabe === false && "opacity-60")}>
                    <span className="w-5 text-right text-xs text-muted-foreground">{i.ordem}.</span>
                    {i.cabe === true && <CheckCircle2 className="size-4 text-emerald-600" aria-label="Cabe" />}
                    {i.cabe === false && <MinusCircle className="size-4 text-muted-foreground" aria-label="Não cabe" />}
                    <span className="font-medium">{i.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {i.supplierName}
                      {i.prioridade && ` · prioridade ${PRIORITY_LABELS[i.prioridade].toLowerCase()}`}
                      {i.comRestricao && " · com restrição"}
                      {i.desconto !== null && i.desconto > 0 && ` · ${Math.round(i.desconto * 100)}% de desconto`}
                      {i.propostaValidade && ` · proposta até ${formatIsoDateBr(i.propostaValidade)}`}
                    </span>
                    <span className="w-28 text-right tabular-nums">{formatBRL(i.custoCents)}</span>
                  </li>
                ))}
              </ol>
              {d.disponivelCents !== null && (
                <p className="text-xs">
                  Cabem <strong>{d.quitaveis}</strong> de {d.itens.length}: {formatBRL(d.cabeCents)}
                  {d.economiaQueCabeCents > 0 && `, com ${formatBRL(d.economiaQueCabeCents)} de economia`}
                  {` · sobram ${formatBRL(d.sobraCents ?? 0)}.`}
                </p>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Ordem sugerida: prioridade, depois as com restrição (negativada, protestada, judicial), o maior desconto e a proposta que vence
            antes. O que não cabe é pulado e os seguintes ainda são tentados. Só um cenário: nada é gravado.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className="font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  );
}
