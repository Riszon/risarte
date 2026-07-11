"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  type DocumentKind,
} from "@/lib/documents";
import { saveTemplate, setTemplateActive } from "./actions";

type Row = {
  id: string;
  kind: DocumentKind;
  title: string;
  body: string;
  isActive: boolean;
};

export function TemplatesManager({ templates }: { templates: Row[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("guidance");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function reset() {
    setEditingId(null);
    setKind("guidance");
    setTitle("");
    setBody("");
  }
  function edit(r: Row) {
    setEditingId(r.id);
    setKind(r.kind);
    setTitle(r.title);
    setBody(r.body);
  }
  function save() {
    startTransition(async () => {
      const res = await saveTemplate({
        id: editingId ?? undefined,
        kind,
        title,
        body,
      });
      if (res.ok) {
        toast.success(editingId ? "Modelo atualizado." : "Modelo criado.");
        reset();
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível salvar.");
      }
    });
  }
  function toggle(r: Row) {
    startTransition(async () => {
      const res = await setTemplateActive(r.id, !r.isActive);
      if (res.ok) router.refresh();
      else toast.error(res.error ?? "Erro.");
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? "Editar modelo" : "Novo modelo (rede)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-kind">Tipo</Label>
            <select
              id="tpl-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as DocumentKind)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-title">Título *</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Pós-operatório de extração"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">Conteúdo</Label>
            <textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Texto do modelo…"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={isPending || !title.trim()}>
              {editingId ? "Salvar alterações" : "Criar modelo"}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={reset} disabled={isPending}>
                Cancelar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelos da rede</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {DOCUMENT_KINDS.map((k) => {
            const rows = templates.filter((t) => t.kind === k);
            if (rows.length === 0) return null;
            return (
              <div key={k}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DOCUMENT_KIND_LABELS[k]}
                </p>
                <ul className="space-y-1.5">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {r.title}
                        {!r.isActive && (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            Inativo
                          </Badge>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => edit(r)}
                          disabled={isPending}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggle(r)}
                          disabled={isPending}
                        >
                          {r.isActive ? "Desativar" : "Ativar"}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum modelo da rede ainda.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
