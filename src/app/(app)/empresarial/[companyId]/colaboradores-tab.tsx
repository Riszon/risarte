"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, FileUp, PiggyBank, Plus, UserPlus } from "lucide-react";
import { formatCpf, formatPhone } from "@/lib/masks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEPENDENT_PLANS,
  DEPENDENT_PLAN_LABELS,
  LEFT_REASONS,
  LEFT_REASON_LABELS,
  RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type Relationship,
} from "@/lib/empresarial/constants";
import {
  addDependent,
  completeEmployee,
  createEmployee,
  deleteEmployee,
  restoreEmployee,
  importEmployees,
  linkDependent,
  removeDependent,
  setEmployeeStatus,
  updateDependent,
  updateEmployee,
  lookupClientByCpf,
  type DependentImportRow,
  type EmployeeImportRow,
  type EmpresarialCandidate,
} from "./employee-actions";
import {
  EmployeeDocumentPicker,
  EmployeeFilesDialog,
  type EmployeeFileView,
} from "./employee-files-dialog";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/** Situação do colaborador nas listas e no relatório (padrão: ativos). */
export const EMPLOYEE_FILTERS = [
  "ACTIVE",
  "INACTIVE",
  "DELETED",
  "ALL",
] as const;
export type EmployeeFilter = (typeof EMPLOYEE_FILTERS)[number];
export const EMPLOYEE_FILTER_LABELS: Record<EmployeeFilter, string> = {
  ACTIVE: "Ativos",
  INACTIVE: "Inativos",
  DELETED: "Excluídos",
  ALL: "Todos",
};

export type DependentView = {
  id: string;
  cpf: string;
  fullName: string | null;
  phone: string | null;
  relationship: Relationship;
  status: "ACTIVE" | "INACTIVE";
  clientId: string | null;
};

export type EmployeeView = {
  id: string;
  cpf: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: "ACTIVE" | "INACTIVE" | "DELETED";
  registrationStage: "PRE_REGISTERED" | "COMPLETED";
  dependentPlan: string;
  clientId: string | null;
  dependents: DependentView[];
  /** CNPJ (documento) da empresa a que este colaborador pertence. */
  companyDocumentId?: string | null;
};

type Unit = { id: string; name: string };

export function ColaboradoresTab({
  companyId,
  employees,
  units,
  canManage,
  canViewBenefitsReport = false,
  companyDocuments = [],
  employeeFiles = [],
}: {
  companyId: string;
  employees: EmployeeView[];
  units: Unit[];
  canManage: boolean;
  /** Extrato de benefícios: gestão só (tem dado clínico por pessoa — LGPD). */
  canViewBenefitsReport?: boolean;
  /** Documentos (CNPJs) da empresa — o seletor só aparece se houver mais de um. */
  companyDocuments?: { id: string; label: string }[];
  /** Arquivos dos colaboradores/dependentes desta empresa. */
  employeeFiles?: EmployeeFileView[];
}) {
  // Padrão: só os ATIVOS (decisão do dono). Excluídos ficam fora até pedir.
  const [statusFilter, setStatusFilter] = useState<EmployeeFilter>("ACTIVE");
  const shown = employees.filter((e) =>
    statusFilter === "ALL" ? true : e.status === statusFilter
  );
  const countBy = (s: EmployeeFilter) =>
    s === "ALL"
      ? employees.length
      : employees.filter((e) => e.status === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canManage && <EmployeeFormDialog companyId={companyId} />}
        <div className="flex flex-wrap items-center gap-2">
          {/* Relatório detalhado (empresa + colaboradores + dependentes). */}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/empresarial/${companyId}/relatorio`} />}
          >
            <FileText className="mr-1 size-4" />
            Relatório detalhado
          </Button>
          {canViewBenefitsReport && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/empresarial/${companyId}/relatorio-beneficios`} />
              }
            >
              <PiggyBank className="mr-1 size-4" />
              Benefícios e economia
            </Button>
          )}
          {canManage && <ImportEmployeesDialog companyId={companyId} />}
        </div>
      </div>

      {/* Filtro por situação — padrão: ativos. */}
      {employees.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {EMPLOYEE_FILTERS.map((f) => (
            <Button
              key={f}
              variant={statusFilter === f ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setStatusFilter(f)}
            >
              {EMPLOYEE_FILTER_LABELS[f]} ({countBy(f)})
            </Button>
          ))}
        </div>
      )}

      {employees.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhum colaborador cadastrado ainda.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhum colaborador {EMPLOYEE_FILTER_LABELS[statusFilter].toLowerCase()}.
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((e) => (
            <EmployeeRow
              key={e.id}
              companyId={companyId}
              employee={e}
              units={units}
              canManage={canManage}
              companyDocuments={companyDocuments}
              employeeFiles={employeeFiles}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeRow({
  companyId,
  employee,
  units,
  canManage,
  companyDocuments = [],
  employeeFiles = [],
}: {
  companyId: string;
  employee: EmployeeView;
  units: Unit[];
  canManage: boolean;
  companyDocuments?: { id: string; label: string }[];
  employeeFiles?: EmployeeFileView[];
}) {
  const [expanded, setExpanded] = useState(false);
  const activeDeps = employee.dependents.filter((d) => d.status === "ACTIVE");
  const myFiles = employeeFiles.filter((f) => f.employeeId === employee.id);

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {employee.fullName}
            {employee.status === "DELETED" ? (
              <Badge variant="destructive">Excluído</Badge>
            ) : employee.status === "INACTIVE" ? (
              <Badge variant="outline">Inativo</Badge>
            ) : employee.registrationStage === "COMPLETED" ? (
              <Badge className="bg-gold/20 text-gold-foreground">
                ★ Cliente vinculado
              </Badge>
            ) : (
              <Badge variant="secondary">Pré-cadastrado</Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCpf(employee.cpf)} · {employee.phone}
            {employee.dependentPlan !== "NONE" &&
              ` · ${DEPENDENT_PLAN_LABELS[employee.dependentPlan as keyof typeof DEPENDENT_PLAN_LABELS]}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {employee.clientId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              nativeButton={false}
              render={<Link href={`/prontuarios/${employee.clientId}`} />}
            >
              Ver ficha
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            Dependentes ({activeDeps.length})
          </Button>
          {/* CNPJ do colaborador (só quando a empresa tem mais de um). */}
          <EmployeeDocumentPicker
            companyId={companyId}
            employeeId={employee.id}
            current={employee.companyDocumentId ?? null}
            documents={companyDocuments}
          />
          <EmployeeFilesDialog
            companyId={companyId}
            employeeId={employee.id}
            employeeName={employee.fullName}
            dependents={employee.dependents.map((d) => ({
              id: d.id,
              name: d.fullName ?? "Dependente",
            }))}
            files={myFiles}
            canManage={canManage}
          />
          {canManage && employee.status === "DELETED" && (
            <RestoreButton companyId={companyId} employee={employee} />
          )}
          {canManage && employee.status !== "DELETED" && (
            <>
              {employee.registrationStage === "PRE_REGISTERED" &&
                employee.status === "ACTIVE" && (
                  <UnitPickerDialog
                    units={units}
                    trigger={
                      <Button size="sm" className="h-7 px-2 text-xs">
                        Completar cadastro
                      </Button>
                    }
                    title="Completar cadastro do colaborador"
                    hint="O colaborador vira cliente do riSZon na unidade escolhida."
                    onConfirm={(clinicId) =>
                      completeEmployee(companyId, employee.id, clinicId)
                    }
                    successMsg="Cadastro completo — cliente vinculado."
                  />
                )}
              <EmployeeFormDialog companyId={companyId} employee={employee} />
              <StatusButton companyId={companyId} employee={employee} />
              <DeleteEmployeeButton companyId={companyId} employee={employee} />
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 p-3">
          <DependentsBlock
            companyId={companyId}
            employee={employee}
            units={units}
            canManage={canManage}
          />
        </div>
      )}
    </div>
  );
}

function StatusButton({
  companyId,
  employee,
}: {
  companyId: string;
  employee: EmployeeView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("RESIGNED");

  if (employee.status === "INACTIVE") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const r = await setEmployeeStatus(companyId, employee.id, true);
            if (r.ok) {
              toast.success("Colaborador reativado.");
              router.refresh();
            } else toast.error(r.error ?? "Erro.");
          })
        }
      >
        Reativar
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            Inativar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inativar colaborador</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Bloqueia novos orçamentos/agendamentos. Tratamentos já aprovados
          seguem. Se for titular, os dependentes também saem.
        </p>
        <div>
          <Label htmlFor="reason">Motivo</Label>
          <select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={selectClass}
          >
            {LEFT_REASONS.map((r) => (
              <option key={r} value={r}>
                {LEFT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const r = await setEmployeeStatus(
                  companyId,
                  employee.id,
                  false,
                  reason
                );
                if (r.ok) {
                  toast.success("Colaborador inativado.");
                  setOpen(false);
                  router.refresh();
                } else toast.error(r.error ?? "Erro.");
              })
            }
          >
            Inativar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Excluir colaborador — exclusão lógica, com confirmação explícita. */
function DeleteEmployeeButton({
  companyId,
  employee,
}: {
  companyId: string;
  employee: EmployeeView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activeDeps = employee.dependents.filter((d) => d.status === "ACTIVE");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setOpen(true)}
      >
        Excluir
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir {employee.fullName}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            O colaborador sai das listas, das contagens e da mensalidade, e perde
            o selo do programa.
          </p>
          {activeDeps.length > 0 && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              {activeDeps.length} dependente(s) saem junto.
            </p>
          )}
          <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            O cadastro <strong>não é apagado do banco</strong>: o histórico de
            uso de benefícios, o período no programa e as cobranças precisam
            continuar existindo. Ele fica na lista de <strong>Excluídos</strong> e
            pode ser restaurado.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await deleteEmployee(companyId, employee.id);
                  if (r.ok) {
                    toast.success("Colaborador excluído.");
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              Excluir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RestoreButton({
  companyId,
  employee,
}: {
  companyId: string;
  employee: EmployeeView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await restoreEmployee(companyId, employee.id);
          if (r.ok) {
            toast.success("Colaborador restaurado (como inativo).");
            router.refresh();
          } else toast.error(r.error ?? "Erro.");
        })
      }
    >
      Restaurar
    </Button>
  );
}

function DependentsBlock({
  companyId,
  employee,
  units,
  canManage,
}: {
  companyId: string;
  employee: EmployeeView;
  units: Unit[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {employee.dependents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum dependente.</p>
      ) : (
        <ul className="space-y-1.5">
          {employee.dependents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {d.fullName || "Dependente"}{" "}
                <span className="text-xs text-muted-foreground">
                  {RELATIONSHIP_LABELS[d.relationship]} · {formatCpf(d.cpf)}
                </span>
                {d.status === "INACTIVE" && (
                  <Badge variant="outline" className="ml-1">
                    Inativo
                  </Badge>
                )}
                {d.clientId && (
                  <Badge className="ml-1 bg-gold/20 text-gold-foreground">
                    ★ vinculado
                  </Badge>
                )}
              </span>
              {canManage && d.status === "ACTIVE" && (
                <span className="flex items-center gap-1.5">
                  <DependentFormDialog
                    companyId={companyId}
                    employeeId={employee.id}
                    dependent={d}
                  />
                  {!d.clientId && (
                    <UnitPickerDialog
                      units={units}
                      trigger={
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                          Vincular cliente
                        </Button>
                      }
                      title="Vincular dependente ao riSZon"
                      hint="O dependente vira cliente na unidade escolhida."
                      onConfirm={(clinicId) =>
                        linkDependent(companyId, d.id, clinicId)
                      }
                      successMsg="Dependente vinculado."
                    />
                  )}
                  {d.clientId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      nativeButton={false}
                      render={<Link href={`/prontuarios/${d.clientId}`} />}
                    >
                      Ficha
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await removeDependent(companyId, d.id);
                        if (r.ok) {
                          toast.success("Dependente removido.");
                          router.refresh();
                        } else toast.error(r.error ?? "Erro.");
                      })
                    }
                  >
                    Remover
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && employee.status === "ACTIVE" && (
        <DependentFormDialog companyId={companyId} employeeId={employee.id} />
      )}
    </div>
  );
}

function EmployeeFormDialog({
  companyId,
  employee,
}: {
  companyId: string;
  employee?: EmployeeView;
}) {
  const router = useRouter();
  const isEdit = Boolean(employee);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // I5b: campos controlados para o autopreenchimento pelo CPF.
  const [cpf, setCpf] = useState(employee?.cpf ?? "");
  const [fullName, setFullName] = useState(employee?.fullName ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [found, setFound] = useState<EmpresarialCandidate | null>(null);

  function lookup(value: string) {
    if (isEdit) return;
    if (value.replace(/\D/g, "").length !== 11) {
      setFound(null);
      return;
    }
    startTransition(async () => {
      const r = await lookupClientByCpf(value);
      if (!r.found) {
        setFound(null);
        return;
      }
      setFound(r);
      if (r.fullName) setFullName(r.fullName);
      if (r.phone) setPhone(r.phone);
      if (r.email) setEmail(r.email);
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = isEdit
        ? await updateEmployee(companyId, employee!.id, formData)
        : await createEmployee(companyId, formData);
      if (r.ok) {
        toast.success(isEdit ? "Colaborador atualizado." : "Colaborador cadastrado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Novo colaborador
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {/* I5b: o cadastro começa pelo CPF — se a pessoa já é cliente da
              Risarte, os dados vêm sozinhos e ninguém digita duas vezes. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="cpf">CPF *</Label>
              <Input
                id="cpf"
                name="cpf"
                required
                autoFocus={!isEdit}
                placeholder="000.000.000-00"
                value={cpf}
                disabled={isEdit}
                onChange={(e) => setCpf(formatCpf(e.target.value))}
                onBlur={(e) => lookup(e.target.value)}
              />
              {found && (
                <p className="mt-1 text-xs text-emerald-700">
                  Já é cliente da Risarte
                  {found.code ? ` (${found.code})` : ""}
                  {found.clinicName ? ` · ${found.clinicName}` : ""} — dados
                  preenchidos. O código de cadastro dele é mantido.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input
                id="full_name"
                name="full_name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">Telefone *</Label>
              <Input
                id="phone"
                name="phone"
                required
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Plano de dependentes</Label>
              <p className="flex h-9 items-center text-sm">
                {DEPENDENT_PLAN_LABELS[
                  (employee?.dependentPlan ?? "NONE") as keyof typeof DEPENDENT_PLAN_LABELS
                ]}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  (automático)
                </span>
              </p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Definido pela quantidade de dependentes: 1 = individual, 2 a 3 =
                familiar, 4+ = familiar com extras.
              </p>
            </div>
            <div>
              <Label htmlFor="grace_period_days">Carência (dias) — opcional</Label>
              <Input
                id="grace_period_days"
                name="grace_period_days"
                type="number"
                min={0}
                placeholder="usa a da empresa"
              />
            </div>
          </div>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              O CPF não é editável. Para trocar, remova e cadastre novamente.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DependentFormDialog({
  companyId,
  employeeId,
  dependent,
}: {
  companyId: string;
  employeeId: string;
  /** Presente = edição do dependente; ausente = novo. */
  dependent?: DependentView;
}) {
  const router = useRouter();
  const isEdit = Boolean(dependent);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // I5b: CPF primeiro + autopreenchimento (igual ao colaborador).
  const [cpf, setCpf] = useState(dependent?.cpf ?? "");
  const [fullName, setFullName] = useState(dependent?.fullName ?? "");
  const [phone, setPhone] = useState(dependent?.phone ?? "");
  const [found, setFound] = useState<EmpresarialCandidate | null>(null);

  function lookup(value: string) {
    if (isEdit) return; // Na edição não sobrescreve o que já está cadastrado.
    if (value.replace(/\D/g, "").length !== 11) {
      setFound(null);
      return;
    }
    startTransition(async () => {
      const r = await lookupClientByCpf(value);
      if (!r.found) {
        setFound(null);
        return;
      }
      setFound(r);
      if (r.fullName) setFullName(r.fullName);
      if (r.phone) setPhone(r.phone);
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = isEdit
        ? await updateDependent(companyId, dependent!.id, formData)
        : await addDependent(companyId, employeeId, formData);
      if (r.ok) {
        toast.success(isEdit ? "Dependente atualizado." : "Dependente adicionado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
              Editar
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
              <UserPlus className="mr-1 size-3.5" />
              Adicionar dependente
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar dependente" : "Novo dependente"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {/* I5b: dependente também começa pelo CPF, com autopreenchimento. */}
          <div>
            <Label htmlFor="dep_cpf">CPF *</Label>
            <Input
              id="dep_cpf"
              name="cpf"
              required
              autoFocus
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(formatCpf(e.target.value))}
              onBlur={(e) => lookup(e.target.value)}
            />
            {found && (
              <p className="mt-1 text-xs text-emerald-700">
                Já é cliente da Risarte
                {found.code ? ` (${found.code})` : ""} — dados preenchidos.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="dep_full_name">Nome</Label>
            <Input
              id="dep_full_name"
              name="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dep_relationship">Parentesco *</Label>
              <select
                id="dep_relationship"
                name="relationship"
                required
                className={selectClass}
                defaultValue={dependent?.relationship ?? ""}
              >
                <option value="">Selecione...</option>
                {RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>
                    {RELATIONSHIP_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="dep_phone">Telefone</Label>
            <Input
              id="dep_phone"
              name="phone"
              placeholder="(00) 00000-0000"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Salvar" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Diálogo genérico que pede a unidade e chama a ação (completar/vincular). */
function UnitPickerDialog({
  units,
  trigger,
  title,
  hint,
  onConfirm,
  successMsg,
}: {
  units: Unit[];
  trigger: React.ReactNode;
  title: string;
  hint: string;
  onConfirm: (clinicId: string) => Promise<{ ok: boolean; error?: string }>;
  successMsg: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [clinicId, setClinicId] = useState(units.length === 1 ? units[0].id : "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <div>
          <Label htmlFor="unit_pick">Unidade *</Label>
          <select
            id="unit_pick"
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
            className={selectClass}
          >
            <option value="">Selecione...</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || !clinicId}
            onClick={() =>
              startTransition(async () => {
                const r = await onConfirm(clinicId);
                if (r.ok) {
                  toast.success(successMsg);
                  setOpen(false);
                  router.refresh();
                } else toast.error(r.error ?? "Erro.");
              })
            }
          >
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const PLAN_BY_LABEL = new Map<string, string>(
  DEPENDENT_PLANS.map((p) => [norm(DEPENDENT_PLAN_LABELS[p]), p])
);
/** I5b: "Cônjuge" → SPOUSE etc. (aceita o rótulo em pt-BR ou a chave). */
// Parentesco na planilha: aceita o rótulo oficial, o valor do enum e as formas
// que as pessoas realmente escrevem ("esposa", "filho", "mãe"...). Antes só o
// rótulo exato passava e a linha era descartada em silêncio.
const RELATIONSHIP_SYNONYMS: Record<string, string> = {
  esposa: "SPOUSE",
  esposo: "SPOUSE",
  marido: "SPOUSE",
  mulher: "SPOUSE",
  companheiro: "SPOUSE",
  companheira: "SPOUSE",
  "companheiro(a)": "SPOUSE",
  conjuge: "SPOUSE",
  parceiro: "SPOUSE",
  parceira: "SPOUSE",
  filho: "CHILD",
  filha: "CHILD",
  filhos: "CHILD",
  enteado: "CHILD",
  enteada: "CHILD",
  dependente: "CHILD",
  pai: "PARENT",
  mae: "PARENT",
  genitor: "PARENT",
  genitora: "PARENT",
  sogro: "OTHER",
  sogra: "OTHER",
  irmao: "OTHER",
  irma: "OTHER",
  neto: "OTHER",
  neta: "OTHER",
  avo: "OTHER",
  outros: "OTHER",
};

const RELATIONSHIP_BY_LABEL = new Map<string, string>([
  ...RELATIONSHIPS.map(
    (r) => [norm(RELATIONSHIP_LABELS[r]), r] as [string, string]
  ),
  ...RELATIONSHIPS.map((r) => [norm(r), r] as [string, string]),
  ...Object.entries(RELATIONSHIP_SYNONYMS).map(
    ([k, v]) => [norm(k), v] as [string, string]
  ),
]);

function ImportEmployeesDialog({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<EmployeeImportRow[]>([]);
  // I5b: dependentes lidos da 2ª aba da planilha.
  const [depRows, setDepRows] = useState<DependentImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    try {
      const XLSX = await import("xlsx");
      const headers = ["Nome", "CPF", "Telefone", "E-mail", "Plano de Dependentes"];
      const examples = [
        ["Maria Silva", "111.111.111-11", "(43) 99999-0000", "maria@empresa.com", "Sem dependentes"],
        ["João Souza", "222.222.222-22", "(43) 98888-0000", "", "Dependente familiar"],
      ];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
      ws["!cols"] = headers.map((h) => ({ wch: Math.max(16, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");

      // I5b: 2ª aba para já trazer os dependentes, ligados pelo CPF do titular.
      const depHeaders = [
        "CPF do Titular",
        "CPF do Dependente",
        "Nome",
        "Parentesco",
        "Telefone",
      ];
      const depExamples = [
        ["222.222.222-22", "333.333.333-33", "Ana Souza", "Cônjuge", "(43) 97777-0000"],
        ["222.222.222-22", "444.444.444-44", "Pedro Souza", "Filho(a)", ""],
      ];
      const depWs = XLSX.utils.aoa_to_sheet([depHeaders, ...depExamples]);
      depWs["!cols"] = depHeaders.map((h) => ({ wch: Math.max(18, h.length + 2) }));
      XLSX.utils.book_append_sheet(wb, depWs, "Dependentes");

      XLSX.writeFile(wb, "modelo-colaboradores.xlsx");
    } catch {
      toast.error("Não foi possível gerar o modelo.");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
      });

      // I5b: aba "Dependentes" (opcional), ligada pelo CPF do titular.
      const depSheetName = wb.SheetNames.find((n) => norm(n).startsWith("depend"));
      const depJson = depSheetName
        ? XLSX.utils.sheet_to_json<Record<string, unknown>>(
            wb.Sheets[depSheetName],
            { defval: "" }
          )
        : [];
      const mappedDeps: DependentImportRow[] = depJson
        .map((obj) => {
          const m: Record<string, string> = {};
          for (const k of Object.keys(obj)) m[norm(k)] = String(obj[k] ?? "").trim();
          const get = (...keys: string[]) => {
            for (const k of keys) if (m[k]) return m[k];
            return "";
          };
          const rel = get("parentesco", "grau de parentesco", "vinculo");
          return {
            holderCpf: get(
              "cpf do titular",
              "cpf titular",
              "titular",
              "cpf do colaborador",
              "cpf colaborador"
            ),
            cpf: get(
              "cpf do dependente",
              "cpf dependente",
              "cpf",
              "documento"
            ),
            fullName: get("nome", "nome completo", "nome do dependente"),
            // Parentesco não reconhecido não descarta a linha: entra como "Outro".
            relationship: RELATIONSHIP_BY_LABEL.get(norm(rel)) ?? "OTHER",
            phone: get("telefone", "celular", "whatsapp"),
          };
        })
        .filter((d) => d.holderCpf && d.cpf);
      const depIgnored = depJson.length - mappedDeps.length;
      setDepRows(mappedDeps);
      const mapped: EmployeeImportRow[] = json
        .map((obj) => {
          const m: Record<string, string> = {};
          for (const k of Object.keys(obj)) m[norm(k)] = String(obj[k] ?? "").trim();
          const get = (...keys: string[]) => {
            for (const k of keys) if (m[k]) return m[k];
            return "";
          };
          const planLabel = get("plano de dependentes", "plano");
          return {
            fullName: get("nome", "nome completo"),
            cpf: get("cpf"),
            phone: get("telefone", "whatsapp", "celular"),
            email: get("e-mail", "email"),
            dependentPlan: planLabel
              ? PLAN_BY_LABEL.get(norm(planLabel)) ?? "NONE"
              : "NONE",
          };
        })
        .filter((r) => r.fullName && r.cpf);
      setRows(mapped);
      if (mapped.length === 0) toast.error("Nenhuma linha válida (confira Nome e CPF).");
      // Sem a aba de dependentes o usuário achava que a planilha "não trouxe".
      if (!depSheetName && mapped.length > 0) {
        toast.info(
          "A planilha não tem a aba “Dependentes” — só os titulares foram lidos. Baixe o Modelo para incluir dependentes."
        );
      } else if (depIgnored > 0) {
        toast.warning(
          `${depIgnored} dependente(s) ignorado(s): confira as colunas “CPF do Titular” e “CPF do Dependente”.`
        );
      }
    } catch {
      toast.error("Não foi possível ler a planilha.");
      setRows([]);
      setDepRows([]);
    }
  }

  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <FileUp className="mr-1 size-4" />
            Importar Excel
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar colaboradores (Excel)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Aba <strong>Colaboradores</strong>: Nome, CPF, Telefone, E-mail,
              Plano de Dependentes. Aba <strong>Dependentes</strong> (opcional):
              CPF do Titular, CPF do Dependente, Nome, Parentesco, Telefone.
            </p>
            <Button size="sm" variant="outline" onClick={downloadTemplate}>
              <Download className="mr-1 size-4" />
              Modelo
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-1 size-4" />
            Escolher planilha
          </Button>
          {fileName && (
            <p className="text-sm text-muted-foreground">
              {fileName} — {rows.length} colaborador(es)
              {depRows.length > 0 && ` · ${depRows.length} dependente(s)`} lido(s)
            </p>
          )}
          {rows.length > 0 && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await importEmployees(companyId, rows, depRows);
                  if (r.ok) {
                    toast.success(
                      `Importados: ${r.inserted ?? 0} colaborador(es)` +
                        (r.dependentsInserted
                          ? ` · ${r.dependentsInserted} dependente(s)`
                          : "") +
                        (r.errors ? ` · ${r.errors} ignorado(s)` : "")
                    );
                    setRows([]);
                    setDepRows([]);
                    setFileName("");
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error ?? "Erro.");
                })
              }
            >
              {isPending ? "Importando..." : `Importar ${rows.length}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
