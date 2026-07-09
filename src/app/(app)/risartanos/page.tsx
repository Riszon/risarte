import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fullAccessClinicIds, getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FilterForm } from "@/components/filter-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CONTRACT_LABELS,
  CONTRACT_TYPES,
  STAFF_PHOTO_BUCKET,
  staffDisplayName,
  type ContractType,
  type StaffAccess,
  type StaffMember,
} from "@/lib/staff";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { StaffFormDialog } from "./staff-form-dialog";

export const metadata: Metadata = { title: "Risartanos" };

type StaffRow = {
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

function toStaff(r: StaffRow): StaffMember {
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

export default async function RisartanosPage(props: PageProps<"/risartanos">) {
  const session = await getSessionContext();

  const allRoles = Object.values(session.rolesByClinic).flat();
  const isRH = allRoles.includes("franchisor_staff");
  const canView =
    session.isAdminMaster ||
    isRH ||
    allRoles.some((r) => ["unit_manager", "franchisee"].includes(r));
  if (!canView) redirect("/");

  const scopeIds = session.isAdminMaster ? null : await fullAccessClinicIds();
  if (scopeIds !== null && scopeIds.length === 0) redirect("/");

  // Onde este usuário pode CADASTRAR/EDITAR: Gerente/Franqueado na sua unidade +
  // Franqueadora/RH nas unidades do escopo. Admin gere tudo.
  const manageClinicIds = new Set<string>();
  for (const [cid, rs] of Object.entries(session.rolesByClinic)) {
    if (rs.some((r) => r === "unit_manager" || r === "franchisee")) {
      manageClinicIds.add(cid);
    }
  }
  if (isRH) for (const id of scopeIds ?? []) manageClinicIds.add(id);

  // Admin e Franqueadora/RH escolhem a unidade ao cadastrar; Gerente/Franqueado
  // cadastram só na unidade ativa (a que estão logados).
  const canPickUnit = session.isAdminMaster || isRH;
  const activeClinicId = session.activeClinic?.id ?? null;
  const activeClinicName = session.activeClinic?.name ?? null;
  const canCreate =
    session.isAdminMaster ||
    isRH ||
    (activeClinicId != null &&
      (session.rolesByClinic[activeClinicId] ?? []).some(
        (r) => r === "unit_manager" || r === "franchisee"
      ));
  const canManageAny = session.isAdminMaster || manageClinicIds.size > 0;

  const searchParams = await props.searchParams;
  const busca = typeof searchParams.busca === "string" ? searchParams.busca : "";
  const unidade =
    typeof searchParams.unidade === "string" ? searchParams.unidade : "";
  const contrato = CONTRACT_TYPES.includes(searchParams.contrato as ContractType)
    ? (searchParams.contrato as ContractType)
    : "";
  const ativo =
    typeof searchParams.ativo === "string" ? searchParams.ativo : "ativos";

  const supabase = await createClient();

  let unitsQuery = supabase
    .from("clinics")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (scopeIds) unitsQuery = unitsQuery.in("id", scopeIds);

  // NÃO filtramos por clinic_id: a barreira é a RLS (`can_see_staff`), que já
  // mostra o Risartano a quem gere QUALQUER unidade onde ele tem acesso. Filtrar
  // pela "unidade de origem" aqui escondia os profissionais multi-unidade.
  let staffQuery = supabase
    .from("staff_members")
    .select(
      "id, clinic_id, code, full_name, preferred_name, cpf, birth_date, gender, marital_status, spouse_name, spouse_phone, whatsapp, email, zip_code, address, address_number, complement, neighborhood, city, state, contract_type, role_title, photo_path, notes, is_active, user_id, inactive_unit_ids, specialties, clinics ( name )"
    )
    .order("full_name")
    .limit(2000);
  if (contrato) staffQuery = staffQuery.eq("contract_type", contrato);
  if (ativo === "ativos") staffQuery = staffQuery.eq("is_active", true);
  else if (ativo === "inativos") staffQuery = staffQuery.eq("is_active", false);

  const [{ data: units }, { data: staffRows }, { data: specRows }] =
    await Promise.all([
      unitsQuery,
      staffQuery.returns<StaffRow[]>(),
      // H4.5 Lote 3: lista de especialidades (dos procedimentos ativos) para
      // marcar no cadastro do Risartano.
      supabase
        .from("procedures")
        .select("specialty")
        .eq("is_active", true)
        .not("specialty", "is", null)
        .returns<{ specialty: string | null }[]>(),
    ]);
  const specialtyOptions = [
    ...new Set(
      (specRows ?? [])
        .map((s) => (s.specialty ?? "").trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const term = busca.trim().toLowerCase();
  const rows = (staffRows ?? []).filter((r) => {
    if (!term) return true;
    return (
      r.full_name.toLowerCase().includes(term) ||
      (r.preferred_name ?? "").toLowerCase().includes(term) ||
      (r.cpf ?? "").includes(term) ||
      (r.code ?? "").toLowerCase().includes(term)
    );
  });

  const unitOptions = (units ?? []).map((u) => ({ id: u.id, name: u.name }));

  // H4.1 Lote 1b: URLs assinadas das fotos (bucket privado).
  const photoUrls = new Map<string, string>();
  const photoPaths = rows
    .filter((r) => r.photo_path)
    .map((r) => r.photo_path as string);
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(STAFF_PHOTO_BUCKET)
      .createSignedUrls(photoPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) photoUrls.set(s.path, s.signedUrl);
    }
  }

  // H4.1 Lote 2b: resumo do acesso (login) dos colaboradores vinculados. O RLS
  // pode esconder perfis de outras unidades — nesses casos mostramos só "com
  // acesso", sem e-mail/funções.
  const accessByUser = new Map<string, StaffAccess>();
  const linkedUserIds = [
    ...new Set(rows.filter((r) => r.user_id).map((r) => r.user_id as string)),
  ];
  if (linkedUserIds.length > 0) {
    const [{ data: profs }, { data: roleRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, is_active, is_admin_master")
        .in("id", linkedUserIds),
      supabase
        .from("user_clinic_roles")
        .select("user_id, role, clinic_id, clinics ( name )")
        .in("user_id", linkedUserIds)
        .returns<
          {
            user_id: string;
            role: UserRole;
            clinic_id: string;
            clinics: { name: string } | null;
          }[]
        >(),
    ]);
    const unitsByUser = new Map<
      string,
      { clinicName: string; roleLabel: string; clinicId: string }[]
    >();
    for (const rr of roleRows ?? []) {
      const list = unitsByUser.get(rr.user_id) ?? [];
      list.push({
        clinicName: rr.clinics?.name ?? "—",
        roleLabel: ROLE_LABELS[rr.role],
        clinicId: rr.clinic_id,
      });
      unitsByUser.set(rr.user_id, list);
    }
    for (const p of profs ?? []) {
      const units = unitsByUser.get(p.id) ?? [];
      const parts = units.map((u) => `${u.roleLabel} · ${u.clinicName}`);
      if (p.is_admin_master) parts.unshift("Admin Master");
      accessByUser.set(p.id, {
        userId: p.id,
        email: p.email,
        loginActive: p.is_active,
        rolesText: parts.join(", "),
        units: units.map((u) => ({
          clinicId: u.clinicId,
          clinicName: u.clinicName,
          roleLabel: u.roleLabel,
        })),
        unitClinicIds: units.map((u) => u.clinicId),
      });
    }
  }

  // Admin: usuários disponíveis para o vínculo manual (e-mails diferentes).
  let linkableUsers: { id: string; label: string }[] = [];
  if (session.isAdminMaster) {
    const { data: allUsers } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name");
    linkableUsers = (allUsers ?? []).map((u) => ({
      id: u.id,
      label: `${u.full_name || u.email || "—"}${u.email ? ` (${u.email})` : ""}`,
    }));
  }

  // Filtro por unidade escolhida no seletor: a unidade de origem OU uma unidade
  // onde o Risartano tem acesso (multi-unidade).
  const shownRows = unidade
    ? rows.filter(
        (r) =>
          r.clinic_id === unidade ||
          (r.user_id &&
            (accessByUser.get(r.user_id)?.unitClinicIds ?? []).includes(unidade))
      )
    : rows;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Risartanos</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro dos colaboradores da{" "}
            {scopeIds && scopeIds.length === 1 ? "unidade" : "rede"}.
          </p>
        </div>
        {canCreate && (canPickUnit ? unitOptions.length > 0 : !!activeClinicId) && (
          <StaffFormDialog
            units={unitOptions}
            canPickUnit={canPickUnit}
            activeClinicName={activeClinicName}
            isAdmin={session.isAdminMaster}
            linkableUsers={linkableUsers}
            specialtyOptions={specialtyOptions}
          />
        )}
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <Input
          name="busca"
          defaultValue={busca}
          placeholder="Buscar por nome, CPF ou código..."
          className="h-9 w-64"
        />
        {unitOptions.length > 1 && (
          <select
            name="unidade"
            defaultValue={unidade}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Todas as unidades</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select
          name="contrato"
          defaultValue={contrato}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Todos os regimes</option>
          {CONTRACT_TYPES.map((c) => (
            <option key={c} value={c}>
              {CONTRACT_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          name="ativo"
          defaultValue={ativo}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </FilterForm>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Colaboradores ({shownRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {shownRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum Risartano encontrado.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Código</th>
                  <th className="px-2 py-1.5 font-medium">Nome</th>
                  <th className="px-2 py-1.5 font-medium">Unidades e situação</th>
                  <th className="px-2 py-1.5 font-medium">Regime</th>
                  <th className="px-2 py-1.5 font-medium">Acesso</th>
                  {canManageAny && <th className="px-2 py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => {
                  const s = toStaff(r);
                  const access = r.user_id
                    ? accessByUser.get(r.user_id) ?? {
                        userId: r.user_id,
                        email: null,
                        loginActive: true,
                        rolesText: "",
                        units: [],
                        unitClinicIds: [],
                      }
                    : null;
                  const accessUnits = access?.units ?? [];
                  const inactiveSet = new Set(r.inactive_unit_ids ?? []);
                  const canManageRow =
                    session.isAdminMaster ||
                    manageClinicIds.has(r.clinic_id) ||
                    (access?.unitClinicIds ?? []).some((id) =>
                      manageClinicIds.has(id)
                    );
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-1.5 font-mono text-xs text-gold">
                        {r.code ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-2">
                          {r.photo_path && photoUrls.get(r.photo_path) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photoUrls.get(r.photo_path)}
                              alt=""
                              className="size-8 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                              {staffDisplayName(s).slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {staffDisplayName(s)}
                            </span>
                            {r.preferred_name && (
                              <span className="block text-xs text-muted-foreground">
                                {r.full_name}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {accessUnits.length > 0 ? (
                          <ul className="space-y-0.5">
                            {accessUnits.map((u) => {
                              const managed =
                                session.isAdminMaster ||
                                manageClinicIds.has(u.clinicId);
                              const unitInactive = inactiveSet.has(u.clinicId);
                              return (
                                <li
                                  key={u.clinicId}
                                  className="flex flex-wrap items-center gap-1.5"
                                >
                                  <span
                                    className={
                                      managed
                                        ? "font-medium"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {u.clinicName}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    · {u.roleLabel}
                                  </span>
                                  {managed ? (
                                    unitInactive ? (
                                      <Badge variant="outline">Inativo</Badge>
                                    ) : (
                                      <Badge variant="secondary">Ativo</Badge>
                                    )
                                  ) : (
                                    <span className="text-xs italic text-muted-foreground">
                                      (outra unidade{unitInactive ? " · inativo" : ""})
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span>{r.clinics?.name ?? "—"}</span>
                            {r.is_active ? (
                              <Badge variant="secondary">Ativo</Badge>
                            ) : (
                              <Badge variant="outline">Inativo</Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.contract_type
                          ? CONTRACT_LABELS[r.contract_type as ContractType]
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {!access ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Sem acesso ao sistema"
                          >
                            Sem acesso
                          </span>
                        ) : !r.is_active && access.loginActive ? (
                          <Badge
                            variant="destructive"
                            title="Colaborador inativo, mas o login ainda está ativo"
                          >
                            Login ainda ativo
                          </Badge>
                        ) : !access.loginActive ? (
                          <Badge variant="outline">Acesso desativado</Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            title={access.rolesText || access.email || undefined}
                          >
                            ✓ Com acesso
                          </Badge>
                        )}
                      </td>
                      {canManageAny && (
                        <td className="px-2 py-1.5 text-right">
                          {canManageRow && (
                            <StaffFormDialog
                              units={unitOptions}
                              staff={s}
                              photoUrl={
                                r.photo_path
                                  ? photoUrls.get(r.photo_path)
                                  : undefined
                              }
                              access={access}
                              isAdmin={session.isAdminMaster}
                              linkableUsers={linkableUsers}
                              manageClinicIds={Array.from(manageClinicIds)}
                              specialtyOptions={specialtyOptions}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
