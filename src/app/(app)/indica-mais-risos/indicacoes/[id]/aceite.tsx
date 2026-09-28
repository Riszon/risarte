"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { registrarAceite } from "../../actions";

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
