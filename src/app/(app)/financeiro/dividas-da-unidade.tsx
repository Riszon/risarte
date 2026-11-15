import Link from "next/link";
import { Landmark } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL } from "@/lib/pricing";

// O card "Dívidas da unidade" (Levantamento de Dívidas, fase 7, 0409) no
// Painel do Financeiro da unidade. Só números — nunca credor, contato ou
// anexo. Quem vê é o banco (`debt_unit_summary` → `_debt_can_see_unit`): sem
// permissão, ele devolve nada e o card não aparece. Nasce desligado (a
// permissão `acao.dividas.ver_unidade` não tem papel nenhum de fábrica).

type Resumo = {
  debts: number;
  balance_cents: number;
  overdue_count: number;
  overdue_cents: number;
  defaulted_count: number;
  defaulted_cents: number;
  restricted_count: number;
  agreements: number;
  agreement_balance_cents: number;
  agreement_next30_cents: number;
};

export async function DividasDaUnidade({
  supabase,
  clinicId,
  nome,
  linkParaOLevantamento,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  nome: string;
  linkParaOLevantamento: boolean;
}) {
  const { data, error } = await supabase.rpc("debt_unit_summary", { p_clinic_id: clinicId });
  // Sem a 0409 no banco, ou sem permissão: o card simplesmente não aparece.
  const r = !error && Array.isArray(data) ? (data[0] as Resumo | undefined) : undefined;
  if (!r) return null;
  const n = (x: unknown) => Number(x ?? 0);
  if (n(r.debts) === 0 && n(r.agreements) === 0) {
    return (
      <section className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <Landmark className="size-5 shrink-0 text-primary" />
        <span>Dívidas da unidade: nenhuma dívida em aberto registrada para {nome}.</span>
      </section>
    );
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Landmark className="size-4 text-primary" /> Dívidas da unidade
      </h2>
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Quanto se deve</p>
          <p className="text-lg font-semibold tabular-nums">{formatBRL(n(r.balance_cents))}</p>
          <p className="text-[11px] text-muted-foreground">{n(r.debts)} dívida(s) em aberto</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Em atraso · inadimplente</p>
          <p className="text-lg font-semibold tabular-nums">{formatBRL(n(r.overdue_cents) + n(r.defaulted_cents))}</p>
          <p className="text-[11px] text-muted-foreground">
            {n(r.overdue_count)} em atraso · {n(r.defaulted_count)} inadimplente(s)
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Com restrição</p>
          <p className="text-lg font-semibold tabular-nums">{n(r.restricted_count)}</p>
          <p className="text-[11px] text-muted-foreground">negativação, protesto ou ação</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Acordos valendo</p>
          <p className="text-lg font-semibold tabular-nums">{formatBRL(n(r.agreement_balance_cents))}</p>
          <p className="text-[11px] text-muted-foreground">
            {n(r.agreements)} acordo(s) · {formatBRL(n(r.agreement_next30_cents))} em 30 dias
          </p>
        </div>
      </div>
      {linkParaOLevantamento && (
        <Link href="/financeiro/dividas" className="inline-block text-xs underline">
          Abrir o Levantamento de Dívidas
        </Link>
      )}
    </section>
  );
}
