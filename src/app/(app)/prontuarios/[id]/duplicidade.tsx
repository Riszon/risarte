"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import type { SurplusRow } from "./receivables-loader";
import { abaterDuplicidade, dispensarTaxaDaRede, marcarDuplicidadeDevolvida } from "./cobranca-actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const MOTIVO: Record<string, string> = {
  cobranca_cancelada: "a cobrança já estava cancelada",
  parcela_ja_paga: "a parcela já estava paga",
  cobranca_estornada: "a cobrança já estava estornada",
};

/**
 * ASA2 (4005) — PAGAMENTO EM DUPLICIDADE (16.6): um pagamento pelo Asaas de
 * cobrança cancelada ou de parcela já paga não vira baixa em dobro. O Gerente da
 * unidade, o Financeiro da Franqueadora ou o Admin decide: devolver ao pagador
 * (a devolução é feita no painel do Asaas) ou abater em outra parcela dele.
 */
export function DuplicidadesDoCliente({
  clientId,
  surpluses,
  parcelasAbertas,
  podeResolver,
}: {
  clientId: string;
  surpluses: SurplusRow[];
  parcelasAbertas: { id: string; rotulo: string }[];
  podeResolver: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [abrindo, setAbrindo] = useState<{ id: string; modo: "abater" | "devolver" } | null>(null);
  const [parcela, setParcela] = useState("");
  const [nota, setNota] = useState("");

  const abertos = surpluses.filter((s) => s.status === "aberto");
  if (abertos.length === 0) return null;

  function confirmar() {
    if (!abrindo) return;
    startTransition(async () => {
      const r =
        abrindo.modo === "abater"
          ? await abaterDuplicidade({ clientId, surplusId: abrindo.id, installmentId: parcela, note: nota })
          : await marcarDuplicidadeDevolvida({ clientId, surplusId: abrindo.id, note: nota });
      if (r.ok) {
        toast.success(abrindo.modo === "abater" ? "Valor abatido na parcela escolhida." : "Marcado como devolvido.");
        setAbrindo(null);
        setNota("");
        setParcela("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
      <p className="font-medium">Pagamento em duplicidade pelo Asaas</p>
      {abertos.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="min-w-0 flex-1">
            {formatBRL(s.amountCents)} pago em {fmtDate(s.paidOn)}, mas {MOTIVO[s.reason] ?? s.reason}. Nenhuma baixa foi
            feita em dobro.
          </span>
          {podeResolver ? (
            <span className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAbrindo({ id: s.id, modo: "abater" })}>
                Abater em outra parcela
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAbrindo({ id: s.id, modo: "devolver" })}>
                Devolvido
              </Button>
            </span>
          ) : (
            <span className="text-[11px]">O Gerente ou o Financeiro decide.</span>
          )}
        </div>
      ))}

      <Dialog open={abrindo !== null} onOpenChange={(o) => !o && setAbrindo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{abrindo?.modo === "abater" ? "Abater em outra parcela" : "Pagamento devolvido"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {abrindo?.modo === "abater" ? (
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Parcela em aberto deste paciente</span>
                <select
                  value={parcela}
                  onChange={(e) => setParcela(e.target.value)}
                  className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">Escolha…</option>
                  {parcelasAbertas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.rotulo}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-muted-foreground">
                  O valor vira a baixa dessa parcela, até o saldo dela, na conta Asaas da unidade.
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">
                Faça a devolução no painel do Asaas e registre aqui como foi devolvido.
              </p>
            )}
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">
                {abrindo?.modo === "abater" ? "Observação (opcional)" : "Como foi devolvido"}
              </span>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                className="mt-0.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
              />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAbrindo(null)}>
              Voltar
            </Button>
            <Button
              disabled={isPending || (abrindo?.modo === "abater" ? !parcela : nota.trim().length < 5)}
              onClick={confirmar}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A dispensa da taxa da rede mantida no estorno (Financeiro e Admin, com motivo). */
export function DispensarTaxaDaRede({ clientId, receiptId }: { clientId: string; receiptId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  return (
    <>
      <Button size="sm" variant="ghost" className="ml-1 h-6 px-1.5 text-[11px]" onClick={() => setAberto(true)}>
        Dispensar a taxa
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dispensar a taxa da rede desta baixa</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Pela regra da rede (D13), a taxa continua devida mesmo com o estorno. Dispense só em caso justificado, como
            pagamento em duplicidade devolvido. Fica registrado com o seu nome e o motivo.
          </p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button
              disabled={isPending || motivo.trim().length < 5}
              onClick={() =>
                startTransition(async () => {
                  const r = await dispensarTaxaDaRede({ clientId, receiptId, reason: motivo });
                  if (r.ok) {
                    toast.success("Taxa da rede dispensada.");
                    setAberto(false);
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              Dispensar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
