"use server";

import { formatPhone } from "@/lib/masks";
import { registrarPeloLink, type RespostaPublica } from "@/lib/indica/publico";

/**
 * Envio do formulário público do convite. Qualquer pessoa chega aqui (sem
 * login): quem valida é o banco (`registrar_pelo_link`), que responde de forma
 * GENÉRICA quando a pessoa já foi indicada ou já é cliente.
 */
export async function enviarPeloConvite(codigo: string, formData: FormData): Promise<RespostaPublica> {
  // Campo-isca: pessoa não vê, robô preenche.
  if (String(formData.get("site") ?? "").trim() !== "") return { ok: true, situacao: "recebido" };
  const nome = String(formData.get("nome") ?? "").trim().slice(0, 120);
  const telefone = formatPhone(String(formData.get("telefone") ?? ""));
  const unidade = String(formData.get("unidade_id") ?? "");
  if (nome.length < 2) return { ok: false, erro: "Escreva o seu nome." };
  if (telefone.replace(/\D/g, "").length < 10) return { ok: false, erro: "WhatsApp com DDD." };
  if (!/^[0-9a-f-]{36}$/i.test(unidade)) return { ok: false, erro: "Escolha a unidade." };
  return registrarPeloLink(codigo, {
    unidade_id: unidade,
    nome,
    telefone,
    aceite: formData.get("aceite") === "on",
  });
}
