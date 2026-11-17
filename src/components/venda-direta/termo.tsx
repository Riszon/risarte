"use client";

// VD3-2 (0415) — a caixa TERMO do caixa da venda direta: enviar o termo pela
// ZapSign, assinar no aparelho do balcão, mandar pelo WhatsApp, ou anexar o
// termo assinado no papel. Assinou na ZapSign → o banco marca a venda sozinho;
// enquanto espera, a janela pergunta de novo a cada poucos segundos.

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, MessageCircle, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatBrDateTime } from "@/lib/dates";
import { fimDoTermo, situacaoDoTermo } from "@/lib/venda-direta-termo-texto";
import {
  enviarTermo,
  marcarTermoNoPapel,
  pegarLinkDoTermo,
  type TermoDaVenda,
} from "@/app/(app)/comercial/venda-direta/caixa-actions";

/** Os mesmos limites da pasta `termos-venda-direta` (0415): o Storage também recusa. */
const TIPOS = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const LIMITE = 10 * 1024 * 1024;
/** De quanto em quanto tempo a janela pergunta se o cliente já assinou. */
const ESPERA_MS = 5000;

export function AcoesDoTermo({
  saleId,
  termo,
  termoErro,
  atualizar,
}: {
  saleId: string;
  termo: TermoDaVenda;
  /** O motivo de o termo não ter saído no Finalizar (cadastro, ZapSign). */
  termoErro: string | null;
  /** Relê a venda (sem mexer na tela de trás). */
  atualizar: () => Promise<void>;
}) {
  const situacao = situacaoDoTermo({
    contractSigned: false,
    contractSignedSource: termo.source,
    packageStatus: termo.packageStatus,
  });
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(termoErro);
  const [papel, setPapel] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);

  // Enquanto o cliente não assina, pergunta de novo (o aviso da ZapSign marca
  // a venda no banco; aqui só se relê).
  const atualizarRef = useRef(atualizar);
  useEffect(() => {
    atualizarRef.current = atualizar;
  }, [atualizar]);
  useEffect(() => {
    if (situacao !== "aguardando") return;
    const id = setInterval(() => {
      void atualizarRef.current();
    }, ESPERA_MS);
    return () => clearInterval(id);
  }, [situacao]);

  function enviar() {
    startTransition(async () => {
      const r = await enviarTermo(saleId);
      if (r.ok) {
        setErro(null);
        toast.success("Termo enviado. O cliente já pode assinar.");
        await atualizar();
      } else {
        setErro(r.error ?? "O termo não saiu.");
        toast.error(r.error ?? "O termo não saiu.");
      }
    });
  }

  function abrirLink(canal: "agora" | "whatsapp") {
    // A aba abre AGORA (no clique), senão o navegador bloqueia; o endereço
    // chega depois.
    const aba = window.open("about:blank", "_blank");
    startTransition(async () => {
      const r = await pegarLinkDoTermo(saleId);
      if (!r.ok) {
        aba?.close();
        toast.error(r.error);
        return;
      }
      const destino = canal === "agora" ? r.link.signUrl : r.link.whatsapp;
      if (!destino) {
        aba?.close();
        toast.error("O cliente não tem telefone no cadastro. Use \"Assinar agora\" ou anexe o papel.");
        return;
      }
      if (aba) aba.location.href = destino;
      else window.location.href = destino;
    });
  }

  function anexar() {
    if (!arquivo) return;
    if (!TIPOS.includes(arquivo.type)) {
      toast.error("Envie uma foto (PNG, JPG ou WEBP) ou um PDF.");
      return;
    }
    if (arquivo.size > LIMITE) {
      toast.error("O arquivo passa de 10 MB.");
      return;
    }
    startTransition(async () => {
      const tipo = arquivo.type.split("/")[1];
      const ext = arquivo.type === "application/pdf" ? "pdf" : tipo === "jpeg" ? "jpg" : tipo;
      // O caminho não leva o nome do arquivo (pode ter o nome do paciente).
      const path = `${saleId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient()
        .storage.from("termos-venda-direta")
        .upload(path, arquivo, { contentType: arquivo.type });
      if (error) {
        toast.error("Não foi possível enviar o arquivo. Tente de novo.");
        return;
      }
      const r = await marcarTermoNoPapel(saleId, path, arquivo.name);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível marcar o termo.");
        return;
      }
      toast.success(r.closed ? "Venda direta CONCLUÍDA! 🎉" : "Termo assinado no papel, com o arquivo anexado.");
      setArquivo(null);
      setPapel(false);
      await atualizar();
    });
  }

  const fim = situacao === "sem_termo" ? fimDoTermo(termo.packageStatus) : null;

  return (
    <div className="space-y-2">
      {situacao === "aguardando" ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Esperando o cliente assinar{termo.packageNumber ? ` (${termo.packageNumber})` : ""}
            {termo.expiresAt ? ` · vale até ${formatBrDateTime(termo.expiresAt).slice(0, 10)}` : ""}.
            Marca sozinho.
          </p>
          <Button className="h-10 w-full" disabled={isPending} onClick={() => abrirLink("agora")}>
            <ExternalLink className="mr-1 size-4" />
            Assinar agora neste aparelho
          </Button>
          <Button variant="outline" className="h-9 w-full" disabled={isPending} onClick={() => abrirLink("whatsapp")}>
            <MessageCircle className="mr-1 size-4" />
            Enviar por WhatsApp
          </Button>
        </>
      ) : (
        <>
          {(fim || erro) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
              {erro ?? fim}
            </p>
          )}
          <Button className="h-10 w-full" disabled={isPending} onClick={enviar}>
            {isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Send className="mr-1 size-4" />}
            {fim ? "Enviar o termo de novo" : "Enviar o termo"}
          </Button>
        </>
      )}

      {papel ? (
        <div className="space-y-1.5 rounded-lg border border-dashed p-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Upload className="size-4 shrink-0 text-muted-foreground" />
            {arquivo ? (
              <span className="truncate font-medium">{arquivo.name}</span>
            ) : (
              <span>Foto ou PDF do termo assinado (até 10 MB)</span>
            )}
            <input
              type="file"
              accept={TIPOS.join(",")}
              className="sr-only"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setPapel(false)}>
              Voltar
            </Button>
            <Button size="sm" className="flex-1" disabled={!arquivo || isPending} onClick={anexar}>
              Anexar e marcar assinado
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          disabled={isPending}
          onClick={() => setPapel(true)}
        >
          Assinado em papel (anexar a foto)
        </button>
      )}
    </div>
  );
}

/** A frase do termo já assinado: de onde veio. */
export function textoDoTermoAssinado(termo: TermoDaVenda | undefined, quem: string | null): string {
  if (termo?.source === "assinatura_digital")
    return `Assinado pela ZapSign${termo.packageNumber ? ` (${termo.packageNumber})` : ""}.`;
  if (termo?.source === "papel")
    return `Assinado no papel${quem ? ` — anexado por ${quem}` : ""}.`;
  return quem ? `Assinado — registrado por ${quem}.` : "Assinado.";
}
