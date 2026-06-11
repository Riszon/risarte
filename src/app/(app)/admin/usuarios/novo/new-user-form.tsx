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
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/lib/roles";
import { createUser, type RoleAssignment } from "../actions";

type ClinicOption = { id: string; name: string };

const ROLE_ITEMS = USER_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function NewUserForm({ clinics }: { clinics: ClinicOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);

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
    setAssignments((prev) => [
      ...prev,
      { clinicId: available[0].id, role: "receptionist" },
    ]);
  }

  function updateAssignment(index: number, patch: Partial<RoleAssignment>) {
    setAssignments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a))
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
            return (
              <div key={index} className="flex items-end gap-2">
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
                      <SelectValue />
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
                    items={ROLE_ITEMS}
                    value={assignment.role}
                    onValueChange={(v) =>
                      v !== null &&
                      updateAssignment(index, { role: v as UserRole })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_ITEMS.map((item) => (
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
