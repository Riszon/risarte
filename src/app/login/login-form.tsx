"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordLogin } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Generic message on purpose: never reveal whether the e-mail exists.
      setError("E-mail ou senha incorretos. Verifique e tente novamente.");
      setLoading(false);
      return;
    }

    // Registra o acesso na trilha de auditoria (best-effort) SEM bloquear a
    // navegação: o fetch segue durante a navegação e o botão libera na hora.
    void recordLogin().catch(() => {
      // ignora — o login não pode falhar por causa da auditoria.
    });

    // Vai direto para a home. O push já renderiza com a sessão nova; o refresh
    // anterior renderizava a home uma 2ª vez e deixava o "Entrando..." preso.
    router.replace("/");
  }

  return (
    <Card className="rounded-2xl border-border/60 shadow-lg">
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-xl">Entrar</CardTitle>
        <CardDescription>
          Acesse com o e-mail e a senha cadastrados pelo administrador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@risarte.com.br"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
