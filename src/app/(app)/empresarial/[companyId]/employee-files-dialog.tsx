"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Paperclip, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  EMPLOYEE_DOCS_BUCKET,
  EMPLOYEE_FILE_TYPES,
  EMPLOYEE_FILE_TYPE_LABELS,
} from "@/lib/empresarial/documents";
import {
  deleteEmployeeFile,
  registerEmployeeFile,
} from "./document-actions";
import { OpenFileButton } from "./documentos-tab";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type EmployeeFileView = {
  id: string;
  employeeId: string;
  dependentId: string | null;
  fileType: string;
  fileName: string;
  storagePath: string;
  createdAt: string;
};

/**
 * Arquivos do colaborador (RG, comprovante de vínculo...) e dos dependentes.
 * O upload vai direto ao Storage (bucket privado, pasta = id da empresa) e a
 * action registra a linha; a leitura é sempre por URL assinada.
 */
export function EmployeeFilesDialog({
  companyId,
  employeeId,
  employeeName,
  dependents,
  files,
  canManage,
}: {
  companyId: string;
  employeeId: string;
  employeeName: string;
  dependents: { id: string; name: string }[];
  files: EmployeeFileView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [fileType, setFileType] = useState<string>("rg");
  const [owner, setOwner] = useState<string>("holder");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = files.filter((f) => f.employeeId === employeeId);

  async function handleFile(file: File) {
    setUploading(true);
    const supabase = createClient();
    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 120);
    const path = `${companyId}/${employeeId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from(EMPLOYEE_DOCS_BUCKET)
      .upload(path, file, { contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Não foi possível enviar o arquivo.");
      return;
    }
    startTransition(async () => {
      const r = await registerEmployeeFile(
        companyId,
        employeeId,
        owner === "holder" ? null : owner,
        fileType,
        file.name,
        path
      );
      setUploading(false);
      if (r.ok) {
        toast.success("Arquivo enviado.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function ownerLabel(f: EmployeeFileView): string {
    if (!f.dependentId) return "Titular";
    return dependents.find((d) => d.id === f.dependentId)?.name ?? "Dependente";
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Paperclip className="mr-1 size-3.5" />
            Arquivos ({mine.length})
          </Button>
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Arquivos de {employeeName}</DialogTitle>
        </DialogHeader>

        {canManage && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="emp_file_owner">De quem é o documento</Label>
                <select
                  id="emp_file_owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className={selectClass}
                >
                  <option value="holder">Titular ({employeeName})</option>
                  {dependents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="emp_file_type">Tipo</Label>
                <select
                  id="emp_file_type"
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  className={selectClass}
                >
                  {EMPLOYEE_FILE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYEE_FILE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
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
        )}

        {mine.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum arquivo enviado.
          </p>
        ) : (
          <ul className="divide-y">
            {mine.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {EMPLOYEE_FILE_TYPE_LABELS[
                      f.fileType as keyof typeof EMPLOYEE_FILE_TYPE_LABELS
                    ] ?? f.fileType}{" "}
                    · {ownerLabel(f)} ·{" "}
                    {new Date(f.createdAt).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}
                  </p>
                </div>
                <span className="flex items-center gap-1">
                  <OpenFileButton kind="employee" path={f.storagePath} />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await deleteEmployeeFile(companyId, f.id);
                          if (r.ok) {
                            toast.success("Arquivo excluído.");
                            router.refresh();
                          } else toast.error(r.error ?? "Erro.");
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Seletor de CNPJ do colaborador — só aparece se a empresa tiver mais de um. */
export function EmployeeDocumentPicker({
  companyId,
  employeeId,
  current,
  documents,
  onChanged,
}: {
  companyId: string;
  employeeId: string;
  current: string | null;
  documents: { id: string; label: string }[];
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (documents.length < 2) return null;

  return (
    <select
      className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
      value={current ?? ""}
      disabled={isPending}
      title="CNPJ da empresa a que este colaborador pertence"
      onChange={(e) => {
        const value = e.target.value || null;
        startTransition(async () => {
          const { setEmployeeDocument } = await import("./document-actions");
          const r = await setEmployeeDocument(companyId, employeeId, value);
          if (r.ok) {
            toast.success("CNPJ do colaborador atualizado.");
            onChanged?.();
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        });
      }}
    >
      <option value="">— sem CNPJ definido —</option>
      {documents.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label}
        </option>
      ))}
    </select>
  );
}
