"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarAceite, registrarAutorizacaoAviso, revogarAutorizacaoAviso } from "../../actions";

/** Registrar o aceite do indicado depois do registro (ligação, visita). */
export function RegistrarAceite({ indicacaoId }: { indicacaoId: string }) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const registrar = (canal: "presencial" | "telefone") =>
    gravar(async () => {
      const r = await registrarAceite(indicacaoId, canal);
      if (r.ok) {
        toast.success("Aceite do indicado registrado.");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => registrar("telefone")}>
        Aceitou por telefone
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => registrar("presencial")}>
        Aceitou pessoalmente
      </Button>
    </div>
  );
}

/**
 * "Autorizou avisar quem indicou" (2009). É OUTRA pergunta, separada do aceite
 * do contato: sem ela, as mensagens ao Embaixador saem sem o nome do indicado.
 * Revogar pede o motivo; "não quer ser ligado a quem indicou" também desliga
 * os dois no portal e no "Indicado por".
 */
export function AutorizacaoAviso({
  indicacaoId,
  autorizadoEm,
  revogadoEm,
  encerrada,
}: {
  indicacaoId: string;
  autorizadoEm: string | null;
  revogadoEm: string | null;
  encerrada: boolean;
}) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const [revogando, setRevogando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [desvincular, setDesvincular] = useState(false);
  const vigente = Boolean(autorizadoEm) && !revogadoEm;

  const autorizar = (canal: "presencial" | "telefone") =>
    gravar(async () => {
      const r = await registrarAutorizacaoAviso(indicacaoId, canal);
      if (r.ok) {
        toast.success("Autorização registrada: as mensagens a quem indicou passam a trazer o nome.");
        router.refresh();
      } else toast.error(r.error);
    });

  const revogar = () =>
    gravar(async () => {
      const r = await revogarAutorizacaoAviso(indicacaoId, motivo, desvincular);
      if (r.ok) {
        toast.success("Autorização revogada: as próximas mensagens saem sem o nome.");
        setRevogando(false);
        setMotivo("");
        router.refresh();
      } else toast.error(r.error);
    });

  if (vigente) {
    if (!revogando) {
      return (
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={gravando} onClick={() => setRevogando(true)}>
          Pediu para não avisar mais
        </Button>
      );
    }
    return (
      <div className="space-y-1.5">
        <Input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (o indicado pediu…)"
          className="h-7 text-xs"
          aria-label="Motivo da revogação"
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={desvincular} onChange={(e) => setDesvincular(e.target.checked)} />
          Não quer ser ligado a quem o indicou (some também do portal do Embaixador)
        </label>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando || !motivo.trim()} onClick={revogar}>
            Revogar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={gravando} onClick={() => setRevogando(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  if (encerrada) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => autorizar("telefone")}>
        Autorizou avisar quem indicou · por telefone
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => autorizar("presencial")}>
        · pessoalmente
      </Button>
    </div>
  );
}
