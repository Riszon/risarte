"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileUp, Plus, UserPlus } from "lucide-react";
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
  importEmployees,
  linkDependent,
  removeDependent,
  setEmployeeStatus,
  updateEmployee,
  type EmployeeImportRow,
} from "./employee-actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

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
  status: "ACTIVE" | "INACTIVE";
  registrationStage: "PRE_REGISTERED" | "COMPLETED";
  dependentPlan: string;
  clientId: string | null;
  dependents: DependentView[];
};

type Unit = { id: string; name: string };

export function ColaboradoresTab({
  companyId,
  employees,
  units,
  canManage,
}: {
  companyId: string;
  employees: EmployeeView[];
  units: Unit[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <EmployeeFormDialog companyId={companyId} />
          <ImportEmployeesDialog companyId={companyId} />
        </div>
      )}

      {employees.length === 0 ? (
        <p className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
          Nenhum colaborador cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {employees.map((e) => (
            <EmployeeRow
              key={e.id}
              companyId={companyId}
              employee={e}
              units={units}
              canManage={canManage}
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
}: {
  companyId: string;
  employee: EmployeeView;
  units: Unit[];
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeDeps = employee.dependents.filter((d) => d.status === "ACTIVE");

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {employee.fullName}
            {employee.status === "INACTIVE" ? (
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
          {canManage && (
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" name="full_name" required defaultValue={employee?.fullName ?? ""} />
            </div>
            <div>
              <Label htmlFor="cpf">CPF *</Label>
              <Input
                id="cpf"
                name="cpf"
                required
                placeholder="000.000.000-00"
                defaultValue={employee?.cpf ?? ""}
                disabled={isEdit}
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="phone">Telefone *</Label>
              <Input
                id="phone"
                name="phone"
                required
                placeholder="(00) 00000-0000"
                defaultValue={employee?.phone ?? ""}
                onChange={(e) => (e.target.value = formatPhone(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" defaultValue={employee?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="dependent_plan">Plano de dependentes</Label>
              <select
                id="dependent_plan"
                name="dependent_plan"
                defaultValue={employee?.dependentPlan ?? "NONE"}
                className={selectClass}
              >
                {DEPENDENT_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {DEPENDENT_PLAN_LABELS[p]}
                  </option>
                ))}
              </select>
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
}: {
  companyId: string;
  employeeId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await addDependent(companyId, employeeId, formData);
      if (r.ok) {
        toast.success("Dependente adicionado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <UserPlus className="mr-1 size-3.5" />
            Adicionar dependente
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo dependente</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="dep_full_name">Nome</Label>
            <Input id="dep_full_name" name="full_name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dep_cpf">CPF *</Label>
              <Input
                id="dep_cpf"
                name="cpf"
                required
                placeholder="000.000.000-00"
                onChange={(e) => (e.target.value = formatCpf(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="dep_relationship">Parentesco *</Label>
              <select id="dep_relationship" name="relationship" required className={selectClass} defaultValue="">
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
              onChange={(e) => (e.target.value = formatPhone(e.target.value))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Adicionar
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

function ImportEmployeesDialog({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<EmployeeImportRow[]>([]);
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
    } catch {
      toast.error("Não foi possível ler a planilha.");
      setRows([]);
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
              Colunas: Nome, CPF, Telefone, E-mail, Plano de Dependentes.
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
              {fileName} — {rows.length} colaborador(es) lido(s)
            </p>
          )}
          {rows.length > 0 && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await importEmployees(companyId, rows);
                  if (r.ok) {
                    toast.success(
                      `Importados: ${r.inserted ?? 0}${r.errors ? ` · ${r.errors} ignorado(s)` : ""}.`
                    );
                    setRows([]);
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
