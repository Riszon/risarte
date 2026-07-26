import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgePercent,
  CalendarCheck,
  HandHeart,
  Heart,
  Repeat,
  ScanLine,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canConfigurePpr, canViewPpr } from "@/lib/ppr/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RisarteMark } from "@/components/risarte-logo";
import { formatBRL } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "PPR+ — Programa de Prevenção Riso+" };

/** Os 6 objetivos do programa (docs/PPR.md §1). */
const GOALS = [
  {
    icon: Repeat,
    title: "Receita recorrente",
    text: "A mensalidade do cliente cria uma receita previsível para a unidade.",
  },
  {
    icon: Heart,
    title: "Relacionamento contínuo",
    text: "O cliente volta com regularidade e mantém o vínculo com a Risarte.",
  },
  {
    icon: Sparkles,
    title: "Benefício real",
    text: "Prevenção de verdade: consultas, radiografias e limpezas incluídas.",
  },
  {
    icon: BadgePercent,
    title: "Mais vendas na mesma base",
    text: "Quem já confia na clínica aceita mais tratamentos.",
  },
  {
    icon: Users,
    title: "Mais indicações",
    text: "Quem é do programa indica — e o indicado também ganha vantagens.",
  },
  {
    icon: HandHeart,
    title: "Riso+ Social",
    text: "Cada mês pago acumula pontos para cuidar de pessoas carentes.",
  },
];

export default async function PprPage() {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");
  const canConfig = canConfigurePpr(session);

  const supabase = await createClient();
  const [{ data: planRows }, { data: perkRows }, { data: tierRows }] =
    await Promise.all([
      supabase
        .from("ppr_plans")
        .select(
          "id, name, description, monthly_cents, allows_dependents, included_dependents, allows_extra_dependents, extra_dependent_cents, cash_discount_percent, max_installments, is_active, sort_order, social_enabled"
        )
        .order("sort_order"),
      supabase
        .from("ppr_plan_perks")
        .select("id, plan_id, label, sort_order")
        .order("sort_order"),
      supabase
        .from("ppr_plan_installment_tiers")
        .select("plan_id, up_to_installments, discount_percent")
        .order("up_to_installments"),
    ]);

  type PlanRow = {
    id: string;
    name: string;
    description: string | null;
    monthly_cents: number;
    allows_dependents: boolean;
    included_dependents: number;
    allows_extra_dependents: boolean;
    extra_dependent_cents: number;
    cash_discount_percent: number;
    max_installments: number;
    is_active: boolean;
    sort_order: number;
    social_enabled: boolean;
  };
  const plans = ((planRows ?? []) as PlanRow[]).filter((p) => p.is_active);
  const perks = (perkRows ?? []) as {
    id: string;
    plan_id: string;
    label: string;
  }[];
  const tiers = (tierRows ?? []) as {
    plan_id: string;
    up_to_installments: number;
    discount_percent: number;
  }[];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* -- Cabeçalho ------------------------------------------------------ */}
      <div className="relative overflow-hidden rounded-2xl border bg-primary text-primary-foreground">
        <RisarteMark className="pointer-events-none absolute -top-4 -right-6 h-40 text-gold/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
          <div>
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary-foreground/60">
              <Sparkles className="size-3.5" />
              Prevenção e relacionamento
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Programa de Prevenção Riso+
            </h1>
            <p className="mt-0.5 text-sm text-primary-foreground/70">
              PPR+ · o cliente paga uma mensalidade e ganha cuidado contínuo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              nativeButton={false}
              render={<Link href="/ppr/adesoes" />}
            >
              <Users className="mr-1 size-3.5" />
              Adesões
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              nativeButton={false}
              render={<Link href="/ppr/validar" />}
            >
              <ScanLine className="mr-1 size-3.5" />
              Validar cartão
            </Button>
            {canConfig && (
              <Button
                size="sm"
                variant="outline"
                className="border-primary-foreground/25 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
                nativeButton={false}
                render={<Link href="/ppr/configuracao" />}
              >
                <Settings className="mr-1 size-3.5" />
                Configurar programa
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* -- O que é -------------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">O que é o PPR+</CardTitle>
          <p className="text-sm text-muted-foreground">
            O <strong>Programa de Prevenção Riso+</strong> é o programa de
            prevenção e relacionamento da Risarte, vendido ao cliente com{" "}
            <strong>pagamento mensal recorrente</strong>. Quem adere passa a ter
            consultas e radiografias sem custo, limpeza periódica gratuita,
            descontos nos tratamentos, parcelamento diferenciado e vantagens para
            quem indicar. É um <strong>programa essencial da Risarte</strong> e um
            indicador de sucesso das unidades da rede.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GOALS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border p-3">
                <span className="mb-2 grid size-8 place-items-center rounded-lg bg-gold/15 text-gold-foreground">
                  <Icon className="size-4" />
                </span>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* -- Planos --------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarCheck className="size-4" />
            Planos do programa
          </h2>
          <span className="text-xs text-muted-foreground">
            {plans.length} plano(s) ativo(s)
          </span>
        </div>

        {plans.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum plano ativo. {canConfig && "Cadastre em Configurar programa."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((p) => {
              const planPerks = perks.filter((k) => k.plan_id === p.id);
              const planTiers = tiers.filter((t) => t.plan_id === p.id);
              return (
                <Card key={p.id} className="overflow-hidden">
                  <span className="block h-1 bg-gold" aria-hidden />
                  <CardHeader className="gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatBRL(p.monthly_cents)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          /mês
                        </span>
                      </span>
                    </div>
                    {p.description && (
                      <p className="text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Tag>
                        {p.allows_dependents
                          ? `1 titular + ${p.included_dependents} dependente(s)`
                          : "Adesão individual"}
                      </Tag>
                      {p.allows_extra_dependents && (
                        <Tag>
                          dependente extra {formatBRL(p.extra_dependent_cents)}
                        </Tag>
                      )}
                      {p.social_enabled && <Tag tone="gold">Riso+ Social</Tag>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {planPerks.length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {planPerks.map((k) => (
                          <li key={k.id} className="flex items-start gap-1.5">
                            <span
                              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold"
                              aria-hidden
                            />
                            <span>{k.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="border-t pt-2 text-xs text-muted-foreground">
                      <p>
                        À vista: <strong>{p.cash_discount_percent}%</strong> de
                        desconto · parcelamento em até{" "}
                        <strong>{p.max_installments}×</strong>
                      </p>
                      {planTiers.length > 0 && (
                        <p className="mt-0.5">
                          Parcelado:{" "}
                          {planTiers
                            .map(
                              (t) =>
                                `até ${t.up_to_installments}× = ${t.discount_percent}%`
                            )
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
        Para vender, use o botão <strong>&quot;Oferecer PPR+&quot;</strong> no
        prontuário do cliente ou no cockpit do consultor. O selo no prontuário, o
        cartão do beneficiário e o painel do programa chegam nas próximas etapas.
      </p>
    </div>
  );
}

function Tag({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "gold";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px]",
        tone === "gold"
          ? "border-gold/40 bg-gold/10 text-gold-foreground"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}
