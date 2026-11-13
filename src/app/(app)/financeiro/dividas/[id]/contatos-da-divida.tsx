"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBrDateTime, instantFromInputValue } from "@/lib/dates";
import { formatPhone } from "@/lib/masks";
import { CHANNEL_LABELS, CONTACT_KIND_LABELS, type Channel } from "@/lib/finance/dividas";
import { registrarContato } from "../actions";
import type { Contato, ContatoFeito } from "../dados";
import { Caixa, Campo, Marca, SELECT, useAcao } from "./comum";

/**
 * Aba Contatos (3.7, 0405): a linha do tempo com o credor — cada ligação,
 * e-mail ou mensagem, com quem fez. Só cresce: corrigir é registrar outro.
 * Embaixo, os contatos de cobrança do credor (editados na aba Credores).
 */
export function ContatosDaDivida({
  debtId,
  credorNome,
  contatosDoCredor,
  feitos,
  nomes,
  podeLancar,
  abrirNovo,
}: {
  debtId: string;
  credorNome: string;
  contatosDoCredor: Contato[];
  feitos: ContatoFeito[];
  nomes: Map<string, string>;
  podeLancar: boolean;
  abrirNovo: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  const vazio = () => ({ canal: "ligacao" as Channel, contato: "", quando: "", resumo: "", conferida: false });
  const [f, setF] = useState<ReturnType<typeof vazio> | null>(abrirNovo && podeLancar ? vazio() : null);
  const nomeDoContato = new Map(contatosDoCredor.map((c) => [c.id, [c.organization, c.personName].filter(Boolean).join(" · ")]));

  const salvar = () => {
    if (!f) return;
    if (!f.resumo.trim()) return toast.error("Escreva o resumo do contato.");
    const quando = f.quando ? instantFromInputValue(f.quando) : null;
    if (f.quando && !quando) return toast.error("Data e hora inválidas.");
    rodar(
      () =>
        registrarContato(debtId, {
          debt_id: debtId,
          channel: f.canal,
          contact_id: f.contato || null,
          occurred_at: quando ? quando.toISOString() : null,
          summary: f.resumo,
          mark_checked: f.conferida,
        }),
      "Contato registrado.",
      () => setF(null)
    );
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Linha do tempo com o credor</h3>
            {podeLancar && !f && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => setF(vazio())}>
                <Plus className="size-3.5" /> Registrar contato
              </Button>
            )}
          </div>
          {f && (
            <Caixa titulo="Novo contato" onCancelar={() => setF(null)} onSalvar={salvar} ocupado={ocupado}>
              <label className="block">
                <Label className="text-[11px]">Canal *</Label>
                <select className={SELECT} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value as Channel })}>
                  {(Object.keys(CHANNEL_LABELS) as Channel[]).map((k) => (
                    <option key={k} value={k}>{CHANNEL_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <Label className="text-[11px]">Com quem</Label>
                <select className={SELECT} value={f.contato} onChange={(e) => setF({ ...f, contato: e.target.value })}>
                  <option value="">—</option>
                  {contatosDoCredor.filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>{nomeDoContato.get(c.id)}</option>
                  ))}
                </select>
              </label>
              <Campo rotulo="Quando (vazio = agora)" type="datetime-local" valor={f.quando} onChange={(v) => setF({ ...f, quando: v })} />
              <div className="flex items-end pb-2">
                <Marca rotulo="Conferi a dívida neste contato" valor={f.conferida} onChange={(v) => setF({ ...f, conferida: v })} />
              </div>
              <label className="block sm:col-span-2">
                <Label className="text-[11px]">Resumo *</Label>
                <textarea
                  className="mt-0.5 min-h-20 w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                  value={f.resumo}
                  onChange={(e) => setF({ ...f, resumo: e.target.value })}
                  placeholder="Ex.: Pedi boleto atualizado; a atendente prometeu retorno até sexta."
                />
              </label>
            </Caixa>
          )}
          {feitos.length === 0 && !f && <p className="text-xs text-muted-foreground">Nenhum contato registrado.</p>}
          <ol className="space-y-1.5 text-sm">
            {feitos.map((c) => (
              <li key={c.id} className="rounded-md border px-2 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {formatBrDateTime(c.occurredAt)} · {CHANNEL_LABELS[c.channel as Channel] ?? c.channel}
                  {c.contactId && nomeDoContato.get(c.contactId) && ` · com ${nomeDoContato.get(c.contactId)}`}
                  {c.userId && ` · por ${nomes.get(c.userId) ?? "—"}`}
                </p>
                <p className="whitespace-pre-wrap">{c.summary}</p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground">Contato registrado não se edita nem se apaga: para corrigir, registre outro.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-3 text-sm">
          <p className="text-xs text-muted-foreground">Contatos de cobrança de {credorNome} (editados na aba Credores).</p>
          {contatosDoCredor.length === 0 && <p className="text-muted-foreground">Nenhum contato cadastrado.</p>}
          <ul className="space-y-1">
            {contatosDoCredor.map((c) => (
              <li key={c.id} className={cn("rounded-md border px-2 py-1", !c.active && "opacity-60")}>
                <span className="mr-2 rounded bg-muted px-1.5 text-[10px]">{CONTACT_KIND_LABELS[c.kind]}</span>
                {nomeDoContato.get(c.id)}
                <span className="block text-xs text-muted-foreground">
                  {[c.phone && `Tel. ${formatPhone(c.phone)}`, c.whatsapp && `WhatsApp ${formatPhone(c.whatsapp)}`, c.email].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
