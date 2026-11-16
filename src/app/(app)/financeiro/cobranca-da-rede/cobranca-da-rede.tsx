"use client";

/**
 * ASA6 (4021) — a tela da COBRANÇA DA REDE: a lista dos meses, o demonstrativo
 * (20.4) com as ações de cada papel, e o saldo anterior (20.15.1).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  SITUACAO_DO_LOTE,
  TIPO_DA_LINHA,
  mesAno,
  planilhaDoLote,
  resumoDoLote,
  type ItemDoLote,
  type LoteDaLista,
  type LoteLido,
  type SaldoAnterior,
} from "@/lib/finance/cobranca-da-rede";
import {
  abrirPrevia,
  aprovarEEmitir,
  cancelarCobranca,
  conferirPrevia,
  contestarLinha,
  decidirContestacao,
  decidirSaldoAnterior,
  linkDoComprovante,
  refazerPrevia,
  tentarDeNovo,
} from "./actions";

const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const CAMINHO = "/financeiro/cobranca-da-rede";

function Etiqueta({ status }: { status: string }) {
  const s = SITUACAO_DO_LOTE[status] ?? { rotulo: status, tom: "bg-muted" };
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", s.tom)}>{s.rotulo}</span>;
}

export function CobrancaDaRede({
  lista,
  lido,
  saldo,
  daRede,
  unidades,
  loteAberto,
}: {
  lista: LoteDaLista[];
  lido: LoteLido | null;
  saldo: SaldoAnterior | null;
  daRede: boolean;
  unidades: { id: string; nome: string; falta: string[] }[];
  loteAberto: string | null;
}) {
  return (
    <div className="space-y-5">
      {daRede && <AbrirPrevia unidades={unidades} />}
      {lido && <Demonstrativo lido={lido} />}
      {saldo && <SaldoAnteriorCard saldo={saldo} />}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Meses</h2>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança mensal ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Mês</th>
                  {daRede && <th className="px-3 py-2">Unidade</th>}
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Prazo da prévia</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((l) => (
                  <tr key={l.id} className={cn(l.id === loteAberto && "bg-gold/10")}>
                    <td className="px-3 py-2 font-medium">
                      {mesAno(l.period)}
                      {l.example_values && <span className="ml-1 text-xs text-amber-700">(exemplo)</span>}
                    </td>
                    {daRede && <td className="px-3 py-2">{l.clinic_name}</td>}
                    <td className="px-3 py-2">
                      <Etiqueta status={l.status} />
                      {l.contests > 0 && <span className="ml-1 text-xs text-red-700">{l.contests} contestação(ões)</span>}
                      {l.charge_status === "vencida" && <span className="ml-1 text-xs text-red-700">em atraso</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.total_cents == null ? "—" : formatBRL(Number(l.total_cents))}</td>
                    <td className="px-3 py-2">{l.status === "previa" ? dia(l.preview_deadline) : "—"}</td>
                    <td className="px-3 py-2">{dia(l.due_date)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link className="text-primary underline-offset-2 hover:underline" href={`${CAMINHO}?lote=${l.id}`}>
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AbrirPrevia({ unidades }: { unidades: { id: string; nome: string; falta: string[] }[] }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [unidade, setUnidade] = useState(unidades[0]?.id ?? "");
  const anterior = (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const [mes, setMes] = useState(anterior);
  const falta = unidades.find((u) => u.id === unidade)?.falta ?? [];
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Abrir a prévia de um mês</h2>
      <p className="text-xs text-muted-foreground">
        A rotina abre sozinha a prévia do mês que fechou, no dia 1, para cada unidade com a configuração completa. Aqui é
        para abrir à mão.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <select className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <Input type="month" className="w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
        <Button
          disabled={pendente || !unidade || falta.length > 0}
          onClick={() =>
            start(async () => {
              const r = await abrirPrevia(unidade, mes);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Prévia aberta. A unidade foi avisada, com o prazo.");
              router.push(`${CAMINHO}?lote=${r.id}`);
            })
          }
        >
          Abrir a prévia
        </Button>
        <Link className="text-sm text-primary underline-offset-2 hover:underline" href={`${CAMINHO}?saldo=${unidade}`}>
          Saldo anterior desta unidade
        </Link>
      </div>
      {falta.length > 0 && (
        <p className="text-xs text-red-700">
          Falta configurar (Central › Rede › Taxas da franquia): {falta.join(", ")}. Sem isso, nada é emitido.
        </p>
      )}
    </section>
  );
}

function Demonstrativo({ lido }: { lido: LoteLido }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const b = lido.batch;
  const r = resumoDoLote(lido.items);
  const acao = (f: () => Promise<{ ok: boolean; error?: string; aviso?: string }>, sucesso: string) =>
    start(async () => {
      const x = await f();
      if (!x.ok) return void toast.error(x.error ?? "Não foi possível.");
      toast.success(x.aviso ?? sucesso);
      router.refresh();
    });
  const baixar = () => {
    const blob = new Blob(["﻿" + planilhaDoLote(lido)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cobranca-da-rede-${lido.clinic.name.replace(/\s+/g, "-")}-${mesAno(b.period).replace("/", "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const motivo = (texto: string) => {
    const m = window.prompt(texto);
    return m && m.trim().length >= 5 ? m.trim() : null;
  };
  const prontaParaAprovar = b.status === "previa" && !lido.items.some((i) => i.status === "contestado");

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {lido.clinic.legal_name ?? lido.clinic.name} — {mesAno(b.period)}
          </h2>
          <p className="text-xs text-muted-foreground">
            CNPJ {lido.clinic.cnpj ?? "—"} · <Etiqueta status={b.status} />
            {b.example_values && <span className="ml-1 text-amber-700">Valores de exemplo (treino/sandbox) — não são do contrato</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={baixar}>
          Baixar a planilha
        </Button>
      </header>

      {lido.notice && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900">{lido.notice}</p>}
      {b.settle_note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{b.settle_note}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr>
              <td className="py-1">Taxas fixas (SDR, tecnologia)</td>
              <td className="py-1 text-right tabular-nums">{formatBRL(r.fixas)}</td>
            </tr>
            {r.porTaxa.map((t) => (
              <tr key={t.label}>
                <td className="py-1">{t.label} a cobrar</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(t.total)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1">Ajustes de meses anteriores e créditos</td>
              <td className="py-1 text-right tabular-nums">{formatBRL(r.ajustes)}</td>
            </tr>
            {r.saldoAnterior !== 0 && (
              <tr>
                <td className="py-1">Saldo anterior</td>
                <td className="py-1 text-right tabular-nums">{formatBRL(r.saldoAnterior)}</td>
              </tr>
            )}
            <tr className="font-semibold">
              <td className="py-1">Total a pagar</td>
              <td className="py-1 text-right tabular-nums">{formatBRL(r.total)}</td>
            </tr>
          </tbody>
        </table>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Informativo do mês (não cobrado de novo):</p>
          <p>Retido pelo split: {formatBRL(Number(lido.info?.retido_cents ?? 0))}</p>
          <p>A reter (cartão parcelado, nos próximos meses): {formatBRL(Number(lido.info?.a_reter_cents ?? 0))}</p>
          <p>Dispensado: {formatBRL(Number(lido.info?.dispensado_cents ?? 0))}</p>
          {b.due_date && (
            <p>
              Vencimento {dia(b.due_date)} · multa {b.fine_percent ?? "—"}% · juros {b.interest_percent_month ?? "—"}% ao mês
            </p>
          )}
          {b.paid_on && (
            <p>
              Pago em {dia(b.paid_on)}: {formatBRL(Number(b.paid_cents ?? 0))}
              {Number(b.late_cents ?? 0) > 0 && ` (multa e juros ${formatBRL(Number(b.late_cents))})`}
            </p>
          )}
        </div>
      </div>

      {lido.charge && (
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p className="font-medium">Cobrança no Asaas (boleto com Pix)</p>
          {lido.charge.invoice_url && (
            <p>
              <a className="text-primary underline" href={lido.charge.invoice_url} target="_blank" rel="noreferrer">
                Abrir a fatura
              </a>{" "}
              <button
                type="button"
                className="ml-2 text-xs text-muted-foreground underline"
                onClick={() => navigator.clipboard.writeText(lido.charge?.invoice_url ?? "").then(() => toast.success("Link copiado."))}
              >
                Copiar link
              </button>
            </p>
          )}
          {lido.charge.identification_field && <p className="break-all font-mono text-xs">{lido.charge.identification_field}</p>}
          {lido.charge.error_code && <p className="text-xs text-red-700">A emissão falhou ({lido.charge.error_code}).</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Linha</th>
              <th className="py-1 pr-2">Origem</th>
              <th className="py-1 pr-2">Paciente</th>
              <th className="py-1 pr-2 text-right">Base</th>
              <th className="py-1 pr-2 text-right">Valor</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lido.items.map((i) => (
              <Linha key={i.id} i={i} lido={lido} pendente={pendente} acao={acao} motivo={motivo} />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap gap-2">
        {lido.can_contest && b.status === "previa" && !b.unit_ack_at && (
          <Button disabled={pendente} onClick={() => acao(() => conferirPrevia(b.id), "Conferida. A prévia vai para a aprovação.")}>
            Conferi, está de acordo
          </Button>
        )}
        {lido.can_manage && b.status === "previa" && (
          <>
            <Button
              disabled={pendente || !prontaParaAprovar}
              title={prontaParaAprovar ? undefined : "Decida as contestações antes"}
              onClick={() => {
                if (!window.confirm(`Aprovar e emitir a cobrança de ${formatBRL(r.total)} pela conta da franqueadora?`)) return;
                acao(() => aprovarEEmitir(b.id), "Aprovada e emitida no Asaas.");
              }}
            >
              Aprovar e emitir
            </Button>
            <Button
              variant="outline"
              disabled={pendente}
              onClick={() => {
                const m = motivo("Por que refazer a prévia? (pelo menos 5 letras)");
                if (m) acao(() => refazerPrevia(b.id, m), "Prévia refeita.");
              }}
            >
              Refazer a prévia
            </Button>
          </>
        )}
        {lido.can_manage && b.status === "aprovada" && lido.charge?.status === "erro_emissao" && (
          <Button disabled={pendente} onClick={() => acao(() => tentarDeNovo(b.id), "Emitida no Asaas.")}>
            Tentar de novo
          </Button>
        )}
        {lido.can_manage && (b.status === "aprovada" || b.status === "emitida") && (
          <Button
            variant="outline"
            disabled={pendente}
            onClick={() => {
              const m = motivo("Por que cancelar esta cobrança no Asaas? (pelo menos 5 letras)");
              if (m) acao(() => cancelarCobranca(b.id, m), "Cancelada.");
            }}
          >
            Cancelar para reemitir
          </Button>
        )}
      </footer>
    </section>
  );
}

function Linha({
  i,
  lido,
  pendente,
  acao,
  motivo,
}: {
  i: ItemDoLote;
  lido: LoteLido;
  pendente: boolean;
  acao: (f: () => Promise<{ ok: boolean; error?: string; aviso?: string }>, sucesso: string) => void;
  motivo: (t: string) => string | null;
}) {
  const [contestando, setContestando] = useState(false);
  const b = lido.batch;
  const podeContestar =
    lido.can_contest &&
    i.status === "ativo" &&
    !i.decision &&
    Number(i.amount_cents) > 0 &&
    i.kind !== "saldo_anterior" &&
    (b.status === "previa" || b.status === "emitida" || b.status === "paga");
  return (
    <>
      <tr className={cn(i.status === "dispensado" && "text-muted-foreground line-through")}>
        <td className="py-1 pr-2">
          <span className="text-xs text-muted-foreground">{TIPO_DA_LINHA[i.kind]}</span>
          <br />
          {i.fee_label} · {mesAno(i.origin_period)}
        </td>
        <td className="py-1 pr-2">
          {i.origin_label ?? i.description ?? "—"}
          {i.received_on && <span className="text-xs text-muted-foreground"> · {dia(i.received_on)}</span>}
        </td>
        <td className="py-1 pr-2">{i.patient_code ? `${i.patient_code} · ${i.patient_short ?? ""}` : "—"}</td>
        <td className="py-1 pr-2 text-right tabular-nums">
          {i.base_cents == null ? "—" : `${formatBRL(Number(i.base_cents))} × ${String(i.percent ?? "").replace(".", ",")}%`}
        </td>
        <td className="py-1 pr-2 text-right tabular-nums">{formatBRL(Number(i.amount_cents))}</td>
        <td className="py-1 text-right text-xs">
          {i.status === "contestado" && <span className="text-red-700">Contestada</span>}
          {i.decision && (
            <span className={i.decision === "aceita" ? "text-emerald-700" : "text-muted-foreground"}>
              {i.decision === "aceita" ? (i.after_issue ? "Aceita: vira crédito" : "Aceita: dispensada") : "Recusada"}
            </span>
          )}
          {podeContestar && (
            <button type="button" className="text-primary underline" onClick={() => setContestando((x) => !x)}>
              Contestar
            </button>
          )}
        </td>
      </tr>
      {(i.contest_reason || i.decision_reason) && (
        <tr>
          <td colSpan={6} className="pb-2 text-xs text-muted-foreground">
            {i.contest_reason && <>Contestação: {i.contest_reason}. </>}
            {i.contest_attachment_path && (
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  const x = await linkDoComprovante(b.id, i.id);
                  if (x.ok) window.open(x.url, "_blank");
                  else toast.error(x.error);
                }}
              >
                Ver o comprovante
              </button>
            )}
            {i.decision_reason && <> Decisão: {i.decision_reason}.</>}
            {lido.can_manage && i.status === "contestado" && (
              <span className="ml-2 space-x-2">
                <button
                  type="button"
                  className="text-emerald-700 underline"
                  disabled={pendente}
                  onClick={() => {
                    const m = motivo("Motivo para ACEITAR (a linha é dispensada; depois da emissão, vira crédito):");
                    if (m) acao(() => decidirContestacao(i.id, true, m), "Contestação aceita.");
                  }}
                >
                  Aceitar
                </button>
                <button
                  type="button"
                  className="text-red-700 underline"
                  disabled={pendente}
                  onClick={() => {
                    const m = motivo("Motivo para RECUSAR:");
                    if (m) acao(() => decidirContestacao(i.id, false, m), "Contestação recusada.");
                  }}
                >
                  Recusar
                </button>
              </span>
            )}
          </td>
        </tr>
      )}
      {contestando && (
        <tr>
          <td colSpan={6} className="pb-3">
            <form
              className="flex flex-wrap items-center gap-2"
              action={(fd) => {
                fd.set("itemId", i.id);
                acao(() => contestarLinha(fd), "Contestação enviada ao Financeiro.");
                setContestando(false);
              }}
            >
              <Input name="motivo" placeholder="O motivo da contestação" className="min-w-72 flex-1" required minLength={5} />
              <input name="arquivo" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="text-xs" />
              <Button type="submit" size="sm" disabled={pendente}>
                Enviar
              </Button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function SaldoAnteriorCard({ saldo }: { saldo: SaldoAnterior }) {
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [decisao, setDecisao] = useState<"incluir" | "parcelar" | "dispensar">("incluir");
  const [parcelas, setParcelas] = useState("2");
  const [motivo, setMotivo] = useState("");
  const total = saldo.lines.reduce((s, l) => s + Number(l.open_cents), 0);
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Saldo anterior (antes do 1º mês da cobrança mensal{saldo.first_period ? `, ${mesAno(saldo.first_period)}` : ""})</h2>
      <p className="text-xs text-muted-foreground">
        As contas de taxa da rede em aberto antes da cobrança mensal. A primeira cobrança não as inclui sozinha: decida aqui,
        por unidade, com o motivo.
      </p>
      {saldo.decision ? (
        <p className="text-sm">
          Decidido: <strong>{saldo.decision.decision}</strong>
          {saldo.decision.decision === "parcelar" && ` em ${saldo.decision.installments} parcelas`} — {formatBRL(Number(saldo.decision.total_cents))}, por{" "}
          {saldo.decision.decided_by ?? "—"} em {dia(saldo.decision.decided_at)}. Motivo: {saldo.decision.reason}
        </p>
      ) : saldo.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{saldo.first_period ? "Nada em aberto antes do primeiro mês." : "A unidade ainda não tem o primeiro mês da cobrança mensal."}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {saldo.lines.map((l) => (
                <tr key={l.payable_id}>
                  <td className="py-1">
                    {l.label} · {mesAno(l.period)}
                  </td>
                  <td className="py-1">vence {dia(l.due_date)}</td>
                  <td className="py-1 text-right tabular-nums">{formatBRL(Number(l.open_cents))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1" colSpan={2}>
                  Total em aberto
                </td>
                <td className="py-1 text-right tabular-nums">{formatBRL(total)}</td>
              </tr>
            </tbody>
          </table>
          <div className="flex flex-wrap items-end gap-2">
            <select className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm" value={decisao} onChange={(e) => setDecisao(e.target.value as typeof decisao)}>
              <option value="incluir">Incluir na próxima cobrança</option>
              <option value="parcelar">Parcelar nas próximas cobranças</option>
              <option value="dispensar">Dispensar</option>
            </select>
            {decisao === "parcelar" && <Input className="w-20" type="number" min={2} max={24} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />}
            <Input className="min-w-72 flex-1" placeholder="O motivo (fica na auditoria)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <Button
              disabled={pendente || motivo.trim().length < 5}
              onClick={() =>
                start(async () => {
                  if (!window.confirm(`Confirmar: ${decisao} ${formatBRL(total)} do saldo anterior? A decisão não se refaz.`)) return;
                  const r = await decidirSaldoAnterior(saldo.clinicId, decisao, Number(parcelas) || 1, motivo);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Decisão gravada.");
                  router.refresh();
                })
              }
            >
              Gravar a decisão
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
