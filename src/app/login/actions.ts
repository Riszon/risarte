"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ipDoPedido } from "@/lib/acesso";

/**
 * REGISTRA A ENTRADA: abre o acesso do dia (0287) e grava "Entrou no sistema"
 * na trilha — as duas coisas dentro do banco, na mesma função.
 *
 * ⚠️ ESTA FUNÇÃO É ESPERADA pelo formulário antes de trocar de tela. A versão
 * anterior (`recordLogin`) era disparada sem esperar, junto com a navegação —
 * e a navegação ganhava a corrida: em 09/10/2026 a trilha da produção tinha
 * 283 registros e NENHUM login, com 7 contas que já tinham entrado.
 *
 * Nunca derruba o login: se o banco ainda não tem a 0287 (o código viaja
 * sozinho, a migração não), o erro vai para o log e a pessoa entra.
 */
export async function iniciarAcesso(): Promise<void> {
  const supabase = await createClient();
  const cabecalhos = await headers();
  const { error } = await supabase.rpc("access_session_check", {
    p_user_agent: cabecalhos.get("user-agent"),
    p_ip: ipDoPedido(cabecalhos),
    p_origin: "login",
  });
  if (error) console.error("iniciarAcesso (0287):", error.message);
}
