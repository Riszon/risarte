import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Handshake, Info } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  NEGOTIATION_STATUS_LABELS,
  type NegotiationStatus,
} from "@/lib/commercial";

export const metadata: Metadata = { title: "Comercial" };

// Mesmas cores do painel de negociação (status da rodada).
const STATUS_PILL: Record<NegotiationStatus, string> = {
  em_negociacao: "border-primary/30 bg-primary/10 text-primary",
  aguardando_autorizacao: "border-amber-300 bg-amber-50 text-amber-800",
  aceita: "border-emerald-300 bg-emerald-50 text-emerald-800",
  devolvida: "border-border bg-muted text-muted-foreground",
  perdida: "border-rose-300 bg-rose-50 text-rose-800",
};

/**
 * COM2: acesso rápido do time comercial — todos os clientes na Conversão
 * Comercial (Fase 4) do escopo do usuário, 1 clique para o Cockpit do
 * Consultor. No COM3 esta tela vira o kanban completo (10 colunas + follow-up).
 */
export default async function ComercialListPage() {
  const session = await getSessionContext();
  const allowed =
    session.isAdminMaster ||
    Object.values(session.rolesByClinic)
      .flat()
      .some((r) =>
        ["commercial_consultant", "commercial_assistant"].includes(r)
      );
  if (!allowed) redirect("/");

  const supabase = await createClient();

  // RLS já limita ao escopo do usuário (unidades do Consultor/Assistente).
  const { data: clients } = await supabase
    .from("clients")
    .select(
      "id, full_name, code, journey_phase, clinic:clinics!clients_clinic_id_fkey ( name )"
    )
    .eq("journey_phase", "commercial_conversion")
    .neq("status", "anonymized")
    .order("full_name");

  const rows = (clients ?? []) as {
    id: string;
    full_name: string;
    code: string | null;
    clinic: { name: string } | { name: string }[] | null;
  }[];

  // Situação da negociação de cada cliente (rodada mais recente).
  const negByClient = new Map<
    string,
    { status: NegotiationStatus; finalCents: number }
  >();
  if (rows.length > 0) {
    const { data: negs } = await supabase
      .from("plan_negotiations")
      .select("client_id, status, final_cents, updated_at")
      .in(
        "client_id",
        rows.map((r) => r.id)
      )
      .order("updated_at", { ascending: false });
    for (const n of (negs ?? []) as {
      client_id: string;
      status: NegotiationStatus;
      final_cents: number;
    }[]) {
      if (!negByClient.has(n.client_id)) {
        negByClient.set(n.client_id, {
          status: n.status,
          finalCents: n.final_cents,
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-gold" />
          Comercial
        </h1>
        <p className="text-sm text-muted-foreground">
          Seus clientes na Conversão Comercial (Fase 4) — clique para abrir o
          Cockpit do Consultor.
        </p>
      </div>

      <p className="flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Este é o acesso rápido do Comercial. O kanban completo (a apresentar,
        follow-up, fechamentos...) chega no próximo lote.
      </p>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente na Conversão Comercial no seu escopo agora.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const clinicName =
              (Array.isArray(c.clinic) ? c.clinic[0] : c.clinic)?.name ?? null;
            const neg = negByClient.get(c.id) ?? null;
            return (
              <li key={c.id}>
                <Link
                  href={`/comercial/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.full_name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {c.code && (
                        <span className="font-mono">{c.code}</span>
                      )}
                      {clinicName && <span>Unidade: {clinicName}</span>}
                    </p>
                  </div>
                  {neg ? (
                    <span className="flex items-center gap-2">
                      {neg.finalCents > 0 && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatBRL(neg.finalCents)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          STATUS_PILL[neg.status]
                        )}
                      >
                        {NEGOTIATION_STATUS_LABELS[neg.status]}
                      </span>
                    </span>
                  ) : (
                    <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                      Sem negociação
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
