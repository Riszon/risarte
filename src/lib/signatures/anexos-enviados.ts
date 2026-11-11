import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "./send";
import { MAX_ATTACHMENT_BYTES } from "./validate";

/**
 * ANEXOS DO COMPUTADOR VÃO DIRETO AO ARMAZENAMENTO (AP150, 11/11/2026).
 *
 * Antes os PDFs iam dentro do pedido da ação de servidor, que o Next limita a
 * 1 MB — um PDF escaneado comum (2–3 MB) não passava, e a tela prometia 8 MB.
 * Subir o limite não resolve: a Vercel corta o pedido em ~4,5 MB.
 *
 * Agora: o servidor dá uma autorização de envio (URL assinada de upload) para
 * um caminho temporário DA PESSOA (`anexos-temp/<usuário>/<id>.pdf`); o
 * navegador manda o arquivo direto ao balde; a preparação lê de lá pela chave
 * de serviço, confere o dono do caminho e o tamanho, e apaga a cópia
 * temporária (o conteúdo segue no PDF do pacote). O balde só aceita PDF e
 * 10 MB, e ninguém logado lê o balde (0395).
 */

export const PASTA_TEMPORARIA = "anexos-temp";
export const MAX_ANEXOS = 10;

export type AnexoEnviado = { path: string; name: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** O caminho temporário de um anexo desta pessoa. */
export function caminhoDoAnexo(userId: string, id: string): string {
  return `${PASTA_TEMPORARIA}/${userId}/${id}.pdf`;
}

/** Só vale o caminho temporário DA PRÓPRIA pessoa (ninguém lê o anexo de outro). */
export function caminhoDoAnexoValido(path: string, userId: string): boolean {
  if (!userId || !new RegExp(`^${UUID}$`, "i").test(userId)) return false;
  return new RegExp(`^${PASTA_TEMPORARIA}/${userId}/${UUID}\\.pdf$`, "i").test(path);
}

/** O que a tela mandou em `attachment_refs` (JSON), sem confiar no formato. */
export function lerReferencias(raw: string): AnexoEnviado[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is { path: unknown; name: unknown } => !!x && typeof x === "object")
      .filter((x) => typeof x.path === "string" && typeof x.name === "string")
      .map((x) => ({ path: String(x.path), name: String(x.name).slice(0, 200) }));
  } catch {
    return [];
  }
}

/**
 * Lê os anexos enviados (pela chave de serviço, depois de conferir o dono do
 * caminho) e apaga a cópia temporária. Erro = mensagem para a tela.
 */
export async function lerAnexosEnviados(
  userId: string,
  refs: AnexoEnviado[]
): Promise<{ ok: true; anexos: { name: string; bytes: Uint8Array }[] } | { ok: false; error: string }> {
  if (refs.length > MAX_ANEXOS) return { ok: false, error: `No máximo ${MAX_ANEXOS} anexos por pacote.` };
  const admin = createAdminClient();
  const anexos: { name: string; bytes: Uint8Array }[] = [];
  for (const r of refs) {
    if (!caminhoDoAnexoValido(r.path, userId)) return { ok: false, error: "Anexo inválido. Escolha o arquivo de novo." };
    const file = await admin.storage.from(BUCKET).download(r.path);
    if (file.error || !file.data) return { ok: false, error: `Não foi possível ler o anexo "${r.name}". Escolha o arquivo de novo.` };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { ok: false, error: `O anexo "${r.name}" passa de 8 MB.` };
    anexos.push({ name: r.name, bytes });
  }
  // A cópia temporária já foi lida; o conteúdo segue no PDF do pacote.
  if (refs.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(refs.map((r) => r.path));
    if (error) console.error("signature temp attachment cleanup failed:", error.message);
  }
  return { ok: true, anexos };
}
