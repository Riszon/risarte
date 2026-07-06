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
import { CLINIC_TYPE_LABELS, type ClinicType } from "@/lib/roles";
import { formatCep, formatCnpj, formatPhone } from "@/lib/masks";
import { createClinic, updateClinic, type ActionResult } from "./actions";

export type ClinicFormData = {
  id?: string;
  name?: string;
  code?: string | null;
  type?: ClinicType;
  max_rooms?: number | null;
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  is_active?: boolean;
};

const STATUS_ITEMS = [
  { value: "true", label: "Ativa" },
  { value: "false", label: "Inativa" },
];

export function ClinicFormDialog({
  clinic,
  clinicType,
  trigger,
}: {
  clinic?: ClinicFormData;
  /** Required when creating: which type of clinic this dialog registers. */
  clinicType?: ClinicType;
  trigger: React.ReactElement<Record<string, unknown>>;
}) {
  const isEdit = Boolean(clinic?.id);
  const type: ClinicType = clinic?.type ?? clinicType ?? "franchise_unit";
  const typeLabel = CLINIC_TYPE_LABELS[type];

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isActive, setIsActive] = useState(clinic?.is_active ?? true);

  function applyMask(
    formatter: (v: string) => string
  ): React.ChangeEventHandler<HTMLInputElement> {
    return (e) => {
      e.target.value = formatter(e.target.value);
    };
  }

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
        toast.success(
          isEdit ? "Dados salvos." : `${typeLabel} cadastrada com sucesso.`
        );
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
            {isEdit ? `Editar ${typeLabel}` : `Cadastrar ${typeLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Altere os dados e salve."
              : `Preencha os dados da ${typeLabel.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={clinic?.name ?? ""}
                placeholder={
                  type === "franchisor"
                    ? "Risarte Franchising"
                    : "Risarte — Unidade Centro"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Código *</Label>
              <Input
                id="code"
                name="code"
                required
                maxLength={6}
                defaultValue={clinic?.code ?? ""}
                placeholder="CBE"
                className="uppercase"
              />
            </div>
          </div>
          {type === "franchise_unit" && (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              As <strong>cadeiras</strong> desta unidade (quantidade, nomes e
              limite) são geridas em <strong>“Configurar agenda”</strong>,
              escolhendo a unidade no menu lateral.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ</Label>
              <Input
                id="cnpj"
                name="cnpj"
                inputMode="numeric"
                defaultValue={clinic?.cnpj ?? ""}
                onChange={applyMask(formatCnpj)}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                name="phone"
                inputMode="numeric"
                defaultValue={clinic?.phone ?? ""}
                onChange={applyMask(formatPhone)}
                placeholder="(11) 99999-9999"
              />
            </div>
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
          <div className="grid grid-cols-[1fr_110px] gap-4">
            <div className="space-y-2">
              <Label htmlFor="address">Endereço (rua/avenida)</Label>
              <Input
                id="address"
                name="address"
                defaultValue={clinic?.address ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address_number">Número</Label>
              <Input
                id="address_number"
                name="address_number"
                defaultValue={clinic?.address_number ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="complement">Complemento</Label>
              <Input
                id="complement"
                name="complement"
                defaultValue={clinic?.complement ?? ""}
                placeholder="Sala, andar..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="neighborhood">Bairro</Label>
              <Input
                id="neighborhood"
                name="neighborhood"
                defaultValue={clinic?.neighborhood ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_70px_120px] gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="zip_code">CEP</Label>
              <Input
                id="zip_code"
                name="zip_code"
                inputMode="numeric"
                defaultValue={clinic?.zip_code ?? ""}
                onChange={applyMask(formatCep)}
                placeholder="00000-000"
              />
            </div>
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                items={STATUS_ITEMS}
                value={isActive ? "true" : "false"}
                onValueChange={(v) => v !== null && setIsActive(v === "true")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
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
