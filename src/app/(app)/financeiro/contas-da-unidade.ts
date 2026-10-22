import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContaDaUnidade } from "@/lib/finance/conta-do-dinheiro";

/**
 * AP51 — as contas (bancárias e o Caixa) das unidades, para o campo "Entrou
 * em" / "Saiu de" e para a Conciliação.
 *
 * ⚠️ A PRINCIPAL É LIDA À PARTE: `is_default` nasce na 0317, e o código vai ao
 * ar antes de a migração rodar em cada banco. Sem a coluna, ninguém é
 * principal — e a régua cai na "única conta bancária", que é o comportamento
 * de antes.
 *
 * Quem não enxerga as contas (a regra da tabela é a do Financeiro) recebe a
 * lista vazia, e o campo oferece "Conta principal da unidade" + Caixa.
 */
export async function carregarContasDaUnidade(
  supabase: SupabaseClient,
  clinicIds: string[]
): Promise<ContaDaUnidade[]> {
  const ids = [...new Set(clinicIds.filter(Boolean))];
  if (!ids.length) return [];
  const [{ data, error }, principais] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("id, clinic_id, alias, kind, active")
      .in("clinic_id", ids)
      .order("alias"),
    supabase.from("bank_accounts").select("id, is_default").in("clinic_id", ids),
  ]);
  if (error) {
    console.error("bank_accounts read failed:", error.message);
    return [];
  }
  const principal = new Set(
    principais.error
      ? []
      : ((principais.data ?? []) as { id: string; is_default: boolean }[])
          .filter((r) => r.is_default)
          .map((r) => r.id)
  );
  return ((data ?? []) as {
    id: string;
    clinic_id: string;
    alias: string;
    kind: string;
    active: boolean;
  }[]).map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    alias: r.alias,
    kind: r.kind,
    active: Boolean(r.active),
    isDefault: principal.has(r.id),
  }));
}
