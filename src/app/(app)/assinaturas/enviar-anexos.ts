"use client";

import { createClient } from "@/lib/supabase/client";
import type { AnexoEnviado } from "@/lib/signatures/anexos-enviados";
import { pedirEnvioDeAnexo } from "./anexo-actions";

const BUCKET = "signature-documents";

/**
 * AP150: manda os PDFs do computador direto ao armazenamento (um por vez) e
 * devolve só as referências — é isso que vai para a ação de preparar. Assim
 * nenhum arquivo passa pelo limite de 1 MB da ação de servidor.
 */
export async function enviarAnexos(arquivos: File[]): Promise<{ ok: true; refs: AnexoEnviado[] } | { ok: false; error: string }> {
  if (arquivos.length === 0) return { ok: true, refs: [] };
  const supabase = createClient();
  const refs: AnexoEnviado[] = [];
  for (const f of arquivos) {
    const autorizacao = await pedirEnvioDeAnexo({ nome: f.name, tamanho: f.size });
    if (!autorizacao.ok) return autorizacao;
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(autorizacao.path, autorizacao.token, f, { contentType: "application/pdf" });
    if (error) return { ok: false, error: `Não foi possível enviar o anexo "${f.name}". Confira a conexão e tente de novo.` };
    refs.push({ path: autorizacao.path, name: f.name });
  }
  return { ok: true, refs };
}
