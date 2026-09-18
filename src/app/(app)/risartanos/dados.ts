import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fullAccessClinicIds, type SessionContext } from "@/lib/auth";
import { isTreino } from "@/lib/environment";
import {
  ROLE_LABELS,
  type ClinicType,
  type UnitScope,
  type UserRole,
} from "@/lib/roles";
import { enderecoDaFicha, type PessoaDaEquipe } from "@/lib/risartanos";
import type { Ambiente, PermissoesDeAmbiente } from "@/lib/ambientes";
import {
  STAFF_PHOTO_BUCKET,
  staffDisplayName,
  type ContractType,
  type StaffAccess,
  type StaffMember,
} from "@/lib/staff";

type Supa = SupabaseClient;

/** As colunas do cadastro que a lista e a ficha usam. */
const COLUNAS =
  "id, clinic_id, code, full_name, preferred_name, cpf, birth_date, gender, marital_status, spouse_name, spouse_phone, whatsapp, email, zip_code, address, address_number, complement, neighborhood, city, state, contract_type, role_title, photo_path, notes, is_active, user_id, inactive_unit_ids, specialties, clinics ( name )";

export type StaffRow = {
  id: string;
  clinic_id: string;
  code: string | null;
  full_name: string;
  preferred_name: string | null;
  cpf: string | null;
  birth_date: string | null;
  gender: string | null;
  marital_status: string | null;
  spouse_name: string | null;
  spouse_phone: string | null;
  whatsapp: string | null;
  email: string | null;
  zip_code: string | null;
  address: string | null;
  address_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  contract_type: string | null;
  role_title: string | null;
  photo_path: string | null;
  notes: string | null;
  is_active: boolean;
  user_id: string | null;
  inactive_unit_ids: string[] | null;
  specialties: string[] | null;
  clinics: { name: string } | null;
};

export function paraStaff(r: StaffRow): StaffMember {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    code: r.code,
    fullName: r.full_name,
    preferredName: r.preferred_name,
    cpf: r.cpf,
    birthDate: r.birth_date,
    gender: (r.gender as StaffMember["gender"]) ?? null,
    maritalStatus: (r.marital_status as StaffMember["maritalStatus"]) ?? null,
    spouseName: r.spouse_name,
    spousePhone: r.spouse_phone,
    whatsapp: r.whatsapp,
    email: r.email,
    zipCode: r.zip_code,
    address: r.address,
    addressNumber: r.address_number,
    complement: r.complement,
    neighborhood: r.neighborhood,
    city: r.city,
    state: r.state,
    contractType: (r.contract_type as ContractType) ?? null,
    roleTitle: r.role_title,
    photoPath: r.photo_path,
    notes: r.notes,
    isActive: r.is_active,
    userId: r.user_id,
    inactiveUnitIds: r.inactive_unit_ids ?? [],
    specialties: r.specialties ?? [],
  };
}

/**
 * QUEM ESTA PESSOA PODE GERIR — espelho, na tela, das funções `can_manage_staff`
 * / `can_manage_staff_record` da RLS (0080). Admin; Gerente/Franqueado da
 * unidade; Franqueadora/RH nas unidades do seu escopo. A barreira de verdade
 * continua sendo o banco: aqui só se decide o que aparece.
 */
export type Alcance = {
  /** null = a rede toda (Admin). */
  escopoIds: string[] | null;
  /** Unidades onde esta pessoa cadastra/edita. */
  gerirIds: Set<string>;
  isRH: boolean;
  podeEscolherUnidade: boolean;
  podeCriar: boolean;
  podeGerirAlguma: boolean;
};

export async function alcanceDoUsuario(session: SessionContext): Promise<Alcance> {
  const papeis = Object.values(session.rolesByClinic).flat();
  const isRH = papeis.includes("franchisor_staff");
  const escopoIds = session.isAdminMaster ? null : await fullAccessClinicIds();

  const gerirIds = new Set<string>();
  for (const [cid, rs] of Object.entries(session.rolesByClinic)) {
    if (rs.some((r) => r === "unit_manager" || r === "franchisee")) {
      gerirIds.add(cid);
    }
  }
  if (isRH) for (const id of escopoIds ?? []) gerirIds.add(id);

  const activeClinicId = session.activeClinic?.id ?? null;
  const podeCriar =
    session.isAdminMaster ||
    isRH ||
    (activeClinicId != null &&
      (session.rolesByClinic[activeClinicId] ?? []).some(
        (r) => r === "unit_manager" || r === "franchisee"
      ));

  // NO TREINO NINGUÉM EDITA (0260) — nem o Admin. O que se VÊ continua igual
  // (escopoIds); o que some é tudo o que grava.
  if (isTreino()) {
    return {
      escopoIds,
      gerirIds: new Set<string>(),
      isRH,
      podeEscolherUnidade: false,
      podeCriar: false,
      podeGerirAlguma: false,
    };
  }

  return {
    escopoIds,
    gerirIds,
    isRH,
    podeEscolherUnidade: session.isAdminMaster || isRH,
    podeCriar,
    podeGerirAlguma: session.isAdminMaster || gerirIds.size > 0,
  };
}

/** Quem vê a tela: Admin, Franqueadora/RH, Gerente e Franqueado. */
export function podeVerEquipe(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  const papeis = Object.values(session.rolesByClinic).flat();
  return (
    papeis.includes("franchisor_staff") ||
    papeis.some((r) => r === "unit_manager" || r === "franchisee")
  );
}

// -----------------------------------------------------------------------------
// O acesso (login) de cada pessoa
// -----------------------------------------------------------------------------

type PerfilRow = {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  is_admin_master: boolean;
};

/**
 * Lê o login de cada usuário pedido. O RLS pode esconder o perfil de quem é de
 * outra unidade: nesse caso fica o registro mínimo ("com acesso", sem e-mail),
 * que é exatamente o que a tela antiga já fazia.
 */
export async function carregarAcessos(
  supabase: Supa,
  userIds: string[]
): Promise<Map<string, StaffAccess>> {
  const mapa = new Map<string, StaffAccess>();
  if (userIds.length === 0) return mapa;

  const [{ data: perfis }, { data: papeis }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, is_active, is_admin_master")
      .in("id", userIds)
      .returns<PerfilRow[]>(),
    supabase
      .from("user_clinic_roles")
      .select("user_id, role, clinic_id, clinics ( name )")
      .in("user_id", userIds)
      .returns<
        {
          user_id: string;
          role: UserRole;
          clinic_id: string;
          clinics: { name: string } | null;
        }[]
      >(),
  ]);

  const unidadesPorUsuario = new Map<
    string,
    { clinicId: string; clinicName: string; roleLabel: string }[]
  >();
  for (const p of papeis ?? []) {
    const lista = unidadesPorUsuario.get(p.user_id) ?? [];
    lista.push({
      clinicId: p.clinic_id,
      clinicName: p.clinics?.name ?? "—",
      roleLabel: ROLE_LABELS[p.role],
    });
    unidadesPorUsuario.set(p.user_id, lista);
  }

  for (const perfil of perfis ?? []) {
    const unidades = unidadesPorUsuario.get(perfil.id) ?? [];
    const partes = unidades.map((u) => `${u.roleLabel} · ${u.clinicName}`);
    if (perfil.is_admin_master) partes.unshift("Admin Master");
    mapa.set(perfil.id, {
      userId: perfil.id,
      email: perfil.email,
      loginActive: perfil.is_active,
      rolesText: partes.join(", "),
      units: unidades,
      unitClinicIds: unidades.map((u) => u.clinicId),
    });
  }
  return mapa;
}

/** URLs assinadas (1h) das fotos — o balde é privado. */
export async function assinarFotos(
  supabase: Supa,
  caminhos: string[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const limpos = caminhos.filter(Boolean);
  if (limpos.length === 0) return urls;
  const { data } = await supabase.storage
    .from(STAFF_PHOTO_BUCKET)
    .createSignedUrls(limpos, 3600);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

// -----------------------------------------------------------------------------
// A lista da equipe
// -----------------------------------------------------------------------------

export type Equipe = {
  pessoas: PessoaDaEquipe[];
  unidades: { id: string; name: string }[];
  /** Logins livres para vincular a um cadastro (só o Admin usa). */
  loginsSemCadastro: { id: string; label: string }[];
};

export async function carregarEquipe(
  supabase: Supa,
  session: SessionContext,
  alcance: Alcance
): Promise<Equipe> {
  let unidadesQuery = supabase
    .from("clinics")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (alcance.escopoIds) unidadesQuery = unidadesQuery.in("id", alcance.escopoIds);

  // NÃO filtramos por clinic_id: a barreira é a RLS (`can_see_staff`), que já
  // mostra o Risartano a quem gere QUALQUER unidade onde ele tem acesso.
  // Filtrar pela "unidade de origem" aqui esconderia os multi-unidade.
  // No treino a lista é a da produção: só o cadastro que veio de lá (0260).
  let cadastrosQuery = supabase
    .from("staff_members")
    .select(COLUNAS)
    .order("full_name")
    .limit(2000);
  if (isTreino()) cadastrosQuery = cadastrosQuery.not("mirrored_at", "is", null);

  const [{ data: unidades }, { data: linhas }] = await Promise.all([
    unidadesQuery.returns<{ id: string; name: string }[]>(),
    cadastrosQuery.returns<StaffRow[]>(),
  ]);

  const cadastros = linhas ?? [];
  const acessos = await carregarAcessos(
    supabase,
    [...new Set(cadastros.filter((r) => r.user_id).map((r) => r.user_id!))]
  );
  const fotos = await assinarFotos(
    supabase,
    cadastros.map((r) => r.photo_path).filter(Boolean) as string[]
  );

  const pessoas: PessoaDaEquipe[] = cadastros.map((r) =>
    pessoaDoCadastro(r, acessos.get(r.user_id ?? ""), fotos, session, alcance)
  );

  // LOGIN SEM CADASTRO — a outra metade da união. Só o Admin gere acesso, então
  // só ele vê (e resolve) esta linha; para os demais a lista continua sendo a
  // de sempre.
  let loginsSemCadastro: { id: string; label: string }[] = [];
  if (session.isAdminMaster) {
    const vinculados = new Set(
      cadastros.filter((r) => r.user_id).map((r) => r.user_id as string)
    );
    const { data: perfis } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_active, is_admin_master")
      .order("full_name")
      .returns<PerfilRow[]>();
    // No treino, só os logins que vieram da produção: os usuários de teste por
    // função continuam entrando, mas não são Risartanos (decisão do dono).
    const daProducao = isTreino() ? await loginsEspelhados(supabase) : null;
    const soltos = (perfis ?? []).filter(
      (p) => !vinculados.has(p.id) && (!daProducao || daProducao.has(p.id))
    );
    const acessosSoltos = await carregarAcessos(
      supabase,
      soltos.map((p) => p.id)
    );
    for (const p of soltos) {
      const acesso = acessosSoltos.get(p.id);
      pessoas.push({
        tipo: "login",
        chave: p.id,
        href: `/risartanos/acesso/${p.id}`,
        code: null,
        nome: p.full_name || p.email || "—",
        nomeCompleto: p.full_name || "",
        email: p.email,
        cpf: null,
        fotoUrl: null,
        unidadeOrigem: null,
        unidadeOrigemId: null,
        unidades: (acesso?.units ?? []).map((u) => ({
          ...u,
          inativo: false,
          gerida: !isTreino(),
        })),
        regime: null,
        ativo: p.is_active,
        temAcesso: true,
        acessoAtivo: p.is_active,
        isAdminMaster: p.is_admin_master,
        podeGerir: !isTreino(),
      });
    }
    loginsSemCadastro = soltos
      .filter((p) => p.is_active)
      .map((p) => ({
        id: p.id,
        label: `${p.full_name || p.email || "—"}${p.email ? ` (${p.email})` : ""}`,
      }));
  }

  return { pessoas, unidades: unidades ?? [], loginsSemCadastro };
}

/** Os logins do treino que são cópia de alguém da produção (0260). */
async function loginsEspelhados(supabase: Supa): Promise<Set<string>> {
  const { data } = await supabase
    .from("mirror_user_map")
    .select("local_id")
    .returns<{ local_id: string }[]>();
  return new Set((data ?? []).map((m) => m.local_id));
}

function pessoaDoCadastro(
  r: StaffRow,
  acesso: StaffAccess | undefined,
  fotos: Map<string, string>,
  session: SessionContext,
  alcance: Alcance
): PessoaDaEquipe {
  // Sem perfil legível (RLS de outra unidade) mas COM vínculo: a pessoa tem
  // acesso, só não dá para dizer mais que isso.
  const temAcesso = Boolean(r.user_id);
  const resumo: StaffAccess | null = r.user_id
    ? acesso ?? {
        userId: r.user_id,
        email: null,
        loginActive: true,
        rolesText: "",
        units: [],
        unitClinicIds: [],
      }
    : null;
  const inativasAqui = new Set(r.inactive_unit_ids ?? []);
  const podeGerir =
    (session.isAdminMaster && !isTreino()) ||
    alcance.gerirIds.has(r.clinic_id) ||
    (resumo?.unitClinicIds ?? []).some((id) => alcance.gerirIds.has(id));

  return {
    tipo: "risartano",
    chave: r.id,
    href: enderecoDaFicha({ code: r.code, id: r.id }),
    code: r.code,
    nome: staffDisplayName({
      preferredName: r.preferred_name,
      fullName: r.full_name,
    }),
    nomeCompleto: r.full_name,
    email: r.email ?? resumo?.email ?? null,
    cpf: r.cpf,
    fotoUrl: (r.photo_path && fotos.get(r.photo_path)) || null,
    unidadeOrigem: r.clinics?.name ?? null,
    unidadeOrigemId: r.clinic_id,
    unidades: (resumo?.units ?? []).map((u) => ({
      ...u,
      inativo: inativasAqui.has(u.clinicId),
      gerida:
        (session.isAdminMaster && !isTreino()) || alcance.gerirIds.has(u.clinicId),
    })),
    regime: r.contract_type,
    ativo: r.is_active,
    temAcesso,
    acessoAtivo: resumo?.loginActive ?? false,
    isAdminMaster: false,
    podeGerir,
  };
}

// -----------------------------------------------------------------------------
// A ficha de um Risartano
// -----------------------------------------------------------------------------

export type FichaDeRisartano = {
  staff: StaffMember;
  row: StaffRow;
  unidadeOrigem: string | null;
  acesso: StaffAccess | null;
  fotoUrl: string | null;
  agendas: Record<string, { weekdays: number[]; dates: string[]; note: string }>;
  podeGerir: boolean;
};

export async function carregarFicha(
  supabase: Supa,
  chave: { por: "code" | "id"; valor: string }
): Promise<FichaDeRisartano | null> {
  const { data: row } = await supabase
    .from("staff_members")
    .select(COLUNAS)
    .eq(chave.por === "code" ? "code" : "id", chave.valor)
    .maybeSingle<StaffRow>();
  if (!row) return null;

  const [acessos, fotos, { data: agendaRows }, { data: podeRpc }] =
    await Promise.all([
      carregarAcessos(supabase, row.user_id ? [row.user_id] : []),
      assinarFotos(supabase, row.photo_path ? [row.photo_path] : []),
      supabase
        .from("staff_clinic_schedule")
        .select("clinic_id, weekdays, specific_dates, note")
        .eq("staff_member_id", row.id)
        .returns<
          {
            clinic_id: string;
            weekdays: number[] | null;
            specific_dates: string[] | null;
            note: string | null;
          }[]
        >(),
      // A régua de quem edita é a MESMA do banco — não uma segunda cópia aqui.
      supabase.rpc("can_manage_staff", { p_staff_id: row.id }),
    ]);

  const acesso: StaffAccess | null = row.user_id
    ? acessos.get(row.user_id) ?? {
        userId: row.user_id,
        email: null,
        loginActive: true,
        rolesText: "",
        units: [],
        unitClinicIds: [],
      }
    : null;

  const agendas: FichaDeRisartano["agendas"] = {};
  for (const a of agendaRows ?? []) {
    agendas[a.clinic_id] = {
      weekdays: a.weekdays ?? [],
      dates: a.specific_dates ?? [],
      note: a.note ?? "",
    };
  }

  return {
    staff: paraStaff(row),
    row,
    unidadeOrigem: row.clinics?.name ?? null,
    acesso,
    fotoUrl: (row.photo_path && fotos.get(row.photo_path)) || null,
    agendas,
    podeGerir: podeRpc === true && !isTreino(),
  };
}

// -----------------------------------------------------------------------------
// O acesso, em detalhe (só o Admin edita — a guarda está nas ações)
// -----------------------------------------------------------------------------

// O tipo mora no componente que o desenha (`acesso.tsx`) para não existir em
// duas versões: `import type` some na compilação, então o "server-only" daqui
// não atravessa para o navegador.
export type { FuncaoDoAcesso } from "./acesso";

/** Funções (papel por clínica) do login, com o escopo de unidades da Franqueadora. */
export async function carregarFuncoes(
  supabase: Supa,
  userId: string
): Promise<import("./acesso").FuncaoDoAcesso[]> {
  const { data } = await supabase
    .from("user_clinic_roles")
    .select(
      "id, clinic_id, role, unit_scope, clinics ( name, type ), role_unit_access ( clinic_id )"
    )
    .eq("user_id", userId)
    .returns<
      {
        id: string;
        clinic_id: string;
        role: UserRole;
        unit_scope: UnitScope | null;
        clinics: { name: string; type: ClinicType } | null;
        role_unit_access: { clinic_id: string }[] | null;
      }[]
    >();
  return (data ?? []).map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    role: r.role,
    clinicName: r.clinics?.name ?? "—",
    clinicType: r.clinics?.type ?? "franchise_unit",
    unitScope: r.unit_scope,
    unitIds: (r.role_unit_access ?? []).map((u) => u.clinic_id),
  }));
}

/**
 * Os ambientes liberados para uma pessoa (0259). Banco sem a migração devolve
 * o padrão — a ficha continua abrindo, com os três no estado de fábrica.
 */
export async function carregarAmbientesDoUsuario(
  supabase: Supa,
  userId: string
): Promise<PermissoesDeAmbiente> {
  // No treino, os ambientes que importam são os do SISTEMA REAL, guardados na
  // cópia (0260) — os de lá dizem só quem entra no próprio treino.
  if (isTreino()) {
    const { data } = await supabase
      .from("mirror_user_map")
      .select("source_environments")
      .eq("local_id", userId)
      .maybeSingle<{ source_environments: PermissoesDeAmbiente | null }>();
    return data?.source_environments ?? {};
  }
  const { data, error } = await supabase
    .from("user_environments")
    .select("environment, allowed")
    .eq("user_id", userId)
    .returns<{ environment: Ambiente; allowed: boolean }[]>();
  if (error) return {};
  const mapa: PermissoesDeAmbiente = {};
  for (const row of data ?? []) mapa[row.environment] = row.allowed;
  return mapa;
}

/** Clínicas ativas (o Admin escolhe entre elas ao dar uma função). */
export async function carregarClinicas(
  supabase: Supa
): Promise<{ id: string; name: string; type: ClinicType }[]> {
  const { data } = await supabase
    .from("clinics")
    .select("id, name, type")
    .eq("is_active", true)
    .order("name")
    .returns<{ id: string; name: string; type: ClinicType }[]>();
  return data ?? [];
}

/** Especialidades oferecidas no formulário (lista padrão + as já marcadas). */
export async function carregarEspecialidades(
  supabase: Supa,
  jaMarcadas: string[] = []
): Promise<string[]> {
  const { data } = await supabase
    .from("specialties")
    .select("name")
    .eq("is_active", true)
    .order("sort_order")
    .returns<{ name: string }[]>();
  const ativas = (data ?? []).map((s) => s.name);
  const extras = [...new Set(jaMarcadas.map((s) => s.trim()).filter(Boolean))]
    .filter((s) => !ativas.includes(s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...ativas, ...extras];
}
