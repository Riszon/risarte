"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  addUserRole,
  removeUserRole,
  resetUserPassword,
  setUserActive,
  updateUserName,
} from "../actions";

type Props = {
  profile: {
    id: string;
    full_name: string;
    email: string | null;
    is_admin_master: boolean;
    is_active: boolean;
  };
  roles: { id: string; clinicId: string; role: UserRole; clinicName: string }[];
  clinics: { id: string; name: string }[];
  isSelf: boolean;
};

const ROLE_ITEMS = USER_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function UserEditor({ profile, roles, clinics, isSelf }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // A user holds ONE role per clinic: only clinics without a role can be added.
  const availableClinics = clinics.filter(
    (c) => !roles.some((r) => r.clinicId === c.id)
  );
  const clinicItems = availableClinics.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const [newClinicId, setNewClinicId] = useState(availableClinics[0]?.id ?? "");
  const [newRole, setNewRole] = useState<UserRole>("receptionist");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successMessage);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              run(() => updateUserName(profile.id, formData), "Nome atualizado.");
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="full_name">Nome completo</Label>
              <Input
                id="full_name"
                name="full_name"
                defaultValue={profile.full_name}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={isPending}>
              Salvar
            </Button>
          </form>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Status</p>
              <p className="text-xs text-muted-foreground">
                Usuários inativos não conseguem entrar no sistema.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {profile.is_active ? (
                <Badge variant="secondary">Ativo</Badge>
              ) : (
                <Badge variant="destructive">Inativo</Badge>
              )}
              {!isSelf && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => setUserActive(profile.id, !profile.is_active),
                      profile.is_active
                        ? "Usuário desativado."
                        : "Usuário reativado."
                    )
                  }
                >
                  {profile.is_active ? "Desativar" : "Reativar"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redefinir senha</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              startTransition(async () => {
                const result = await resetUserPassword(profile.id, formData);
                if (result.ok) {
                  toast.success("Senha redefinida.");
                  form.reset();
                } else {
                  toast.error(result.error ?? "Algo deu errado.");
                }
              });
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="password">Nova senha provisória</Label>
              <Input
                id="password"
                name="password"
                type="text"
                required
                minLength={6}
                placeholder="Mín. 6 caracteres, letras e números"
              />
            </div>
            <Button type="submit" variant="outline" disabled={isPending}>
              Redefinir
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Função por Clínica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma função atribuída.
            </p>
          )}
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div>
                <p className="text-sm font-medium">{role.clinicName}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[role.role]}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={isPending}
                aria-label="Remover função"
                onClick={() =>
                  run(
                    () => removeUserRole(role.id, profile.id),
                    "Função removida."
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          {availableClinics.length > 0 ? (
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Clínica</Label>
                <Select
                  items={clinicItems}
                  value={newClinicId}
                  onValueChange={(v) => v !== null && setNewClinicId(v)}
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
                <Label className="text-xs">Função</Label>
                <Select
                  items={ROLE_ITEMS}
                  value={newRole}
                  onValueChange={(v) => v !== null && setNewRole(v as UserRole)}
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
                variant="outline"
                disabled={isPending || !newClinicId}
                onClick={() =>
                  run(
                    () => addUserRole(profile.id, newClinicId, newRole),
                    "Função atribuída."
                  )
                }
              >
                Adicionar
              </Button>
            </div>
          ) : (
            roles.length > 0 && (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Este usuário já tem função em todas as clínicas. Para trocar a
                função de uma clínica, remova a atual e adicione a nova.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
