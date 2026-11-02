import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { getSessionContext } from "@/lib/auth";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { canViewSignatureNetworkDashboard, canViewSignaturePackages, canViewSignatures } from "@/lib/signatures/access";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL, STAGE_LABEL, isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus } from "@/lib/signatures/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pacotes de assinatura" };
export const dynamic = "force-dynamic";

/**
 * A LISTA DE PACOTES (ZS4): o que foi enviado para assinatura, com filtros
 * simples — situação, público, unidade (só para quem vê a rede) e busca por
 * número ou nome do cliente. A RLS já recorta o que cada um vê (a unidade,
 * a rede, o RisLife só os seus). O painel com indicadores é a ZS7.
 */

const LIMIT = 100;
const STATUSES: PackageStatus[] = ["sent", "partially_signed", "signed", "refused", "expired", "cancelled"];

type Row = {
  id: string;
  number: string;
  status: PackageStatus;
  current_stage: PackageStage;
  audience: "patient" | "company";
  sent_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  cover_data: { client_name?: string } | null;
  clinics: { name: string } | null;
  signature_package_items: { title: string; sort_order: number }[];
};

export default async function PacotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSessionContext();
  if (!canViewSignatures(session)) redirect("/");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.situacao as PackageStatus) ? (sp.situacao as PackageStatus) : sp.situacao === "aguardando" ? "aguardando" : null;
  const publico = sp.publico === "patient" || sp.publico === "company" ? sp.publico : null;
  const busca = (sp.busca ?? "").replace(/[%,()*"\\]/g, " ").trim().slice(0, 60);
  const rede = canViewSignatureNetworkDashboard(session);
  const unidade = rede && sp.unidade && /^[0-9a-f-]{36}$/i.test(sp.unidade) ? sp.unidade : null;
  const podeVer = canViewSignaturePackages(session);

  const supabase = await createClient();
  let q = supabase
    .from("signature_packages")
    .select("id, number, status, current_stage, audience, sent_at, expires_at, completed_at, cover_data, clinics ( name ), signature_package_items ( title, sort_order )")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(LIMIT);
  if (status === "aguardando") q = q.in("status", ["sent", "partially_signed"]);
  else if (status) q = q.eq("status", status);
  if (publico) q = q.eq("audience", publico);
  if (unidade) q = q.eq("clinic_id", unidade);
  if (busca) q = q.or(`number.ilike."*${busca}*",cover_data->>client_name.ilike."*${busca}*"`);
  const { data, error } = await q.returns<Row[]>();

  const unidades = rede
    ? ((await createAdminClient().from("clinics").select("id, name").order("name")).data ?? [])
    : [];
  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileSignature}
        titulo="Pacotes enviados"
        descricao="Tudo o que foi enviado para assinatura digital, do mais recente para o mais antigo. Clique no número para ver o pacote, o PDF e as ações."
        voltar={{ href: "/assinaturas", rotulo: "Assinaturas" }}
      />

      <FilterForm className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Situação</span>
          <select name="situacao" defaultValue={sp.situacao ?? ""} className="rounded-md border bg-background px-2 py-1.5">
            <option value="">Todas</option>
            <option value="aguardando">Aguardando assinatura</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PACKAGE_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Público</span>
          <select name="publico" defaultValue={publico ?? ""} className="rounded-md border bg-background px-2 py-1.5">
            <option value="">Todos</option>
            <option value="patient">Pacientes</option>
            <option value="company">Empresas</option>
          </select>
        </label>
        {rede && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Unidade</span>
            <select name="unidade" defaultValue={unidade ?? ""} className="max-w-56 rounded-md border bg-background px-2 py-1.5">
              <option value="">Todas</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Buscar (número ou cliente) — Enter</span>
          <input name="busca" defaultValue={busca} placeholder="Ex.: ASS-000013 ou Maria" className="rounded-md border bg-background px-2 py-1.5" />
        </label>
      </FilterForm>

      <Card>
        <CardContent className="pt-4">
          {!podeVer ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Você não tem permissão para ver os pacotes de assinatura.</p>
          ) : error ? (
            <p className="text-sm text-destructive">Não foi possível ler os pacotes. Tente de novo em instantes.</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum pacote com esses filtros.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((p) => {
                const itens = [...p.signature_package_items].sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/assinaturas/pacotes/${p.id}`} className="font-mono font-medium text-primary hover:underline">
                        {p.number}
                      </Link>{" "}
                      · <span className="font-medium">{p.cover_data?.client_name ?? "—"}</span>
                      <p className="truncate text-xs text-muted-foreground">
                        {itens.map((i) => i.title).join(" + ")}
                        {rede && p.clinics?.name ? ` · ${p.clinics.name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <Badge className={PACKAGE_STATUS_CLASS[p.status]}>{PACKAGE_STATUS_LABEL[p.status]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {p.sent_at ? `Enviado ${formatBrDateTime(p.sent_at)}` : ""}
                        {isWaiting(p.status) ? ` · ${STAGE_LABEL[p.current_stage]}` : ""}
                        {isWaiting(p.status) && p.expires_at ? ` · até ${formatBrDate(p.expires_at)}` : ""}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.length === LIMIT && <p className="mt-2 text-xs text-muted-foreground">Mostrando os {LIMIT} mais recentes. Use os filtros para achar os mais antigos.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
