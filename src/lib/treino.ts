import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * O AMBIENTE DE TREINO É OUTRO BANCO — e é por isso que este arquivo existe.
 *
 * O dono pediu "um login só" para os três ambientes. Para o Risarte Academy
 * isso já é verdade: ele divide o MESMO projeto Supabase do sistema real, então
 * o `auth.users` é o mesmo. Para o treino, não: ele tem projeto próprio (é o
 * que impede um paciente de teste de nascer no banco de verdade), e um projeto
 * próprio tem a própria lista de usuários.
 *
 * Então "um login só" aqui é construído, não herdado: ao liberar o treino para
 * alguém, o sistema real **cria a pessoa lá** com o mesmo e-mail e a mesma
 * senha; ao trocar a senha aqui, troca lá também; ao retirar o acesso, **bane**
 * o login de lá (nunca apaga — apagar levaria junto o que ela fez treinando).
 *
 * ⚠️ O QUE ISTO CUSTA, declarado: a produção passa a guardar a chave de serviço
 * do banco de treino (`TREINO_SUPABASE_URL` + `TREINO_SERVICE_ROLE_KEY`, nas
 * variáveis da Vercel). Sem elas, liberar o treino **falha com uma mensagem
 * clara** em vez de marcar o acesso e não criar ninguém.
 *
 * ⚠️ E O LIMITE: recuperação de senha feita pelo próprio Supabase (link de
 * e-mail) não passa por aqui, então essa troca não se espelha. O caminho que se
 * espelha é o do sistema — "Redefinir senha" na ficha e "Trocar minha senha" no
 * Perfil.
 */

export type ResultadoDoTreino = { ok: boolean; error?: string };

export function treinoConfigurado(): boolean {
  return Boolean(
    process.env.TREINO_SUPABASE_URL && process.env.TREINO_SERVICE_ROLE_KEY
  );
}

const FALTA_CHAVE =
  "O ambiente de treino ainda não está configurado no servidor (TREINO_SUPABASE_URL e TREINO_SERVICE_ROLE_KEY). Sem isso não dá para criar o login lá.";

function clienteDoTreino(): SupabaseClient | null {
  if (!treinoConfigurado()) return null;
  return createClient(
    process.env.TREINO_SUPABASE_URL!,
    process.env.TREINO_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Acha a pessoa no treino pelo e-mail (é a chave entre os dois bancos). */
async function acharNoTreino(
  treino: SupabaseClient,
  email: string
): Promise<{ id: string } | null> {
  const alvo = email.trim().toLowerCase();
  const { data } = await treino
    .from("profiles")
    .select("id, email")
    .ilike("email", alvo)
    .maybeSingle<{ id: string; email: string | null }>();
  return data ? { id: data.id } : null;
}

/**
 * Libera a pessoa no treino: cria o login (ou reativa o que já existe), dá a
 * ela a MESMA função da unidade do cadastro — a unidade é casada pelo NOME,
 * porque os ids das clínicas são diferentes em cada banco — e marca o sistema
 * como liberado lá dentro. Sem função, a pessoa entraria no treino e não teria
 * o que treinar.
 */
export async function liberarNoTreino(entrada: {
  email: string;
  senha: string;
  nome: string;
  funcao: string | null;
  unidade: string | null;
}): Promise<ResultadoDoTreino> {
  const treino = clienteDoTreino();
  if (!treino) return { ok: false, error: FALTA_CHAVE };

  const email = entrada.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "E-mail inválido." };

  let userId: string;
  const existente = await acharNoTreino(treino, email);
  if (existente) {
    userId = existente.id;
    const { error } = await treino.auth.admin.updateUserById(userId, {
      ban_duration: "none",
      password: entrada.senha,
    });
    if (error) {
      console.error("liberarNoTreino (reativar) falhou:", error.message);
      return { ok: false, error: "Não foi possível reativar o login no treino." };
    }
    await treino.from("profiles").update({ is_active: true }).eq("id", userId);
  } else {
    const { data, error } = await treino.auth.admin.createUser({
      email,
      password: entrada.senha,
      email_confirm: true,
      user_metadata: { full_name: entrada.nome },
    });
    if (error || !data.user) {
      console.error("liberarNoTreino (criar) falhou:", error?.message);
      return { ok: false, error: "Não foi possível criar o login no treino." };
    }
    userId = data.user.id;
  }

  // A função, casada pelo NOME da unidade. Se aquela unidade não existir no
  // treino, a pessoa entra sem função — e o treino avisa isso na própria tela
  // (modo portal), em vez de o sistema inventar uma unidade para ela.
  if (entrada.funcao && entrada.unidade) {
    const { data: clinica } = await treino
      .from("clinics")
      .select("id")
      .ilike("name", entrada.unidade)
      .maybeSingle<{ id: string }>();
    if (clinica) {
      await treino
        .from("user_clinic_roles")
        .upsert(
          { user_id: userId, clinic_id: clinica.id, role: entrada.funcao },
          { onConflict: "user_id,clinic_id" }
        );
    }
  }

  // No treino o sistema é o que se vem usar: liberar lá é o ponto do ambiente.
  const { error: erroAmbiente } = await treino
    .from("user_environments")
    .upsert(
      { user_id: userId, environment: "sistema", allowed: true },
      { onConflict: "user_id,environment" }
    );
  if (erroAmbiente) {
    // Banco de treino ainda sem a 0259: não é motivo para falhar a liberação —
    // lá, sem a tabela, o sistema continua aberto como sempre foi.
    console.error("liberarNoTreino (ambiente) avisou:", erroAmbiente.message);
  }

  return { ok: true };
}

/** Retira o acesso ao treino: bane o login de lá, sem apagar nada. */
export async function bloquearNoTreino(email: string): Promise<ResultadoDoTreino> {
  const treino = clienteDoTreino();
  if (!treino) return { ok: false, error: FALTA_CHAVE };

  const pessoa = await acharNoTreino(treino, email);
  // Nunca existiu lá: retirar o acesso é exatamente o estado atual.
  if (!pessoa) return { ok: true };

  const { error } = await treino.auth.admin.updateUserById(pessoa.id, {
    ban_duration: "876000h",
  });
  if (error) {
    console.error("bloquearNoTreino falhou:", error.message);
    return { ok: false, error: "Não foi possível bloquear o login no treino." };
  }
  await treino.from("profiles").update({ is_active: false }).eq("id", pessoa.id);
  return { ok: true };
}

/**
 * A senha trocada aqui vale lá (decisão do dono).
 *
 * Silencioso de propósito quando a pessoa não existe no treino ou a chave não
 * está configurada: trocar a própria senha não pode falhar por causa de um
 * ambiente que a pessoa nem usa. Quem chama decide se avisa.
 */
export async function sincronizarSenhaNoTreino(
  email: string,
  senha: string
): Promise<ResultadoDoTreino> {
  const treino = clienteDoTreino();
  if (!treino) return { ok: false, error: FALTA_CHAVE };

  const pessoa = await acharNoTreino(treino, email);
  if (!pessoa) return { ok: true };

  const { error } = await treino.auth.admin.updateUserById(pessoa.id, {
    password: senha,
  });
  if (error) {
    console.error("sincronizarSenhaNoTreino falhou:", error.message);
    return { ok: false, error: "A senha mudou aqui, mas não no treino." };
  }
  return { ok: true };
}
