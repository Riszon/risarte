"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESCOPO_LABEL,
  PERGUNTA_DO_FIM,
  RESPOSTA_EFEITO,
  RESPOSTA_LABEL,
  type RespostaDoFechamento,
} from "@/lib/fim-do-tratamento";
import { responderFechamento, type PerguntaPendente } from "./fim-do-tratamento-actions";

/**
 * A PERGUNTA DO FIM (0416, Passo 2 do plano): abre no Atendimento logo depois
 * de concluir a última sessão de um plano, para quem executou. Não fecha sem
 * resposta — é a decisão que o desenho original chamava de "bloqueante". A
 * mesma pergunta continua na ficha do cliente e no sino até ser respondida.
 */
export function PerguntaDoFimDialog({
  pergunta,
  onRespondida,
}: {
  pergunta: PerguntaPendente | null;
  onRespondida: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function responder(r: RespostaDoFechamento) {
    if (!pergunta) return;
    startTransition(async () => {
      const res = await responderFechamento(pergunta.clientId, pergunta.id, r);
      if (res.ok) {
        toast.success("Resposta registrada.");
        onRespondida();
        router.refresh();
      } else {
        toast.error(res.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    // Controlado e sem "X": clicar fora ou apertar Esc não fecha.
    <Dialog open={pergunta !== null} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleHelp className="size-5 shrink-0 text-destructive" aria-hidden />
            Decisão obrigatória
          </DialogTitle>
          <DialogDescription>
            {pergunta?.clientName} terminou{" "}
            {pergunta ? ESCOPO_LABEL[pergunta.scope] : "o plano"}.
            {pergunta?.treatmentEnd
              ? " Não sobra outro tratamento."
              : " Ainda há outro tratamento em andamento."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">{PERGUNTA_DO_FIM}</p>
        <div className="grid gap-2">
          {(["sim", "nao", "nao_sei"] as const).map((r) => (
            <Button
              key={r}
              variant={r === "sim" ? "default" : "outline"}
              disabled={isPending}
              onClick={() => responder(r)}
              className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
            >
              <span>{RESPOSTA_LABEL[r]}</span>
              <span className="text-xs font-normal opacity-80">{RESPOSTA_EFEITO[r]}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
