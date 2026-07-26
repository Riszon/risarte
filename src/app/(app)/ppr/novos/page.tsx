import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarPlus, Clock, HeartPulse, Users } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewPpr } from "@/lib/ppr/access";
import { PPR_STATUS_LABELS, type PprStatus } from "@/lib/ppr/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Novos beneficiários do PPR+" };

/** "2 meses e 12 dias", "15 dias", "hoje" — quanto tempo desde a entrada. */
function elapsedLabel(from: string, now = new Date()): string {
  const start = new Date(from);
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  const anchor = new Date(start);
  anchor.setMonth(anchor.getMonth() + months);
  if (anchor > now) {
    months -= 1;
    anchor.setMonth(anchor.getMonth() - 1);
  }
  const days = Math.max(
    0,
    Math.floor((now.getTime() - anchor.getTime()) / 86_400_000)
  );
  if (months <= 0 && days === 0) return "hoje";
  if (months <= 0) return `${days} dia${days === 1 ? "" : "s"}`;
  const m = `${months} ${months === 1 ? "mês" : "meses"}`;
  if (days === 0) return m;
  return `${m} e ${days} dia${days === 1 ? "" : "s"}`;
}

/**
 * Lista da RECEPÇÃO: quem entrou no PPR+ e ainda **não tem agendamento nem
 * atendimento**. É a fila de "ligar e marcar a primeira limpeza".
 */
export default async function PprNewBeneficiariesPage() {
  const session = await getSessionContext();
  if (!canViewPpr(session)) redirect("/");

  const clinicId = session.activeClinic?.id ?? null;
  const supabase = await createClient();

  let query = supabase
    .from("ppr_beneficiaries")
    .select(
      "id, role, relationship, joined_at, clinic_id, client:clients!ppr_beneficiaries_client_id_fkey ( id, full_name, code, phone ), membership:ppr_memberships ( id, status, activated_at, created_at, holder_client_id, plan:ppr_plans ( name ), holder:clients!ppr_memberships_holder_client_id_fkey ( id, full_name ) ), clinic:clinics!ppr_beneficiaries_clinic_id_fkey ( name )"
    )
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (clinicId) query = query.eq("clinic_id", clinicId);
  const { data: rows, error } = await query;
  if (error) console.error("PprNewBeneficiariesPage failed:", error.message);

  type Row = {
    id: string;
    role: string;
    relationship: string | null;
    joined_at: string;
    client:
      | { id: string; full_name: string; code: string | null; phone: string | null }
      | { id: string; full_name: string; code: string | null; phone: string | null }[]
      | null;
    membership:
      | {
          id: string;
          status: string;
          activated_at: string | null;
          created_at: string;
          plan: { name: string } | { name: string }[] | null;
          holder: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
        }
      | {
          id: string;
          status: string;
          activated_at: string | null;
          created_at: string;
          plan: { name: string } | { name: string }[] | null;
          holder: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
        }[]
      | null;
    clinic: { name: string } | { name: string }[] | null;
  };
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const beneficiaries = ((rows ?? []) as unknown as Row[]).filter((b) => {
    const m = one(b.membership);
    return m && m.status !== "cancelado";
  });

  // Quem JÁ tem agendamento (qualquer situação) ou atendimento registrado sai
  // da lista — a fila é de quem ainda não foi marcado.
  const clientIds = [
    ...new Set(
      beneficiaries
        .map((b) => one(b.client)?.id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const scheduled = new Set<string>();
  if (clientIds.length > 0) {
    const [{ data: appts }, { data: sessions }] = await Promise.all([
      supabase
        .from("appointments")
        .select("client_id, status")
        .in("client_id", clientIds),
      supabase
        .from("treatment_sessions")
        .select("client_id, status")
        .in("client_id", clientIds),
    ]);
    for (const a of (appts ?? []) as { client_id: string; status: string }[]) {
      if (a.status !== "cancelled") scheduled.add(a.client_id);
    }
    for (const s of (sessions ?? []) as { client_id: string; status: string }[]) {
      if (s.status === "done") scheduled.add(s.client_id);
    }
  }

  const pending = beneficiaries.filter((b) => {
    const c = one(b.client);
    return c && !scheduled.has(c.id);
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <HeartPulse className="size-3.5" />
            PPR+
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Novos beneficiários sem agendamento
          </h1>
          <p className="text-sm text-muted-foreground">
            {session.activeClinic?.name ?? "Rede"} · {pending.length} pessoa(s)
            esperando o primeiro contato da recepção.
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

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Todos os beneficiários do PPR+ já têm agendamento ou atendimento. 🎉
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {pending.map((b) => {
            const c = one(b.client);
            const m = one(b.membership);
            const plan = one(m?.plan ?? null);
            const holder = one(m?.holder ?? null);
            const clinic = one(b.clinic);
            const since = b.joined_at ?? m?.created_at ?? "";
            const isHolder = b.role === "titular";
            return (
              <li
                key={b.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {c?.full_name ?? "Cliente"}
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[10px] uppercase",
                        isHolder
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      {isHolder ? "titular" : (b.relationship ?? "dependente")}
                    </span>
                    {m && m.status !== "ativo" && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                        {PPR_STATUS_LABELS[m.status as PprStatus]}
                      </span>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {c?.code && <span className="font-mono">{c.code}</span>}
                    <span>{plan?.name ?? "PPR+"}</span>
                    {clinic?.name && <span>{clinic.name}</span>}
                    {c?.phone && <span>{c.phone}</span>}
                  </p>
                  {!isHolder && holder && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3" />
                      Titular:{" "}
                      <Link
                        href={`/prontuarios/${holder.id}`}
                        className="text-primary hover:underline"
                      >
                        {holder.full_name}
                      </Link>
                    </p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1 text-xs">
                    <Clock className="size-3 text-amber-600" />
                    <strong>{since ? elapsedLabel(since) : "—"}</strong> no PPR+
                    {since && (
                      <span className="text-muted-foreground">
                        · entrou em{" "}
                        {new Date(since).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c?.id && (
                    <>
                      <Button
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/agenda?cliente=${c.id}`} />}
                      >
                        <CalendarPlus className="mr-1 size-3.5" />
                        Agendar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href={`/prontuarios/${c.id}`} />}
                      >
                        Prontuário
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
