"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { contaPadrao, type ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";
import { CampoDaConta } from "../../campo-da-conta";
import { registerPayablePayment } from "../../payables-actions";
import { SELECT, useAcao } from "./comum";

// "Registrar pagamento" de um título da dívida — o de origem, a parcela do
// acordo ou o restabelecido (0406/0408). É a MESMA porta do Contas a Pagar:
// não existe "pagamento da dívida" à parte.

export type TituloParaPagar = { id: string; descricao: string; valorCents: number; pagoCents: number };

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

export function DialogoDePagamento({
  titulo,
  onFechar,
  contas,
  clinicId,
  hoje,
}: {
  titulo: TituloParaPagar | null;
  onFechar: () => void;
  contas: ContaDaUnidade[];
  clinicId: string;
  hoje: string;
}) {
  return (
    <Dialog open={titulo !== null} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
        </DialogHeader>
        {titulo && <Formulario key={titulo.id} titulo={titulo} onFechar={onFechar} contas={contas} clinicId={clinicId} hoje={hoje} />}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  titulo,
  onFechar,
  contas,
  clinicId,
  hoje,
}: {
  titulo: TituloParaPagar;
  onFechar: () => void;
  contas: ContaDaUnidade[];
  clinicId: string;
  hoje: string;
}) {
  const { ocupado, rodar } = useAcao();
  const [valor, setValor] = useState(emTexto(titulo.valorCents - titulo.pagoCents));
  const [juros, setJuros] = useState("0,00");
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("pix");
  const [conta, setConta] = useState(contaPadrao(contas, clinicId, "pix"));
  const [referencia, setReferencia] = useState("");

  const pagar = () => {
    const amount = reais(valor);
    const interest = reais(juros || "0");
    if (!(amount > 0) || !(interest >= 0)) return;
    rodar(
      () =>
        registerPayablePayment({
          payableId: titulo.id,
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
      onFechar
    );
  };

  return (
    <>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {titulo.descricao} · falta {formatBRL(titulo.valorCents - titulo.pagoCents)}
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
      <DialogFooter>
        <Button variant="outline" onClick={onFechar}>
          Cancelar
        </Button>
        <Button disabled={ocupado} onClick={pagar}>
          Registrar
        </Button>
      </DialogFooter>
    </>
  );
}
