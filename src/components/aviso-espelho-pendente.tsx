import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { isTreino } from "@/lib/environment";
import { treinoConfigurado } from "@/lib/treino";
import { createClient } from "@/lib/supabase/server";

/**
 * NA PRODUÇÃO, PARA O ADMIN: alguma alteração não chegou ao treino (0260).
 *
 * A cópia roda depois da resposta e nunca desfaz o que foi salvo aqui — então
 * a falha não aparece na hora. Este aviso é o lugar onde ela aparece, com o
 * caminho do conserto. Some sozinho quando uma cópia completa dá certo.
 */
export async function AvisoEspelhoPendente({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin || isTreino() || !treinoConfigurado()) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("mirror_state")
    .select("pending, last_full_sync_at")
    .maybeSingle<{ pending: boolean; last_full_sync_at: string | null }>();
  if (!data) return null;
  if (!data.pending && data.last_full_sync_at) return null;

  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {data.pending
          ? "Alguma alteração de Risartanos ou acessos não chegou ao treino."
          : "O treino ainda não recebeu a primeira cópia dos Risartanos."}{" "}
        <Link href="/admin/ambientes" className="font-medium underline underline-offset-2">
          Sincronizar o treino
        </Link>
        .
      </span>
    </p>
  );
}
