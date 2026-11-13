"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBrDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/client";
import { ANEXO_MAX_BYTES, ANEXO_TIPOS, ATTACHMENT_KIND_LABELS, type AttachmentKind } from "@/lib/finance/dividas";
import { linkDoAnexo, registrarAnexo, removerRegistro } from "../actions";
import type { Anexo } from "../dados";
import { RemoverComMotivo, Removido, SELECT, useAcao } from "./comum";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const tamanho = (b: number | null) =>
  b === null ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/**
 * Aba Anexos (3.7, 0405): contrato, boleto, notificação, proposta,
 * comprovante, quitação, anuência… O arquivo vai direto para a pasta privada
 * `dividas` (a regra do banco só deixa quem lança) e o caminho NÃO leva o nome
 * do arquivo — o nome fica só no registro. Remover é lógico, com motivo.
 */
export function Anexos({
  debtId,
  anexos,
  nomes,
  podeLancar,
}: {
  debtId: string;
  anexos: Anexo[];
  nomes: Map<string, string>;
  podeLancar: boolean;
}) {
  const router = useRouter();
  const { ocupado, rodar } = useAcao();
  const [enviando, startEnvio] = useTransition();
  const [tipo, setTipo] = useState<AttachmentKind>("boleto");
  const [verRemovidos, setVerRemovidos] = useState(false);
  const [remover, setRemover] = useState<Anexo | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const enviar = (arquivo: File) => {
    if (!ANEXO_TIPOS.includes(arquivo.type)) return toast.error("Envie PDF ou imagem (PNG, JPG, WEBP).");
    if (arquivo.size > ANEXO_MAX_BYTES) return toast.error("O arquivo passa de 10 MB.");
    startEnvio(async () => {
      const path = `${debtId}/${crypto.randomUUID()}.${EXT[arquivo.type]}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("dividas").upload(path, arquivo, { contentType: arquivo.type });
      if (error) {
        toast.error("Não foi possível enviar o arquivo. Tente de novo.");
        return;
      }
      const r = await registrarAnexo(debtId, { path, kind: tipo, file_name: arquivo.name });
      if (r.ok) {
        toast.success("Anexo guardado.");
        router.refresh();
      } else toast.error(r.error ?? "Não foi possível registrar o anexo.");
    });
  };

  const abrir = async (id: string) => {
    const r = await linkDoAnexo(id);
    if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else toast.error(r.error ?? "Não foi possível abrir.");
  };

  const lista = anexos.filter((a) => verRemovidos || !a.removedAt);
  const removidos = anexos.filter((a) => a.removedAt).length;

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <h3 className="text-sm font-semibold">Anexos</h3>
        {podeLancar && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
            <label className="block min-w-52">
              <Label className="text-[11px]">Tipo do documento</Label>
              <select className={SELECT} value={tipo} onChange={(e) => setTipo(e.target.value as AttachmentKind)}>
                {(Object.keys(ATTACHMENT_KIND_LABELS) as AttachmentKind[]).map((k) => (
                  <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <input
              ref={entrada}
              type="file"
              className="hidden"
              accept={ANEXO_TIPOS.join(",")}
              onChange={(e) => {
                const arq = e.target.files?.[0];
                e.target.value = "";
                if (arq) enviar(arq);
              }}
            />
            <Button size="sm" className="h-9" disabled={enviando} onClick={() => entrada.current?.click()}>
              <Paperclip className="size-4" /> {enviando ? "Enviando…" : "Escolher arquivo"}
            </Button>
            <span className="text-[11px] text-muted-foreground">PDF ou imagem, até 10 MB.</span>
          </div>
        )}
        {removidos > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="accent-primary" checked={verRemovidos} onChange={(e) => setVerRemovidos(e.target.checked)} />
            Mostrar os {removidos} removido{removidos === 1 ? "" : "s"}
          </label>
        )}
        {lista.length === 0 && <p className="text-xs text-muted-foreground">Nenhum anexo.</p>}
        <ul className="space-y-1 text-sm">
          {lista.map((a) => (
            <li key={a.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border px-2 py-1.5", a.removedAt && "opacity-60")}>
              <span className="rounded bg-muted px-1.5 text-[10px]">{ATTACHMENT_KIND_LABELS[a.kind as AttachmentKind] ?? a.kind}</span>
              <button type="button" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" onClick={() => abrir(a.id)}>
                {a.fileName} <ExternalLink className="size-3" />
              </button>
              <span className="text-xs text-muted-foreground">
                {[tamanho(a.sizeBytes), formatBrDateTime(a.uploadedAt), a.uploadedBy && nomes.get(a.uploadedBy)].filter(Boolean).join(" · ")}
              </span>
              {podeLancar && !a.removedAt && (
                <button type="button" aria-label="Remover anexo" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setRemover(a)}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
              <div className="w-full">
                <Removido em={a.removedAt} motivo={a.removedReason} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      {remover && (
        <RemoverComMotivo
          titulo={`Remover “${remover.fileName}”`}
          aberto
          ocupado={ocupado}
          onFechar={() => setRemover(null)}
          onConfirmar={(motivo) => rodar(() => removerRegistro(debtId, "anexo", remover.id, motivo), "Anexo removido (o arquivo fica guardado).", () => setRemover(null))}
        />
      )}
    </Card>
  );
}
