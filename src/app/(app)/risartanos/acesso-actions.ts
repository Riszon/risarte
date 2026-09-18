"use server";

import { revalidatePath } from "next/cache";
import { requireAdminMaster } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { AMBIENTES, type Ambiente } from "@/lib/ambientes";
import { TAMANHO_DA_SENHA_SUGERIDA, senhaSugerida } from "@/lib/risartanos";
import { isTreino } from "@/lib/environment";
import { SOMENTE_CONSULTA_NO_TREINO } from "@/lib/espelho";
import { agendarEspelho } from "@/lib/espelho-treino";
import {
  bloquearNoTreino,
  liberarNoTreino,
  sincronizarSenhaNoTreino,
  treinoConfigurado,
} from "@/lib/treino";
import {
  USER_ROLES,
  UNIT_SCOPES,
  FRANCHISOR_ROLES,
  isRoleAllowedForClinicType,
  ROLE_LABELS,
  type ClinicType,
  type UnitScope,
  type UserRole,
} from "@/lib/roles";

/**
 * O ACESSO AO SISTEMA (login, senha e funções) — antes a tela
 * `/admin/usuarios`, hoje a seção "Acesso ao sistema" da ficha do Risartano.
 *
 * Mudou o lugar, NÃO mudou quem pode: **toda** ação aqui continua exigindo
 * Admin Master, exatamente como antes. Gerente, Franqueado e Franqueadora/RH
 * cuidam do cadastro; criar login, trocar senha e dar função é do Admin.
 */

export type ActionResult = { ok: boolean; error?: string; aviso?: string };

/** A ficha e a lista vivem sob /risartanos — a subárvore inteira reaquece. */
function reaquecer(): void {
  revalidatePath("/risartanos", "layout");
}

/**
 * A função foi dada FORA da unidade do cadastro?
 *
 * A tela pede a autorização do Admin nesse caso (decisão do dono, 17/09/2026);
 * aqui a resposta é recalculada no servidor, porque quem responde "era fora da
 * unidade?" para a auditoria não pode ser a mesma tela que fez o pedido.
 */
async function foraDaUnidadeDoCadastro(
  userId: string,
  clinicId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_members")
    .select("clinic_id")
    .eq("user_id", userId)
    .returns<{ clinic_id: string }[]>();
  if (!data || data.length === 0) return false;
  return !data.some((s) => s.clinic_id === clinicId);
}

/**
 * Persists the franchisor unit-access scope for a role assignment (the row in
 * user_clinic_roles). For 'specific', stores the chosen units; otherwise clears
 * them. No-op for non-franchisor roles.
 */
async function saveUnitScope(
  roleRowId: string,
  role: UserRole,
  scope: UnitScope | undefined,
  unitIds: string[] | undefined
): Promise<void> {
  if (!FRANCHISOR_ROLES.includes(role)) return;
  const effectiveScope: UnitScope = scope ?? "all";
  const supabase = await createClient();

  await supabase
    .from("user_clinic_roles")
    .update({ unit_scope: effectiveScope })
    .eq("id", roleRowId);

  await supabase.from("role_unit_access").delete().eq("user_clinic_role_id", roleRowId);

  if (effectiveScope === "specific" && unitIds && unitIds.length > 0) {
    await supabase.from("role_unit_access").insert(
      unitIds.map((clinicId) => ({
        user_clinic_role_id: roleRowId,
        clinic_id: clinicId,
      }))
    );
  }
}

/**
 * Validates that each role is allowed for its clinic's type (franchisor vs
 * unit). Returns an error message, or null when all assignments are valid.
 */
async function validateRoleEnvironments(
  assignments: { clinicId: string; role: UserRole }[]
): Promise<string | null> {
  if (assignments.length === 0) return null;
  const supabase = await createClient();
  const clinicIds = [...new Set(assignments.map((a) => a.clinicId))];
  const { data: clinics } = await supabase
    .from("clinics")
    .select("id, type")
    .in("id", clinicIds);

  const typeById = new Map<string, ClinicType>(
    (clinics ?? []).map((c) => [c.id, c.type as ClinicType])
  );

  for (const a of assignments) {
    const type = typeById.get(a.clinicId);
    if (!type) return "Clínica não encontrada.";
    if (!isRoleAllowedForClinicType(a.role, type)) {
      return `A função "${ROLE_LABELS[a.role]}" não pode ser atribuída neste tipo de clínica.`;
    }
  }
  return null;
}

const SERVICE_KEY_HINT =
  "A chave service_role ainda não foi configurada no arquivo .env.local do servidor.";

function validatePassword(password: string): string | null {
  if (password.length < 6) {
    return "A senha deve ter no mínimo 6 caracteres.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "A senha deve conter letras e números.";
  }
  return null;
}

export type RoleAssignment = {
  clinicId: string;
  role: UserRole;
  unitScope?: UnitScope;
  unitIds?: string[];
};

function parseAssignments(raw: string): RoleAssignment[] | null {
  try {
    const parsed = JSON.parse(raw) as RoleAssignment[];
    if (!Array.isArray(parsed)) return null;
    const seenClinics = new Set<string>();
    for (const item of parsed) {
      if (!item.clinicId || !USER_ROLES.includes(item.role)) return null;
      if (item.unitScope && !UNIT_SCOPES.includes(item.unitScope)) return null;
      // One role per clinic.
      if (seenClinics.has(item.clinicId)) return null;
      seenClinics.add(item.clinicId);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function createUser(formData: FormData): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const assignments = parseAssignments(
    String(formData.get("assignments") ?? "[]")
  );

  if (!fullName) return { ok: false, error: "Informe o nome completo." };
  if (!email.includes("@")) return { ok: false, error: "E-mail inválido." };
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };
  if (!assignments)
    return {
      ok: false,
      error:
        "Funções inválidas. Verifique se não há duas funções na mesma clínica.",
    };

  const envError = await validateRoleEnvironments(assignments);
  if (envError) return { ok: false, error: envError };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    console.error("createUser failed:", createError?.message);
    const friendly = createError?.message?.includes("already")
      ? "Já existe um usuário com este e-mail."
      : "Não foi possível criar o usuário.";
    return { ok: false, error: friendly };
  }

  const supabase = await createClient();
  if (assignments.length > 0) {
    const { data: insertedRoles, error: rolesError } = await supabase
      .from("user_clinic_roles")
      .insert(
        assignments.map((a) => ({
          user_id: created.user!.id,
          clinic_id: a.clinicId,
          role: a.role,
        }))
      )
      .select("id, clinic_id");
    if (rolesError) {
      console.error("role assignment failed:", rolesError.message);
      return {
        ok: false,
        error:
          "Acesso criado, mas houve erro ao atribuir funções. Atribua-as na ficha do Risartano.",
      };
    }
    // Save the unit-access scope for franchisor-role assignments.
    for (const a of assignments) {
      const row = (insertedRoles ?? []).find((r) => r.clinic_id === a.clinicId);
      if (row) await saveUnitScope(row.id, a.role, a.unitScope, a.unitIds);
    }
  }

  // Acesso criado a partir de um Risartano → vincula o cadastro de RH ao novo
  // login (além do vínculo automático por e-mail no banco, 0079).
  const staffMemberId = String(formData.get("staff_member_id") ?? "").trim();
  if (staffMemberId) {
    const { error: linkError } = await supabase
      .from("staff_members")
      .update({ user_id: created.user.id })
      .eq("id", staffMemberId)
      .is("user_id", null);
    if (linkError) {
      console.error("staff link on createUser failed:", linkError.message);
    }
  }

  // OS AMBIENTES escolhidos na hora de liberar o acesso (0259). O treino nasce
  // com a MESMA senha daqui — é o único momento em que dá para igualar as duas,
  // porque depois a senha vira um embaralhado que ninguém lê de volta.
  const ambientesPedidos = AMBIENTES.filter(
    (a) => String(formData.get(`ambiente_${a}`) ?? "") === "on"
  );
  const avisos: string[] = [];
  for (const ambiente of ambientesPedidos) {
    if (ambiente === "treino") {
      if (!treinoConfigurado()) {
        avisos.push(
          "o login do treino não foi criado: falta configurar o ambiente de treino no servidor"
        );
        continue;
      }
      const r = await liberarNoTreino({
        email,
        senha: password,
        nome: fullName,
        idDaProducao: created.user.id,
      });
      if (!r.ok) {
        avisos.push(r.error ?? "o login do treino não foi criado");
        continue;
      }
    }
    const { error: erroAmbiente } = await supabase.rpc("set_user_environment", {
      p_user_id: created.user.id,
      p_environment: ambiente,
      p_allowed: true,
    });
    if (erroAmbiente) {
      console.error("ambiente na criação falhou:", erroAmbiente.message);
      avisos.push(`o ambiente "${ambiente}" não foi marcado`);
    }
  }

  // Depois do vínculo: aí sim dá para dizer, do lado do servidor, se alguma
  // função saiu da unidade do cadastro (a tela pede autorização para isso).
  const fora: string[] = [];
  for (const a of assignments) {
    if (await foraDaUnidadeDoCadastro(created.user.id, a.clinicId)) {
      fora.push(a.clinicId);
    }
  }

  await logAudit({
    action: "create",
    entityType: "user",
    entityId: created.user.id,
    details: {
      funcoes: assignments.length,
      fora_da_unidade_do_cadastro: fora.length > 0,
      ambientes: ambientesPedidos,
    },
  });
  agendarEspelho({ pessoa: created.user.id });
  reaquecer();
  revalidatePath("/", "layout");
  return {
    ok: true,
    aviso:
      avisos.length > 0 ? `Acesso criado, mas ${avisos.join("; ")}.` : undefined,
  };
}

// -----------------------------------------------------------------------------
// Os três ambientes (0259)
// -----------------------------------------------------------------------------

/** Dados do cadastro que o treino precisa para a pessoa entrar com função. */
async function dadosParaOTreino(userId: string): Promise<{
  email: string | null;
  nome: string;
  funcao: string | null;
  unidade: string | null;
}> {
  const supabase = await createClient();
  const [{ data: perfil }, { data: staff }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle<{ full_name: string; email: string | null }>(),
    supabase
      .from("staff_members")
      .select("full_name, email, role_title, clinics ( name )")
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle<{
        full_name: string;
        email: string | null;
        role_title: string | null;
        clinics: { name: string } | null;
      }>(),
  ]);
  return {
    email: perfil?.email ?? staff?.email ?? null,
    nome: staff?.full_name || perfil?.full_name || "",
    funcao: staff?.role_title ?? null,
    unidade: staff?.clinics?.name ?? null,
  };
}

export type ResultadoDeAmbiente = ActionResult & {
  /** Senha provisória criada no treino, quando o login nasceu agora. */
  senhaDoTreino?: string;
  aviso?: string;
};

/**
 * Liga ou desliga um ambiente para a pessoa.
 *
 * O `sistema` e o `academy` são uma linha no banco — este banco responde por
 * eles. O `treino` é outro banco: ligar é **criar a pessoa lá**, desligar é
 * **bani-la lá**. Por isso a ordem importa: o trabalho no outro banco acontece
 * ANTES de marcar aqui. Marcar primeiro e falhar depois deixaria a tela dizendo
 * "liberado" sobre um login que não existe.
 */
export async function definirAmbiente(
  userId: string,
  ambiente: Ambiente,
  liberar: boolean
): Promise<ResultadoDeAmbiente> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  if (!AMBIENTES.includes(ambiente)) {
    return { ok: false, error: "Ambiente desconhecido." };
  }

  let senhaDoTreino: string | undefined;
  if (ambiente === "treino") {
    if (!treinoConfigurado()) {
      return {
        ok: false,
        error:
          "O ambiente de treino ainda não está ligado neste servidor. Falta cadastrar TREINO_SUPABASE_URL e TREINO_SERVICE_ROLE_KEY nas variáveis da Vercel.",
      };
    }
    const dados = await dadosParaOTreino(userId);
    if (!dados.email) {
      return { ok: false, error: "Esta pessoa não tem e-mail no cadastro." };
    }
    if (liberar) {
      // O login do treino nasce com senha própria: a senha daqui é guardada
      // embaralhada e não dá para lê-la. A partir da primeira troca no Perfil,
      // as duas andam juntas.
      senhaDoTreino = senhaSugerida(sorteio());
      const r = await liberarNoTreino({
        email: dados.email,
        senha: senhaDoTreino,
        nome: dados.nome,
        idDaProducao: userId,
      });
      if (!r.ok) return { ok: false, error: r.error };
    } else {
      const r = await bloquearNoTreino(dados.email);
      if (!r.ok) return { ok: false, error: r.error };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_environment", {
    p_user_id: userId,
    p_environment: ambiente,
    p_allowed: liberar,
  });
  if (error) {
    console.error("definirAmbiente falhou:", error.message);
    return {
      ok: false,
      error:
        error.code === "PGRST202"
          ? "O banco ainda não recebeu a migração 0259 (ambientes)."
          : "Não foi possível salvar o ambiente.",
    };
  }

  await logAudit({
    action: "update",
    entityType: "user_environments",
    entityId: userId,
    details: { ambiente, liberado: liberar },
  });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  revalidatePath("/", "layout");
  return {
    ok: true,
    senhaDoTreino,
    aviso:
      ambiente === "academy"
        ? "O Risarte Academy roda em outro sistema: a marcação controla o atalho do Início; o bloqueio lá depende de ajuste no Academy."
        : undefined,
  };
}

/** Bytes de sorteio para a senha provisória (a conta em si é pura e testada). */
function sorteio(): Uint8Array {
  const bytes = new Uint8Array(TAMANHO_DA_SENHA_SUGERIDA);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function updateUserName(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { ok: false, error: "Informe o nome completo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", userId);

  if (error) {
    console.error("updateUserName failed:", error.message);
    return { ok: false, error: "Não foi possível salvar o nome." };
  }

  await logAudit({ action: "update", entityType: "user", entityId: userId });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  return { ok: true };
}

export async function resetUserPassword(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  const password = String(formData.get("password") ?? "");
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("resetUserPassword failed:", error.message);
    return { ok: false, error: "Não foi possível redefinir a senha." };
  }

  // A MESMA SENHA VALE NO TREINO (decisão do dono, 17/09/2026). Se falhar, a
  // senha daqui já mudou — então o aviso é devolvido em vez de fingir que os
  // dois ambientes continuam iguais.
  let aviso: string | undefined;
  if (treinoConfigurado()) {
    const { email } = await dadosParaOTreino(userId);
    if (email) {
      const r = await sincronizarSenhaNoTreino(email, password);
      if (!r.ok) aviso = r.error;
    }
  }

  await logAudit({
    action: "update",
    entityType: "user",
    entityId: userId,
    details: { field: "password" },
  });
  return { ok: true, aviso };
}

export async function setUserActive(
  userId: string,
  active: boolean
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  const session = await requireAdminMaster();
  if (userId === session.userId) {
    return { ok: false, error: "Você não pode desativar a si mesmo." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: SERVICE_KEY_HINT };
  }

  // Ban blocks login; ~100 years means "until reactivated".
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banError) {
    console.error("setUserActive ban failed:", banError.message);
    return { ok: false, error: "Não foi possível alterar o status." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId);
  if (error) {
    console.error("setUserActive flag failed:", error.message);
    return { ok: false, error: "Não foi possível alterar o status." };
  }

  await logAudit({
    action: "update",
    entityType: "user",
    entityId: userId,
    details: { field: "is_active", value: active },
  });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  return { ok: true };
}

export async function addUserRole(
  userId: string,
  clinicId: string,
  role: UserRole,
  unitScope?: UnitScope,
  unitIds?: string[]
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  if (!USER_ROLES.includes(role)) {
    return { ok: false, error: "Função inválida." };
  }

  const envError = await validateRoleEnvironments([{ clinicId, role }]);
  if (envError) return { ok: false, error: envError };

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("user_clinic_roles")
    .insert({ user_id: userId, clinic_id: clinicId, role })
    .select("id")
    .single();

  if (error) {
    const friendly = error.code === "23505"
      ? "Esta pessoa já tem uma função nesta clínica. Remova a atual antes de adicionar outra."
      : "Não foi possível atribuir a função.";
    if (error.code !== "23505") {
      console.error("addUserRole failed:", error.message);
    }
    return { ok: false, error: friendly };
  }

  await saveUnitScope(inserted.id, role, unitScope, unitIds);

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    clinicId,
    details: {
      added: role,
      fora_da_unidade_do_cadastro: await foraDaUnidadeDoCadastro(userId, clinicId),
    },
  });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  return { ok: true };
}

/** Updates the unit-access scope of an existing franchisor role assignment. */
export async function updateRoleScope(
  roleRowId: string,
  userId: string,
  unitScope: UnitScope,
  unitIds: string[]
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();
  if (!UNIT_SCOPES.includes(unitScope)) {
    return { ok: false, error: "Escopo inválido." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("user_clinic_roles")
    .select("role")
    .eq("id", roleRowId)
    .single();
  if (!row) return { ok: false, error: "Função não encontrada." };

  await saveUnitScope(roleRowId, row.role as UserRole, unitScope, unitIds);

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    details: { unit_scope: unitScope, units: unitIds.length },
  });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  return { ok: true };
}

export async function removeUserRole(
  roleRowId: string,
  userId: string
): Promise<ActionResult> {
  if (isTreino()) return { ok: false, error: SOMENTE_CONSULTA_NO_TREINO };
  await requireAdminMaster();

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_clinic_roles")
    .delete()
    .eq("id", roleRowId);

  if (error) {
    console.error("removeUserRole failed:", error.message);
    return { ok: false, error: "Não foi possível remover a função." };
  }

  await logAudit({
    action: "update",
    entityType: "user_clinic_roles",
    entityId: userId,
    details: { removedRowId: roleRowId },
  });
  agendarEspelho({ pessoa: userId });
  reaquecer();
  return { ok: true };
}
