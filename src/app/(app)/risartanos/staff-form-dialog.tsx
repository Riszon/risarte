"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
  CONTRACT_LABELS,
  CONTRACT_TYPES,
  GENDER_LABELS,
  GENDERS,
  MARITAL_LABELS,
  MARITAL_STATUSES,
  type StaffMember,
} from "@/lib/staff";
import { createStaffMember, updateStaffMember } from "./actions";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function StaffFormDialog({
  units,
  staff,
}: {
  units: { id: string; name: string }[];
  staff?: StaffMember;
}) {
  const router = useRouter();
  const isEdit = Boolean(staff);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = isEdit
        ? await updateStaffMember(staff!.id, formData)
        : await createStaffMember(formData);
      if (result.ok) {
        toast.success(isEdit ? "Risartano atualizado." : "Risartano cadastrado.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
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
              Novo Risartano
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Editar ${staff!.code ?? "Risartano"}`
              : "Novo Risartano"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <Label htmlFor="clinic_id">Unidade *</Label>
              <select id="clinic_id" name="clinic_id" required className={selectClass}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Dados pessoais
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="full_name">Nome completo *</Label>
              <Input id="full_name" name="full_name" required defaultValue={staff?.fullName ?? ""} />
            </div>
            <div>
              <Label htmlFor="preferred_name">Como quer ser chamado(a)</Label>
              <Input id="preferred_name" name="preferred_name" defaultValue={staff?.preferredName ?? ""} />
            </div>
            <div>
              <Label htmlFor="cpf">CPF</Label>
              <Input id="cpf" name="cpf" defaultValue={staff?.cpf ?? ""} />
            </div>
            <div>
              <Label htmlFor="birth_date">Nascimento</Label>
              <Input id="birth_date" name="birth_date" type="date" defaultValue={staff?.birthDate ?? ""} />
            </div>
            <div>
              <Label htmlFor="gender">Gênero</Label>
              <select id="gender" name="gender" defaultValue={staff?.gender ?? ""} className={selectClass}>
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="marital_status">Estado civil</Label>
              <select id="marital_status" name="marital_status" defaultValue={staff?.maritalStatus ?? ""} className={selectClass}>
                <option value="">—</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m} value={m}>
                    {MARITAL_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="spouse_name">Cônjuge — nome</Label>
              <Input id="spouse_name" name="spouse_name" defaultValue={staff?.spouseName ?? ""} />
            </div>
            <div>
              <Label htmlFor="spouse_phone">Cônjuge — telefone</Label>
              <Input id="spouse_phone" name="spouse_phone" defaultValue={staff?.spousePhone ?? ""} />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Contato
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input id="whatsapp" name="whatsapp" defaultValue={staff?.whatsapp ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" defaultValue={staff?.email ?? ""} />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Endereço
          </p>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="zip_code">CEP</Label>
              <Input id="zip_code" name="zip_code" defaultValue={staff?.zipCode ?? ""} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="address">Logradouro</Label>
              <Input id="address" name="address" defaultValue={staff?.address ?? ""} />
            </div>
            <div>
              <Label htmlFor="address_number">Número</Label>
              <Input id="address_number" name="address_number" defaultValue={staff?.addressNumber ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input id="complement" name="complement" defaultValue={staff?.complement ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="neighborhood">Bairro</Label>
              <Input id="neighborhood" name="neighborhood" defaultValue={staff?.neighborhood ?? ""} />
            </div>
            <div>
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" name="city" defaultValue={staff?.city ?? ""} />
            </div>
            <div>
              <Label htmlFor="state">UF</Label>
              <Input id="state" name="state" maxLength={2} defaultValue={staff?.state ?? ""} />
            </div>
          </div>

          <p className="text-xs font-medium uppercase text-muted-foreground">
            Contrato
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contract_type">Regime</Label>
              <select id="contract_type" name="contract_type" defaultValue={staff?.contractType ?? ""} className={selectClass}>
                <option value="">—</option>
                {CONTRACT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CONTRACT_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="role_title">Cargo / função</Label>
              <Input id="role_title" name="role_title" defaultValue={staff?.roleTitle ?? ""} />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Observações</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={staff?.notes ?? ""}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
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
