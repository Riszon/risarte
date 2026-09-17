"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/masks";
import { trocarMinhaSenha, updateOwnProfile } from "./actions";

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

/**
 * MINHA SENHA — e ela vale nos dois ambientes.
 *
 * O login é um só para a pessoa (sistema real, treino e Academy), então trocar
 * aqui troca também no treino, que é o único que mora em outro banco. Se o
 * espelho falhar, a tela diz — em vez de deixar a pessoa descobrir na hora de
 * entrar no treino.
 */
export function FormularioDeSenha() {
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Minha senha</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            startTransition(async () => {
              const r = await trocarMinhaSenha(formData);
              if (r.ok) {
                toast.success("Senha trocada. Ela já vale no treino também.");
                if (r.aviso) toast.warning(r.aviso);
                form.reset();
              } else {
                toast.error(r.error ?? "Algo deu errado.");
              }
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="current_password">Senha atual *</Label>
            <Input
              id="current_password"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha *</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                placeholder="Mín. 6 caracteres, letras e números"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password_confirm">Repita a nova senha *</Label>
              <Input
                id="password_confirm"
                name="password_confirm"
                type="password"
                required
                minLength={6}
              />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? "Trocando..." : "Trocar senha"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
