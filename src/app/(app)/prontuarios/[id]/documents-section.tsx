"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Plus, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  type ClinicalDocumentItem,
  type DocumentKind,
  type DocumentTemplate,
} from "@/lib/documents";
import { createDocument } from "./documents-actions";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DocumentsSection({
  clientId,
  clinicId,
  canEmit,
  documents,
  templates,
}: {
  clientId: string;
  clinicId: string;
  canEmit: boolean;
  documents: ClinicalDocumentItem[];
  templates: DocumentTemplate[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>("prescription");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const kindTemplates = useMemo(
    () => templates.filter((t) => t.kind === kind),
    [templates, kind]
  );

  function openNew() {
    setKind("prescription");
    setTemplateId("");
    setTitle("");
    setBody("");
    setOpen(true);
  }

  function onKindChange(k: DocumentKind) {
    setKind(k);
    setTemplateId("");
    setTitle("");
    setBody("");
  }

  function onTemplateChange(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setTitle(t.title);
      setBody(t.body);
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await createDocument({ clientId, clinicId, kind, title, body });
      if (res.ok && res.id) {
        toast.success("Documento emitido.");
        setOpen(false);
        // Abre a versão para impressão / salvar em PDF numa nova aba.
        window.open(`/documentos/${res.id}/imprimir`, "_blank");
        router.refresh();
      } else {
        toast.error(res.error ?? "Não foi possível emitir o documento.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Documentos</CardTitle>
          {canEmit && (
            <Button size="sm" onClick={openNew} disabled={isPending}>
              <Plus className="mr-1 size-3" /> Novo documento
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {documents.length > 0 ? (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="size-3.5 text-muted-foreground" />
                    {d.title}
                    <Badge variant="secondary" className="text-[10px]">
                      {DOCUMENT_KIND_LABELS[d.kind]}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(d.createdAt)}
                    {d.authorName ? ` · ${d.authorName}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href={`/documentos/${d.id}/imprimir`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <Printer className="mr-1 size-3" /> Imprimir
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Nenhum documento emitido ainda.
          </p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo documento</DialogTitle>
            <DialogDescription>
              Escolha o tipo, use um modelo (opcional) e ajuste o texto. Ao
              emitir, abre a versão para impressão / salvar em PDF.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-kind">Tipo</Label>
                <select
                  id="doc-kind"
                  value={kind}
                  onChange={(e) => onKindChange(e.target.value as DocumentKind)}
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
                <Label htmlFor="doc-template">Modelo</Label>
                <select
                  id="doc-template"
                  value={templateId}
                  onChange={(e) => onTemplateChange(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Em branco</option>
                  {kindTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.clinicId === null ? " (rede)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Título *</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Prescrição — Amoxicilina"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-body">Conteúdo *</Label>
              <textarea
                id="doc-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Texto do documento…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={submit}
              disabled={isPending || !title.trim() || !body.trim()}
            >
              Emitir e imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
