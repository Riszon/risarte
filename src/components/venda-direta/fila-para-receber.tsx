// Venda direta v3 — a fila "Para receber" da tela Atendimento: toda venda
// direta ABERTA da unidade (falta definir o pagamento, assinar ou receber),
// com o Continuar que abre o caixa onde ela parou. É o que substitui a ida à
// aba "Sessões & Procedimentos" do prontuário.

import Link from "next/link";
import { Wallet } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime } from "@/lib/dates";
import { oQueFalta } from "@/lib/venda-direta-caixa";
import { BotaoContinuarVenda } from "./caixa";

export type VendaNaFila = {
  id: string;
  code: string | null;
  clientId: string | null;
  clientName: string | null;
  finalCents: number;
  paymentMethod: string | null;
  contractSigned: boolean;
  paymentConfirmed: boolean;
  createdAt: string;
};

/**
 * As vendas diretas abertas da unidade. `null` = não foi possível ler (a tela
 * diz isso, em vez de mostrar "nada a receber" sem ter olhado).
 */
export async function carregarFilaParaReceber(
  supabase: SupabaseClient,
  clinicId: string
): Promise<VendaNaFila[] | null> {
  const { data, error } = await supabase
    .from("direct_sales")
    .select(
      "id, code, client_id, client_name, final_cents, payment_method, contract_signed, payment_confirmed, created_at"
    )
    .eq("clinic_id", clinicId)
    .eq("cancelled", false)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.error("carregarFilaParaReceber failed:", error.message);
    return null;
  }
  return (data ?? []).map((s) => ({
    id: s.id as string,
    code: (s.code as string | null) ?? null,
    clientId: (s.client_id as string | null) ?? null,
    clientName: (s.client_name as string | null) ?? null,
    finalCents: (s.final_cents as number) ?? 0,
    paymentMethod: (s.payment_method as string | null) ?? null,
    contractSigned: Boolean(s.contract_signed),
    paymentConfirmed: Boolean(s.payment_confirmed),
    createdAt: s.created_at as string,
  }));
}

export function FilaParaReceber({ vendas }: { vendas: VendaNaFila[] | null }) {
  if (vendas === null) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Não foi possível ler as vendas diretas em aberto. Recarregue a tela.
      </p>
    );
  }
  if (vendas.length === 0) return null;
  return (
    <section
      aria-label="Vendas diretas para receber"
      className="rounded-xl border border-amber-300/70 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <h2 className="flex items-center gap-2 border-b border-amber-300/50 px-3 py-2 text-sm font-semibold">
        <Wallet className="size-4 text-amber-700 dark:text-amber-300" />
        Para receber
        <span className="rounded-full bg-amber-200/70 px-1.5 text-xs font-medium tabular-nums dark:bg-amber-500/30">
          {vendas.length}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          vendas diretas em aberto nesta unidade
        </span>
      </h2>
      <ul className="divide-y divide-amber-300/40">
        {vendas.slice(0, A_VISTA).map((v) => (
          <Linha key={v.id} v={v} />
        ))}
      </ul>
      {vendas.length > A_VISTA && (
        <details className="border-t border-amber-300/40">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            ver as outras {vendas.length - A_VISTA}
          </summary>
          <ul className="divide-y divide-amber-300/40 border-t border-amber-300/40">
            {vendas.slice(A_VISTA).map((v) => (
              <Linha key={v.id} v={v} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Quantas vendas ficam à vista; o resto abre em "ver as outras". */
const A_VISTA = 4;

function Linha({ v }: { v: VendaNaFila }) {
  return (
          <li
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2">
                {v.clientId ? (
                  <Link
                    href={`/prontuarios/${v.clientId}`}
                    className="font-medium hover:underline"
                  >
                    {v.clientName ?? "Cliente"}
                  </Link>
                ) : (
                  <span className="font-medium">{v.clientName ?? "Cliente avulso"}</span>
                )}
                {v.code && (
                  <span className="rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
                    {v.code}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {oQueFalta({
                  cancelled: false,
                  closed: false,
                  finalCents: v.finalCents,
                  paymentMethod: v.paymentMethod,
                  contractSigned: v.contractSigned,
                  paymentConfirmed: v.paymentConfirmed,
                })}{" "}
                · lançada em {formatBrDateTime(v.createdAt)}
              </p>
            </div>
            <span className="font-semibold tabular-nums">{formatBRL(v.finalCents)}</span>
            {v.clientId && (
              <BotaoContinuarVenda
                clientId={v.clientId}
                clientName={v.clientName}
                saleId={v.id}
                destaque
              />
            )}
          </li>
  );
}
