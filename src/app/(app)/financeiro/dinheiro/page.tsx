import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance } from "@/lib/finance/access";
import { PainelDoDinheiro, type DadosDoPainel } from "./painel";

export const metadata: Metadata = { title: "Dinheiro no caixa" };

/**
 * 4011 (ASA4, entrega 1; spec 19.11 e 19.12, F5) — O DINHEIRO DA UNIDADE.
 *
 * Toda baixa em dinheiro entra no Caixa da unidade. Esta tela mostra o que
 * ainda NÃO foi depositado (por recebimento e por dias parado; depois do prazo
 * da rede, padrão 2 dias úteis, o Gerente e o Financeiro são avisados) e
 * registra o depósito com o COMPROVANTE: o dinheiro sai do Caixa e entra na
 * conta bancária (6.3.01, fora do resultado). Quando o extrato for importado,
 * a Conciliação liga a linha a esse lançamento — sem lançar de novo.
 */
export default async function DinheiroPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");
  const params = await props.searchParams;
  const pedida = typeof params.unidade === "string" ? params.unidade : null;
  const supabase = await createClient();

  // Na franqueadora, o Financeiro e o Admin escolhem a unidade.
  const ativa = session.activeClinic;
  let unidades: { id: string; name: string }[] = [];
  if (ativa?.type === "franchisor") {
    const { data } = await supabase.from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name");
    unidades = (data ?? []) as { id: string; name: string }[];
  }
  const clinicId = pedida ?? (ativa?.type === "franchisor" ? (unidades[0]?.id ?? null) : (ativa?.id ?? null));

  let dados: DadosDoPainel | null = null;
  let erro: string | null = null;
  if (clinicId) {
    const { data, error } = await supabase.rpc("cash_panel_read", { p_clinic_id: clinicId });
    if (error) {
      erro = error.message.includes("NOT_ALLOWED")
        ? "Você não vê o dinheiro desta unidade."
        : error.message.includes("cash_panel_read")
          ? "O painel do dinheiro ainda não está ligado neste banco (falta a migração 4011)."
          : "Não foi possível ler o dinheiro da unidade.";
      if (!erro.startsWith("Você") && !erro.startsWith("O painel")) console.error("cash_panel_read failed:", error.message);
    } else dados = data as DadosDoPainel;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Banknote className="size-6 text-primary" />
          Dinheiro no caixa
        </h1>
        <p className="text-sm text-muted-foreground">
          O dinheiro recebido no balcão que ainda não foi depositado no banco, e os depósitos com comprovante.
        </p>
      </div>
      {!clinicId ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">Selecione uma unidade no menu lateral.</p>
      ) : erro ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erro}</p>
      ) : dados ? (
        <PainelDoDinheiro clinicId={clinicId} unidades={unidades} dados={dados} />
      ) : null}
    </div>
  );
}
