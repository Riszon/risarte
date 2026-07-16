"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Filtro por profissional: mostra só os agendamentos do profissional escolhido.
 * "Todos" (padrão) = sem filtro. Estado na URL (`?profissional=userId`),
 * preservando vista/ref/salas, então vale em Dia/Semana/Mês.
 */
export function ProviderFilter({
  providers,
  selected,
}: {
  providers: { userId: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) params.delete("profissional");
    else params.set("profissional", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background hover:bg-muted"
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        Profissional:
      </span>
      <button
        type="button"
        className={chip(!selected)}
        onClick={() => navigate("")}
      >
        Todos
      </button>
      {providers.map((p) => (
        <button
          key={p.userId}
          type="button"
          className={chip(selected === p.userId)}
          onClick={() => navigate(p.userId)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
