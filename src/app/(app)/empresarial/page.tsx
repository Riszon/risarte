import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { FilterForm } from "@/components/filter-form";
import { BarChart3, KanbanSquare, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/lib/masks";
import {
  COMPANY_STATUSES,
  COMPANY_STATUS_LABELS,
  PAYMENT_MODEL_LABELS,
  type CompanyStatus,
  type PaymentModel,
} from "@/lib/empresarial/constants";
import type { Company } from "@/lib/empresarial/types";
import { CompanyFormDialog } from "./company-form-dialog";

export const metadata: Metadata = { title: "Risarte Empresarial" };

type CompanyRow = {
  id: string;
  cnpj: string;
  legal_name: string;
  trade_name: string | null;
  state_registration: string | null;
  address: Company["address"];
  employee_count: number | null;
  status: CompanyStatus;
  payment_model: PaymentModel;
  company_subsidy_type: "PERCENT" | "AMOUNT" | null;
  company_subsidy_value: number | null;
  due_day: number;
  assigned_consultant_id: string | null;
  payment_methods: Company["paymentMethods"];
  default_max_installments: number;
  contract_started_at: string | null;
  grace_period_days: number;
  employee_grace_period_days: number;
  notes: string | null;
  created_at: string;
};

function toCompany(r: CompanyRow): Company {
  return {
    id: r.id,
    cnpj: r.cnpj,
    legalName: r.legal_name,
    tradeName: r.trade_name,
    stateRegistration: r.state_registration,
    address: r.address,
    employeeCount: r.employee_count,
    status: r.status,
    paymentModel: r.payment_model,
    companySubsidyType: r.company_subsidy_type,
    companySubsidyValue: r.company_subsidy_value,
    dueDay: r.due_day,
    assignedConsultantId: r.assigned_consultant_id,
    paymentMethods: r.payment_methods ?? [],
    defaultMaxInstallments: r.default_max_installments,
    contractStartedAt: r.contract_started_at,
    gracePeriodDays: r.grace_period_days,
    employeeGracePeriodDays: r.employee_grace_period_days,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

const STATUS_VARIANT: Record<
  CompanyStatus,
  "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "secondary",
  SUSPENDED: "destructive",
  TERMINATED: "outline",
};

export default async function EmpresarialPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  const canManage = isProgramManager(session);
  const canFunnel = canManage || isRislifeConsultant(session);

  const searchParams = await props.searchParams;
  const busca = typeof searchParams.busca === "string" ? searchParams.busca : "";
  const situacao =
    typeof searchParams.situacao === "string" ? searchParams.situacao : "";

  const db = await empresarialDb();
  let query = db
    .from("companies")
    .select(
      "id, cnpj, legal_name, trade_name, state_registration, address, employee_count, status, payment_model, company_subsidy_type, company_subsidy_value, due_day, assigned_consultant_id, payment_methods, default_max_installments, contract_started_at, grace_period_days, employee_grace_period_days, notes, created_at"
    )
    .order("legal_name")
    .limit(2000);
  if (situacao && (COMPANY_STATUSES as readonly string[]).includes(situacao)) {
    query = query.eq("status", situacao);
  }

  const [{ data: companyRows }, { data: empRows }] = await Promise.all([
    query.returns<CompanyRow[]>(),
    db.from("employees").select("id, status").eq("status", "ACTIVE"),
  ]);

  // Consultores RisLife disponíveis para o seletor do formulário.
  const supabase = await createClient();
  const { data: consultantRows } = await supabase
    .from("user_clinic_roles")
    .select("user_id, profiles ( full_name, email )")
    .eq("role", "rislife_consultant")
    .returns<
      { user_id: string; profiles: { full_name: string; email: string } | null }[]
    >();
  const consultantMap = new Map<string, string>();
  for (const c of consultantRows ?? []) {
    const label = c.profiles?.full_name || c.profiles?.email || "—";
    consultantMap.set(c.user_id, label);
  }
  const consultants = [...consultantMap.entries()].map(([id, label]) => ({
    id,
    label,
  }));

  const term = busca.trim().toLowerCase();
  const rows = (companyRows ?? []).filter((r) => {
    if (!term) return true;
    return (
      r.legal_name.toLowerCase().includes(term) ||
      (r.trade_name ?? "").toLowerCase().includes(term) ||
      r.cnpj.includes(term.replace(/\D/g, ""))
    );
  });

  const total = companyRows?.length ?? 0;
  const active = (companyRows ?? []).filter((r) => r.status === "ACTIVE").length;
  const suspended = (companyRows ?? []).filter(
    (r) => r.status === "SUSPENDED"
  ).length;
  const activeEmployees = empRows?.length ?? 0;

  const kpis = [
    { label: "Empresas", value: total },
    { label: "Ativas", value: active },
    { label: "Suspensas", value: suspended },
    { label: "Colaboradores ativos", value: activeEmployees },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Risarte Empresarial
          </h1>
          <p className="text-sm text-muted-foreground">
            Empresas parceiras do programa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canFunnel && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/empresarial/funil" />}
            >
              <KanbanSquare className="mr-1 size-4" />
              Funil
            </Button>
          )}
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/empresarial/painel" />}
              >
                <BarChart3 className="mr-1 size-4" />
                Painel
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/empresarial/configuracoes" />}
              >
                <Settings className="mr-1 size-4" />
                Configurações
              </Button>
              <CompanyFormDialog consultants={consultants} />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <FilterForm className="flex flex-wrap items-center gap-2">
        <Input
          name="busca"
          defaultValue={busca}
          placeholder="Buscar por nome ou CNPJ..."
          className="h-9 w-64"
        />
        <select
          name="situacao"
          defaultValue={situacao}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Todas as situações</option>
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPANY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </FilterForm>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empresas ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma empresa encontrada.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Empresa</th>
                  <th className="px-2 py-1.5 font-medium">CNPJ</th>
                  <th className="px-2 py-1.5 font-medium">Situação</th>
                  <th className="px-2 py-1.5 font-medium">Modelo</th>
                  <th className="px-2 py-1.5 font-medium">Consultor</th>
                  {canManage && <th className="px-2 py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/empresarial/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.trade_name || r.legal_name}
                      </Link>
                      {r.trade_name && (
                        <span className="block text-xs text-muted-foreground">
                          {r.legal_name}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                      {formatCnpj(r.cnpj)}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge variant={STATUS_VARIANT[r.status]}>
                        {COMPANY_STATUS_LABELS[r.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {PAYMENT_MODEL_LABELS[r.payment_model]}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {r.assigned_consultant_id
                        ? consultantMap.get(r.assigned_consultant_id) ?? "—"
                        : "—"}
                    </td>
                    {canManage && (
                      <td className="px-2 py-1.5 text-right">
                        <CompanyFormDialog
                          company={toCompany(r)}
                          consultants={consultants}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
