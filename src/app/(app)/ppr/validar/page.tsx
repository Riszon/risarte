import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CircleAlert,
  ScanLine,
  SearchX,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPpr } from "@/lib/ppr/access";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";

export const metadata: Metadata = { title: "Validar cartão do PPR+" };

/**
 * Confere o cartão do beneficiário pelo código: diz na hora se o plano está
 * ativo, qual é o plano e o que ele inclui.
 */
export default async function PprValidatePage(
  props: PageProps<"/ppr/validar">
) {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");

  const sp = await props.searchParams;
  const raw = Array.isArray(sp.codigo) ? sp.codigo[0] : sp.codigo;
  const code = (raw ?? "").trim().toUpperCase();

  let result:
    | {
        found: true;
        name: string;
        clientId: string;
        planName: string;
        status: PprStatus;
        role: string;
        relationship: string | null;
        activatedAt: string | null;
        left: boolean;
        perks: string[];
      }
    | { found: false }
    | null = null;

  if (code) {
    const supabase = await createClient();
    const { data: b } = await supabase
      .from("ppr_beneficiaries")
      .select(
        "id, role, relationship, left_at, client:clients!ppr_beneficiaries_client_id_fkey ( id, full_name ), membership:ppr_memberships ( status, activated_at, plan:ppr_plans ( id, name ) )"
      )
      .eq("card_code", code)
      .maybeSingle();

    if (!b) result = { found: false };
    else {
      const one = <T,>(v: T | T[] | null | undefined): T | null =>
        Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
      const client = one(
        b.client as unknown as
          | { id: string; full_name: string }
          | { id: string; full_name: string }[]
          | null
      );
      const membership = one(
        b.membership as unknown as
          | { status: string; activated_at: string | null; plan: unknown }
          | { status: string; activated_at: string | null; plan: unknown }[]
          | null
      );
      const plan = one(
        (membership?.plan ?? null) as
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null
      );
      const { data: perkRows } = plan
        ? await supabase
            .from("ppr_plan_perks")
            .select("label, sort_order")
            .eq("plan_id", plan.id)
            .order("sort_order")
        : { data: [] };

      result = {
        found: true,
        name: client?.full_name ?? "Cliente",
        clientId: client?.id ?? "",
        planName: plan?.name ?? "PPR+",
        status: (membership?.status ?? "cancelado") as PprStatus,
        role: b.role as string,
        relationship: b.relationship as string | null,
        activatedAt: membership?.activated_at ?? null,
        left: Boolean(b.left_at),
        perks: ((perkRows ?? []) as { label: string }[]).map((p) => p.label),
      };
    }
  }

  const ok =
    result && result.found && result.status === "ativo" && !result.left;

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <ScanLine className="size-3.5" />
            PPR+
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Validar cartão
          </h1>
          <p className="text-sm text-muted-foreground">
            Digite o código do cartão do cliente para conferir se o plano está
            ativo.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/ppr" />}
        >
          <ArrowLeft className="mr-1 size-3.5" />
          Programa
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            method="get"
            action="/ppr/validar"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="min-w-0 flex-1 text-xs">
              <span className="text-muted-foreground">Código do cartão</span>
              <Input
                name="codigo"
                defaultValue={code}
                placeholder="PPR-XXXX-XXXX"
                className="font-mono uppercase"
                autoFocus
              />
            </label>
            <Button type="submit">Conferir</Button>
          </form>
        </CardContent>
      </Card>

      {result && !result.found && (
        <Card className="border-rose-300">
          <CardContent className="flex items-center gap-3 py-6">
            <SearchX className="size-6 text-rose-600" />
            <div>
              <p className="font-medium">Cartão não encontrado</p>
              <p className="text-sm text-muted-foreground">
                Confira o código digitado — ele tem o formato PPR-XXXX-XXXX.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.found && (
        <Card className={cn(ok ? "border-emerald-300" : "border-amber-300")}>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {ok ? (
                <BadgeCheck className="size-5 text-emerald-600" />
              ) : (
                <CircleAlert className="size-5 text-amber-600" />
              )}
              {ok ? "Benefícios liberados" : "Benefícios bloqueados"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {result.name} · {result.planName} ·{" "}
              {result.role === "titular"
                ? "titular"
                : (result.relationship ?? "dependente")}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Situação do plano:{" "}
              <strong>{PPR_STATUS_LABELS[result.status]}</strong>
              {result.left && " · este beneficiário saiu do plano"}
              {result.activatedAt &&
                ` · ativo desde ${new Date(result.activatedAt).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}`}
            </p>

            {ok && result.perks.length > 0 && (
              <ul className="space-y-1 text-sm">
                {result.perks.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold"
                      aria-hidden
                    />
                    {p}
                  </li>
                ))}
              </ul>
            )}

            {result.clientId && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/prontuarios/${result.clientId}`} />}
              >
                Abrir prontuário
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
