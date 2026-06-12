"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/masks";
import { updateOwnProfile } from "./actions";

export function ProfileForm({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string;
  email: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateOwnProfile(formData);
      if (result.ok) {
        toast.success("Dados salvos.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meus dados</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome completo *</Label>
            <Input id="full_name" name="full_name" required defaultValue={fullName} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                name="phone"
                inputMode="numeric"
                defaultValue={phone}
                onChange={(e) => {
                  e.target.value = formatPhone(e.target.value);
                }}
                placeholder="(11) 99999-9999"
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail de acesso</Label>
              <Input value={email} disabled />
            </div>
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
