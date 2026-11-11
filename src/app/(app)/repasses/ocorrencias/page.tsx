import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { failureFromDb, type PayoutFailureDb } from "@/lib/finance/payout-report";
import { FailuresBoard } from "./failures-board";

/**
 * Repasse, Etapa 4B (0400) — as OCORRÊNCIAS DE FALHA DO DENTISTA.
 *
 * Quem aprova a equipe (Gerente; sem Gerente, Coordenador) decide se houve
 * falha; o Financeiro acompanha (e decide quando a unidade não tem ninguém).
 * O banco diz o que cada um vê e decide (`payout_failure_list`, campo
 * `can_decide`). O dentista não vê ocorrências: ele vê o desconto, com o
 * motivo, no relatório dele.
 */
export default async function OcorrenciasPage() {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payout_failure_list", { p_clinic_id: null });
  if (error) console.error("payout_failure_list failed:", error.message);
  const lista = ((data ?? []) as PayoutFailureDb[]).map(failureFromDb);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <Link
          href="/repasses"
          className="inline-flex text-sm text-muted-foreground hover:text-foreground"
        >
          ← Repasses
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlert className="size-6 text-primary" />
          Ocorrências de falha
        </h1>
        <p className="text-sm text-muted-foreground">
          Procedimentos que já têm repasse e deram problema: reprovados no
          controle de qualidade, de uma venda cancelada ou registrados à mão.
          Quem aprova a equipe decide, com motivo, se foi{" "}
          <strong>falha do dentista</strong>. Só desconta quando foi.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Não foi possível carregar as ocorrências. Tente de novo; se continuar,
          avise o suporte.
        </p>
      )}

      <FailuresBoard failures={lista} />
    </div>
  );
}
