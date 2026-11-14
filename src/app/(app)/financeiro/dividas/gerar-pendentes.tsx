"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gerarPendentesNoFinanceiro } from "./actions";

/**
 * Fase 3 (0406): as dívidas A/B que ainda não estão no Contas a Pagar — as
 * cadastradas antes desta versão ou sem "gerar já". Gera todas de uma vez;
 * a que não puder (falta conta, mês fechado…) fica listada com o motivo.
 */
export function GerarPendentes({ pendentes }: { pendentes: { id: string; code: string }[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [ocupado, startTransition] = useTransition();
  const [falhas, setFalhas] = useState<{ code: string; id: string; motivo: string }[]>([]);
  const codigo = new Map(pendentes.map((p) => [p.id, p.code]));

  const gerar = () =>
    startTransition(async () => {
      const r = await gerarPendentesNoFinanceiro(pendentes.map((p) => p.id));
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      if (r.geradas > 0) toast.success(`${r.geradas} ${r.geradas === 1 ? "título gerado" : "títulos gerados"} no Contas a Pagar.`);
      setFalhas(r.falhas.map((f) => ({ ...f, code: codigo.get(f.id) ?? "—" })));
      if (r.falhas.length === 0) setAberto(false);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
      <Receipt className="size-4" />
      <span className="flex-1">
        {pendentes.length === 1 ? "1 dívida ainda não está" : `${pendentes.length} dívidas ainda não estão`} no Contas a Pagar
        da unidade (origens A e B).
      </span>
      <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
        Gerar no Contas a Pagar
      </Button>

      <Dialog open={aberto} onOpenChange={(o) => !ocupado && setAberto(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerar os títulos no Contas a Pagar</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Cada dívida vira 1 título no Contas a Pagar da unidade que deve: as anteriores à implantação como{" "}
              <strong>saldo de implantação</strong> (fora da DRE), as novas como despesa na competência. Para ver o
              detalhe de uma antes, abra a aba Contas a Pagar da dívida.
            </p>
            {falhas.length > 0 && (
              <div className="rounded border border-amber-500/50 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">Não foram geradas:</p>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {falhas.map((f) => (
                    <li key={f.id}>
                      <Link href={`/financeiro/dividas/${f.id}?aba=financeiro`} className="underline">
                        {f.code}
                      </Link>
                      : {f.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button disabled={ocupado} onClick={gerar}>
              {ocupado ? "Gerando…" : `Gerar ${pendentes.length === 1 ? "1 título" : `${pendentes.length} títulos`}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
