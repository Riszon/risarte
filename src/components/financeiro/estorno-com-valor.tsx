"use client";

/**
 * 4020a (spec 19.38) — "ESTORNAR PARTE": o estorno com valor (Pix ou cartão), com
 * a CONFIRMAÇÃO REFORÇADA do cartão (cuidado 1): o valor, o paciente, a
 * repartição prevista entre as parcelas (cuidado 2) e o aviso de que, no cartão,
 * o estorno sai na hora e não pode ser desfeito. Acima do limite da Central, o
 * Gerente ou o franqueado confirma antes de ir ao Asaas.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { pedirEstornoComValor, previaDoEstornoParcial, type PreviaDoEstornoParcial } from "@/app/(app)/prontuarios/[id]/estorno-actions";

const centavos = (s: string) => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return t && Number.isFinite(n) ? Math.round(n * 100) : null;
};

export function EstornoComValor({
  clientId,
  chargeId = null,
  blockId = null,
  rotulo = "Estornar parte",
}: {
  clientId: string;
  chargeId?: string | null;
  blockId?: string | null;
  rotulo?: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<PreviaDoEstornoParcial | null>(null);
  const [pendente, start] = useTransition();

  const ver = (v: string) =>
    start(async () => {
      const r = await previaDoEstornoParcial({ chargeId, blockId, amountCents: centavos(v) });
      if (!r.ok) return void toast.error(r.error);
      setPrevia(r.previa);
    });

  const abrir = () => {
    setAberto(true);
    setPrevia(null);
    ver("");
  };

  const cartao = previa?.kind === "cartao";
  const valorCents = centavos(valor);

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={abrir}>
        <Undo2 className="mr-1 size-3" /> {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{blockId ? "Estornar parte do parcelamento" : "Estornar parte da cobrança"}</DialogTitle>
            <DialogDescription>
              {previa?.patient?.name ? `${previa.patient.code ?? ""} · ${previa.patient.name}` : "Carregando…"}
            </DialogDescription>
          </DialogHeader>
          {previa && (
            <div className="space-y-3 text-sm">
              <p>
                Ainda pode ser estornado: <strong>{formatBRL(previa.left_cents)}</strong>. Em branco = o total.
              </p>
              <label className="block space-y-1">
                <span className="font-medium">Valor do estorno (R$)</span>
                <Input value={valor} onChange={(e) => setValor(e.target.value)} onBlur={() => ver(valor)} inputMode="decimal" placeholder="o total" />
              </label>
              {previa.expected_split && previa.expected_split.length > 0 && (
                <div className="rounded-md border p-2 text-xs">
                  <p className="mb-1 font-medium">Como o Asaas deve repartir (previsão):</p>
                  <ul className="space-y-0.5">
                    {previa.expected_split.map((x) => (
                      <li key={x.charge_id}>
                        Parcela {x.numero}: {formatBRL(x.valor_cents)} {x.inteira ? "(inteira: a baixa é desfeita, e ela fica \"Estornada\")" : "(parte: a parcela continua paga)"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">Depois do pedido, o riSZon grava o que o Asaas fez; se for diferente, avisa você e o Financeiro.</p>
                </div>
              )}
              {cartao && (
                <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  <strong>No cartão, o estorno sai na hora e não pode ser desfeito.</strong>
                </p>
              )}
              {previa.needs_confirm && (
                <p className="text-xs text-muted-foreground">
                  Este estorno de cartão precisa da confirmação do Gerente ou do franqueado (não de quem pede) antes de ir ao Asaas.
                </p>
              )}
              <p className="text-xs text-muted-foreground">A taxa da rede continua devida pela unidade.</p>
              <label className="block space-y-1">
                <span className="font-medium">Motivo</span>
                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que estornar (fica na auditoria)" />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAberto(false)} disabled={pendente}>
                  Voltar
                </Button>
                <Button
                  disabled={pendente || motivo.trim().length < 5 || (valor.trim() !== "" && !valorCents)}
                  onClick={() =>
                    start(async () => {
                      const r = await pedirEstornoComValor({ clientId, chargeId, blockId, amountCents: valor.trim() ? valorCents : null, motivo });
                      if (!r.ok) return void toast.error(r.error);
                      toast.success(r.aviso);
                      setAberto(false);
                      router.refresh();
                    })
                  }
                >
                  {previa.needs_confirm ? "Pedir (vai para a confirmação)" : `Estornar ${formatBRL(valorCents ?? previa.left_cents)}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
