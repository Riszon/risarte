import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, UserPlus } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageOrtho, canViewOrtho } from "@/lib/ortodontia/access";
import { loadEffectiveSettings, loadOrthoProcedures, loadOrthodontistOptions } from "@/lib/ortodontia/db";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { todayInBrazil } from "@/lib/dates";
import { NovoCasoForm } from "./novo-caso-form";

export const metadata: Metadata = { title: "Ortodontia — Novo caso" };

/**
 * ABRIR UM CASO: escolhe o paciente (busca na unidade ativa), confere que ele
 * não tem caso aberto e preenche o cronograma e a mensalidade a partir da
 * configuração da unidade. Só Gerente, Coordenador e Admin.
 */
export default async function OrtoNovoCasoPage(props: PageProps<"/ortodontia/casos/novo">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  const clinicId = session.activeClinic?.id ?? null;
  if (!clinicId || session.activeClinic?.type !== "franchise_unit") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Escolha uma <strong>unidade</strong> no menu lateral para abrir um caso de ortodontia.
        </p>
      </div>
    );
  }
  if (!canManageOrtho(session, clinicId)) redirect("/ortodontia/casos");

  const sp = await props.searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const clienteId = pick("cliente") ?? "";
  const negociacaoId = pick("negociacao") ?? "";
  const busca = (pick("busca") ?? "").trim();
  const supabase = await createClient();

  // Passo 1: escolher o paciente.
  if (!clienteId) {
    let encontrados: { id: string; full_name: string; code: string | null; ortho_active: boolean | null }[] = [];
    if (busca.length >= 2) {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, code, ortho_active")
        .eq("clinic_id", clinicId)
        .eq("status", "active")
        .or(`full_name.ilike.%${busca.replace(/[%,()]/g, "")}%,code.ilike.%${busca.replace(/[%,()]/g, "")}%`)
        .order("full_name")
        .limit(30);
      encontrados = (data ?? []) as typeof encontrados;
    }
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <CabecalhoDeModulo chapeu="Ortodontia" icone={UserPlus} titulo="Novo caso ortodôntico" descricao={`Passo 1 de 2 — escolha o paciente de ${session.activeClinic?.name}.`} voltar={{ href: "/ortodontia/casos", rotulo: "Casos" }} />
        <FilterForm className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Nome ou código do paciente (Enter para procurar)" autoFocus />
        </FilterForm>
        {busca.length >= 2 && (
          <Card>
            <CardContent className="p-0">
              {encontrados.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum paciente ativo com &quot;{busca}&quot; nesta unidade. O cadastro é feito em Prontuários.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {encontrados.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <span>
                        {c.full_name} {c.code && <span className="text-xs text-muted-foreground">· {c.code}</span>}
                      </span>
                      {c.ortho_active ? (
                        <span className="text-xs text-muted-foreground">já tem caso aberto</span>
                      ) : (
                        <Link href={`/ortodontia/casos/novo?cliente=${c.id}`} className="text-xs font-medium underline-offset-2 hover:underline">Escolher →</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Passo 2: o caso.
  const { data: client } = await supabase
    .from("clients")
    .select("id, full_name, code, clinic_id, ortho_case_id, ortho_active, birth_date")
    .eq("id", clienteId)
    .maybeSingle();
  if (!client || client.clinic_id !== clinicId) redirect("/ortodontia/casos/novo");
  if (client.ortho_active && client.ortho_case_id) redirect(`/ortodontia/casos/${client.ortho_case_id}`);

  const [settings, orthodontists, procedures] = await Promise.all([
    loadEffectiveSettings(supabase, clinicId),
    loadOrthodontistOptions(supabase, clinicId),
    loadOrthoProcedures(supabase),
  ]);

  // ORTO7 (0333): vindo de uma venda, as características do caso são as que o
  // Planner definiu na opção (tipo, meses de referência, intervalo).
  type Proposta = { treatment_kind: string; planned_months: number; maintenance_interval_days: number };
  let proposta: Proposta | null = null;
  if (negociacaoId) {
    const { data: neg } = await supabase
      .from("plan_negotiations")
      .select("option_id")
      .eq("id", negociacaoId)
      .maybeSingle();
    if (neg?.option_id) {
      const { data: p } = await supabase
        .from("treatment_plan_ortho")
        .select("treatment_kind, planned_months, maintenance_interval_days")
        .eq("option_id", neg.option_id as string)
        .maybeSingle();
      proposta = (p as Proposta | null) ?? null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={UserPlus}
        titulo="Novo caso ortodôntico"
        descricao={`Passo 2 de 2 — ${client.full_name}${client.code ? ` · ${client.code}` : ""}. Os valores vêm da configuração da unidade e podem ser ajustados.`}
        voltar={{ href: "/ortodontia/casos/novo", rotulo: "Trocar o paciente" }}
      />
      <NovoCasoForm
        clientId={client.id as string}
        negotiationId={negociacaoId || null}
        today={todayInBrazil()}
        defaults={{
          kind: proposta?.treatment_kind ?? null,
          monthlyCents: settings?.monthly_fee_cents ?? 0,
          plannedMonths: proposta?.planned_months ?? settings?.planned_months ?? 24,
          intervalDays: proposta?.maintenance_interval_days ?? settings?.maintenance_interval_days ?? 30,
          billingDay: settings?.billing_day ?? 10,
          procedureId: settings?.maintenance_procedure_id ?? null,
          retainerCharged: settings?.retainer_charge_enabled === true,
          retainerFeeCents: settings?.retainer_fee_cents ?? 0,
          retainerTerms: settings?.retainer_terms ?? null,
        }}
        orthodontists={orthodontists}
        procedures={procedures}
      />
    </div>
  );
}
