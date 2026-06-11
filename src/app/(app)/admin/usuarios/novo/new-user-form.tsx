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

export function NewUserForm({ clinics }: { clinics: ClinicOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);

  function addAssignment() {
    if (clinics.length === 0) {
      toast.error("Cadastre uma clínica antes de atribuir papéis.");
      return;
    }
    setAssignments((prev) => [
      ...prev,
      { clinicId: clinics[0].id, role: "receptionist" },
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
                minLength={12}
                placeholder="Mín. 12 caracteres, letras e números"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Papéis por clínica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {assignments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum papel atribuído ainda.
            </p>
          )}
          {assignments.map((assignment, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                {index === 0 && <Label className="text-xs">Clínica</Label>}
                <Select
                  value={assignment.clinicId}
                  onValueChange={(v) =>
                    v !== null && updateAssignment(index, { clinicId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clinics.map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                {index === 0 && <Label className="text-xs">Papel</Label>}
                <Select
                  value={assignment.role}
                  onValueChange={(v) =>
                    updateAssignment(index, { role: v as UserRole })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
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
                aria-label="Remover papel"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addAssignment}>
            Adicionar papel
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
