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
  staffDisplayName,
  type ContractType,
  type StaffMember,
} from "@/lib/staff";
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
  };
}

export default async function RisartanosPage(props: PageProps<"/risartanos">) {
  const session = await getSessionContext();

  const allRoles = Object.values(session.rolesByClinic).flat();
  const isManagerOrStaff = allRoles.some((r) =>
    ["unit_manager", "franchisor_staff"].includes(r)
  );
  const isFranchisee = allRoles.includes("franchisee");
  if (!session.isAdminMaster && !isManagerOrStaff && !isFranchisee) {
    redirect("/");
  }
  // Quem só visualiza (franqueado): sem cadastrar/editar.
  const canManage = session.isAdminMaster || isManagerOrStaff;

  const scopeIds = session.isAdminMaster ? null : await fullAccessClinicIds();
  if (scopeIds !== null && scopeIds.length === 0) redirect("/");

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

  let staffQuery = supabase
    .from("staff_members")
    .select(
      "id, clinic_id, code, full_name, preferred_name, cpf, birth_date, gender, marital_status, spouse_name, spouse_phone, whatsapp, email, zip_code, address, address_number, complement, neighborhood, city, state, contract_type, role_title, photo_path, notes, is_active, clinics ( name )"
    )
    .order("full_name")
    .limit(2000);
  if (scopeIds) staffQuery = staffQuery.in("clinic_id", scopeIds);
  if (unidade) staffQuery = staffQuery.eq("clinic_id", unidade);
  if (contrato) staffQuery = staffQuery.eq("contract_type", contrato);
  if (ativo === "ativos") staffQuery = staffQuery.eq("is_active", true);
  else if (ativo === "inativos") staffQuery = staffQuery.eq("is_active", false);

  const [{ data: units }, { data: staffRows }] = await Promise.all([
    unitsQuery,
    staffQuery.returns<StaffRow[]>(),
  ]);

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
        {canManage && unitOptions.length > 0 && (
          <StaffFormDialog units={unitOptions} />
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
            Colaboradores ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum Risartano encontrado.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Código</th>
                  <th className="px-2 py-1.5 font-medium">Nome</th>
                  <th className="px-2 py-1.5 font-medium">Cargo</th>
                  <th className="px-2 py-1.5 font-medium">Regime</th>
                  <th className="px-2 py-1.5 font-medium">Unidade</th>
                  <th className="px-2 py-1.5 font-medium">Situação</th>
                  {canManage && <th className="px-2 py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = toStaff(r);
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-1.5 font-mono text-xs text-gold">
                        {r.code ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{staffDisplayName(s)}</span>
                        {r.preferred_name && (
                          <span className="block text-xs text-muted-foreground">
                            {r.full_name}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.role_title ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.contract_type
                          ? CONTRACT_LABELS[r.contract_type as ContractType]
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.clinics?.name ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.is_active ? (
                          <Badge variant="secondary">Ativo</Badge>
                        ) : (
                          <Badge variant="outline">Inativo</Badge>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-2 py-1.5 text-right">
                          <StaffFormDialog units={unitOptions} staff={s} />
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
