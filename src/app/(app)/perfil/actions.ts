"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhone } from "@/lib/masks";
import { sincronizarSenhaNoTreino, treinoConfigurado } from "@/lib/treino";
import { isTreino } from "@/lib/environment";
import { agendarEspelho } from "@/lib/espelho-treino";

/**
 * No TREINO, nome, telefone e senha vêm do sistema real (0260): trocar aqui
 * seria desfeito na próxima cópia. O Perfil do sistema real abre para todo
 * mundo, até para quem ainda só tem o treino (modo portal).
 */
const NO_TREINO_TROCA_NO_REAL =
  "No treino, seus dados e sua senha vêm do sistema real. Troque lá, em Perfil — passa a valer aqui também.";

export type ActionResult = { ok: boolean; error?: string; aviso?: string };

/**
 * TROCAR A PRÓPRIA SENHA — e a mesma senha passa a valer no TREINO.
 *
 * Decisão do dono (17/09/2026): é um login só para a pessoa, então trocar aqui
 * tem de trocar lá. O treino é outro banco, e o espelho é feito na hora da
 * troca — este é o único momento em que a senha existe em texto para o sistema.
 *
 * ⚠️ Limite declarado: recuperação por link de e-mail (fluxo do próprio
 * Supabase) não passa por aqui e, portanto, não se espelha.
 */
export async function trocarMinhaSenha(
  formData: FormData
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: NO_TREINO_TROCA_NO_REAL };
  const session = await getSessionContext();
  const atual = String(formData.get("current_password") ?? "");
  const senha = String(formData.get("password") ?? "");
  const confirmacao = String(formData.get("password_confirm") ?? "");

  if (!atual) return { ok: false, error: "Informe a sua senha atual." };
  if (senha.length < 6) {
    return { ok: false, error: "A senha deve ter no mínimo 6 caracteres." };
  }
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    return { ok: false, error: "A senha deve conter letras e números." };
  }
  if (senha !== confirmacao) {
    return { ok: false, error: "As duas senhas digitadas não são iguais." };
  }

  // ⚠️ A SENHA ATUAL É CONFERIDA NUM CLIENTE À PARTE, sem biscoitos: ele entra,
  // confirma e é descartado. Sem isso, um computador destravado por um minuto
  // bastaria para trocar a senha de alguém.
  const conferencia = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: erroAtual } = await conferencia.auth.signInWithPassword({
    email: session.email,
    password: atual,
  });
  if (erroAtual) {
    return { ok: false, error: "A senha atual não confere." };
  }

  // ⚠️ A TROCA VAI PELA CHAVE DE SERVIÇO, e não pela sessão de quem está
  // logado. `auth.updateUser()` gira os tokens da sessão no meio da resposta:
  // os biscoitos novos não chegavam ao navegador a tempo, a tela seguinte caía
  // sem sessão e o Perfil abria com "esta tela não conseguiu abrir" — com a
  // senha NÃO trocada. Pela chave de serviço a sessão de quem está logado
  // continua de pé, que é o que se espera ao trocar a própria senha.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      error: "A chave de serviço não está configurada neste servidor.",
    };
  }
  const { error } = await admin.auth.admin.updateUserById(session.userId, {
    password: senha,
  });
  if (error) {
    console.error("trocarMinhaSenha failed:", error.message);
    return { ok: false, error: "Não foi possível trocar a senha." };
  }

  // O treino segue a senha daqui. Se falhar, a senha JÁ mudou neste sistema —
  // então a pessoa precisa saber que o treino ficou para trás.
  let aviso: string | undefined;
  if (treinoConfigurado() && session.email) {
    const r = await sincronizarSenhaNoTreino(session.email, senha);
    if (!r.ok) {
      aviso =
        "A senha mudou aqui, mas não no ambiente de treino. Avise a Franqueadora.";
    }
  }

  return { ok: true, aviso };
}

/** Users may update their own NON-critical data (name, phone). */
export async function updateOwnProfile(
  formData: FormData
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: NO_TREINO_TROCA_NO_REAL };
  const session = await getSessionContext();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!fullName) return { ok: false, error: "Informe o nome completo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: phone ? formatPhone(phone) : null })
    .eq("id", session.userId);

  if (error) {
    console.error("updateOwnProfile failed:", error.message);
    return { ok: false, error: "Não foi possível salvar seus dados." };
  }

  agendarEspelho({ pessoa: session.userId });
  revalidatePath("/perfil");
  revalidatePath("/", "layout");
  return { ok: true };
}
