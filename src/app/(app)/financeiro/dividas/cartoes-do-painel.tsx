"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileWarning,
  Gavel,
  Handshake,
  Landmark,
  PiggyBank,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { STATUS_LABELS, STATUS_TONE, valorDevido, type DebtListRow } from "@/lib/finance/dividas";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_TONE, type AgreementStatus } from "@/lib/finance/dividas-acordos";
import {
  CARTOES_DO_PAINEL,
  acordosDoCartao,
  dividasDoCartao,
  type AcordoDoPainel,
  type CartaoDoPainel,
  type IndicadoresDoPainel,
} from "@/lib/finance/dividas-painel";

// OS CARTÕES DO PAINEL (pedido do dono, 15/11/2026): em três blocos, cada um
// com a sua cor e o seu ícone — quanto se deve, o que pede atenção, o que já
// foi resolvido — e TODO número é clicável: abre a lista do que o forma, pela
// mesma regra da conta (`dividasDoCartao` / `acordosDoCartao`).

type Acordo = AcordoDoPainel & { id?: string; codigo?: string; principalId?: string; totalCents?: number; supplierName?: string };
type Aberto = { cartao: CartaoDoPainel; clinicId?: string; titulo?: string };

type Tom = { borda: string; icone: string; fundo: string };
const TOM: Record<"vermelho" | "ambar" | "laranja" | "roxo" | "verde" | "indigo" | "neutro", Tom> = {
  vermelho: { borda: "border-l-red-500", icone: "text-red-600 dark:text-red-400", fundo: "bg-red-50 dark:bg-red-950/30" },
  ambar: { borda: "border-l-amber-500", icone: "text-amber-600 dark:text-amber-400", fundo: "bg-amber-50 dark:bg-amber-950/30" },
  laranja: { borda: "border-l-orange-500", icone: "text-orange-600 dark:text-orange-400", fundo: "bg-orange-50 dark:bg-orange-950/30" },
  roxo: { borda: "border-l-fuchsia-500", icone: "text-fuchsia-600 dark:text-fuchsia-400", fundo: "bg-fuchsia-50 dark:bg-fuchsia-950/30" },
  verde: { borda: "border-l-emerald-500", icone: "text-emerald-600 dark:text-emerald-400", fundo: "bg-emerald-50 dark:bg-emerald-950/30" },
  indigo: { borda: "border-l-indigo-500", icone: "text-indigo-600 dark:text-indigo-400", fundo: "bg-indigo-50 dark:bg-indigo-950/30" },
  neutro: { borda: "border-l-slate-400", icone: "text-slate-600 dark:text-slate-300", fundo: "bg-muted/40" },
};

export function CartoesDoPainel({
  ind,
  rows,
  acordos,
}: {
  ind: IndicadoresDoPainel;
  rows: DebtListRow[];
  acordos: Acordo[];
}) {
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const t = ind.totais;
  const comProposta = t.comPropostaDevidoCents;
  const semProposta = t.semPropostaCents;
  const pctCom = t.devidoCents > 0 ? Math.round((comProposta / t.devidoCents) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ 1. quanto se deve */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => setAberto({ cartao: "devido" })}
          className="group rounded-xl border bg-card p-5 text-left transition hover:border-primary/50 hover:shadow-sm"
        >
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Landmark className="size-4 text-primary" /> Total devido
            <ChevronRight className="ml-auto size-4 opacity-0 transition group-hover:opacity-100" />
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{formatBRL(t.devidoCents)}</p>
          <p className="text-sm text-muted-foreground">
            {t.quantidade} dívida{t.quantidade === 1 ? "" : "s"}
            {t.contestadaJudicialCents > 0 && ` · ${formatBRL(t.contestadaJudicialCents)} contestado ou na Justiça`}
          </p>
          {t.devidoCents > 0 && (
            <div className="mt-4 space-y-1">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <span className="h-full bg-emerald-500" style={{ width: `${pctCom}%` }} />
                <span className="ml-0.5 h-full flex-1 bg-amber-500" />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" /> com proposta {formatBRL(comProposta)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-amber-500" /> sem proposta {formatBRL(semProposta)}
                </span>
              </div>
            </div>
          )}
        </button>

        <div className="divide-y rounded-xl border bg-card">
          <Linha rotulo="Estimado para regularizar" valor={t.estimadoCents} nota="a proposta, quando há; senão o devido" onClick={() => setAberto({ cartao: "estimado" })} />
          <Linha
            rotulo="Custo total para regularizar"
            valor={t.custoTotalCents}
            nota={t.custasCents > 0 ? `com ${formatBRL(t.custasCents)} de custas de cartório` : "sem custas de cartório em aberto"}
            onClick={() => setAberto({ cartao: "custo" })}
          />
          <Linha
            rotulo="Economia potencial"
            valor={t.economiaCents}
            nota={t.descontoMedio === null ? "nenhuma dívida com proposta" : `desconto médio de ${Math.round(t.descontoMedio * 100)}%, só onde há proposta`}
            destaque="verde"
            onClick={() => setAberto({ cartao: "economia" })}
          />
          <Linha
            rotulo="Propostas atuais"
            valor={t.propostasCents}
            nota={`sobre ${formatBRL(comProposta)} devidos`}
            onClick={() => setAberto({ cartao: "propostas" })}
          />
          <Linha rotulo="Sem proposta" valor={semProposta} nota="ainda a negociar" destaque="ambar" onClick={() => setAberto({ cartao: "sem_proposta" })} />
        </div>
      </section>

      {/* ------------------------------------------- 2. o que pede atenção */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">O que pede atenção</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Ladrilho icone={Clock} tom={TOM.ambar} rotulo="Em atraso" c={ind.emAtraso} onClick={() => setAberto({ cartao: "em_atraso" })} />
          <Ladrilho icone={AlertOctagon} tom={TOM.vermelho} rotulo="Inadimplentes" c={ind.inadimplentes} onClick={() => setAberto({ cartao: "inadimplentes" })} />
          <Ladrilho icone={Ban} tom={TOM.vermelho} rotulo="Negativadas" c={ind.negativadas} onClick={() => setAberto({ cartao: "negativadas" })} />
          <Ladrilho icone={FileWarning} tom={TOM.laranja} rotulo="Protestadas" c={ind.protestadas} onClick={() => setAberto({ cartao: "protestadas" })} />
          <Ladrilho icone={Gavel} tom={TOM.roxo} rotulo="Com ação judicial" c={ind.judiciais} onClick={() => setAberto({ cartao: "judiciais" })} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">CNPJs com restrição:</span>
          {ind.cnpjsComRestricao.length === 0 ? (
            <span className="text-muted-foreground">nenhum no filtro.</span>
          ) : (
            ind.cnpjsComRestricao.map((c) => (
              <button
                key={c.clinicId}
                type="button"
                onClick={() => setAberto({ cartao: "restricao", clinicId: c.clinicId, titulo: `${c.nome} — dívidas com restrição` })}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs hover:border-red-500 dark:border-red-900 dark:bg-red-950/30"
              >
                <span className="font-medium">{c.nome}</span>
                <span className="text-muted-foreground">
                  {[c.negativadas && `${c.negativadas} neg.`, c.protestadas && `${c.protestadas} prot.`, c.judiciais && `${c.judiciais} jud.`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <ChevronRight className="size-3" />
              </button>
            ))
          )}
        </div>
      </section>

      {/* ---------------------------------------- 3. o que já foi resolvido */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">O que já foi resolvido e o que está em acordo</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Ladrilho icone={CheckCircle2} tom={TOM.verde} rotulo="Já quitado" valor={ind.quitadoCents} nota="pago nos títulos e nas parcelas" onClick={() => setAberto({ cartao: "quitado" })} />
          <Ladrilho
            icone={PiggyBank}
            tom={TOM.verde}
            rotulo="Economia já obtida"
            valor={ind.economiaObtidaCents}
            nota="desconto dos acordos em dia ou cumpridos"
            onClick={() => setAberto({ cartao: "economia_obtida" })}
          />
          <Ladrilho
            icone={Handshake}
            tom={TOM.indigo}
            rotulo="Acordos valendo"
            valor={ind.acordos.saldoCents}
            nota={`${ind.acordos.quantidade} acordo(s) · ${formatBRL(ind.acordos.proximos30Cents)} em 30 dias${ind.acordos.quebrados > 0 ? ` · ${ind.acordos.quebrados} quebrado(s)` : ""}`}
            alerta={ind.acordos.quebrados > 0}
            onClick={() => setAberto({ cartao: "acordos" })}
          />
        </div>
      </section>

      {aberto && <ListaDoCartao aberto={aberto} rows={rows} acordos={acordos} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  nota,
  destaque,
  onClick,
}: {
  rotulo: string;
  valor: number;
  nota: string;
  destaque?: "verde" | "ambar";
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{rotulo}</span>
        <span className="block text-[11px] text-muted-foreground">{nota}</span>
      </span>
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          destaque === "verde" && "text-emerald-700 dark:text-emerald-400",
          destaque === "ambar" && "text-amber-700 dark:text-amber-400"
        )}
      >
        {formatBRL(valor)}
      </span>
      <ChevronRight className="size-4 text-muted-foreground opacity-40 transition group-hover:opacity-100" />
    </button>
  );
}

function Ladrilho({
  icone: Icone,
  tom,
  rotulo,
  c,
  valor,
  nota,
  alerta,
  onClick,
}: {
  icone: ComponentType<{ className?: string }>;
  tom: Tom;
  rotulo: string;
  c?: { quantidade: number; valorCents: number };
  valor?: number;
  nota?: string;
  alerta?: boolean;
  onClick: () => void;
}) {
  const vazio = c ? c.quantidade === 0 : (valor ?? 0) === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group rounded-xl border border-l-4 bg-card p-3 text-left transition hover:shadow-sm",
        tom.borda,
        vazio && "opacity-70"
      )}
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("rounded-md p-1", tom.fundo)}>
          <Icone className={cn("size-4", tom.icone)} />
        </span>
        {rotulo}
        {alerta && <span className="rounded bg-red-100 px-1.5 text-[10px] font-medium text-red-800 dark:bg-red-950/50 dark:text-red-200">atenção</span>}
        <ChevronRight className="ml-auto size-4 opacity-0 transition group-hover:opacity-100" />
      </span>
      {c ? (
        <>
          <span className="mt-1.5 block text-2xl font-semibold tabular-nums">{c.quantidade}</span>
          <span className="block text-xs text-muted-foreground">{formatBRL(c.valorCents)}</span>
        </>
      ) : (
        <>
          <span className="mt-1.5 block text-xl font-semibold tabular-nums">{formatBRL(valor ?? 0)}</span>
          {nota && <span className="block text-[11px] text-muted-foreground">{nota}</span>}
        </>
      )}
    </button>
  );
}

// ------------------------------------------------- a lista de cada cartão

function ListaDoCartao({ aberto, rows, acordos, onFechar }: { aberto: Aberto; rows: DebtListRow[]; acordos: Acordo[]; onFechar: () => void }) {
  const titulo = aberto.titulo ?? CARTOES_DO_PAINEL[aberto.cartao];
  const ehAcordo = aberto.cartao === "acordos" || aberto.cartao === "economia_obtida";
  const dividas = ehAcordo ? [] : dividasDoCartao(aberto.cartao, rows, aberto.clinicId);
  const lista = ehAcordo ? acordosDoCartao(aberto.cartao, acordos, rows) : [];

  // O valor que a coluna principal mostra é o que o cartão soma.
  const valorDaLinha = (r: DebtListRow): number => {
    switch (aberto.cartao) {
      case "estimado":
        return r.propostaCents ?? valorDevido(r);
      case "custo":
        return (r.propostaCents ?? valorDevido(r)) + r.custasCents;
      case "economia":
        return r.propostaCents === null ? 0 : Math.max(0, valorDevido(r) - r.propostaCents);
      case "propostas":
        return r.propostaCents ?? 0;
      case "quitado":
        return r.pagoCents ?? 0;
      default:
        return valorDevido(r);
    }
  };
  const rotuloDoValor: Partial<Record<CartaoDoPainel, string>> = {
    estimado: "Estimado",
    custo: "Custo (com custas)",
    economia: "Economia",
    propostas: "Proposta",
    quitado: "Já pago",
  };
  const ordenadas = [...dividas].sort((a, b) => valorDaLinha(b) - valorDaLinha(a) || a.code.localeCompare(b.code));
  const total = ordenadas.reduce((x, r) => x + valorDaLinha(r), 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        {ehAcordo ? (
          lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum acordo neste número, com o filtro do Painel.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Acordo</th>
                  <th className="py-1">Situação</th>
                  <th className="py-1 text-right">Acordado</th>
                  <th className="py-1 text-right">{aberto.cartao === "economia_obtida" ? "Desconto" : "Falta pagar"}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((a, k) => (
                  <tr key={a.id ?? k} className="border-t">
                    <td className="py-1.5">
                      {a.principalId ? (
                        <Link href={`/financeiro/dividas/${a.principalId}?aba=acordos`} className="font-medium text-primary underline-offset-2 hover:underline">
                          {a.codigo ?? "Acordo"}
                        </Link>
                      ) : (
                        a.codigo ?? "Acordo"
                      )}
                      {a.supplierName && <span className="block text-[11px] text-muted-foreground">{a.supplierName}</span>}
                    </td>
                    <td className="py-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs", AGREEMENT_STATUS_TONE[a.situacao as AgreementStatus])}>
                        {AGREEMENT_STATUS_LABELS[a.situacao as AgreementStatus] ?? a.situacao}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{a.totalCents === undefined ? "—" : formatBRL(a.totalCents)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBRL(aberto.cartao === "economia_obtida" ? a.descontoCents : a.abertas.reduce((x, p) => x + p.faltaCents, 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="py-1.5" colSpan={3}>
                    {lista.length} acordo{lista.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatBRL(
                      lista.reduce(
                        (x, a) => x + (aberto.cartao === "economia_obtida" ? a.descontoCents : a.abertas.reduce((y, p) => y + p.faltaCents, 0)),
                        0
                      )
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )
        ) : ordenadas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma dívida neste número, com o filtro do Painel.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Dívida</th>
                <th className="py-1">Devedor</th>
                <th className="py-1">Situação</th>
                <th className="py-1 text-right">Devido</th>
                {rotuloDoValor[aberto.cartao] && <th className="py-1 text-right">{rotuloDoValor[aberto.cartao]}</th>}
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1.5">
                    <Link href={`/financeiro/dividas/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {r.code}
                    </Link>
                    <span className="block text-[11px] text-muted-foreground">
                      {r.supplierName} · vence {formatIsoDateBr(r.vencimentoAberto ?? r.dueDate)}
                    </span>
                  </td>
                  <td className="py-1.5">{r.clinicName}</td>
                  <td className="py-1.5">
                    <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-xs", STATUS_TONE[r.status])}>{STATUS_LABELS[r.status]}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatBRL(valorDevido(r))}</td>
                  {rotuloDoValor[aberto.cartao] && <td className="py-1.5 text-right font-medium tabular-nums">{formatBRL(valorDaLinha(r))}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-semibold">
              <tr>
                <td className="py-1.5" colSpan={3}>
                  {ordenadas.length} dívida{ordenadas.length === 1 ? "" : "s"}
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatBRL(ordenadas.reduce((x, r) => x + valorDevido(r), 0))}</td>
                {rotuloDoValor[aberto.cartao] && <td className="py-1.5 text-right tabular-nums">{formatBRL(total)}</td>}
              </tr>
            </tfoot>
          </table>
        )}
        <p className="text-[11px] text-muted-foreground">Clique no código para abrir a dívida (ou o acordo). A lista segue o filtro do Painel.</p>
      </DialogContent>
    </Dialog>
  );
}
