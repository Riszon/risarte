"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACAO_CAMPANHA_LABEL,
  CAMPANHA_STATUS_LABEL,
  acoesDaCampanha,
  type AcaoCampanha,
  type CampanhaStatus,
} from "@/lib/indica/campanhas";
import { mudarCampanha } from "../actions";

function Encerrar({ id }: { id: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [gravando, gravar] = useTransition();
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button size="sm" variant="outline">Encerrar</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encerrar a campanha</DialogTitle>
          <DialogDescription>
            Indicações novas deixam de entrar nela. As que já entraram continuam com a regra da
            campanha até o fim.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="motivo">Motivo *</Label>
            <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={gravando}
              onClick={() =>
                gravar(async () => {
                  const r = await mudarCampanha(id, "encerrar", motivo);
                  if (r.ok) {
                    toast.success("Campanha encerrada.");
                    setAberto(false);
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              {gravando ? "Encerrando…" : "Encerrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Os botões que a situação permite (o banco confere de novo). */
export function AcoesCampanha({ id, status }: { id: string; status: CampanhaStatus }) {
  const router = useRouter();
  const [gravando, gravar] = useTransition();
  const fazer = (acao: AcaoCampanha) =>
    gravar(async () => {
      const r = await mudarCampanha(id, acao);
      if (r.ok) {
        toast.success(`Campanha: ${CAMPANHA_STATUS_LABEL[r.status as CampanhaStatus] ?? r.status}.`);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-2">
      {acoesDaCampanha(status).map((a) =>
        a === "encerrar" ? (
          <Encerrar key={a} id={id} />
        ) : (
          <Button key={a} size="sm" variant={a === "publicar" ? "default" : "outline"} disabled={gravando} onClick={() => fazer(a)}>
            {ACAO_CAMPANHA_LABEL[a]}
          </Button>
        )
      )}
    </div>
  );
}
