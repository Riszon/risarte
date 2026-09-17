// AS REGRAS DOS ANEXOS DE RELATO (0257) — puras e testadas.
//
// O BUCKET é quem manda (tipo e tamanho estão no `storage.buckets` da 0257);
// esta lista existe para a tela recusar ANTES de enviar, com uma frase que a
// pessoa entende, em vez de deixar o Storage responder em inglês. Há teste que
// confere que as duas listas são a mesma.

export const TIPOS_ACEITOS = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "video/mp4",
  "video/webm",
] as const;

export type TipoAceito = (typeof TIPOS_ACEITOS)[number];

/** 10 MB — o mesmo `file_size_limit` do bucket. */
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** Por envio (o formulário). O banco segura 10 ativos por relato. */
export const MAXIMO_POR_ENVIO = 5;
export const MAXIMO_POR_RELATO = 10;

/** O `accept` do seletor de arquivo. */
export const ACCEPT = TIPOS_ACEITOS.join(",");

const EXTENSAO: Record<TipoAceito, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function ehTipoAceito(tipo: string): tipo is TipoAceito {
  return (TIPOS_ACEITOS as readonly string[]).includes(tipo);
}

export function extensaoDo(tipo: TipoAceito): string {
  return EXTENSAO[tipo];
}

export type TipoDeMidia = "imagem" | "video" | "pdf";

export function midiaDo(tipo: string): TipoDeMidia {
  if (tipo.startsWith("image/")) return "imagem";
  if (tipo.startsWith("video/")) return "video";
  return "pdf";
}

/** "820 KB", "1,5 MB". */
export function rotuloDeTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })} MB`;
}

export type ArquivoCandidato = { name: string; type: string; size: number };

/**
 * O que pode entrar, e por que o resto não entrou. Nunca recusa em silêncio:
 * arquivo que some da lista sem explicação vira "o sistema perdeu meu print".
 */
export function triarArquivos(
  candidatos: ArquivoCandidato[],
  jaNaLista: number
): { aceitos: number[]; avisos: string[] } {
  const aceitos: number[] = [];
  const avisos: string[] = [];
  let vagas = MAXIMO_POR_ENVIO - jaNaLista;

  candidatos.forEach((a, i) => {
    const nome = a.name || "arquivo";
    if (!ehTipoAceito(a.type)) {
      avisos.push(`"${nome}" não foi incluído: só imagem, PDF ou vídeo (MP4/WebM).`);
      return;
    }
    if (a.size > TAMANHO_MAXIMO) {
      avisos.push(
        `"${nome}" não foi incluído: tem ${rotuloDeTamanho(a.size)}, e o limite é 10 MB.`
      );
      return;
    }
    if (a.size === 0) {
      avisos.push(`"${nome}" não foi incluído: o arquivo está vazio.`);
      return;
    }
    if (vagas <= 0) {
      avisos.push(`"${nome}" não foi incluído: são no máximo ${MAXIMO_POR_ENVIO} por envio.`);
      return;
    }
    vagas--;
    aceitos.push(i);
  });

  return { aceitos, avisos };
}

/**
 * O caminho no Storage: `<relato>/<uuid>.<ext>`. O nome original NÃO entra —
 * "print ficha Maria Souza.png" no caminho seria nome de paciente num lugar que
 * aparece em log de servidor.
 */
export function caminhoDoAnexo(reportId: string, uuid: string, tipo: TipoAceito): string {
  return `${reportId}/${uuid}.${extensaoDo(tipo)}`;
}

/**
 * Nome da captura (o arquivo não tem nome próprio). Leva a TELA de onde veio:
 * no modo "ir até a tela do problema" a pessoa tira prints de telas
 * diferentes, e quem lê o relato precisa saber qual é qual. O endereço é do
 * sistema (`/financeiro/dre`), nunca dado de paciente — mas o id que alguns
 * endereços carregam é trocado por "ficha", para não viajar no nome.
 */
export function nomeDaCaptura(instante: Date, tela?: string | null): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const quando = `${instante.getFullYear()}${p(instante.getMonth() + 1)}${p(
    instante.getDate()
  )}-${p(instante.getHours())}${p(instante.getMinutes())}${p(instante.getSeconds())}`;
  return `captura${rotuloDaTela(tela)}-${quando}.png`;
}

const PARECE_ID = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|\d+|[A-Z]{2,3}-\d+)$/i;

function rotuloDaTela(tela?: string | null): string {
  if (!tela) return "";
  const partes = tela
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .map((seg) => (PARECE_ID.test(seg) ? "ficha" : seg))
    .map((seg) => seg.normalize("NFD").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
  return partes.length ? `-${partes.join("-")}` : "-inicio";
}
