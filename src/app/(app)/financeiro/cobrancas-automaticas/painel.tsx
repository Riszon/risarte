"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { rotuloDoMotivo } from "@/lib/asaas/cobrancas-automaticas-regras";
import { rodarAgora, salvarConfiguracao } from "./actions";

export type DadosDoPainel = {
  prazo: number;
  pode_configurar: boolean;
  app_base_url: string | null;
  vigia: boolean;
  segundo_disparo: boolean;
  unidades: { clinic_id: string; nome: string; ligada: boolean; desde: string | null; pronta: boolean }[];
  pendencias: {
    installment_id: string;
    clinic_id: string;
    vencimento: string;
    valor: number;
    meio: string;
    cliente: string | null;
    codigo: string | null;
    client_id: string;
    motivo: string;
  }[];
  rodadas: {
    routine: string;
    origin: string;
    started_at: string;
    finished_at: string | null;
    ok: boolean | null;
    created: number;
    failed: number;
    skipped: number;
    stopped_reason: string | null;
    quem: string | null;
  }[];
};

const ROTINA: Record<string, string> = {
  cobrancas: "Criação das cobranças",
  split_diario: "Split diário",
  contas: "Verificação das contas",
  regua: "Régua",
};
const ORIGEM: Record<string, string> = { vercel: "Vercel", banco: "Banco (2º disparo)", rodar_agora: "Rodar agora", gatilho: "Assinatura/venda" };
const CAMPO = "mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";
const fmt = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PainelDasCobrancasAutomaticas({ dados }: { dados: DadosDoPainel }) {
  const router = useRouter();
  const [ocupado, start] = useTransition();
  const [prazo, setPrazo] = useState(String(dados.prazo));
  const [url, setUrl] = useState(dados.app_base_url ?? "");
  const nomeDa = new Map(dados.unidades.map((u) => [u.clinic_id, u.nome]));

  const salvar = (p: Parameters<typeof salvarConfiguracao>[0], ok: string) =>
    start(async () => {
      const r = await salvarConfiguracao(p);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success(ok);
        router.refresh();
      }
    });

  const rodar = () =>
    start(async () => {
      const r = await rodarAgora();
      if (!r.ok) toast.error(r.error ?? "Não foi possível rodar.");
      else {
        toast.success(`Rodada feita: ${r.criadas} criada(s), ${r.falhas} com erro, ${r.puladas} para depois${r.motivo ? ` (${rotuloDoMotivo(r.motivo)})` : ""}.`);
        router.refresh();
      }
    });

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Unidades</h2>
          {dados.pode_configurar && (
            <Button size="sm" className="h-8" onClick={rodar} disabled={ocupado}>
              <Play className="mr-1 size-3.5" /> Rodar agora
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Com a unidade ligada, o contrato assinado DEPOIS de ligar já cria as cobranças no Asaas. O que foi assinado antes continua manual.
        </p>
        <ul className="divide-y text-sm">
          {dados.unidades.map((u) => (
            <li key={u.clinic_id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="flex-1">{u.nome}</span>
              {!u.pronta && <span className="text-xs text-amber-800 dark:text-amber-200">não está pronta na Central</span>}
              <span className="text-xs text-muted-foreground">{u.ligada && u.desde ? `ligada desde ${hora(u.desde)}` : "desligada"}</span>
              {dados.pode_configurar && (
                <Button
                  size="sm"
                  variant={u.ligada ? "outline" : "default"}
                  className="h-7 text-[11px]"
                  disabled={ocupado}
                  onClick={() => salvar({ units: [{ clinic_id: u.clinic_id, enabled: !u.ligada }] }, u.ligada ? "Unidade desligada." : "Unidade ligada.")}
                >
                  {u.ligada ? "Desligar" : "Ligar"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {dados.pode_configurar && (
        <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Prazo (dias antes do vencimento, 11 a 30)</span>
            <div className="flex gap-2">
              <input className={CAMPO} inputMode="numeric" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              <Button size="sm" className="mt-0.5 h-9" disabled={ocupado} onClick={() => salvar({ windowDays: Number(prazo) }, "Prazo salvo. Vale para as cobranças ainda não criadas.")}>
                Salvar
              </Button>
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Endereço da aplicação (2º disparo pelo banco)</span>
            <div className="flex gap-2">
              <input className={CAMPO} placeholder="https://risarte.vercel.app" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button size="sm" className="mt-0.5 h-9" disabled={ocupado} onClick={() => salvar({ appBaseUrl: url }, "Endereço salvo.")}>
                Salvar
              </Button>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {dados.segundo_disparo
                ? "O banco tem o pg_net: o 2º disparo roda às 01:35, 08:10 e 09:30."
                : "O banco ainda não tem o pg_net: só o cron da Vercel dispara (o vigia continua)."}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dados.vigia}
              disabled={ocupado}
              onChange={(e) => salvar({ watchEnabled: e.target.checked }, e.target.checked ? "Vigia ligado." : "Vigia desligado.")}
            />
            Vigia das rotinas (avisa o Admin Master e o Financeiro quando uma rotina não roda)
          </label>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Parcelas no prazo ainda sem cobrança ({dados.pendencias.length})</h2>
        {dados.pendencias.length === 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nenhuma pendência.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {dados.pendencias.map((p) => (
              <li key={p.installment_id} className="flex flex-wrap items-center gap-3 p-2">
                <span className="w-24 text-xs text-muted-foreground">{fmt(p.vencimento)}</span>
                <Link href={`/prontuarios/${p.client_id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.cliente ?? "—"} {p.codigo && <span className="text-xs text-muted-foreground">({p.codigo})</span>}
                </Link>
                <span className="text-xs text-muted-foreground">{nomeDa.get(p.clinic_id) ?? ""}</span>
                <span className={cn("rounded border px-1.5 text-[11px]", p.motivo.startsWith("erro:") ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground")}>
                  {rotuloDoMotivo(p.motivo)}
                </span>
                <span className="font-medium tabular-nums">{formatBRL(Number(p.valor))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Rodadas das rotinas</h2>
        {dados.rodadas.length === 0 ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nenhuma rodada registrada ainda.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {dados.rodadas.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 p-2">
                <span className="w-28 text-xs text-muted-foreground">{hora(r.started_at)}</span>
                <span className="flex-1">
                  {ROTINA[r.routine] ?? r.routine} · {ORIGEM[r.origin] ?? r.origin}
                  {r.quem && <span className="text-xs text-muted-foreground"> · {r.quem}</span>}
                </span>
                <span className={cn("text-xs", r.ok === false ? "text-destructive" : "text-muted-foreground")}>
                  {r.finished_at === null ? "rodando" : r.ok ? "ok" : "com erro"}
                  {r.routine === "cobrancas" && ` · ${r.created} criada(s), ${r.failed} erro(s), ${r.skipped} para depois`}
                  {r.stopped_reason && ` · ${rotuloDoMotivo(r.stopped_reason)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
