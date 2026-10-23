"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Pencil, Play, Send, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { mudarSituacaoDaMeta, publicarMeta } from "../actions";

type Acao = "pause" | "resume" | "cancel" | "discard";

const TEXTO: Record<Acao, { titulo: string; descricao: string; botao: string; motivo: boolean }> = {
  pause: {
    titulo: "Pausar a meta",
    descricao:
      "Enquanto pausada, os dias não contam para o ritmo. O prazo final NÃO se estende sozinho — se precisar, edite o fim depois.",
    botao: "Pausar",
    motivo: true,
  },
  resume: { titulo: "Retomar a meta", descricao: "A meta volta a correr a partir de hoje.", botao: "Retomar", motivo: true },
  cancel: {
    titulo: "Cancelar a meta",
    descricao: "Cancelar é definitivo: a meta sai das ativas e não é apurada. O histórico continua guardado.",
    botao: "Cancelar a meta",
    motivo: true,
  },
  discard: {
    titulo: "Descartar o rascunho",
    descricao: "O rascunho é apagado. Como ele nunca foi publicado, ninguém da equipe chegou a vê-lo.",
    botao: "Descartar",
    motivo: false,
  },
};

export function AcoesDaMeta({
  id,
  status,
  podeEditar,
}: {
  id: string;
  /** A situação efetiva (a da tela). */
  status: string;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState<Acao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pendente, startTransition] = useTransition();
  if (!podeEditar) return null;
  const encerrada = status === "finished" || status === "cancelled" || status === "closing";

  function confirmar() {
    if (!aberta) return;
    const acao = aberta;
    if (TEXTO[acao].motivo && !motivo.trim()) {
      toast.error("Escreva o motivo.");
      return;
    }
    startTransition(async () => {
      const r = await mudarSituacaoDaMeta(id, acao, motivo);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setAberta(null);
      setMotivo("");
      toast.success(acao === "discard" ? "Rascunho descartado." : "Situação da meta atualizada.");
      if (acao === "discard") router.push("/metas?aba=rascunhos");
      router.refresh();
    });
  }

  function publicar() {
    startTransition(async () => {
      const r = await publicarMeta(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Meta publicada.");
      router.refresh();
    });
  }

  const classeBotao = "bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/25 hover:bg-primary-foreground/25";

  return (
    <div className="flex flex-wrap gap-2">
      {!encerrada && (
        <Button nativeButton={false} render={<Link href={`/metas/${id}/editar`} />} variant="ghost" className={classeBotao}>
          <Pencil className="mr-1 size-4" /> Editar
        </Button>
      )}
      {status === "draft" && (
        <>
          <Button type="button" disabled={pendente} onClick={publicar} className="bg-primary-foreground text-primary hover:bg-primary-foreground/90">
            <Send className="mr-1 size-4" /> Publicar
          </Button>
          <Button type="button" variant="ghost" className={classeBotao} onClick={() => setAberta("discard")}>
            <Trash2 className="mr-1 size-4" /> Descartar
          </Button>
        </>
      )}
      {(status === "active" || status === "scheduled") && (
        <Button type="button" variant="ghost" className={classeBotao} onClick={() => setAberta("pause")}>
          <Pause className="mr-1 size-4" /> Pausar
        </Button>
      )}
      {status === "paused" && (
        <Button type="button" variant="ghost" className={classeBotao} onClick={() => setAberta("resume")}>
          <Play className="mr-1 size-4" /> Retomar
        </Button>
      )}
      {!encerrada && status !== "draft" && (
        <Button type="button" variant="ghost" className={classeBotao} onClick={() => setAberta("cancel")}>
          <XCircle className="mr-1 size-4" /> Cancelar
        </Button>
      )}

      <Dialog open={aberta !== null} onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent>
          {aberta && (
            <>
              <DialogHeader>
                <DialogTitle>{TEXTO[aberta].titulo}</DialogTitle>
                <DialogDescription>{TEXTO[aberta].descricao}</DialogDescription>
              </DialogHeader>
              {TEXTO[aberta].motivo && (
                <div className="space-y-1.5">
                  <Label htmlFor="motivo-acao">Motivo (fica no histórico da meta)</Label>
                  <textarea
                    id="motivo-acao"
                    className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAberta(null)}>
                  Fechar
                </Button>
                <Button
                  type="button"
                  disabled={pendente}
                  variant={aberta === "cancel" || aberta === "discard" ? "destructive" : "default"}
                  onClick={confirmar}
                >
                  {TEXTO[aberta].botao}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
