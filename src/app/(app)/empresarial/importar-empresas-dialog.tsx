"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  abaDasEmpresas,
  abaDosOutrosDocumentos,
  celulaDaPlanilha as celula,
  type ErroDaPlanilha,
} from "@/lib/empresarial/planilha-empresas";
import { importarEmpresas } from "./actions";

/**
 * IMPORTAR EMPRESAS (1047; migração das empresas que já estão no programa).
 *
 * O navegador só LÊ o arquivo (cada aba em `header: 1`, datas como
 * "aaaa-mm-dd"); quem confere é o servidor, com o que o banco diz. Tudo ou
 * nada: a lista de erros fica na janela até a próxima planilha.
 */
export function ImportarEmpresasDialog({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [arquivo, setArquivo] = useState("");
  const [celulas, setCelulas] = useState<{ empresas: unknown[][]; documentos: unknown[][] } | null>(null);
  const [erros, setErros] = useState<ErroDaPlanilha[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setArquivo(file.name);
    setErros([]);
    setCelulas(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ler = (nome: string | null): unknown[][] =>
        nome
          ? XLSX.utils
              .sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: "", blankrows: true, raw: true })
              .map((linha) => linha.map(celula))
          : [];
      const nomeEmp = abaDasEmpresas(wb.SheetNames);
      if (!nomeEmp) {
        toast.error("A planilha não tem a aba “Empresas”. Baixe o Modelo e preencha nele.");
        return;
      }
      setCelulas({ empresas: ler(nomeEmp), documentos: ler(abaDosOutrosDocumentos(wb.SheetNames)) });
    } catch {
      toast.error("Não foi possível ler a planilha.");
    }
  }

  function importar() {
    if (!celulas) return;
    startTransition(async () => {
      const r = await importarEmpresas(celulas.empresas, celulas.documentos);
      if (r.ok) {
        toast.success(
          `${r.importadas ?? 0} empresa(s) importada(s). Agora importe os titulares de cada uma, na ficha da empresa.`,
          { duration: 10000 }
        );
        setCelulas(null);
        setArquivo("");
        setOpen(false);
        router.refresh();
      } else {
        setErros(r.erros ?? []);
        toast.error(r.error ?? "Erro.", { duration: 12000 });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className={className}>
            <FileUp className="mr-1 size-4" />
            Importar empresas
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar empresas (Excel)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Para levar ao sistema as empresas que <strong>já fazem parte</strong> do programa.
              Baixe o <strong>Modelo</strong>: ele traz as instruções, a aba{" "}
              <strong>Empresas</strong> (uma linha por empresa) e a aba{" "}
              <strong>Outros CNPJs</strong>. Entra inteira ou não entra. Os titulares vêm
              depois, pela planilha de cada empresa.
            </p>
            {/* Link comum (não <Link>): é um arquivo gerado no servidor. */}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href="/empresarial/modelo-empresas" download />}
            >
              <Download className="mr-1 size-4" />
              Modelo
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-1 size-4" />
            Escolher planilha
          </Button>
          {arquivo && <p className="text-sm text-muted-foreground">{arquivo}</p>}
          {erros.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">
                A planilha não foi importada: {erros.length} problema(s). Nada foi gravado.
              </p>
              <p className="text-xs text-muted-foreground">
                Corrija na planilha e escolha o arquivo de novo. A linha é a do Excel.
              </p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                {erros.map((e, i) => (
                  <li key={`${e.aba}-${e.linha}-${i}`}>
                    <span className="font-mono">
                      {e.aba}, linha {e.linha}
                    </span>
                    : {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {celulas && (
            <Button size="sm" disabled={isPending} onClick={importar}>
              {isPending ? "Conferindo e importando..." : "Conferir e importar"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

