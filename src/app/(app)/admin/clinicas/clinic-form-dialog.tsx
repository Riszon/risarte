"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CLINIC_TYPE_LABELS, CLINIC_TYPES, type ClinicType } from "@/lib/roles";
import { createClinic, updateClinic, type ActionResult } from "./actions";

export type ClinicFormData = {
  id?: string;
  name?: string;
  type?: ClinicType;
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  is_active?: boolean;
};

export function ClinicFormDialog({
  clinic,
  trigger,
}: {
  clinic?: ClinicFormData;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const isEdit = Boolean(clinic?.id);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ClinicType>(clinic?.type ?? "franchise_unit");
  const [isActive, setIsActive] = useState(clinic?.is_active ?? true);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("type", type);
    formData.set("is_active", String(isActive));

    startTransition(async () => {
      const result: ActionResult = isEdit
        ? await updateClinic(clinic!.id!, formData)
        : await createClinic(formData);

      if (result.ok) {
        toast.success(isEdit ? "Clínica atualizada." : "Clínica cadastrada.");
        setOpen(false);
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar clínica" : "Nova clínica"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Altere os dados da clínica."
              : "Cadastre uma unidade da rede Risarte."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={clinic?.name ?? ""}
              placeholder="Risarte — Unidade Centro"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ClinicType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLINIC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CLINIC_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input
                id="cnpj"
                name="cnpj"
                defaultValue={clinic?.cnpj ?? ""}
                placeholder="00.000.000/0000-00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={clinic?.phone ?? ""}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={clinic?.email ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Endereço</Label>
            <Input
              id="address"
              name="address"
              defaultValue={clinic?.address ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" name="city" defaultValue={clinic?.city ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">UF</Label>
              <Input
                id="state"
                name="state"
                maxLength={2}
                defaultValue={clinic?.state ?? ""}
                placeholder="SP"
              />
            </div>
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={isActive ? "true" : "false"}
                onValueChange={(v) => setIsActive(v === "true")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Ativa</SelectItem>
                  <SelectItem value="false">Inativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
