"use server";

import { randomUUID } from "node:crypto";
import { getSessionContext } from "@/lib/auth";
import { canSendSignatures } from "@/lib/signatures/access";
import { caminhoDoAnexo } from "@/lib/signatures/anexos-enviados";
import { BUCKET } from "@/lib/signatures/send";
import { MAX_ATTACHMENT_BYTES } from "@/lib/signatures/validate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * AP150: a autorização para o navegador mandar UM anexo (PDF) direto ao
 * armazenamento, num caminho temporário da própria pessoa. O arquivo não
 * passa por aqui (a ação de servidor aceita no máximo 1 MB). Quem lê e
 * confere o arquivo é a preparação do pacote (`lerAnexosEnviados`).
 */
export async function pedirEnvioDeAnexo(input: {
  nome: string;
  tamanho: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!canSendSignatures(session)) return { ok: false, error: "Você não tem permissão para enviar documentos para assinatura." };
  const nome = String(input.nome ?? "");
  if (!/\.pdf$/i.test(nome)) return { ok: false, error: `"${nome}" não é um PDF.` };
  const tamanho = Number(input.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, error: `"${nome}" está vazio.` };
  if (tamanho > MAX_ATTACHMENT_BYTES) return { ok: false, error: `"${nome}" passa de 8 MB.` };

  const path = caminhoDoAnexo(session.userId, randomUUID());
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error("signature attachment upload url failed:", error?.message);
    return { ok: false, error: "Não foi possível preparar o envio do anexo. Tente de novo em instantes." };
  }
  return { ok: true, path, token: data.token };
}
