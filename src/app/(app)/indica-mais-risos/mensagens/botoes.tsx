"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marcarMensagem } from "./actions";

/**
 * Abrir o WhatsApp com o texto pronto e, depois de enviar, marcar. Abrir não
 * marca sozinho: só quem viu a mensagem sair sabe que ela saiu.
 */
export function BotoesMensagem({ id, link, status }: { id: number; link: string | null; status: string }) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const marcar = (s: "enviada" | "descartada" | "a_enviar") =>
    gravar(async () => {
      const r = await marcarMensagem(id, s);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });

  if (status !== "a_enviar") {
    return (
      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={gravando} onClick={() => marcar("a_enviar")}>
        Voltar para a fila
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {link ? (
        <Button
          size="sm"
          className="h-7 text-xs"
          nativeButton={false}
          render={<a href={link} target="_blank" rel="noopener noreferrer" />}
        >
          <Send className="mr-1 size-3" /> Abrir WhatsApp
        </Button>
      ) : (
        <span className="text-xs text-destructive">telefone inválido</span>
      )}
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gravando} onClick={() => marcar("enviada")}>
        Enviada
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={gravando} onClick={() => marcar("descartada")}>
        Descartar
      </Button>
    </div>
  );
}
