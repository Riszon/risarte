"use server";

import { formatPhone } from "@/lib/masks";
import { origemDoSite, portalIndicar, portalResgatar } from "@/lib/indica/publico";

const TOKEN = /^[0-9a-f]{64}$/;

export async function indicarPeloPortal(
  token: string,
  nome: string,
  telefone: string
): Promise<{ ok: boolean; erro?: string; mensagem?: string }> {
  if (!TOKEN.test(token)) return { ok: false, erro: "Acesso inválido." };
  if (nome.trim().length < 2) return { ok: false, erro: "Escreva o nome do seu amigo." };
  const tel = formatPhone(telefone);
  if (tel.replace(/\D/g, "").length < 10) return { ok: false, erro: "WhatsApp do amigo com DDD." };
  const r = await portalIndicar(token, { nome: nome.trim().slice(0, 120), telefone: tel });
  if (!r.ok) return { ok: false, erro: r.erro };
  const link = r.link ? `${await origemDoSite()}${r.link}` : "";
  return { ok: true, mensagem: (r.texto ?? "").replace("{link}", link) };
}

export async function resgatarPeloPortal(
  token: string,
  itemId: string
): Promise<{ ok: boolean; erro?: string; codigo?: string; status?: string }> {
  if (!TOKEN.test(token) || !/^[0-9a-f-]{36}$/i.test(itemId)) return { ok: false, erro: "Pedido inválido." };
  return portalResgatar(token, itemId);
}
