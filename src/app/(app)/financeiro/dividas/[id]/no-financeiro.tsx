"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import { titulosParecidos } from "@/lib/finance/dividas";
import { contaPadrao, type ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";
import { CampoDaConta } from "../../campo-da-conta";
import { registerPayablePayment } from "../../payables-actions";
import { buscarTitulosLivres, gerarNoFinanceiro, vincularTitulos } from "../actions";
import type { TituloDaDivida, TituloLivre } from "../dados";
import { SELECT, useAcao } from "./comum";

// A aba "Contas a Pagar" do detalhe da dívida (0406, fase 3): o que a dívida
// gera (ou já gerou) no Financeiro da unidade devedora.

export type PreviaDoFinanceiro = {
  conta: string | null;
  nomeDaConta: string | null;
  valorCents: number;
  competencia: string | null;
  vencimento: string | null;
  saldoDeImplantacao: boolean;
  naDre: boolean;
  problema: string | null;
  jaGerada: boolean;
};

const STATUS_DO_TITULO: Record<string, string> = {
  aberta: "Em aberto",
  parcial: "Pago em parte",
  paga: "Pago",
  cancelada: "Cancelado",
  recusada: "Recusado",
  aguardando_autorizacao: "Aguardando autorização",
};

const FORMAS = [
  { value: "pix", label: "Pix" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "debito_automatico", label: "Débito automático" },
];

const reais = (texto: string) => {
  const n = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const emTexto = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function NoFinanceiro({
  debtId,
  clinicId,
  devedor,
  origem,
  alvo,
  previa,
  titulos,
  contas,
  hoje,
  podeLancar,
}: {
  debtId: string;
  clinicId: string;
  devedor: string;
  origem: "A" | "B" | "C";
  alvo: { fornecedorId: string; vencimento: string; valorCents: number | null; contrato: string | null };
  previa: PreviaDoFinanceiro | null;
  titulos: TituloDaDivida[];
  contas: ContaDaUnidade[];
  hoje: string;
  podeLancar: boolean;
}) {
  const { ocupado, rodar } = useAcao();
  const ativos = titulos.filter((t) => t.status !== "cancelada" && t.status !== "recusada");
  const total = ativos.reduce((a, t) => a + t.valorCents, 0);
  const pago = ativos.reduce((a, t) => a + t.pagoCents, 0);

  // Origem C: os títulos livres do mesmo CNPJ, os parecidos primeiro.
  const [livres, setLivres] = useState<TituloLivre[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const parecidos = useMemo(() => new Set(titulosParecidos(livres ?? [], alvo).map((t) => t.id)), [livres, alvo]);
  const ordenados = useMemo(
    () => [...(livres ?? [])].sort((a, b) => Number(parecidos.has(b.id)) - Number(parecidos.has(a.id))),
    [livres, parecidos]
  );
  const buscar = async () => {
    setBuscando(true);
    try {
      setLivres(await buscarTitulosLivres(clinicId));
    } finally {
      setBuscando(false);
    }
  };

  // Registrar pagamento (a mesma porta do Contas a Pagar).
  const [pagando, setPagando] = useState<TituloDaDivida | null>(null);
  const [valor, setValor] = useState("");
  const [juros, setJuros] = useState("0,00");
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("pix");
  const [conta, setConta] = useState("");
  const [referencia, setReferencia] = useState("");
  const abrirPagamento = (t: TituloDaDivida) => {
    setPagando(t);
    setValor(emTexto(t.valorCents - t.pagoCents));
    setJuros("0,00");
    setData(hoje);
    setForma("pix");
    setConta(contaPadrao(contas, clinicId, "pix"));
    setReferencia("");
  };
  const pagar = () => {
    if (!pagando) return;
    const amount = reais(valor);
    const interest = reais(juros || "0");
    if (!(amount > 0) || !(interest >= 0)) return;
    rodar(
      () =>
        registerPayablePayment({
          payableId: pagando.id,
          amountCents: amount,
          feeCents: 0,
          interestCents: interest,
          paidAt: data,
          paymentMethod: forma,
          reference: referencia,
          notes: "",
          clientToken: crypto.randomUUID(),
          conta,
        }),
      "Pagamento registrado.",
      () => setPagando(null)
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start gap-2">
            <Receipt className="mt-0.5 size-4 text-muted-foreground" />
            <div className="flex-1 space-y-1 text-sm">
              <p className="font-medium">No Contas a Pagar de {devedor}</p>
              {ativos.length > 0 ? (
                <p className="text-muted-foreground">
                  {ativos.length} {ativos.length === 1 ? "título" : "títulos"} · {formatBRL(total)} · pago {formatBRL(pago)} · falta{" "}
                  {formatBRL(Math.max(total - pago, 0))}
                </p>
              ) : (
                <p className="text-muted-foreground">Esta dívida ainda não está no Contas a Pagar.</p>
              )}
            </div>
          </div>

          {origem !== "C" && previa && !previa.jaGerada && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              {previa.problema ? (
                <p className="text-amber-700 dark:text-amber-300">{previa.problema}</p>
              ) : (
                <>
                  <p>
                    Será criado 1 título de <strong>{formatBRL(previa.valorCents)}</strong> na conta{" "}
                    <strong>
                      {previa.conta}
                      {previa.nomeDaConta ? ` · ${previa.nomeDaConta}` : ""}
                    </strong>
                    {previa.vencimento ? `, vencendo em ${formatIsoDateBr(previa.vencimento)}` : ""}.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {previa.naDre
                      ? `A despesa entra na DRE de ${previa.competencia ? formatIsoDateBr(previa.competencia) : "sua competência"}.`
                      : "Marcado como saldo de implantação: nenhum lançamento na DRE (só juros, multa e descontos futuros entram)."}
                  </p>
                  {podeLancar && (
                    <Button
                      className="mt-3"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => rodar(() => gerarNoFinanceiro(debtId), "Título criado no Contas a Pagar.")}
                    >
                      Gerar no Contas a Pagar
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {origem !== "C" && previa?.jaGerada && previa.problema === null && (
            <p className="text-xs text-muted-foreground">
              Mudou o valor, a conta ou o vencimento da dívida? O título acompanha sozinho enquanto não tiver pagamento.
            </p>
          )}
        </CardContent>
      </Card>

      {origem === "C" && podeLancar && (
        <Card>
          <CardContent className="space-y-3 py-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Vincular títulos que já estão no Contas a Pagar</p>
              <Button size="sm" variant="outline" disabled={buscando} onClick={buscar}>
                <Link2 className="size-4" /> {livres ? "Buscar de novo" : "Buscar títulos em aberto"}
              </Button>
            </div>
            {livres && livres.length === 0 && (
              <p className="text-muted-foreground">Nenhum título em aberto sem dívida em {devedor}.</p>
            )}
            {livres && livres.length > 0 && (
              <>
                <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {ordenados.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${t.descricao}`}
                        checked={marcados.includes(t.id)}
                        onChange={(e) =>
                          setMarcados((m) => (e.target.checked ? [...m, t.id] : m.filter((x) => x !== t.id)))
                        }
                      />
                      <span className="flex-1 truncate">{t.descricao}</span>
                      {parecidos.has(t.id) && (
                        <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          parecido
                        </span>
                      )}
                      <span className="tabular-nums text-muted-foreground">{formatIsoDateBr(t.vencimento)}</span>
                      <span className="w-28 text-right tabular-nums">{formatBRL(t.valorCents)}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  disabled={ocupado || marcados.length === 0}
                  onClick={() =>
                    rodar(() => vincularTitulos(debtId, marcados), "Títulos vinculados à dívida.", () => {
                      setMarcados([]);
                      setLivres(null);
                    })
                  }
                >
                  Vincular {marcados.length || ""} {marcados.length === 1 ? "título" : "títulos"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {titulos.length > 0 && (
        <Card>
          <CardContent className="py-2">
            <ul className="divide-y text-sm">
              {titulos.map((t) => {
                const aberto = t.status === "aberta" || t.status === "parcial";
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.descricao}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.conta} · {t.link === "gerado" ? "gerado pela dívida" : "vinculado"}
                        {t.saldoDeImplantacao ? " · saldo de implantação" : ""}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">vence {formatIsoDateBr(t.vencimento)}</span>
                    <span className="text-xs">{STATUS_DO_TITULO[t.status] ?? t.status}</span>
                    <span className="w-40 text-right tabular-nums">
                      {formatBRL(t.valorCents)}
                      {t.pagoCents > 0 && (
                        <span className="block text-xs text-muted-foreground">pago {formatBRL(t.pagoCents)}</span>
                      )}
                    </span>
                    {aberto && podeLancar && (
                      <Button size="sm" variant="outline" onClick={() => abrirPagamento(t)}>
                        <Wallet className="size-4" /> Registrar pagamento
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="py-2 text-xs text-muted-foreground">
              Os títulos também aparecem em{" "}
              <Link href="/financeiro/contas-a-pagar" className="underline">
                Financeiro → Contas a pagar
              </Link>{" "}
              da unidade.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={pagando !== null} onOpenChange={(o) => !o && setPagando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          {pagando && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {pagando.descricao} · falta {formatBRL(pagando.valorCents - pagando.pagoCents)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">Valor pago (R$)</Label>
                  <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
                </div>
                <div>
                  <Label className="text-[11px]">Juros e multa (R$)</Label>
                  <Input value={juros} onChange={(e) => setJuros(e.target.value)} inputMode="decimal" />
                </div>
                <div>
                  <Label className="text-[11px]">Data</Label>
                  <Input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
                </div>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">Forma</span>
                  <select
                    className={SELECT}
                    value={forma}
                    onChange={(e) => {
                      setForma(e.target.value);
                      setConta(contaPadrao(contas, clinicId, e.target.value));
                    }}
                  >
                    {FORMAS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <CampoDaConta rotulo="Saiu de" contas={contas} clinicId={clinicId} value={conta} onChange={setConta} />
              <div>
                <Label className="text-[11px]">Referência (opcional)</Label>
                <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Juros e multa vão para a despesa financeira do mês do pagamento; o principal só baixa a dívida.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagando(null)}>
              Cancelar
            </Button>
            <Button disabled={ocupado} onClick={pagar}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
