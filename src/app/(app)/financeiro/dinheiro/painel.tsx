"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Landmark, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { desfazerDeposito, linkDoComprovante, registrarDeposito } from "./actions";
import { somaDosEscolhidos, avisoDoDeposito } from "@/lib/finance/dinheiro";

export type DadosDoPainel = {
  prazo_dias_uteis: number;
  desde: string;
  pode_registrar: boolean;
  pode_desfazer: boolean;
  pendentes: {
    receipt_id: string;
    recebido_em: string;
    valor: number;
    cliente: string | null;
    codigo: string | null;
    client_id: string;
    parado: boolean;
    quem: string | null;
  }[];
  depositos: {
    id: string;
    data: string;
    valor: number;
    recebimentos: number;
    diferenca_motivo: string | null;
    conta: string;
    comprovante: string;
    comprovante_nome: string | null;
    quem: string | null;
    registrado_em: string;
    desfeito_em: string | null;
    motivo_desfazer: string | null;
    itens: number;
  }[];
  contas: { id: string; nome: string; padrao: boolean }[];
};

const TIPOS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const CAMPO = "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export function PainelDoDinheiro({
  clinicId,
  unidades,
  dados,
}: {
  clinicId: string;
  unidades: { id: string; name: string }[];
  dados: DadosDoPainel;
}) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [abrir, setAbrir] = useState(false);
  const [conta, setConta] = useState(dados.contas[0]?.id ?? "");
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [desfazer, setDesfazer] = useState<string | null>(null);
  const [motivoDesfazer, setMotivoDesfazer] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  const totalPendente = dados.pendentes.reduce((s, p) => s + Number(p.valor), 0);
  const parados = dados.pendentes.filter((p) => p.parado);
  const soma = useMemo(() => somaDosEscolhidos(dados.pendentes, escolhidos), [dados.pendentes, escolhidos]);
  const valorCents = parseBRLToCents(valor) ?? 0;
  const aviso = avisoDoDeposito(valorCents || soma);

  const alternar = (id: string) =>
    setEscolhidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function abrirDeposito() {
    setValor((soma / 100).toFixed(2).replace(".", ","));
    setMotivo("");
    setArquivo(null);
    setData(hoje());
    setAbrir(true);
  }

  function salvar() {
    if (!arquivo) return toast.error("Anexe o comprovante do depósito.");
    if (!TIPOS[arquivo.type]) return toast.error("Envie PDF ou imagem (PNG, JPG, WEBP).");
    if (arquivo.size > 10 * 1024 * 1024) return toast.error("O arquivo passa de 10 MB.");
    start(async () => {
      const path = `${clinicId}/${crypto.randomUUID()}.${TIPOS[arquivo.type]}`;
      const { error } = await createClient().storage.from("depositos").upload(path, arquivo, { contentType: arquivo.type });
      if (error) {
        toast.error("Não foi possível enviar o comprovante. Tente de novo.");
        return;
      }
      const r = await registrarDeposito({
        clinicId,
        bankAccountId: conta,
        depositedOn: data,
        receiptIds: [...escolhidos],
        amountCents: valorCents,
        proofPath: path,
        proofName: arquivo.name,
        differenceReason: motivo,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Depósito registrado: o dinheiro saiu do Caixa e entrou no banco.");
      setAbrir(false);
      setEscolhidos(new Set());
      router.refresh();
    });
  }

  function confirmarDesfazer() {
    if (!desfazer) return;
    start(async () => {
      const r = await desfazerDeposito({ depositId: desfazer, reason: motivoDesfazer });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Depósito desfeito: os recebimentos voltaram a 'não depositado'.");
      setDesfazer(null);
      router.refresh();
    });
  }

  async function verComprovante(path: string) {
    const r = await linkDoComprovante(path);
    if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else toast.error(r.error ?? "Não foi possível abrir.");
  }

  return (
    <div className="space-y-5">
      {unidades.length > 0 && (
        <label className="block max-w-xs">
          <span className="text-[11px] font-medium text-muted-foreground">Unidade</span>
          <select
            className={CAMPO}
            value={clinicId}
            onChange={(e) => router.push(`/financeiro/dinheiro?unidade=${e.target.value}`)}
          >
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Não depositado</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(totalPendente)}</p>
            <p className="text-xs text-muted-foreground">{dados.pendentes.length} recebimento(s) em dinheiro</p>
          </CardContent>
        </Card>
        <Card className={cn(parados.length > 0 && "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-500/15")}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Parado há mais de {dados.prazo_dias_uteis} dias úteis</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(parados.reduce((s, p) => s + Number(p.valor), 0))}</p>
            <p className="text-xs text-muted-foreground">O Gerente e o Financeiro da Franqueadora recebem aviso.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Escolhidos para depositar</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(soma)}</p>
            {dados.pode_registrar ? (
              <Button size="sm" className="mt-1 h-8" disabled={escolhidos.size === 0 || dados.contas.length === 0} onClick={abrirDeposito}>
                <Landmark className="mr-1 size-3.5" />
                Registrar depósito
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Quem registra: Gerente, Financeiro da Franqueadora ou Admin Master.</p>
            )}
            {dados.pode_registrar && dados.contas.length === 0 && (
              <p className="mt-1 text-xs text-destructive">A unidade não tem conta bancária cadastrada (Conciliação).</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recebimentos em dinheiro ainda no Caixa</h2>
        <p className="text-xs text-muted-foreground">Desde {formatBrDate(dados.desde)}. Deposite um dia por vez, num depósito só.</p>
        {dados.pendentes.length === 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nenhum dinheiro parado no Caixa.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {dados.pendentes.map((p) => (
              <li key={p.receipt_id} className="flex flex-wrap items-center gap-3 p-2">
                {dados.pode_registrar && (
                  <input
                    type="checkbox"
                    aria-label={`Escolher o recebimento de ${p.cliente ?? "cliente"}`}
                    checked={escolhidos.has(p.receipt_id)}
                    onChange={() => alternar(p.receipt_id)}
                  />
                )}
                <span className="w-24 text-xs text-muted-foreground">{formatBrDate(p.recebido_em)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {p.cliente ?? "—"} {p.codigo && <span className="text-xs text-muted-foreground">({p.codigo})</span>}
                  {p.quem && <span className="text-xs text-muted-foreground"> · recebido por {p.quem}</span>}
                </span>
                {p.parado && (
                  <span className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-800">
                    <AlertTriangle className="size-3" /> parado
                  </span>
                )}
                <span className="font-medium tabular-nums">{formatBRL(Number(p.valor))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Depósitos (últimos 90 dias)</h2>
        {dados.depositos.length === 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nenhum depósito registrado.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {dados.depositos.map((d) => (
              <li key={d.id} className={cn("flex flex-wrap items-center gap-3 p-2", d.desfeito_em && "opacity-60")}>
                <span className="w-24 text-xs text-muted-foreground">{formatBrDate(d.data)}</span>
                <span className="min-w-0 flex-1">
                  {d.conta} · {d.itens} recebimento(s){d.quem && <span className="text-xs text-muted-foreground"> · por {d.quem}</span>}
                  {d.diferenca_motivo && (
                    <span className="block text-xs text-amber-800">
                      Recebimentos {formatBRL(Number(d.recebimentos))}; diferença: {d.diferenca_motivo}
                    </span>
                  )}
                  {d.desfeito_em && <span className="block text-xs text-destructive">Desfeito: {d.motivo_desfazer}</span>}
                </span>
                <span className="font-medium tabular-nums">{formatBRL(Number(d.valor))}</span>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => verComprovante(d.comprovante)}>
                  <ExternalLink className="mr-1 size-3.5" /> Comprovante
                </Button>
                {dados.pode_desfazer && !d.desfeito_em && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => {
                      setDesfazer(d.id);
                      setMotivoDesfazer("");
                    }}
                  >
                    <Undo2 className="mr-1 size-3.5" /> Desfazer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={abrir} onOpenChange={setAbrir}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar depósito</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {escolhidos.size} recebimento(s), somando <strong>{formatBRL(soma)}</strong>.
            </p>
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Conta em que foi depositado</span>
              <select className={CAMPO} value={conta} onChange={(e) => setConta(e.target.value)}>
                {dados.contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Data do depósito</span>
                <input type="date" className={CAMPO} value={data} max={hoje()} onChange={(e) => setData(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Valor depositado (R$)</span>
                <input className={CAMPO} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
              </label>
            </div>
            {valorCents !== soma && (
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Motivo da diferença (obrigatório)</span>
                <input className={CAMPO} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Comprovante (obrigatório)</span>
              <input
                ref={entrada}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="mt-0.5 block w-full text-xs"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
            {aviso && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{aviso}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrir(false)} disabled={ocupado}>
              Voltar
            </Button>
            <Button onClick={salvar} disabled={ocupado || !arquivo || !conta || valorCents <= 0}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={desfazer !== null} onOpenChange={(o) => { if (!o) setDesfazer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desfazer depósito</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Os lançamentos são estornados e os recebimentos voltam a &quot;não depositado&quot;. O comprovante fica guardado.
          </p>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Motivo (obrigatório)</span>
            <input className={CAMPO} value={motivoDesfazer} onChange={(e) => setMotivoDesfazer(e.target.value)} />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesfazer(null)} disabled={ocupado}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={confirmarDesfazer} disabled={ocupado || !motivoDesfazer.trim()}>
              Desfazer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
