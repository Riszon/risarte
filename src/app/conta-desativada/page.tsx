import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Acesso desativado" };

/**
 * A tela de quem teve o acesso desativado.
 *
 * ⚠️ FICA FORA DO GRUPO `(app)` DE PROPÓSITO. Toda tela lá dentro chama
 * `getSessionContext()`, que é justamente quem manda para cá — se esta página
 * estivesse lá, ela chamaria a sessão, a sessão mandaria para cá de novo, e o
 * navegador entraria em laço.
 *
 * Também não dá para simplesmente mandar para o login: o porteiro vê um token
 * válido e devolve a pessoa para dentro. Por isso a saída é explícita, num
 * botão — e é ele que apaga a sessão.
 */
export default function ContaDesativadaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-l-4 border-l-amber-500 p-6 text-center">
        <ShieldOff className="mx-auto size-10 text-amber-500" />
        <h1 className="mt-4 text-xl font-semibold">Seu acesso está desativado</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sua conta existe, mas foi desativada por um administrador. Isso não
          apaga nada do que você registrou — apenas impede novas entradas.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Se você acha que é engano, fale com o responsável pelo sistema na sua
          unidade.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
