"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { abrirRevisao } from "./revisao-actions";

/** "Revisar contrato": pede o motivo e abre a revisão (1050). */
export function AbrirRevisao({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Revisar contrato</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revisar contrato</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const motivo = String(new FormData(e.currentTarget).get("motivo") ?? "");
            startTransition(async () => {
              const r = await abrirRevisao(companyId, motivo);
              if (r.ok && r.id) {
                setOpen(false);
                router.push(`/empresarial/${companyId}/revisao/${r.id}`);
              } else toast.error(r.error ?? "Erro.");
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            A revisão começa com as regras de hoje. Você altera o que foi renegociado, anexa o aditivo
            assinado pela empresa e o gestor do programa aplica. Até lá, nada muda.
          </p>
          <div className="space-y-1">
            <Label htmlFor="motivo">Motivo</Label>
            <textarea
              id="motivo"
              name="motivo"
              required
              minLength={10}
              rows={3}
              placeholder="Ex.: empresa importada — acertar a implantação e o preço combinado no contrato de papel."
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Abrindo..." : "Abrir a revisão"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
