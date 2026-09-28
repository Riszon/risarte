import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A PORTA DAS PÁGINAS PÚBLICAS do Indica +Risos (/i, /c, /e) — sem login.
 *
 * ⚠️ Usa a chave de serviço, e é por isso que é estreita de propósito: só
 * chama as FUNÇÕES públicas do schema `indica` (convite_publico,
 * registrar_pelo_link, ver_convite, aceitar_convite, portal_*), que só a
 * chave de serviço executa e que devolvem o mínimo (primeiro nome, etapa,
 * saldo). Nenhuma leitura de tabela passa por aqui. Decisão do dono
 * (28/09/2026): o Embaixador entra por link mágico, sem conta.
 */
function rpc() {
  return createAdminClient().schema("indica");
}

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await rpc().rpc(fn, args);
  if (error) {
    console.error(`indica.${fn}:`, error.message);
    return null;
  }
  return data as T;
}

/** IP de quem aceitou (vai para o registro do aceite LGPD). */
export async function ipDoVisitante(): Promise<string | null> {
  const h = await headers();
  const bruto = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  return /^[0-9a-f:.]{3,45}$/i.test(bruto) ? bruto : null;
}

/**
 * O endereço dos links. Parâmetro `url_publica`; vazio = o próprio site (a
 * produção usa o dela, o treino o dele). Domínio próprio depois: um lugar só.
 */
export async function origemDoSite(): Promise<string> {
  let configurada = "";
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .schema("indica")
      .rpc("config_valor", { p_chave: "url_publica" });
    if (typeof data === "string") configurada = data.trim().replace(/\/+$/, "");
  } catch {
    // sem sessão (página pública): usa o endereço da própria requisição
  }
  if (configurada) return configurada;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---- /i/[código] ------------------------------------------------------------
export type ConvitePublico = {
  indicador: string;
  codigo: string;
  termo_versao: string;
  unidades: { id: string; nome: string; cidade: string | null }[];
};
export const convitePublico = (codigo: string) =>
  chamar<ConvitePublico>("convite_publico", { p_codigo: codigo });

export type RespostaPublica = { ok: boolean; erro?: string; situacao?: string };
export async function registrarPeloLink(
  codigo: string,
  dados: { unidade_id: string; nome: string; telefone: string; aceite: boolean }
): Promise<RespostaPublica> {
  const r = await chamar<RespostaPublica>("registrar_pelo_link", {
    p_codigo: codigo,
    p_dados: dados,
    p_ip: await ipDoVisitante(),
  });
  return r ?? { ok: false, erro: "Não foi possível enviar agora. Tente de novo." };
}

// ---- /c/[token] -------------------------------------------------------------
export type VerConvite = { indicado: string; indicador: string; unidade: string; termo_versao: string };
export const verConvite = (token: string) => chamar<VerConvite>("ver_convite", { p_token: token });
export async function aceitarConvite(token: string): Promise<boolean> {
  return (await chamar<boolean>("aceitar_convite", { p_token: token, p_ip: await ipDoVisitante() })) === true;
}

// ---- /e/[token] — portal do Embaixador -------------------------------------
export type Portal = {
  embaixador: { codigo: string; primeiro_nome: string; nivel: { codigo: string; nome: string } };
  saldo: { disponivel: number; pendente: number; em_carencia: number; a_vencer_30_dias: number } | null;
  indicacoes: { codigo: string; indicado: string | null; etapa: string; registrada_em: string }[];
  extrato: {
    tipo: string;
    saldo: string;
    riso_coins: number;
    indicacao: string | null;
    libera_em: string | null;
    expira_em: string | null;
    criado_em: string;
  }[];
};
export const portalEmbaixador = (token: string) => chamar<Portal>("portal_embaixador", { p_token: token });

export type ItemDoPortal = {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: string;
  custo: number;
  valor_centavos: number | null;
  disponivel: boolean;
};
export const portalCatalogo = (token: string) => chamar<ItemDoPortal[]>("portal_catalogo", { p_token: token });

export async function portalResgatar(token: string, itemId: string) {
  return (
    (await chamar<{ ok: boolean; erro?: string; codigo?: string; status?: string }>("portal_resgatar", {
      p_token: token,
      p_item_id: itemId,
    })) ?? { ok: false, erro: "Não foi possível pedir agora. Tente de novo." }
  );
}

export async function portalIndicar(token: string, dados: { nome: string; telefone: string }) {
  return (
    (await chamar<{ ok: boolean; erro?: string; link?: string; texto?: string }>("portal_indicar", {
      p_token: token,
      p_dados: dados,
    })) ?? { ok: false, erro: "Não foi possível enviar agora. Tente de novo." }
  );
}
