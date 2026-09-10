import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  canManagePurchaseRequests,
  canViewPurchases,
  isPurchaser,
} from "@/lib/purchases-access";
import { canConfigureFinanceNetwork } from "@/lib/finance/access";
import { todayInBrazil } from "@/lib/dates";
import type {
  PurchaseRequest,
  PurchaseRequestItem,
} from "@/lib/purchases";
import { PurchasesView } from "./purchases-client";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { TrilhaDaCompra } from "./trilha";
import { contarEtapasDaCompra } from "./trilha-dados";

export const metadata: Metadata = { title: "Compras" };

/**
 * COMPRAS C1 — a necessidade da unidade.
 *
 * A lista nasce do estoque (o que está abaixo do mínimo), o gerente ajusta e
 * envia à Franqueadora. A NEGOCIAÇÃO é da rede; o DINHEIRO é da unidade.
 */
export default async function PurchasesPage() {
  const session = await getSessionContext();
  const clinicId = session.activeClinic?.id ?? null;
  if (!canViewPurchases(session, clinicId)) redirect("/");

  if (!clinicId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  // As contagens da trilha entram na MESMA leva das outras consultas: em
  // sequência somariam duas idas ao banco ao tempo de abrir a tela.
  const [
    { data: requestRows },
    { data: itemRows },
    { data: stockRows },
    { data: accountRows },
    etapas,
  ] = await Promise.all([
      supabase
        .from("purchase_requests")
        .select("id, code, clinic_id, status, is_local, notes, sent_at, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("purchase_request_items")
        .select(
          "id, request_id, item_id, description, account_code, quantity, purchase_unit, estimated_unit_cents, estimated_total_cents, estimate_source, estimate_date, notes"
        ),
      supabase
        .from("stock_items")
        .select("id, name, brand, purchase_unit")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("chart_of_accounts")
        .select("code, name")
        .eq("is_analytic", true)
        .eq("active", true)
        .in("scope", ["unit", "both"])
        .order("code"),
      // ⚠️ A CONTA VEM DO LUGAR COMUM, não de uma cópia aqui: a trilha aparece
      // em cinco telas, e duas versões do mesmo número divergiriam no dia em
      // que alguém mexesse numa delas.
      contarEtapasDaCompra(supabase, clinicId),
    ]);

  const requests: PurchaseRequest[] = (
    (requestRows ?? []) as {
      id: string;
      code: string;
      clinic_id: string;
      status: string;
      is_local: boolean;
      notes: string | null;
      sent_at: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    code: r.code,
    clinicId: r.clinic_id,
    status: r.status as PurchaseRequest["status"],
    isLocal: r.is_local,
    notes: r.notes ?? "",
    sentAt: r.sent_at,
    createdAt: r.created_at,
  }));

  const known = new Set(requests.map((r) => r.id));
  const itemsByRequest: Record<string, PurchaseRequestItem[]> = {};
  for (const raw of (itemRows ?? []) as {
    id: string;
    request_id: string;
    item_id: string | null;
    description: string;
    account_code: string | null;
    quantity: number;
    purchase_unit: string | null;
    estimated_unit_cents: number;
    estimated_total_cents: number;
    estimate_source: string;
    estimate_date: string | null;
    notes: string | null;
  }[]) {
    if (!known.has(raw.request_id)) continue;
    (itemsByRequest[raw.request_id] ??= []).push({
      id: raw.id,
      itemId: raw.item_id,
      description: raw.description,
      accountCode: raw.account_code,
      quantity: Number(raw.quantity ?? 0),
      purchaseUnit: raw.purchase_unit,
      estimatedUnitCents: Number(raw.estimated_unit_cents ?? 0),
      estimatedTotalCents: Number(raw.estimated_total_cents ?? 0),
      estimateSource: raw.estimate_source as PurchaseRequestItem["estimateSource"],
      estimateDate: raw.estimate_date,
      notes: raw.notes ?? "",
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <CabecalhoDeModulo
        chapeu="Suprimentos"
        icone={ShoppingCart}
        titulo={`Compras — ${session.activeClinic?.name ?? "unidade"}`}
        descricao="O que falta na sua unidade vira lista, e a lista vira negociação da rede."
      />

      <TrilhaDaCompra
        atual="pedir"
        {...etapas}
        podeVerMesa={isPurchaser(session) || canConfigureFinanceNetwork(session)}
      />


      <PurchasesView
        clinicId={clinicId}
        today={todayInBrazil()}
        requests={requests}
        itemsByRequest={itemsByRequest}
        stockItems={(
          (stockRows ?? []) as {
            id: string;
            name: string;
            brand: string | null;
            purchase_unit: string | null;
          }[]
        ).map((i) => ({
          id: i.id,
          name: i.name,
          brand: i.brand ?? "",
          purchaseUnit: i.purchase_unit ?? "",
        }))}
        accounts={(
          (accountRows ?? []) as { code: string; name: string }[]
        ).map((a) => ({ code: a.code, name: a.name }))}
        canManage={canManagePurchaseRequests(session, clinicId)}
      />
    </div>
  );
}
