"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, parseBRLToCents } from "@/lib/pricing";
import { ORTHO_BILLING_METHODS, ORTHO_BILLING_METHOD_LABELS, type OrthoBillingMethod } from "@/lib/ortodontia/constants";
import { decideOrthoBatch, emitOrthoBatch } from "../../actions";

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const brlText = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * R8 (0335): as ações sobre o LOTE de mensalidades, na ficha do caso — para
 * quem gere ou dá baixa, com o caso em tratamento:
 *   * lote ativo sem decisão → "Emitir novas mensalidades" (lote novo; o
 *     valor vem sugerido, com o reajuste anual depois de 12 meses — Q2) ou
 *     "Não será necessário" (finalizando);
 *   * sem lote → "Emitir lote de mensalidades" (os casos de antes, ou depois
 *     de retomar da suspensão).
 */
export function BatchActions({
  caseId,
  batch,
  suggested,
  defaults,
}: {
  caseId: string;
  /** O lote ativo (nulo = sem lote). */
  batch: { id: string; seq: number; installmentsCount: number; amountCents: number; method: string | null; punctuality: number; decision: string | null; lastDue: string } | null;
  /** O valor sugerido para o lote novo e se o reajuste anual entrou (Q2). */
  suggested: { amountCents: number; adjusted: boolean; adjustmentPercent: number };
  defaults: { count: number; method: string | null; punctuality: number };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<null | "renovar" | "nao_renovar" | "emitir">(null);
  const [count, setCount] = useState<number>(batch?.installmentsCount ?? defaults.count);
  const [amount, setAmount] = useState(brlText(suggested.amountCents));
  const [method, setMethod] = useState<string>(batch?.method ?? defaults.method ?? "boleto");
  const [punct, setPunct] = useState(String(batch?.punctuality ?? defaults.punctuality).replace(".", ","));
  const [note, setNote] = useState("");

  const decided = Boolean(batch?.decision);

  function run(kind: "renovar" | "nao_renovar" | "emitir") {
    startTransition(async () => {
      const amountCents = parseBRLToCents(amount) ?? 0;
      const punctuality = Number.parseFloat(punct.replace(",", ".")) || 0;
      const r =
        kind === "emitir"
          ? await emitOrthoBatch(caseId, { count, amountCents, method, punctuality })
          : await decideOrthoBatch(batch!.id, kind, kind === "renovar" ? { count, amountCents, method, punctuality, note } : { note });
      if (!r.ok) toast.error(r.error ?? "Não foi possível registrar.");
      else {
        toast.success(kind === "nao_renovar" ? "Registrado: não serão emitidas novas mensalidades." : "Lote de mensalidades emitido.");
        setOpen(null);
        setNote("");
        router.refresh();
      }
    });
  }

  const formulario = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="lote-count">Quantas mensalidades</Label>
        <Input id="lote-count" type="number" min={1} max={120} value={count} onChange={(e) => setCount(Number(e.target.value))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lote-amount">Valor da mensalidade (R$)</Label>
        <Input id="lote-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {suggested.adjusted && (
          <p className="text-[11px] text-muted-foreground">
            Sugerido com o reajuste anual de {String(suggested.adjustmentPercent).replace(".", ",")}% (mais de 12 meses de tratamento). Você pode alterar.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="lote-method">Como são emitidas</Label>
        <select id="lote-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
          {ORTHO_BILLING_METHODS.map((m) => (
            <option key={m} value={m}>{ORTHO_BILLING_METHOD_LABELS[m as OrthoBillingMethod]}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="lote-punct">Desconto por pontualidade (%)</Label>
        <Input id="lote-punct" inputMode="decimal" value={punct} onChange={(e) => setPunct(e.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="lote-note">Observação</Label>
        <Input id="lote-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: acordo renovado com o paciente por telefone" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {batch && !decided && (
        <>
          <Button size="sm" onClick={() => setOpen("renovar")}>Emitir novas mensalidades</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen("nao_renovar")}>Não será necessário</Button>
        </>
      )}
      {!batch && <Button size="sm" onClick={() => setOpen("emitir")}>Emitir lote de mensalidades</Button>}

      <Dialog open={open === "renovar" || open === "emitir"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{open === "emitir" ? "Emitir o lote de mensalidades" : "Emitir novas mensalidades"}</DialogTitle>
            <DialogDescription>
              {open === "emitir"
                ? "As mensalidades são emitidas de uma vez, uma por mês a partir deste mês (competência mês a mês na DRE)."
                : `O lote ${batch?.seq ?? ""} termina em ${batch ? batch.lastDue.split("-").reverse().join("/") : ""}. O lote novo começa no mês seguinte ao último deste.`}
            </DialogDescription>
          </DialogHeader>
          {formulario}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={isPending}>Voltar</Button>
            <Button onClick={() => run(open === "emitir" ? "emitir" : "renovar")} disabled={isPending || count < 1}>
              {isPending ? "Emitindo…" : `Emitir ${count} mensalidade${count === 1 ? "" : "s"} de ${formatBRL(parseBRLToCents(amount) ?? 0)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "nao_renovar"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Não será necessário emitir mais mensalidades</DialogTitle>
            <DialogDescription>
              Use quando o tratamento está finalizando dentro deste lote. Depois da última mensalidade, nada mais é emitido; a entrega das contenções fecha o tratamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="lote-note-2">Observação</Label>
            <Input id="lote-note-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: previsão de entrega das contenções em dezembro" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={isPending}>Voltar</Button>
            <Button onClick={() => run("nao_renovar")} disabled={isPending}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
