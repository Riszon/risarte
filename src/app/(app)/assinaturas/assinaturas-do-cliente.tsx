import { FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL, SIGNER_STATUS_LABEL, STAGE_LABEL, isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus, SignerStatus } from "@/lib/signatures/types";
import { getSessionContext } from "@/lib/auth";
import { permissoesDoPacote } from "@/lib/signatures/access";
import { acoesPermitidas } from "@/lib/signatures/actions-permitidas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AcoesDoPacote } from "./acoes-do-pacote";
import { EnviarParaAssinaturaDialog } from "./enviar-dialog";
import { AtualizaAoVivo } from "@/components/assinaturas/atualiza-ao-vivo";

/**
 * O BLOCO "ASSINATURAS DIGITAIS" DA ABA DOCUMENTOS DA FICHA (plano ZS0 §4.7):
 * os pacotes do paciente, a situação de cada um e quem já assinou. Lê pela
 * RLS (quem não pode ver não vê). Desde a ZS4 cada pacote tem as mesmas ações
 * do detalhe (visualizar, baixar, reenviar, cancelar, reenviar como novo),
 * cada uma só para quem pode (`acoesPermitidas`), e o link para o detalhe.
 */

type PackageRow = {
  id: string;
  number: string;
  status: PackageStatus;
  current_stage: PackageStage;
  sent_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  created_at: string;
  clinic_id: string;
  audience: "patient" | "company";
  merged_pdf_path: string | null;
  signed_pdf_path: string | null;
  signature_package_items: { id: string; title: string; sort_order: number; first_page: number | null; last_page: number | null }[];
  signature_signers: { name: string; order_group: number; sort_order: number; status: SignerStatus }[];
};

export async function AssinaturasDoCliente({
  clientId,
  clinicId,
  canSend,
}: {
  clientId: string;
  clinicId: string;
  canSend: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("signature_packages")
    .select(
      "id, number, status, current_stage, sent_at, expires_at, completed_at, created_at, clinic_id, audience, merged_pdf_path, signed_pdf_path, signature_package_items ( id, title, sort_order, first_page, last_page ), signature_signers ( name, order_group, sort_order, status )"
    )
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<PackageRow[]>();

  const pacotes = (data ?? []).filter((p) => !(p.status === "cancelled" && !p.sent_at));
  const session = await getSessionContext();
  const ids = pacotes.map((p) => p.id);
  const [{ data: reenvios }, { data: settings }] = await Promise.all([
    ids.length
      ? supabase.from("signature_packages").select("number, resent_from_package_id").in("resent_from_package_id", ids).not("sent_at", "is", null)
      : Promise.resolve({ data: [] as { number: string; resent_from_package_id: string | null }[] }),
    createAdminClient().from("signature_settings").select("zapsign_emails_enabled").eq("id", true).maybeSingle(),
  ]);

  return (
    <Card>
      {pacotes.some((p) => isWaiting(p.status)) && <AtualizaAoVivo clientId={clientId} />}
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4 text-gold-tinta" />
            Assinaturas digitais
          </CardTitle>
          {canSend && <EnviarParaAssinaturaDialog clientId={clientId} clinicId={clinicId} origin={{ type: "client", id: clientId }} />}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">Não foi possível ler as assinaturas deste paciente.</p>
        ) : pacotes.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">Nenhum documento enviado para assinatura digital ainda.</p>
        ) : (
          <ul className="space-y-2">
            {pacotes.map((p) => {
              const itens = [...p.signature_package_items].sort((a, b) => a.sort_order - b.sort_order);
              const signers = [...p.signature_signers].sort((a, b) => a.order_group - b.order_group || a.sort_order - b.sort_order);
              const resentAs = (reenvios ?? []).find((r) => r.resent_from_package_id === p.id)?.number ?? null;
              const actions = acoesPermitidas(
                {
                  status: p.status,
                  hasMergedPdf: !!p.merged_pdf_path,
                  hasSignedPdf: !!p.signed_pdf_path,
                  wasSent: !!p.sent_at,
                  audience: p.audience,
                  zapsignEmailsEnabled: !!settings?.zapsign_emails_enabled,
                  resentAs,
                },
                permissoesDoPacote(session, p.clinic_id)
              );
              return (
                <li key={p.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      <span className="font-mono">{p.number}</span> · {itens.map((i) => i.title).join(" + ")}
                    </p>
                    <Badge className={PACKAGE_STATUS_CLASS[p.status]}>{PACKAGE_STATUS_LABEL[p.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.sent_at ? `Enviado em ${formatBrDateTime(p.sent_at)}` : `Criado em ${formatBrDateTime(p.created_at)}`}
                    {isWaiting(p.status) ? ` · ${STAGE_LABEL[p.current_stage]}` : ""}
                    {isWaiting(p.status) && p.expires_at ? ` · vale até ${formatBrDate(p.expires_at)}` : ""}
                    {p.completed_at ? ` · concluído em ${formatBrDateTime(p.completed_at)}` : ""}
                  </p>
                  {resentAs && <p className="mt-1 text-xs text-muted-foreground">Reenviado como {resentAs}.</p>}
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {signers.map((s, i) => (
                      <li key={i} className={s.status === "signed" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                        {s.order_group}º {s.name}: {SIGNER_STATUS_LABEL[s.status]}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <AcoesDoPacote
                      compacto
                      packageId={p.id}
                      number={p.number}
                      clientId={clientId}
                      actions={actions}
                      items={itens.map((i) => ({ id: i.id, title: i.title, firstPage: i.first_page, lastPage: i.last_page }))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
