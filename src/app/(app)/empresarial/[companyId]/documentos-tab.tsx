"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Plus, Star, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCpf } from "@/lib/masks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BILLING_MODELS,
  BILLING_MODEL_LABELS,
  COMPANY_DOCS_BUCKET,
  COMPANY_FILE_TYPES,
  COMPANY_FILE_TYPE_LABELS,
  DOC_TYPES,
  DOC_TYPE_LABELS,
  maskDocument,
  type BillingModel,
  type DocType,
} from "@/lib/empresarial/documents";
import {
  addCompanyDocument,
  deleteCompanyFile,
  getFileUrl,
  registerCompanyFile,
  removeCompanyDocument,
  setBillingModel,
  setPrimaryDocument,
  updateCompanyDocument,
} from "./document-actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type CompanyDocumentView = {
  id: string;
  docType: DocType;
  docNumber: string;
  docFormatted: string;
  holderCpf: string | null;
  isPrimary: boolean;
  nickname: string | null;
  employeeCount: number;
};

export type CompanyFileView = {
  id: string;
  fileType: string;
  fileName: string;
  storagePath: string;
  createdAt: string;
  uploaderName: string | null;
};

export function DocumentosTab({
  companyId,
  documents,
  files,
  billingModel,
  canManage,
}: {
  companyId: string;
  documents: CompanyDocumentView[];
  files: CompanyFileView[];
  billingModel: BillingModel;
  canManage: boolean;
}) {
  const cnpjCount = documents.filter((d) => d.docType === "CNPJ").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            Documentos da empresa ({documents.length})
          </CardTitle>
          {canManage && <DocumentDialog companyId={companyId} />}
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum documento cadastrado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Documento</th>
                    <th className="px-2 py-1.5 font-medium">Identificação</th>
                    <th className="px-2 py-1.5 font-medium">Colaboradores</th>
                    {canManage && <th className="px-2 py-1.5" />}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="px-2 py-1.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono">{d.docFormatted}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {d.docType}
                          </Badge>
                          {d.isPrimary && (
                            <Badge className="bg-gold/20 text-[10px] text-gold-foreground">
                              ★ Principal
                            </Badge>
                          )}
                        </span>
                        {d.holderCpf && (
                          <span className="block text-[10px] text-muted-foreground">
                            Titular: {d.holderCpf}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {d.nickname ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {d.employeeCount}
                      </td>
                      {canManage && (
                        <td className="px-2 py-1.5 text-right">
                          <span className="flex justify-end gap-1">
                            {!d.isPrimary && (
                              <PrimaryButton companyId={companyId} documentId={d.id} />
                            )}
                            <DocumentDialog
                              companyId={companyId}
                              document={d}
                            />
                            {!d.isPrimary && (
                              <RemoveButton companyId={companyId} documentId={d.id} />
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            O documento <strong>principal</strong> é o que identifica a empresa nas
            listas, contratos e cobranças.
          </p>
        </CardContent>
      </Card>

      {/* Faturamento: só faz sentido com mais de um CNPJ. */}
      {cnpjCount > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modelo de faturamento</CardTitle>
          </CardHeader>
          <CardContent>
            <BillingModelPicker
              companyId={companyId}
              current={billingModel}
              canManage={canManage}
              cnpjCount={cnpjCount}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Arquivos da empresa ({files.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canManage && <CompanyFileUpload companyId={companyId} />}
          {files.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum arquivo enviado.
            </p>
          ) : (
            <ul className="divide-y">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {COMPANY_FILE_TYPE_LABELS[
                        f.fileType as keyof typeof COMPANY_FILE_TYPE_LABELS
                      ] ?? f.fileType}{" "}
                      · {new Date(f.createdAt).toLocaleDateString("pt-BR")}
                      {f.uploaderName ? ` · ${f.uploaderName}` : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-1">
                    <OpenFileButton kind="company" path={f.storagePath} />
                    {canManage && (
                      <DeleteFileButton companyId={companyId} fileId={f.id} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PrimaryButton({
  companyId,
  documentId,
}: {
  companyId: string;
  documentId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      title="Tornar principal"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await setPrimaryDocument(companyId, documentId);
          if (r.ok) {
            toast.success("Documento principal atualizado.");
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      <Star className="mr-1 size-3.5" />
      Principal
    </Button>
  );
}

function RemoveButton({
  companyId,
  documentId,
}: {
  companyId: string;
  documentId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-destructive"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await removeCompanyDocument(companyId, documentId);
          if (r.ok) {
            toast.success("Documento removido.");
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function DocumentDialog({
  companyId,
  document,
}: {
  companyId: string;
  document?: CompanyDocumentView;
}) {
  const router = useRouter();
  const isEdit = Boolean(document);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [docType, setDocType] = useState<DocType>(document?.docType ?? "CNPJ");
  const [number, setNumber] = useState(document?.docFormatted ?? "");

  function changeType(next: string) {
    const t = next as DocType;
    setDocType(t);
    setNumber((cur) => maskDocument(t, cur));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = isEdit
        ? await updateCompanyDocument(companyId, document!.id, formData)
        : await addCompanyDocument(companyId, formData);
      if (r.ok) {
        toast.success(isEdit ? "Documento atualizado." : "Documento adicionado.");
        setOpen(false);
        if (!isEdit) setNumber("");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Adicionar documento
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar documento" : "Novo documento da empresa"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="doc_type">Tipo *</Label>
              <select
                id="doc_type"
                name="doc_type"
                value={docType}
                onChange={(e) => changeType(e.target.value)}
                className={selectClass}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="doc_number">Número *</Label>
              <Input
                id="doc_number"
                name="doc_number"
                required
                value={number}
                onChange={(e) => setNumber(maskDocument(docType, e.target.value))}
              />
            </div>
          </div>

          {docType === "CAEPF" && (
            <div>
              <Label htmlFor="holder_cpf">CPF do titular *</Label>
              <Input
                id="holder_cpf"
                name="holder_cpf"
                required
                placeholder="000.000.000-00"
                defaultValue={document?.holderCpf ?? ""}
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
              />
            </div>
          )}

          <div>
            <Label htmlFor="nickname">Apelido (ajuda a identificar)</Label>
            <Input
              id="nickname"
              name="nickname"
              placeholder="Ex.: Filial Londrina"
              defaultValue={document?.nickname ?? ""}
            />
          </div>

          {!isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_primary" />
              Marcar como documento principal
            </label>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BillingModelPicker({
  companyId,
  current,
  canManage,
  cnpjCount,
}: {
  companyId: string;
  current: BillingModel;
  canManage: boolean;
  cnpjCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Esta empresa tem <strong>{cnpjCount} CNPJs</strong>. Como a cobrança deve
        sair?
      </p>
      <div className="space-y-1.5">
        {BILLING_MODELS.map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="billing_model"
              checked={current === m}
              disabled={!canManage || isPending}
              onChange={() =>
                startTransition(async () => {
                  const r = await setBillingModel(companyId, m);
                  if (r.ok) {
                    toast.success("Modelo de faturamento salvo.");
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            />
            {BILLING_MODEL_LABELS[m]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A geração do boleto por CNPJ entra na etapa do financeiro — aqui você
        registra a decisão.
      </p>
    </div>
  );
}

function CompanyFileUpload({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fileType, setFileType] = useState<string>("contrato_social");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    const supabase = createClient();
    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 120);
    const path = `${companyId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from(COMPANY_DOCS_BUCKET)
      .upload(path, file, { contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Não foi possível enviar o arquivo.");
      return;
    }
    startTransition(async () => {
      const r = await registerCompanyFile(companyId, fileType, file.name, path);
      setUploading(false);
      if (r.ok) {
        toast.success("Arquivo enviado.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="min-w-40">
        <Label htmlFor="company_file_type">Tipo do arquivo</Label>
        <select
          id="company_file_type"
          value={fileType}
          onChange={(e) => setFileType(e.target.value)}
          className={selectClass}
        >
          {COMPANY_FILE_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMPANY_FILE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={uploading || isPending}
        onClick={() => fileRef.current?.click()}
      >
        <FileUp className="mr-1 size-4" />
        {uploading ? "Enviando…" : "Enviar arquivo"}
      </Button>
    </div>
  );
}

export function OpenFileButton({
  kind,
  path,
}: {
  kind: "company" | "employee";
  path: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await getFileUrl(kind, path);
          if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
          else toast.error(r.error ?? "Erro.");
        })
      }
    >
      Abrir
    </Button>
  );
}

function DeleteFileButton({
  companyId,
  fileId,
}: {
  companyId: string;
  fileId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-destructive"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await deleteCompanyFile(companyId, fileId);
          if (r.ok) {
            toast.success("Arquivo excluído.");
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
