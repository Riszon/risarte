"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { iniciarContatoPelaLista } from "@/app/(app)/prontuarios/[id]/abandono-actions";

/** 0423: a ação por cliente da lista — abrir a ficha ou começar o contato. */
export function IniciarContatoBotao({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function iniciar() {
    startTransition(async () => {
      const res = await iniciarContatoPelaLista(clientId);
      if (res.ok) {
        toast.success("Tarefa de contato aberta para o Coordenador, na ficha do cliente.");
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <div className="flex shrink-0 gap-1.5">
      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/prontuarios/${clientId}`} />}>
        Abrir ficha
      </Button>
      <Button size="sm" disabled={isPending} onClick={iniciar}>
        Iniciar contato
      </Button>
    </div>
  );
}
