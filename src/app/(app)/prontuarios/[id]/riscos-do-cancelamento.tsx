"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CANAL_DOS_RISCOS_DO_CANCELAMENTO,
  MINIMO_DOS_RISCOS_DO_CANCELAMENTO,
  type CanalDosRiscosDoCancelamento,
} from "@/lib/fim-do-cancelamento";
import { registrarRiscosDoCancelamento } from "@/app/cancelamentos/[id]/termo/fim-do-cancelamento-actions";

const CAMPO = "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm";

export type TermoComRiscosPendentes = { id: string; code: string | null };

/**
 * 0426 (D25): o termo de cancelamento com procedimento começado e não
 * terminado espera o registro do Coordenador sobre os riscos informados. Linha
 * do painel "Precisa de atenção" até o registro.
 */
export function RiscosDoCancelamento({
  clientId,
  termos,
  ehCoordenador,
  hoje,
}: {
  clientId: string;
  termos: TermoComRiscosPendentes[];
  ehCoordenador: boolean;
  /** Hoje no Brasil (aaaa-mm-dd), vindo do servidor. */
  hoje: string;
}) {
  const [aberto, setAberto] = useState<TermoComRiscosPendentes | null>(null);
  if (termos.length === 0) return null;
  return (
    <>
      {termos.map((t) => (
        <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
          <FileWarning className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive">
              Cancelamento {t.code ?? ""}: registrar os riscos informados ao cliente
            </p>
            <p className="mt-0.5 text-xs text-foreground/80">
              O plano tem procedimento começado e não terminado. O termo só pode ser assinado depois
              do registro do Coordenador Clínico.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Link
              href={`/cancelamentos/${t.id}/termo`}
              className="inline-flex items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              Ver termo
              <ChevronRight className="size-3.5" />
            </Link>
            {ehCoordenador && (
              <Button size="sm" onClick={() => setAberto(t)}>
                Registrar riscos
              </Button>
            )}
          </div>
        </li>
      ))}
      <RiscosDialog clientId={clientId} termo={aberto} hoje={hoje} onClose={() => setAberto(null)} />
    </>
  );
}

function RiscosDialog({
  clientId,
  termo,
  hoje,
  onClose,
}: {
  clientId: string;
  termo: TermoComRiscosPendentes | null;
  hoje: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [riscos, setRiscos] = useState("");
  const [canal, setCanal] = useState<CanalDosRiscosDoCancelamento>("presencial");
  const [informadoEm, setInformadoEm] = useState(hoje);

  function fechar() {
    setRiscos("");
    setCanal("presencial");
    setInformadoEm(hoje);
    onClose();
  }

  function salvar() {
    if (!termo) return;
    startTransition(async () => {
      const res = await registrarRiscosDoCancelamento({ id: termo.id, clientId, riscos, canal, informadoEm });
      if (res.ok) {
        toast.success("Riscos registrados. O Gerente foi avisado: o termo já pode ser assinado.");
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={termo !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Riscos informados no cancelamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Sai impresso no termo e fica no prontuário: é a proteção da clínica quando um procedimento
            é interrompido no meio.
          </p>
          <textarea
            value={riscos}
            onChange={(e) => setRiscos(e.target.value)}
            rows={4}
            placeholder="Ex.: informado o risco de fratura do dente sem a coroa definitiva."
            className={CAMPO}
          />
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Por qual meio</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CANAL_DOS_RISCOS_DO_CANCELAMENTO) as CanalDosRiscosDoCancelamento[]).map((c) => (
                <Button key={c} size="sm" type="button" variant={canal === c ? "default" : "outline"} onClick={() => setCanal(c)}>
                  {CANAL_DOS_RISCOS_DO_CANCELAMENTO[c]}
                </Button>
              ))}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Em que data</span>
            <input type="date" value={informadoEm} max={hoje} onChange={(e) => setInformadoEm(e.target.value)} className={CAMPO} />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button disabled={isPending || riscos.trim().length < MINIMO_DOS_RISCOS_DO_CANCELAMENTO || !informadoEm} onClick={salvar}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
