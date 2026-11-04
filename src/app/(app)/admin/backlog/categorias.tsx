"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { estaFechado, type CategoriaDoBacklog, type ItemDoBacklog } from "@/lib/backlog";
import { salvarCategoria } from "./actions";

/**
 * As categorias do backlog (B-D3: crescem e mudam com o uso). Criar,
 * renomear, ordenar e desativar. Não existe apagar: categoria com itens só se
 * desativa (e desativada some da escolha de item novo, não da lista).
 */
export function JanelaDasCategorias({
  categorias,
  itens,
}: {
  categorias: CategoriaDoBacklog[];
  itens: ItemDoBacklog[];
}) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();
  const [nova, setNova] = useState("");

  function gravar(dados: { id?: string; name: string; sortOrder?: number; active?: boolean }, depois?: () => void) {
    const fd = new FormData();
    if (dados.id) fd.set("id", dados.id);
    fd.set("name", dados.name);
    if (dados.sortOrder != null) fd.set("sortOrder", String(dados.sortOrder));
    if (dados.active != null) fd.set("active", String(dados.active));
    comecar(async () => {
      const r = await salvarCategoria(fd);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Categoria gravada.");
      depois?.();
      router.refresh();
    });
  }

  const usoDe = (id: string) => {
    const doGrupo = itens.filter((i) => i.categoryId === id);
    return { total: doGrupo.length, abertos: doGrupo.filter((i) => !estaFechado(i.status)).length };
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Tags className="mr-1.5 size-4" />
            Categorias
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Categorias do backlog</DialogTitle>
          <DialogDescription>
            O número define a ordem. Categoria com itens não se apaga: desative, e ela deixa de aparecer para
            item novo.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {categorias.map((c) => (
            <LinhaDaCategoria
              key={`${c.id}-${c.name}-${c.sortOrder}-${c.active}`}
              categoria={c}
              uso={usoDe(c.id)}
              pendente={pendente}
              aoGravar={gravar}
            />
          ))}
        </ul>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nova.trim()) return;
            gravar({ name: nova.trim() }, () => setNova(""));
          }}
        >
          <Input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Nome da nova categoria"
            maxLength={60}
            aria-label="Nome da nova categoria"
          />
          <Button type="submit" disabled={pendente || !nova.trim()}>
            Criar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinhaDaCategoria({
  categoria,
  uso,
  pendente,
  aoGravar,
}: {
  categoria: CategoriaDoBacklog;
  uso: { total: number; abertos: number };
  pendente: boolean;
  aoGravar: (d: { id?: string; name: string; sortOrder?: number; active?: boolean }) => void;
}) {
  const [nome, setNome] = useState(categoria.name);
  const [ordem, setOrdem] = useState(String(categoria.sortOrder));
  const mudou = nome.trim() !== categoria.name || ordem !== String(categoria.sortOrder);

  return (
    <li className="flex flex-wrap items-center gap-2 p-2">
      <Input
        value={ordem}
        onChange={(e) => setOrdem(e.target.value.replace(/\D/g, ""))}
        className="h-8 w-16 tabular-nums"
        aria-label={`Ordem de ${categoria.name}`}
      />
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="h-8 min-w-40 flex-1"
        maxLength={60}
        aria-label={`Nome de ${categoria.name}`}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {uso.abertos} abertos · {uso.total} no total
      </span>
      {mudou && (
        <Button
          size="sm"
          disabled={pendente || !nome.trim()}
          onClick={() => aoGravar({ id: categoria.id, name: nome.trim(), sortOrder: Number(ordem) || undefined })}
        >
          Salvar
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pendente}
        onClick={() => aoGravar({ id: categoria.id, name: categoria.name, active: !categoria.active })}
      >
        {categoria.active ? "Desativar" : "Reativar"}
      </Button>
    </li>
  );
}
