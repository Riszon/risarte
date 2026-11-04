"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MODULOS } from "@/lib/system-reports";
import { PRIORIDADES, PRIORIDADE_EXPLICA, PRIORIDADE_ROTULO, type CategoriaDoBacklog } from "@/lib/backlog";
import { criarItem } from "./actions";
import { Escolha } from "./pecas";

const SEM_MODULO = "__sem";

/** O dono registra um item à mão (origem "dono"). */
export function NovoItem({ categorias }: { categorias: CategoriaDoBacklog[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [categoria, setCategoria] = useState(categorias[0]?.name ?? "");
  const [prioridade, setPrioridade] = useState("media");
  const [modulo, setModulo] = useState(SEM_MODULO);
  const [pendente, comecar] = useTransition();

  function enviar(formData: FormData) {
    formData.set("module", modulo === SEM_MODULO ? "" : modulo);
    comecar(async () => {
      const r = await criarItem(formData);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Registrado: ${r.code}`);
      setAberto(false);
      router.push(`/admin/backlog/${r.code}`);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            <Plus className="mr-1.5 size-4" />
            Novo item
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo item no backlog</DialogTitle>
          <DialogDescription>O código (AP…) é dado pelo sistema ao gravar.</DialogDescription>
        </DialogHeader>
        <form action={enviar} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bk-novo-titulo">Título</Label>
            <Input id="bk-novo-titulo" name="title" required maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-novo-detalhe">Detalhe</Label>
            <textarea
              id="bk-novo-detalhe"
              name="detail"
              rows={5}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="O que acontece, onde, e o que você esperava."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Escolha
                rotulo="Categoria"
                name="category"
                itens={categorias.map((c) => ({ value: c.name, label: c.name }))}
                valor={categoria}
                aoMudar={setCategoria}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Escolha
                rotulo="Prioridade"
                name="priority"
                itens={PRIORIDADES.map((p) => ({ value: p, label: PRIORIDADE_ROTULO[p] }))}
                valor={prioridade}
                aoMudar={setPrioridade}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Módulo</Label>
              <Escolha
                rotulo="Módulo"
                itens={[{ value: SEM_MODULO, label: "Nenhum" }, ...MODULOS.map((m) => ({ value: m.value, label: m.label }))]}
                valor={modulo}
                aoMudar={setModulo}
                className="w-full"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {PRIORIDADE_ROTULO[prioridade as keyof typeof PRIORIDADE_ROTULO]}:{" "}
            {PRIORIDADE_EXPLICA[prioridade as keyof typeof PRIORIDADE_EXPLICA]}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Gravando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
