"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setStaffActive, setStaffUnitActive } from "./actions";

/**
 * UNIDADES E SITUAÇÃO.
 *
 * Duas coisas diferentes, e a tela separa: estar inativo numa unidade (parou de
 * atender em Londrina, continua em Cambé) não é o mesmo que sair da equipe.
 * Sair da equipe é o cadastro inteiro — e é aí que o acesso ao sistema passa a
 * precisar de decisão.
 */
export function UnidadesDoRisartano({
  staffId,
  ativo,
  unidadeOrigem,
  unidades,
  podeGerir,
}: {
  staffId: string;
  ativo: boolean;
  unidadeOrigem: string | null;
  unidades: {
    clinicId: string;
    clinicName: string;
    roleLabel: string;
    inativo: boolean;
    gerida: boolean;
  }[];
  podeGerir: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function rodar(
    acao: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string
  ) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(sucesso);
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Building2 className="size-4 text-gold-tinta" />
        Unidades e situação
      </h2>

      {unidades.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sem função em unidade nenhuma. O cadastro nasceu em{" "}
          <b>{unidadeOrigem ?? "—"}</b>; as unidades aparecem aqui quando o
          acesso recebe uma função.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {unidades.map((u) => (
            <li
              key={u.clinicId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="text-sm font-medium">{u.clinicName}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {u.roleLabel}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    u.inativo
                      ? "text-xs text-muted-foreground"
                      : "text-xs font-medium text-emerald-700 dark:text-emerald-400"
                  }
                >
                  {u.inativo ? "Inativo aqui" : "Ativo aqui"}
                </span>
                {u.gerida ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isPending}
                    onClick={() =>
                      rodar(
                        () => setStaffUnitActive(staffId, u.clinicId, u.inativo),
                        u.inativo ? "Ativado nesta unidade." : "Inativado nesta unidade."
                      )
                    }
                  >
                    {u.inativo ? "Reativar" : "Inativar"}
                  </Button>
                ) : (
                  <span className="text-xs italic text-muted-foreground">
                    outra unidade
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {podeGerir && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {ativo
              ? "Saiu da Risarte? Desligue o cadastro — e desative o acesso logo acima."
              : "Cadastro desligado: não aparece nas listas de equipe."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              rodar(
                () => setStaffActive(staffId, !ativo),
                ativo ? "Cadastro desligado." : "Cadastro reativado."
              )
            }
          >
            {ativo ? "Desligar da equipe" : "Reativar cadastro"}
          </Button>
        </div>
      )}
    </section>
  );
}
