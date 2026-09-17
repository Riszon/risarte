"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  FileText,
  Film,
  ImageOff,
  Paperclip,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatBrDateTime } from "@/lib/dates";
import {
  ACCEPT,
  MAXIMO_POR_ENVIO,
  caminhoDoAnexo,
  ehTipoAceito,
  midiaDo,
  nomeDaCaptura,
  rotuloDeTamanho,
  triarArquivos,
} from "@/lib/anexos-de-relato";
import { capturarTela, podeCapturarTela } from "@/lib/captura-de-tela";
import { registrarAnexo, removerAnexo } from "./actions";

const semAssinatura = () => () => {};

export type AnexoPendente = {
  chave: string;
  arquivo: File;
  kind: "captura" | "arquivo";
  /** Endereço local da miniatura (só imagem). */
  previa: string | null;
};

/**
 * ESCOLHER O QUE VAI JUNTO (0257): capturar a tela, anexar arquivo, colar um
 * print (Ctrl+V) ou arrastar para cá.
 *
 * Nada sobe enquanto a pessoa escolhe. O envio acontece depois que o relato
 * (ou a mensagem) existe — é o id dele que dá o endereço do arquivo.
 */
export function SeletorDeAnexos({
  pendentes,
  aoMudar,
  esconder,
  mostrar,
  desabilitado,
}: {
  pendentes: AnexoPendente[];
  aoMudar: (lista: AnexoPendente[]) => void;
  /** O painel lateral some durante a captura, senão sai na foto. */
  esconder?: () => void;
  mostrar?: () => void;
  desabilitado?: boolean;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const [capturando, setCapturando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  // A captura só existe no navegador de computador. No servidor não há
  // `navigator`: `useSyncExternalStore` responde "não" no servidor e no
  // primeiro desenho, e só depois pergunta ao navegador — os dois lados nunca
  // discordam (a mesma lição do `useNow`).
  const captura = useSyncExternalStore(semAssinatura, podeCapturarTela, () => false);

  // A lista mais recente, para o ouvinte de "colar" (que é criado uma vez).
  const atual = useRef(pendentes);
  useEffect(() => {
    atual.current = pendentes;
  }, [pendentes]);

  function acrescentar(arquivos: File[], kind: AnexoPendente["kind"]) {
    const { aceitos, avisos } = triarArquivos(arquivos, atual.current.length);
    avisos.forEach((a) => toast.warning(a));
    if (aceitos.length === 0) return;
    const novos = aceitos.map((i) => {
      const arquivo = arquivos[i];
      return {
        chave: crypto.randomUUID(),
        arquivo,
        kind,
        previa: arquivo.type.startsWith("image/") ? URL.createObjectURL(arquivo) : null,
      };
    });
    aoMudar([...atual.current, ...novos]);
  }

  // Colar um print em qualquer campo do formulário.
  useEffect(() => {
    const form = raiz.current?.closest("form");
    if (!form) return;
    const aoColar = (e: ClipboardEvent) => {
      const arquivos = [...(e.clipboardData?.files ?? [])];
      if (arquivos.length === 0) return;
      e.preventDefault();
      const nomeados = arquivos.map((f) =>
        f.name && f.name !== "image.png"
          ? f
          : new File([f], nomeDaCaptura(new Date()).replace("captura", "colado"), {
              type: f.type,
            })
      );
      acrescentar(nomeados, "arquivo");
    };
    form.addEventListener("paste", aoColar);
    return () => form.removeEventListener("paste", aoColar);
    // `acrescentar` lê a lista pelo ref; o ouvinte não precisa ser recriado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function tirar(chave: string) {
    const item = pendentes.find((p) => p.chave === chave);
    if (item?.previa) URL.revokeObjectURL(item.previa);
    aoMudar(pendentes.filter((p) => p.chave !== chave));
  }

  async function aoCapturar() {
    setCapturando(true);
    const r = await capturarTela({
      nome: nomeDaCaptura(new Date()),
      esconder,
      mostrar,
    });
    setCapturando(false);
    if (r.ok) {
      acrescentar([r.arquivo], "captura");
      toast.success("Tela capturada. Confira a miniatura antes de enviar.");
    } else if (r.motivo === "falhou") {
      toast.error("Não consegui capturar a tela. Use a tecla Print Screen e cole aqui (Ctrl+V).");
    }
    // "cancelado": a pessoa desistiu na janela do navegador — nada a dizer.
  }

  const cheio = pendentes.length >= MAXIMO_POR_ENVIO;

  return (
    <div
      ref={raiz}
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        if (!desabilitado) acrescentar([...e.dataTransfer.files], "arquivo");
      }}
      className={cn(
        "space-y-2 rounded-md border border-dashed p-3",
        arrastando && "border-primary bg-primary/5"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {captura && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={aoCapturar}
            disabled={desabilitado || capturando || cheio}
          >
            <Camera className="mr-1.5 size-4" />
            {capturando ? "Capturando…" : "Capturar a tela"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => entrada.current?.click()}
          disabled={desabilitado || cheio}
        >
          <Paperclip className="mr-1.5 size-4" />
          Anexar arquivo
        </Button>
        <input
          ref={entrada}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            acrescentar([...(e.target.files ?? [])], "arquivo");
            e.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">
          {captura ? "ou cole um print (Ctrl+V) ou arraste aqui" : "imagem, PDF ou vídeo"}
          {" · "}até {MAXIMO_POR_ENVIO}, 10 MB cada
        </span>
      </div>

      {pendentes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {pendentes.map((p) => (
            <li
              key={p.chave}
              className="relative flex w-28 flex-col overflow-hidden rounded-md border bg-background text-[11px]"
            >
              <div className="grid h-20 place-items-center bg-muted">
                {p.previa ? (
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), sem otimização possível
                  <img src={p.previa} alt="" className="h-full w-full object-cover object-top" />
                ) : midiaDo(p.arquivo.type) === "video" ? (
                  <Film className="size-6 text-muted-foreground" />
                ) : (
                  <FileText className="size-6 text-muted-foreground" />
                )}
              </div>
              <span className="truncate px-1.5 pt-1" title={p.arquivo.name}>
                {p.kind === "captura" ? "Captura de tela" : p.arquivo.name}
              </span>
              <span className="px-1.5 pb-1 text-muted-foreground">
                {rotuloDeTamanho(p.arquivo.size)}
              </span>
              <button
                type="button"
                onClick={() => tirar(p.chave)}
                className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-background/90 shadow hover:bg-destructive hover:text-white"
                aria-label="Tirar da lista"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendentes.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          Quem vê este relato vê os anexos. Se o print mostrar dado de paciente
          que não tem a ver com o problema, tire da lista antes de enviar.
        </p>
      )}
    </div>
  );
}

/**
 * Enviar os anexos de um relato ou de uma mensagem. Cada arquivo sobe direto
 * do navegador e depois é registrado; se o registro falha, o arquivo é
 * apagado, para não ficar órfão na pasta.
 */
export async function enviarAnexos(
  reportId: string,
  messageId: string | null,
  pendentes: AnexoPendente[]
): Promise<{ enviados: number; falhas: string[] }> {
  const supabase = createClient();
  const falhas: string[] = [];
  let enviados = 0;

  for (const p of pendentes) {
    const tipo = p.arquivo.type;
    const nome = p.kind === "captura" ? "Captura de tela" : p.arquivo.name;
    if (!ehTipoAceito(tipo)) {
      falhas.push(`${nome}: tipo não aceito`);
      continue;
    }
    const caminho = caminhoDoAnexo(reportId, crypto.randomUUID(), tipo);
    const { error } = await supabase.storage
      .from("system-reports")
      .upload(caminho, p.arquivo, { contentType: tipo });
    if (error) {
      falhas.push(`${nome}: não subiu`);
      continue;
    }
    const r = await registrarAnexo({
      reportId,
      messageId,
      path: caminho,
      fileName: p.arquivo.name,
      mimeType: tipo,
      sizeBytes: p.arquivo.size,
      kind: p.kind,
    });
    if (!r.ok) {
      await supabase.storage.from("system-reports").remove([caminho]);
      falhas.push(`${nome}: ${r.error ?? "não foi registrado"}`);
      continue;
    }
    enviados++;
  }

  pendentes.forEach((p) => p.previa && URL.revokeObjectURL(p.previa));
  return { enviados, falhas };
}

/** Avisa o resultado do envio, sem esconder o que falhou. */
export function avisarEnvio(r: { enviados: number; falhas: string[] }) {
  if (r.falhas.length > 0) {
    toast.error(
      `${r.falhas.length === 1 ? "Um anexo não foi enviado" : `${r.falhas.length} anexos não foram enviados`}: ${r.falhas.join("; ")}`
    );
  }
}

// -----------------------------------------------------------------------------
// A galeria
// -----------------------------------------------------------------------------

export type AnexoExibido = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "captura" | "arquivo";
  createdAt: string;
  /** Link temporário; nulo quando removido ou quando o link não pôde ser gerado. */
  url: string | null;
  removido: { quando: string; quem: string } | null;
  podeRemover: boolean;
};

export function GaleriaDeAnexos({ anexos }: { anexos: AnexoExibido[] }) {
  if (anexos.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {anexos.map((a) => (
        <Anexo key={a.id} anexo={a} />
      ))}
    </ul>
  );
}

function Anexo({ anexo: a }: { anexo: AnexoExibido }) {
  const router = useRouter();
  const [removendo, iniciar] = useTransition();
  const [confirmar, setConfirmar] = useState(false);

  if (a.removido) {
    return (
      <li className="flex h-16 items-center gap-2 rounded-md border border-dashed px-3 text-xs text-muted-foreground">
        <ImageOff className="size-4" />
        <span>
          Anexo removido por {a.removido.quem}
          <br />
          {formatBrDateTime(a.removido.quando)}
        </span>
      </li>
    );
  }

  const midia = midiaDo(a.mimeType);
  const rotulo = a.kind === "captura" ? "Captura de tela" : a.fileName;

  function remover() {
    iniciar(async () => {
      const r = await removerAnexo(a.id);
      if (r.ok) {
        if (r.error) toast.warning(r.error);
        else toast.success("Anexo removido.");
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível remover.");
      }
      setConfirmar(false);
    });
  }

  return (
    <li className="w-40 overflow-hidden rounded-md border bg-card text-xs">
      {a.url && midia === "imagem" ? (
        <a href={a.url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
          {/* eslint-disable-next-line @next/next/no-img-element -- link assinado e temporário do Storage */}
          <img src={a.url} alt={rotulo} className="h-24 w-full bg-muted object-cover object-top" />
        </a>
      ) : a.url && midia === "video" ? (
        <video src={a.url} controls preload="metadata" className="h-24 w-full bg-black" />
      ) : (
        <a
          href={a.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="grid h-24 place-items-center bg-muted text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-8" />
        </a>
      )}
      <div className="space-y-0.5 px-2 py-1.5">
        <p className="truncate font-medium" title={rotulo}>
          {rotulo}
        </p>
        <p className="text-muted-foreground">{rotuloDeTamanho(a.sizeBytes)}</p>
        {!a.url && <p className="text-destructive">Link indisponível agora</p>}
        {a.podeRemover &&
          (confirmar ? (
            <div className="flex gap-1 pt-1">
              <Button size="xs" variant="destructive" onClick={remover} disabled={removendo}>
                {removendo ? "Removendo…" : "Remover"}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmar(false)} disabled={removendo}>
                Não
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              className="flex items-center gap-1 pt-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
              Remover
            </button>
          ))}
      </div>
    </li>
  );
}
