"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClientRecord, updateClientRecord } from "./actions";

export type ClientFormValues = {
  id?: string;
  full_name?: string;
  cpf?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  notes?: string | null;
};

export function ClientForm({ client }: { client?: ClientFormValues }) {
  const isEdit = Boolean(client?.id);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = isEdit
        ? await updateClientRecord(client!.id!, formData)
        : await createClientRecord(formData);

      if (result.ok) {
        toast.success(isEdit ? "Dados salvos." : "Cliente cadastrado.");
        router.push(result.clientId ? `/clientes/${result.clientId}` : "/clientes");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome completo *</Label>
            <Input
              id="full_name"
              name="full_name"
              required
              defaultValue={client?.full_name ?? ""}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input
                id="cpf"
                name="cpf"
                defaultValue={client?.cpf ?? ""}
                placeholder="000.000.000-00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birth_date">Data de nascimento</Label>
              <Input
                id="birth_date"
                name="birth_date"
                type="date"
                defaultValue={client?.birth_date ?? ""}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone / WhatsApp</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={client?.phone ?? ""}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={client?.email ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Endereço</Label>
            <Input
              id="address"
              name="address"
              defaultValue={client?.address ?? ""}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" name="city" defaultValue={client?.city ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">UF</Label>
              <Input
                id="state"
                name="state"
                maxLength={2}
                defaultValue={client?.state ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">CEP</Label>
              <Input
                id="zip_code"
                name="zip_code"
                defaultValue={client?.zip_code ?? ""}
                placeholder="00000-000"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={client?.notes ?? ""}
              placeholder="Como conheceu a Risarte, preferências de contato..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : isEdit ? "Salvar alterações" : "Cadastrar cliente"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
