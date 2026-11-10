"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { linkDoPapelAssinado, markPaperContract } from "./closing-actions";

/** Os mesmos limites da pasta `contratos-papel` (0392): o Storage também recusa. */
const TIPOS = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const LIMITE = 10 * 1024 * 1024;

/**
 * OC-00171 (0392, decisão do dono): marcar "Contrato assinado" À MÃO exige a
 * foto ou o PDF do contrato assinado no papel. A janela envia o arquivo à
 * pasta privada e só então marca — o banco recusa a marcação manual sem papel.
 */
export function AnexarPapelDoContrato({
  open,
  onOpenChange,
  clientId,
  negotiationId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  negotiationId: string;
}) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function enviar() {
    if (!arquivo) return;
    if (!TIPOS.includes(arquivo.type)) {
      toast.error("Envie uma foto (PNG, JPG ou WEBP) ou um PDF.");
      return;
    }
    if (arquivo.size > LIMITE) {
      toast.error("O arquivo passa de 10 MB.");
      return;
    }
    startTransition(async () => {
      const ext = arquivo.type === "application/pdf" ? "pdf" : arquivo.type.split("/")[1] === "jpeg" ? "jpg" : arquivo.type.split("/")[1];
      // O caminho não leva o nome do arquivo (pode ter o nome do paciente).
      const path = `${negotiationId}/${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("contratos-papel")
        .upload(path, arquivo, { contentType: arquivo.type });
      if (upErr) {
        toast.error("Não foi possível enviar o arquivo. Tente de novo.");
        return;
      }
      const r = await markPaperContract(clientId, negotiationId, path, arquivo.name);
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      toast.success(
        r.closed
          ? "VENDA CONCLUÍDA! Contrato assinado (papel anexado) e pagamento confirmado — a recepção foi acionada."
          : "Contrato marcado como assinado no papel, com o arquivo anexado."
      );
      setArquivo(null);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contrato assinado no papel</DialogTitle>
          <DialogDescription>
            Anexe a foto ou o PDF do contrato <strong>assinado</strong>. Sem o
            papel, o contrato não pode ser marcado à mão. Pela assinatura
            digital, ele marca sozinho.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-muted/50">
          <Upload className="size-5 text-muted-foreground" />
          {arquivo ? <span className="font-medium">{arquivo.name}</span> : <span>Escolher a foto ou o PDF (até 10 MB)</span>}
          <input
            type="file"
            accept={TIPOS.join(",")}
            className="sr-only"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={!arquivo || isPending}>
            {isPending ? "Enviando…" : "Anexar e marcar como assinado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Abre o papel assinado (link temporário de 5 minutos). */
export function VerPapelDoContrato({ negotiationId, nome }: { negotiationId: string; nome?: string | null }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
      onClick={() =>
        startTransition(async () => {
          const r = await linkDoPapelAssinado(negotiationId);
          if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
          else toast.error(r.error ?? "Não foi possível abrir o arquivo.");
        })
      }
    >
      <FileText className="size-3.5" />
      {nome ? `Ver o papel assinado (${nome})` : "Ver o papel assinado"}
    </button>
  );
}
