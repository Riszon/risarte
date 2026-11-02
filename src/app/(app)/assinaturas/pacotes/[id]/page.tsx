import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, Circle, FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { AtualizaAoVivo } from "@/components/assinaturas/atualiza-ao-vivo";
import { getSessionContext } from "@/lib/auth";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { canViewSignatures, permissoesDoPacote } from "@/lib/signatures/access";
import { acoesPermitidas } from "@/lib/signatures/actions-permitidas";
import { EVENT_WARNING, rotuloDoEvento } from "@/lib/signatures/eventos";
import { qualificacaoDoTipo } from "@/lib/signatures/qualificacao";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL, SIGNER_STATUS_LABEL, STAGE_LABEL, isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus, SignerStatus } from "@/lib/signatures/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AcoesDoPacote } from "../../acoes-do-pacote";

export const metadata: Metadata = { title: "Pacote de assinatura" };
export const dynamic = "force-dynamic";

/**
 * O DETALHE DO PACOTE (plano ZS0 §10, ZS4): quem é, em que etapa está, quem
 * já assinou, os documentos com a página inicial, a história (eventos) e as
 * ações — cada uma só para quem pode (`acoesPermitidas`). Lê pela RLS: quem
 * não vê o pacote recebe 404, como nas outras fichas.
 */

type Pkg = {
  id: string;
  number: string;
  clinic_id: string;
  audience: "patient" | "company";
  client_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  status: PackageStatus;
  current_stage: PackageStage;
  sent_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  client_signed_at: string | null;
  created_at: string;
  merged_pdf_path: string | null;
  signed_pdf_path: string | null;
  merged_page_count: number | null;
  linked_amount_cents: number | null;
  auth_level_applied: "simple" | "strong" | null;
  auth_reason: string | null;
  sent_by: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  refused_reason: string | null;
  resent_from_package_id: string | null;
  cover_data: { client_name?: string; clinic_name?: string } | null;
  clinics: { name: string } | null;
};

const STAGES: { key: Exclude<PackageStage, "done">; label: string; group: number }[] = [
  { key: "client", label: "Cliente", group: 1 },
  { key: "witnesses", label: "Testemunhas", group: 2 },
  { key: "risarte", label: "Risarte", group: 3 },
];

export default async function PacotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!canViewSignatures(session)) redirect("/");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: pkg } = await supabase
    .from("signature_packages")
    .select(
      "id, number, clinic_id, audience, client_id, company_id, lead_id, status, current_stage, sent_at, expires_at, completed_at, client_signed_at, created_at, merged_pdf_path, signed_pdf_path, merged_page_count, linked_amount_cents, auth_level_applied, auth_reason, sent_by, cancel_reason, cancelled_by, cancelled_at, refused_reason, resent_from_package_id, cover_data, clinics ( name )"
    )
    .eq("id", id)
    .maybeSingle<Pkg>();
  if (!pkg) notFound();

  const admin = createAdminClient();
  const [{ data: items }, { data: signers }, { data: events }, { data: from }, { data: resentAs }, { data: settings }] = await Promise.all([
    supabase.from("signature_package_items").select("id, title, sort_order, first_page, last_page, template_id").eq("package_id", pkg.id).order("sort_order"),
    supabase
      .from("signature_signers")
      .select("id, name, signer_type, order_group, sort_order, status, signed_at, last_notified_at, auth_mode_applied")
      .eq("package_id", pkg.id)
      .order("order_group")
      .order("sort_order"),
    supabase.from("signature_events").select("id, event_type, payload, actor_user_id, error, created_at").eq("package_id", pkg.id).order("created_at", { ascending: false }).limit(60),
    pkg.resent_from_package_id
      ? supabase.from("signature_packages").select("id, number").eq("id", pkg.resent_from_package_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("signature_packages").select("id, number, status").eq("resent_from_package_id", pkg.id).not("sent_at", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("signature_settings").select("zapsign_emails_enabled").eq("id", true).maybeSingle(),
  ]);

  // Os nomes de quem enviou, cancelou e agiu (só o nome; o pacote já é visível a quem lê).
  const people = new Set<string>([pkg.sent_by, pkg.cancelled_by, ...(events ?? []).map((e) => e.actor_user_id)].filter((x): x is string => !!x));
  const { data: profiles } = people.size ? await admin.from("profiles").select("id, full_name").in("id", [...people]) : { data: [] };
  const nome = (uid: string | null) => (uid ? (profiles ?? []).find((p) => p.id === uid)?.full_name || "Alguém da equipe" : null);

  const actions = acoesPermitidas(
    {
      status: pkg.status,
      hasMergedPdf: !!pkg.merged_pdf_path,
      hasSignedPdf: !!pkg.signed_pdf_path,
      wasSent: !!pkg.sent_at,
      audience: pkg.audience,
      zapsignEmailsEnabled: !!settings?.zapsign_emails_enabled,
      resentAs: resentAs?.number ?? null,
    },
    permissoesDoPacote(session, pkg.clinic_id)
  );

  const clientName = pkg.cover_data?.client_name ?? "Cliente";
  const lista = signers ?? [];
  const historia = (events ?? [])
    .map((e) => ({ ...e, label: rotuloDoEvento(e.event_type, e.payload as Record<string, unknown> | null) }))
    .filter((e) => e.label);

  const statusDosSignatarios = (
    <div className="rounded-md border bg-background p-3 text-sm">
      <p className="mb-2 font-medium">Quem assina</p>
      <ul className="space-y-1.5">
        {lista.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            {s.status === "signed" ? (
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span>
              {s.order_group}º {s.name}
              <span className="block text-xs text-muted-foreground">
                {SIGNER_STATUS_LABEL[s.status as SignerStatus]}
                {s.signed_at ? ` em ${formatBrDateTime(s.signed_at)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      {isWaiting(pkg.status) && <AtualizaAoVivo clientId={pkg.client_id ?? undefined} />}
      <CabecalhoDeModulo
        chapeu="Assinaturas digitais"
        icone={FileSignature}
        titulo={`Pacote ${pkg.number}`}
        descricao={`${clientName} · ${pkg.clinics?.name ?? pkg.cover_data?.clinic_name ?? ""}`}
        voltar={{ href: "/assinaturas/pacotes", rotulo: "Pacotes" }}
      />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={PACKAGE_STATUS_CLASS[pkg.status]}>{PACKAGE_STATUS_LABEL[pkg.status]}</Badge>
            {isWaiting(pkg.status) && <span className="text-sm text-muted-foreground">{STAGE_LABEL[pkg.current_stage]}</span>}
            {pkg.client_id && (
              <Link href={`/prontuarios/${pkg.client_id}?aba=documentos`} className="ml-auto text-sm text-primary underline-offset-4 hover:underline">
                Abrir a ficha do paciente
              </Link>
            )}
            {!pkg.client_id && (pkg.company_id || pkg.lead_id) && (
              <Link
                href={pkg.company_id ? `/empresarial/${pkg.company_id}?aba=contratos` : `/empresarial/funil/${pkg.lead_id}/contrato`}
                className="ml-auto text-sm text-primary underline-offset-4 hover:underline"
              >
                {pkg.company_id ? "Abrir a ficha da empresa" : "Abrir o contrato no funil"}
              </Link>
            )}
          </div>

          {/* A etapa: cliente → testemunhas → Risarte. */}
          {pkg.sent_at && (
            <ol className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
              {STAGES.map((st) => {
                const doGrupo = lista.filter((s) => s.order_group === st.group);
                const feito = doGrupo.length > 0 && doGrupo.every((s) => s.status === "signed");
                const atual = isWaiting(pkg.status) && pkg.current_stage === st.key;
                return (
                  <li
                    key={st.key}
                    className={`rounded-md border px-2 py-1.5 text-center ${
                      feito
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                        : atual
                          ? "border-sky-300 bg-sky-50 font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
                          : "text-muted-foreground"
                    }`}
                  >
                    {st.label}
                    <span className="block text-[11px] font-normal">{doGrupo.length === 0 ? "ninguém" : feito ? "assinou" : atual ? "agora" : "aguarda"}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {pkg.sent_at && <Info rotulo="Enviado" valor={`${formatBrDateTime(pkg.sent_at)}${nome(pkg.sent_by) ? ` por ${nome(pkg.sent_by)}` : ""}`} />}
            {pkg.expires_at && isWaiting(pkg.status) && <Info rotulo="Vale até" valor={formatBrDate(pkg.expires_at)} />}
            {pkg.client_signed_at && <Info rotulo="Cliente assinou" valor={formatBrDateTime(pkg.client_signed_at)} />}
            {pkg.completed_at && <Info rotulo="Concluído" valor={formatBrDateTime(pkg.completed_at)} />}
            {pkg.linked_amount_cents != null && <Info rotulo="Valor ligado" valor={formatBRL(pkg.linked_amount_cents)} />}
            {pkg.auth_level_applied && (
              <Info rotulo="Autenticação do cliente" valor={pkg.auth_reason || (pkg.auth_level_applied === "strong" ? "reforçada" : "simples")} />
            )}
            {pkg.status === "cancelled" && (
              <Info
                rotulo="Cancelado"
                valor={`${pkg.cancelled_at ? formatBrDateTime(pkg.cancelled_at) : ""}${nome(pkg.cancelled_by) ? ` por ${nome(pkg.cancelled_by)}` : ""}${pkg.cancel_reason ? ` — ${motivoLegivel(pkg.cancel_reason)}` : ""}`}
              />
            )}
            {pkg.status === "refused" && pkg.refused_reason && <Info rotulo="Motivo da recusa" valor={pkg.refused_reason} />}
            {from && <Info rotulo="Reenvio de" valor={<Link className="text-primary hover:underline" href={`/assinaturas/pacotes/${from.id}`}>{from.number}</Link>} />}
            {resentAs && <Info rotulo="Reenviado como" valor={<Link className="text-primary hover:underline" href={`/assinaturas/pacotes/${resentAs.id}`}>{resentAs.number}</Link>} />}
            {pkg.status === "signed" && !pkg.signed_pdf_path && (
              <p className="text-amber-700 dark:text-amber-300 sm:col-span-2">O PDF assinado ainda está sendo buscado na ZapSign. Enquanto isso, o visualizador mostra o PDF enviado.</p>
            )}
          </dl>

          <AcoesDoPacote
            packageId={pkg.id}
            number={pkg.number}
            clientId={pkg.client_id}
            actions={actions}
            items={(items ?? []).map((i) => ({ id: i.id, title: i.title, firstPage: i.first_page, lastPage: i.last_page }))}
            signersAside={statusDosSignatarios}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signatários</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {lista.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">
                      {s.order_group}º {s.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {qualificacaoDoTipo(s.signer_type)}
                      {s.last_notified_at ? ` · reenviado em ${formatBrDateTime(s.last_notified_at)}` : ""}
                    </span>
                  </span>
                  <span className={`text-xs ${s.status === "signed" ? "text-emerald-700 dark:text-emerald-300" : s.status === "refused" ? "text-destructive" : "text-muted-foreground"}`}>
                    {SIGNER_STATUS_LABEL[s.status as SignerStatus]}
                    {s.signed_at ? ` · ${formatBrDateTime(s.signed_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documentos do pacote</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="divide-y text-sm">
              {(items ?? []).map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {it.title}
                    {!it.template_id && <span className="ml-1 text-xs text-muted-foreground">(PDF anexado)</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {it.first_page ? `pág. ${it.first_page}${it.last_page && it.last_page !== it.first_page ? `–${it.last_page}` : ""}` : "—"}
                  </span>
                </li>
              ))}
            </ol>
            {pkg.merged_page_count && <p className="mt-2 text-xs text-muted-foreground">{pkg.merged_page_count} páginas no total, contando a capa.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que aconteceu</CardTitle>
        </CardHeader>
        <CardContent>
          {historia.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {historia.map((e) => (
                <li key={e.id} className={`flex flex-wrap gap-x-3 ${EVENT_WARNING.has(e.event_type) ? "text-amber-700 dark:text-amber-300" : ""}`}>
                  <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{formatBrDateTime(e.created_at)}</span>
                  <span>
                    {e.label}
                    {nome(e.actor_user_id) ? <span className="text-muted-foreground"> · {nome(e.actor_user_id)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{rotulo}:</dt>
      <dd>{valor}</dd>
    </div>
  );
}

/** Os motivos técnicos de cancelamento, em português. */
function motivoLegivel(reason: string): string {
  switch (reason) {
    case "draft_discarded":
      return "rascunho descartado antes do envio";
    case "pdf_failed":
      return "falha ao montar o PDF";
    case "zapsign_deleted":
      return "excluído na ZapSign";
    default:
      return reason;
  }
}
