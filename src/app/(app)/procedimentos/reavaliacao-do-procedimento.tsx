"use client";

// D17 (0416): "Reavaliação presencial obrigatória" no cartão do procedimento.
// Com ele no plano, o fim do plano já marca "Sim" e a Recepção agenda a
// consulta com o Coordenador — a pergunta ao dentista não aparece. Só o Admin
// Master muda.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { salvarReavaliacaoObrigatoria } from "./reavaliacao-actions";

export function ReavaliacaoDoProcedimento({
  procedureId,
  obrigatoria,
  podeEditar,
}: {
  procedureId: string;
  obrigatoria: boolean;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function alternar(valor: boolean) {
    start(async () => {
      const r = await salvarReavaliacaoObrigatoria(procedureId, valor);
      if (r.ok) {
        toast.success(valor ? "Reavaliação obrigatória ligada." : "Reavaliação obrigatória desligada.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs">
      <label className="flex items-start gap-2">
        <ClipboardCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="checkbox"
          className="mt-0.5"
          checked={obrigatoria}
          disabled={!podeEditar || pending}
          onChange={(e) => alternar(e.target.checked)}
        />
        <span>
          <span className="font-medium">Reavaliação presencial obrigatória no fim do plano</span>
          <span className="block text-muted-foreground">
            Com este procedimento no plano, o fim do plano já pede a consulta de
            reavaliação com o Coordenador, sem perguntar a quem executou.
          </span>
        </span>
      </label>
    </div>
  );
}
