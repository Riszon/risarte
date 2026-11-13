"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PROPOSAL_SOURCE_LABELS,
  PROPOSAL_STATUS_LABELS,
  centavosDoCampo,
  descontoDaProposta,
  faltaNaProposta,
  type PaymentKind,
  type PaymentMethod,
  type ProposalSource,
  type ProposalStatus,
} from "@/lib/finance/dividas";
import { mudarSituacaoDaProposta, registrarProposta } from "../actions";
import type { Proposta } from "../dados";
import { Caixa, Campo, SELECT, moeda, useAcao } from "./comum";

const TOM: Record<ProposalStatus, string> = {
  ativa: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  substituida: "bg-muted text-muted-foreground",
  aceita: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  expirada: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  recusada: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

type Form = {
  escopo: "divida" | "grupo";
  valor: string;
  tipo: PaymentKind;
  entrada: string;
  parcelas: string;
  parcela: string;
  forma: string;
  validade: string;
  origem: ProposalSource;
  condicao: string;
  notas: string;
  data: string;
};

/**
 * Aba Propostas (3.4, 0405): o histórico de propostas, que SÓ CRESCE. Nova
 * proposta substitui a ativa; o que foi proposto não muda. Desconto e
 * economia são calculados sobre o valor devido (o atualizado, senão o
 * original) — nunca digitados.
 */
export function Propostas({
  debtId,
  groupId,
  groupLabel,
  devidoCents,
  devidoDoGrupoCents,
  propostas,
  hoje,
  podeLancar,
  abrirNova,
}: {
  debtId: string;
  groupId: string | null;
  groupLabel: string | null;
  devidoCents: number;
  devidoDoGrupoCents: number | null;
  propostas: Proposta[];
  hoje: string;
  podeLancar: boolean;
  /** Abrir já com o formulário (o botão do cabeçalho remonta a aba com isto). */
  abrirNova: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  const vazio = (): Form => ({
    escopo: "divida",
    valor: "",
    tipo: "a_vista",
    entrada: "",
    parcelas: "",
    parcela: "",
    forma: "",
    validade: "",
    origem: "credor",
    condicao: "",
    notas: "",
    data: hoje,
  });
  const [f, setF] = useState<Form | null>(abrirNova && podeLancar ? vazio() : null);
  const [mudar, setMudar] = useState<{ id: string; para: "recusada" | "expirada"; motivo: string } | null>(null);

  const baseDoCalculo = (escopoGrupo: boolean) => (escopoGrupo ? (devidoDoGrupoCents ?? devidoCents) : devidoCents);

  const salvar = () => {
    if (!f) return;
    const falta = faltaNaProposta({ valor: f.valor, tipo: f.tipo, parcelas: f.parcelas, validade: f.validade, hoje });
    if (falta) return toast.error(falta);
    for (const [v, nome] of [[f.entrada, "Entrada"], [f.parcela, "Valor da parcela"]] as const) {
      if (Number.isNaN(centavosDoCampo(v))) return toast.error(`${nome}: valor inválido.`);
    }
    const valor = centavosDoCampo(f.valor)!;
    if (valor > baseDoCalculo(f.escopo === "grupo"))
      toast.warning("Atenção: a proposta é MAIOR que o valor devido. Ela foi registrada mesmo assim — confira com o credor.");
    rodar(
      () =>
        registrarProposta(debtId, {
          debt_id: f.escopo === "grupo" ? null : debtId,
          group_id: f.escopo === "grupo" ? groupId : null,
          proposed_on: f.data || hoje,
          amount_cents: valor,
          payment_kind: f.tipo,
          down_payment_cents: centavosDoCampo(f.entrada),
          installments: f.tipo === "parcelado" ? Number(f.parcelas) : null,
          installment_cents: f.tipo === "parcelado" ? centavosDoCampo(f.parcela) : null,
          method: f.forma || null,
          valid_until: f.validade || null,
          source: f.origem,
          condition_text: f.condicao,
          notes: f.notas,
        }),
      "Proposta registrada. A anterior passou a “substituída”.",
      () => setF(null)
    );
  };

  const confirmarMudanca = () => {
    if (!mudar) return;
    if (mudar.para === "recusada" && mudar.motivo.trim().length < 5) return toast.error("Escreva o motivo da recusa.");
    rodar(() => mudarSituacaoDaProposta(debtId, mudar.id, mudar.para, mudar.motivo), "Proposta atualizada.", () => setMudar(null));
  };

  const previa = f ? centavosDoCampo(f.valor) : null;
  const descPrevia = f && previa !== null && !Number.isNaN(previa) ? descontoDaProposta(baseDoCalculo(f.escopo === "grupo"), previa) : null;

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Propostas de quitação</h3>
          {podeLancar && !f && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setF(vazio())}>
              <Plus className="size-3.5" /> Registrar proposta
            </Button>
          )}
        </div>

        {f && (
          <Caixa titulo="Nova proposta" onCancelar={() => setF(null)} onSalvar={salvar} ocupado={ocupado}>
            {groupId && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px]">A proposta é para</Label>
                <div className="flex flex-wrap gap-4">
                  {(["divida", "grupo"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1.5 text-sm">
                      <input type="radio" className="accent-primary" checked={f.escopo === t} onChange={() => setF({ ...f, escopo: t })} />
                      {t === "divida" ? "Só esta dívida" : `O grupo inteiro (${groupLabel ?? "grupo"}, ${formatBRL(devidoDoGrupoCents ?? 0)})`}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Campo rotulo="Valor da proposta (R$) *" inputMode="decimal" valor={f.valor} onChange={(v) => setF({ ...f, valor: moeda(v) })} />
            <div className="flex items-end pb-2 text-xs text-muted-foreground">
              {descPrevia === null
                ? `Devido: ${formatBRL(baseDoCalculo(f.escopo === "grupo"))}`
                : descPrevia < 0
                  ? "⚠ maior que o valor devido"
                  : `${Math.round(descPrevia * 100)}% de desconto · economia de ${formatBRL(baseDoCalculo(f.escopo === "grupo") - (previa ?? 0))}`}
            </div>
            <label className="block">
              <Label className="text-[11px]">Condição</Label>
              <select className={SELECT} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as PaymentKind })}>
                {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                  <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <Label className="text-[11px]">Forma de pagamento</Label>
              <select className={SELECT} value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })}>
                <option value="">—</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((k) => (
                  <option key={k} value={k}>{PAYMENT_METHOD_LABELS[k]}</option>
                ))}
              </select>
            </label>
            {f.tipo === "parcelado" && (
              <>
                <Campo rotulo="Entrada (R$)" inputMode="decimal" valor={f.entrada} onChange={(v) => setF({ ...f, entrada: moeda(v) })} />
                <Campo rotulo="Nº de parcelas *" inputMode="numeric" valor={f.parcelas} onChange={(v) => setF({ ...f, parcelas: v.replace(/\D/g, "").slice(0, 3) })} />
                <Campo rotulo="Valor da parcela (R$)" inputMode="decimal" valor={f.parcela} onChange={(v) => setF({ ...f, parcela: moeda(v) })} />
              </>
            )}
            <Campo rotulo="Validade" type="date" valor={f.validade} onChange={(v) => setF({ ...f, validade: v })} />
            <label className="block">
              <Label className="text-[11px]">Origem da proposta</Label>
              <select className={SELECT} value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value as ProposalSource })}>
                {(Object.keys(PROPOSAL_SOURCE_LABELS) as ProposalSource[]).map((k) => (
                  <option key={k} value={k}>{PROPOSAL_SOURCE_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <Campo rotulo="Proposta recebida em" type="date" valor={f.data} onChange={(v) => setF({ ...f, data: v })} />
            <Campo className="sm:col-span-2" rotulo="Condição como veio (texto livre)" valor={f.condicao} onChange={(v) => setF({ ...f, condicao: v })} placeholder="Ex.: Até 12x de R$ 25,00 no boleto" />
            <Campo className="sm:col-span-2" rotulo="Observações" valor={f.notas} onChange={(v) => setF({ ...f, notas: v })} />
          </Caixa>
        )}

        {propostas.length === 0 && !f && <p className="text-xs text-muted-foreground">Nenhuma proposta registrada.</p>}
        <ul className="space-y-1.5 text-sm">
          {propostas.map((p) => {
            const base = p.groupId ? (devidoDoGrupoCents ?? devidoCents) : devidoCents;
            const desc = descontoDaProposta(base, p.amountCents);
            const st = p.status as ProposalStatus;
            return (
              <li key={p.id} className={cn("rounded-md border px-2 py-1.5", st !== "ativa" && "opacity-75")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatBRL(p.amountCents)}</span>
                  <span className={cn("rounded px-1.5 text-[10px] font-medium", TOM[st])}>{PROPOSAL_STATUS_LABELS[st]}</span>
                  {p.groupId && <span className="rounded bg-muted px-1.5 text-[10px]">do grupo {groupLabel ?? ""}</span>}
                  {desc !== null && (
                    <span className={cn("text-xs", desc < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {desc < 0 ? "maior que o devido" : `${Math.round(desc * 100)}% de desconto · economia ${formatBRL(base - p.amountCents)}`}
                    </span>
                  )}
                  {podeLancar && st === "ativa" && (
                    <span className="ml-auto flex gap-2 text-xs">
                      <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => setMudar({ id: p.id, para: "recusada", motivo: "" })}>
                        Recusar
                      </button>
                      <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => setMudar({ id: p.id, para: "expirada", motivo: "" })}>
                        Expirou
                      </button>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[
                    `recebida em ${formatIsoDateBr(p.proposedOn)}`,
                    PROPOSAL_SOURCE_LABELS[p.source as ProposalSource] ?? p.source,
                    p.paymentKind === "parcelado"
                      ? `${p.downPaymentCents ? `entrada ${formatBRL(p.downPaymentCents)} + ` : ""}${p.installments}x${p.installmentCents ? ` de ${formatBRL(p.installmentCents)}` : ""}`
                      : "à vista",
                    p.method && PAYMENT_METHOD_LABELS[p.method as PaymentMethod],
                    p.validUntil && `válida até ${formatIsoDateBr(p.validUntil)}`,
                  ].filter(Boolean).join(" · ")}
                </p>
                {p.conditionText && <p className="text-xs">“{p.conditionText}”</p>}
                {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                {p.statusReason && st !== "ativa" && <p className="text-xs text-muted-foreground">Motivo: {p.statusReason}</p>}
                {mudar?.id === p.id && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Campo className="min-w-64 flex-1" rotulo={mudar.para === "recusada" ? "Motivo da recusa *" : "Observação (opcional)"} valor={mudar.motivo} onChange={(v) => setMudar({ ...mudar, motivo: v })} />
                    <Button size="sm" variant="ghost" onClick={() => setMudar(null)}>Cancelar</Button>
                    <Button size="sm" onClick={confirmarMudanca} disabled={ocupado}>
                      {mudar.para === "recusada" ? "Marcar recusada" : "Marcar expirada"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Proposta não se edita nem se apaga: registrar uma nova substitui a ativa e o histórico mostra a evolução. Aceitar
          uma proposta é feito pelo Renegociar (próxima etapa). A proposta vencida sai de “ativa” sozinha na madrugada.
        </p>
      </CardContent>
    </Card>
  );
}
