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

  // R4/Q1 (0334): esta tela tem DOIS caminhos, e nenhum é "novo caso do nada":
  //   * pela VENDA (`?negociacao=`): venda fechada antes desta versão, ainda
  //     sem caso (o Painel lista); o caso novo nasce sozinho no fechamento.
  //   * LEGADO (`?legado=1`): paciente que já estava em tratamento antes do
  //     sistema, enquanto o Admin deixar a porta aberta na unidade.
  const legado = pick("legado") === "1";
  if (!negociacaoId && !legado) redirect("/ortodontia");
  const settingsDaPorta = legado ? await loadEffectiveSettings(supabase, clinicId) : null;
  if (legado && settingsDaPorta && !settingsDaPorta.legacy_entry_enabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          O cadastro de <strong>caso legado</strong> está fechado nesta unidade. O caso de ortodontia nasce no fechamento da venda do Comercial; se ainda há pacientes antigos para cadastrar, peça ao Admin para reabrir a porta na Configuração da Ortodontia.
        </p>
      </div>
    );
  }

  // Passo 1: escolher o paciente (só no caminho legado — pela venda o paciente já vem).
  if (!clienteId) {
    if (!legado) redirect("/ortodontia");
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
        <CabecalhoDeModulo chapeu="Ortodontia" icone={UserPlus} titulo="Caso legado" descricao={`Passo 1 de 2 — escolha o paciente de ${session.activeClinic?.name} que já estava em tratamento ortodôntico antes do sistema.`} voltar={{ href: "/ortodontia", rotulo: "Painel" }} />
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
                        <Link href={`/ortodontia/casos/novo?legado=1&cliente=${c.id}`} className="text-xs font-medium underline-offset-2 hover:underline">Escolher →</Link>
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
  if (!client || client.clinic_id !== clinicId) redirect(legado ? "/ortodontia/casos/novo?legado=1" : "/ortodontia");
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
  // ORTO8 (0334): o acordo fechado pelo Consultor na negociação preenche o dinheiro.
  type Acordo = {
    monthly_fee_cents: number;
    billing_day: number;
    retainer_charged: boolean;
    retainer_fee_cents: number;
    retainer_terms: string | null;
  };
  let acordo: Acordo | null = null;
  if (negociacaoId) {
    const { data: a } = await supabase
      .from("plan_negotiation_ortho")
      .select("monthly_fee_cents, billing_day, retainer_charged, retainer_fee_cents, retainer_terms")
      .eq("negotiation_id", negociacaoId)
      .maybeSingle();
    acordo = (a as Acordo | null) ?? null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={UserPlus}
        titulo={legado ? "Caso legado" : "Abrir o caso da venda"}
        descricao={
          legado
            ? `Passo 2 de 2 — ${client.full_name}${client.code ? ` · ${client.code}` : ""}. Paciente que já estava em tratamento antes do sistema: informe o que foi combinado com ele.`
            : `${client.full_name}${client.code ? ` · ${client.code}` : ""}. As características vêm da proposta do Planner e o dinheiro do acordo da negociação; ajuste se precisar.`
        }
        voltar={{ href: "/ortodontia/casos/novo", rotulo: "Trocar o paciente" }}
      />
      <NovoCasoForm
        clientId={client.id as string}
        negotiationId={negociacaoId || null}
        legado={legado}
        today={todayInBrazil()}
        defaults={{
          kind: proposta?.treatment_kind ?? null,
          monthlyCents: acordo?.monthly_fee_cents ?? settings?.monthly_fee_cents ?? 0,
          plannedMonths: proposta?.planned_months ?? settings?.planned_months ?? 24,
          intervalDays: proposta?.maintenance_interval_days ?? settings?.maintenance_interval_days ?? 30,
          billingDay: acordo?.billing_day ?? settings?.billing_day ?? 10,
          procedureId: settings?.maintenance_procedure_id ?? null,
          retainerCharged: acordo ? acordo.retainer_charged === true : settings?.retainer_charge_enabled === true,
          retainerFeeCents: acordo?.retainer_fee_cents ?? settings?.retainer_fee_cents ?? 0,
          retainerTerms: acordo ? (acordo.retainer_terms ?? null) : (settings?.retainer_terms ?? null),
        }}
        orthodontists={orthodontists}
        procedures={procedures}
      />
    </div>
  );
}
