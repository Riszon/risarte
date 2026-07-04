"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { setActiveClinic } from "@/lib/actions/session";
import { CLINIC_TYPE_LABELS, type ClinicType } from "@/lib/roles";

type WelcomeClinic = { id: string; name: string; type: ClinicType };

/**
 * H1.7: quando o usuário tem acesso a mais de uma unidade e ainda não escolheu,
 * ele decide aqui em qual unidade entrar (em vez de cair numa automaticamente).
 */
export function ChooseClinicWelcome({
  fullName,
  clinics,
}: {
  fullName: string;
  clinics: WelcomeClinic[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(clinicId: string) {
    startTransition(async () => {
      await setActiveClinic(clinicId);
      router.push("/");
      router.refresh();
    });
  }

  const firstName = fullName.split(" ")[0] || fullName;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-lg font-semibold tracking-tight">Risarte</p>
          <p className="text-sm text-muted-foreground">Odontologia</p>
        </div>
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Olá, {firstName}!</h1>
          <p className="text-sm text-muted-foreground">
            Você tem acesso a mais de uma unidade. Escolha em qual deseja
            trabalhar agora.
          </p>
        </div>
        <ul className="space-y-2">
          {clinics.map((clinic) => (
            <li key={clinic.id}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => choose(clinic.id)}
                className="flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
              >
                <Building2 className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{clinic.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {CLINIC_TYPE_LABELS[clinic.type]}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 opacity-60" />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-center text-xs text-muted-foreground">
          Depois você pode trocar de unidade a qualquer momento pelo menu
          lateral.
        </p>
      </div>
    </div>
  );
}
