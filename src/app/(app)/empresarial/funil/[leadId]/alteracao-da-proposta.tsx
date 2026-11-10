"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, PencilLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatBrDate } from "@/lib/dates";
import type { SituacaoDaProposta } from "@/lib/empresarial/alteracao-da-proposta";
import { applyProposalToCompany, reopenProposal } from "./actions";

/**
 * O AVISO DA PROPOSTA TRAVADA (1041, pedido do dono 09/11/2026).
 *
 * Aparece acima das abas, em todas elas: quem abre a ficha de uma empresa com
 * contrato assinado precisa saber, antes de tentar mexer, que a proposta só se
 * lê — e quem pode destravar, e como.
 */
export function AvisoDaProposta({
  leadId,
  situacao,
  podeDestravar,
  temEmpresa,
}: {
  leadId: string;
  situacao: SituacaoDaProposta;
  /** Admin e gestor do programa (`isProgramManager`). */
  podeDestravar: boolean;
  temEmpresa: boolean;
}) {
  if (situacao.tipo === "livre") return null;

  if (situacao.tipo === "em_alteracao") {
    const r = situacao.reabertura;
    return (
      <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">
          <PencilLine className="mr-1 inline size-4" aria-hidden />
          Proposta e contrato em alteração
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Destravados em {formatBrDate(r.reabertaEm)}
          {r.reabertaPor ? ` por ${r.reabertaPor}` : ""}. Motivo: {r.motivo}
        </p>
        <p className="mt-1 text-xs">
          Ajuste a proposta e o contrato e envie o contrato para{" "}
          <strong>assinar de novo</strong> (aba Envio e selos). Assinado, a
          proposta trava outra vez
          {temEmpresa ? " e as alterações podem ir para o cadastro da empresa" : ""}.
        </p>
      </div>
    );
  }

  const assinadaEm = situacao.assinadaEm;
  return (
    <div className="space-y-2 rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            <Lock className="mr-1 inline size-4" aria-hidden />
            Contrato assinado em {formatBrDate(assinadaEm)} — proposta travada
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A proposta e o contrato só se leem. Para mudar alguma coisa, a
            alteração é destravada com o motivo e o contrato é assinado de novo.
          </p>
        </div>
        {podeDestravar ? (
          <BotaoDestravar leadId={leadId} temEmpresa={temEmpresa} />
        ) : (
          <p className="max-w-56 text-xs text-muted-foreground">
            Precisa alterar? Peça ao gestor do programa.
          </p>
        )}
      </div>

      {situacao.tipo === "levar_para_empresa" && (
        <LevarParaEmpresa
          leadId={leadId}
          motivo={situacao.reabertura.motivo}
          podeLevar={podeDestravar}
        />
      )}
    </div>
  );
}

function BotaoDestravar({ leadId, temEmpresa }: { leadId: string; temEmpresa: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [isPending, startTransition] = useTransition();
  const curto = motivo.trim().length < 10;

  function confirmar() {
    startTransition(async () => {
      const r = await reopenProposal(leadId, motivo);
      if (r.ok) {
        toast.success("Destravado. Ajuste a proposta e envie o contrato para assinar de novo.");
        setAberto(false);
        setMotivo("");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <PencilLine className="mr-1 size-3.5" />
            Alterar proposta e contrato
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar proposta e contrato</DialogTitle>
          <DialogDescription>
            A assinatura atual é desfeita e o contrato volta a precisar de
            assinatura. O contrato já assinado continua guardado nos pacotes de
            assinatura.
            {temEmpresa
              ? " Depois de assinado de novo, as alterações podem ir para o cadastro da empresa; cobranças já geradas não mudam."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="motivo-da-alteracao">Motivo da alteração *</Label>
          <textarea
            id="motivo-da-alteracao"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
            placeholder="Ex.: a empresa pediu mais 5 titulares e um benefício de clareamento."
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Fica no histórico da empresa, com o seu nome.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={curto || isPending} onClick={confirmar}>
            Destravar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LevarParaEmpresa({
  leadId,
  motivo,
  podeLevar,
}: {
  leadId: string;
  motivo: string;
  podeLevar: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function levar() {
    startTransition(async () => {
      const r = await applyProposalToCompany(leadId);
      if (r.ok) {
        toast.success("O cadastro da empresa foi atualizado com a proposta reassinada.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2">
      <p className="text-xs">
        <strong>A proposta alterada foi assinada de novo</strong> ({motivo}). O
        cadastro da empresa ainda está com os valores antigos.
      </p>
      {podeLevar ? (
        <Button size="sm" className="h-8 text-xs" disabled={isPending} onClick={levar}>
          <Send className="mr-1 size-3.5" />
          Levar as alterações para a empresa
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">O gestor do programa leva para a empresa.</p>
      )}
    </div>
  );
}
