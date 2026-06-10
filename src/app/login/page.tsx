import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/setup-notice";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

export default function LoginPage() {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">
            Risarte Odontologia
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sistema de gestão da jornada do cliente
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
