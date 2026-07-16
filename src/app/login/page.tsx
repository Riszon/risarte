import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { RisarteWordmark } from "@/components/risarte-logo";
import { APP_VERSION } from "@/lib/version";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

export default function LoginPage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  return (
    <main className="flex flex-1">
      {/* Painel da marca (aparece em telas médias/grandes) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground md:flex md:w-1/2 lg:w-3/5">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gold" />
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-gold/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-white/5 blur-3xl" />

        <div className="relative">
          <RisarteWordmark className="h-10 text-primary-foreground" />
        </div>

        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight lg:text-4xl">
            Gestão da Jornada do Cliente
          </h2>
          <p className="text-sm leading-relaxed text-primary-foreground/70">
            Do primeiro contato ao acompanhamento — planejamento, agenda,
            prontuário e comercial, tudo numa rede só.
          </p>
        </div>

        <p className="relative text-xs text-primary-foreground/50">
          © Risarte Odontologia
        </p>
      </aside>

      {/* Painel do formulário */}
      <div className="flex w-full flex-col items-center justify-center bg-background p-6 md:w-1/2 lg:w-2/5">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center md:hidden">
            <RisarteWordmark className="h-8 text-primary" />
            <p className="text-sm text-muted-foreground">
              Sistema de gestão da jornada do cliente
            </p>
          </div>
          <LoginForm />
          <p className="mt-6 text-center text-xs text-muted-foreground">
            riSZon · v{APP_VERSION}
          </p>
        </div>
      </div>
    </main>
  );
}
