"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROLE_LABELS,
  rolesForClinicType,
  type ClinicType,
  type UserRole,
} from "@/lib/roles";
import { createUser, type RoleAssignment } from "../actions";
import { UnitAccessControl } from "../unit-access-control";

type ClinicOption = { id: string; name: string; type: ClinicType };

/** Roles allowed for a given clinic, as Select items. */
function roleItemsFor(type: ClinicType | undefined) {
  if (!type) return [];
  return rolesForClinicType(type).map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  }));
}

export function NewUserForm({ clinics }: { clinics: ClinicOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const franchiseUnits = clinics.filter((c) => c.type === "franchise_unit");

  function isFranchisorClinic(clinicId: string): boolean {
    return clinics.find((c) => c.id === clinicId)?.type === "franchisor";
  }

  /** Clinics not yet used by another row (a user has ONE role per clinic). */
  function availableClinics(currentIndex: number): ClinicOption[] {
    const usedElsewhere = assignments
      .filter((_, i) => i !== currentIndex)
      .map((a) => a.clinicId);
    return clinics.filter((c) => !usedElsewhere.includes(c.id));
  }

  function addAssignment() {
    const available = availableClinics(-1);
    if (clinics.length === 0) {
      toast.error("Cadastre uma clínica antes de atribuir funções.");
      return;
    }
    if (available.length === 0) {
      toast.error("Este usuário já tem função em todas as clínicas.");
      return;
    }
    const firstClinic = available[0];
    const defaultRole = rolesForClinicType(firstClinic.type)[0];
    setAssignments((prev) => [
      ...prev,
      {
        clinicId: firstClinic.id,
        role: defaultRole,
        unitScope: firstClinic.type === "franchisor" ? "all" : undefined,
        unitIds: [],
      },
    ]);
  }

  function clinicType(clinicId: string): ClinicType | undefined {
    return clinics.find((c) => c.id === clinicId)?.type;
  }

  function updateAssignment(index: number, patch: Partial<RoleAssignment>) {
    setAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== index) return a;
        const next = { ...a, ...patch };
        // If the clinic changed, fix the role and the access scope.
        if (patch.clinicId) {
          const type = clinicType(patch.clinicId) ?? "franchise_unit";
          const allowed = rolesForClinicType(type);
          if (!allowed.includes(next.role)) next.role = allowed[0];
          if (type === "franchisor") {
            next.unitScope = next.unitScope ?? "all";
            next.unitIds = next.unitIds ?? [];
          } else {
            next.unitScope = undefined;
            next.unitIds = [];
          }
        }
        return next;
      })
    );
  }

  function removeAssignment(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("assignments", JSON.stringify(assignments));

    startTransition(async () => {
      const result = await createUser(formData);
      if (result.ok) {
        toast.success("Usuário criado com sucesso.");
        router.push("/admin/usuarios");
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados de acesso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome completo *</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail *</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha provisória *</Label>
              <Input
                id="password"
                name="password"
                type="text"
                required
                minLength={6}
                placeholder="Mín. 6 caracteres, letras e números"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Função por Clínica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {assignments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma função atribuída ainda.
            </p>
          )}
          {assignments.map((assignment, index) => {
            const clinicItems = availableClinics(index).map((c) => ({
              value: c.id,
              label: c.name,
            }));
            const roleItems = roleItemsFor(clinicType(assignment.clinicId));
            const showAccess = isFranchisorClinic(assignment.clinicId);
            return (
              <div key={index} className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  {index === 0 && <Label className="text-xs">Clínica</Label>}
                  <Select
                    items={clinicItems}
                    value={assignment.clinicId}
                    onValueChange={(v) =>
                      v !== null && updateAssignment(index, { clinicId: v })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value) =>
                          clinicItems.find((i) => i.value === value)?.label ??
                          "Selecionar"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clinicItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  {index === 0 && <Label className="text-xs">Função</Label>}
                  <Select
                    items={roleItems}
                    value={assignment.role}
                    onValueChange={(v) =>
                      v !== null &&
                      updateAssignment(index, { role: v as UserRole })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value) =>
                          roleItems.find((i) => i.value === value)?.label ??
                          "Selecionar"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {roleItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAssignment(index)}
                  aria-label="Remover função"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {showAccess && (
                <UnitAccessControl
                  idPrefix={`access-${index}`}
                  units={franchiseUnits}
                  scope={assignment.unitScope ?? "all"}
                  unitIds={assignment.unitIds ?? []}
                  onChange={(scope, unitIds) =>
                    updateAssignment(index, { unitScope: scope, unitIds })
                  }
                />
              )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addAssignment}
          >
            Adicionar função
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Criando..." : "Criar usuário"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/usuarios")}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
