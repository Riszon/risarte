"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { iniciarAcesso } from "./actions";
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

/**
 * A mensagem certa para cada tipo de falha — sem entregar o e-mail.
 *
 * ⚠️ ANTES, TODA FALHA VIRAVA "e-mail ou senha incorretos". A intenção estava
 * certa (nunca revelar se um e-mail existe, para ninguém descobrir quem tem
 * conta), mas o efeito era esconder tudo o mais: excesso de tentativas,
 * internet caída, Supabase fora do ar, configuração errada. Custou uma
 * investigação inteira no dia da publicação — a senha estava certa e a tela
 * insistia que não.
 *
 * Pior no uso real: um soluço do servidor faria a equipe inteira concluir que
 * esqueceu a senha, e a recepção passaria a manhã pedindo redefinição.
 *
 * A regra que mantém o sigilo: só a resposta "credencial inválida" fala de
 * e-mail e senha, e ela é a MESMA para e-mail que não existe e para senha
 * errada. As outras falam do problema de verdade, que não diz nada sobre quem
 * tem conta.
 */
export function mensagemDeEntrada(erro: {
  message?: string;
  status?: number;
}): string {
  const status = erro.status ?? 0;
  const texto = (erro.message ?? "").toLowerCase();

  if (status === 429 || texto.includes("rate limit")) {
    return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  }
  if (texto.includes("captcha")) {
    return "A verificação de segurança bloqueou a entrada. Avise o administrador.";
  }
  if (texto.includes("email not confirmed")) {
    return "Este acesso ainda não foi liberado. Fale com o administrador.";
  }
  if (status === 0 || texto.includes("fetch") || texto.includes("network")) {
    return "Não consegui falar com o servidor. Verifique a internet e tente de novo.";
  }
  if (status >= 500) {
    return "O servidor de acesso está fora do ar no momento. Tente de novo em instantes.";
  }
  // O caso comum, e o único que menciona e-mail e senha.
  if (status === 400 || texto.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos. Verifique e tente novamente.";
  }
  // Nada reconhecido: diz que é outra coisa, e mostra o código para o suporte.
  // Chutar "senha errada" aqui é o que criou o problema.
  return `Não foi possível entrar agora (código ${status || "?"}). Tente de novo; se insistir, avise o administrador.`;
}

export function LoginForm({ aviso = null }: { aviso?: string | null }) {
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
      setError(mensagemDeEntrada(signInError));
      setLoading(false);
      return;
    }

    // ⚠️ O REGISTRO DA ENTRADA É ESPERADO antes de trocar de tela (0287).
    //
    // Até 09/10/2026 ele era disparado SEM esperar ("o fetch segue durante a
    // navegação"). Não seguia: a navegação ganhava a corrida e o login nunca
    // chegou à trilha — zero em 283 registros na produção. É a mesma corrida
    // do "Abrir" das notificações (OC-00093).
    //
    // O teto de 4 segundos garante que a auditoria nunca prenda ninguém na
    // tela de login: se o registro demorar, a pessoa entra do mesmo jeito e o
    // acesso é registrado pela primeira tela que abrir.
    await Promise.race([
      iniciarAcesso().catch(() => {
        // o login não pode falhar por causa do registro
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);

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
          {/* 0287: por que a pessoa voltou para cá. Sem a frase, quem foi
              desconectado por inatividade conclui que o sistema caiu. */}
          {aviso && (
            <p
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm"
            >
              {aviso}
            </p>
          )}
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
