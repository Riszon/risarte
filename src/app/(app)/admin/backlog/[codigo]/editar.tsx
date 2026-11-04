"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODULOS } from "@/lib/system-reports";
import {
  PRIORIDADES,
  PRIORIDADE_EXPLICA,
  PRIORIDADE_ROTULO,
  SITUACOES,
  SITUACAO_ROTULO,
  type CategoriaDoBacklog,
  type Prioridade,
  type SituacaoDoItem,
} from "@/lib/backlog";
import type { DetalheDoItem } from "../dados";
import { atualizarItem } from "../actions";
import { Escolha } from "../pecas";

const SEM_MODULO = "__sem";

/**
 * O que o dono muda no item: prioridade, categoria, módulo, situação e uma
 * nota. Título e detalhe ficam atrás de "Editar texto" — mudam pouco, e o
 * detalhe costuma ser o registro de quem achou.
 */
export function EditarItem({ item, categorias }: { item: DetalheDoItem; categorias: CategoriaDoBacklog[] }) {
  const router = useRouter();
  const [pendente, comecar] = useTransition();
  const [prioridade, setPrioridade] = useState<Prioridade>(item.priority);
  const [categoria, setCategoria] = useState(item.category);
  const [modulo, setModulo] = useState(item.module ?? SEM_MODULO);
  const [situacao, setSituacao] = useState<SituacaoDoItem>(item.status);
  const [editandoTexto, setEditandoTexto] = useState(false);

  const fechando = (situacao === "resolvido" || situacao === "descartado") && situacao !== item.status;
  // Categoria desativada continua na escolha só se for a do item.
  const opcoesCategoria = categorias
    .filter((c) => c.active || c.name === item.category)
    .map((c) => ({ value: c.name, label: c.active ? c.name : `${c.name} (desativada)` }));

  function enviar(formData: FormData) {
    formData.set("code", item.code);
    formData.set("priority", prioridade);
    formData.set("category", categoria);
    formData.set("module", modulo === SEM_MODULO ? "" : modulo);
    // Só manda a situação quando ela MUDOU: reenviar "descartado" pediria o
    // motivo de novo a cada mudança de prioridade.
    if (situacao !== item.status) formData.set("status", situacao);
    comecar(async () => {
      const r = await atualizarItem(formData);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Gravado.");
      setEditandoTexto(false);
      router.refresh();
    });
  }

  return (
    <form action={enviar} className="space-y-3 rounded-lg border p-3" key={item.updatedAt}>
      <h2 className="text-sm font-semibold">Classificar</h2>

      <div className="space-y-1">
        <Label>Prioridade</Label>
        <Escolha
          rotulo="Prioridade"
          itens={PRIORIDADES.map((p) => ({ value: p, label: PRIORIDADE_ROTULO[p] }))}
          valor={prioridade}
          aoMudar={(v) => setPrioridade(v as Prioridade)}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">{PRIORIDADE_EXPLICA[prioridade]}</p>
      </div>

      <div className="space-y-1">
        <Label>Categoria</Label>
        <Escolha rotulo="Categoria" itens={opcoesCategoria} valor={categoria} aoMudar={setCategoria} className="w-full" />
      </div>

      <div className="space-y-1">
        <Label>Módulo</Label>
        <Escolha
          rotulo="Módulo"
          itens={[{ value: SEM_MODULO, label: "Nenhum" }, ...MODULOS.map((m) => ({ value: m.value, label: m.label }))]}
          valor={modulo}
          aoMudar={setModulo}
          className="w-full"
        />
      </div>

      <div className="space-y-1">
        <Label>Situação</Label>
        <Escolha
          rotulo="Situação"
          itens={SITUACOES.map((s) => ({ value: s, label: SITUACAO_ROTULO[s] }))}
          valor={situacao}
          aoMudar={(v) => setSituacao(v as SituacaoDoItem)}
          className="w-full"
        />
      </div>

      {fechando && (
        <div className="space-y-2 rounded-md bg-muted/50 p-2">
          {situacao === "resolvido" && (
            <div className="space-y-1">
              <Label htmlFor="bk-versao">Versão (se houver)</Label>
              <Input id="bk-versao" name="resolvedVersion" placeholder="0.400.0" className="h-8" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="bk-como">{situacao === "resolvido" ? "Como foi resolvido" : "Por que foi descartado"}</Label>
            <textarea
              id="bk-como"
              name="resolution"
              rows={2}
              required={situacao === "descartado"}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="bk-nota">Nota (vai para a linha do tempo)</Label>
        <textarea id="bk-nota" name="note" rows={2} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
      </div>

      {editandoTexto ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="bk-titulo">Título</Label>
            <Input id="bk-titulo" name="title" defaultValue={item.title} maxLength={300} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bk-detalhe">Detalhe</Label>
            <textarea
              id="bk-detalhe"
              name="detail"
              rows={10}
              defaultValue={item.detail}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
            />
          </div>
        </div>
      ) : (
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setEditandoTexto(true)}>
          Editar título e detalhe
        </Button>
      )}

      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Gravando…" : "Gravar"}
      </Button>
    </form>
  );
}
