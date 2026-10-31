import { FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL, SIGNER_STATUS_LABEL, STAGE_LABEL, isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus, SignerStatus } from "@/lib/signatures/types";
import { createClient } from "@/lib/supabase/server";
import { EnviarParaAssinaturaDialog } from "./enviar-dialog";

/**
 * O BLOCO "ASSINATURAS DIGITAIS" DA ABA DOCUMENTOS DA FICHA (plano ZS0 §4.7):
 * os pacotes do paciente, a situação de cada um e quem já assinou. Lê pela
 * RLS (quem não pode ver não vê). O detalhe do pacote e as ações (reenviar,
 * cancelar, baixar) chegam na ZS4; aqui é a lista e o botão de enviar.
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
  signature_package_items: { title: string; sort_order: number }[];
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
      "id, number, status, current_stage, sent_at, expires_at, completed_at, created_at, signature_package_items ( title, sort_order ), signature_signers ( name, order_group, sort_order, status )"
    )
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<PackageRow[]>();

  const pacotes = (data ?? []).filter((p) => !(p.status === "cancelled" && !p.sent_at));

  return (
    <Card>
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
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {signers.map((s, i) => (
                      <li key={i} className={s.status === "signed" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                        {s.order_group}º {s.name}: {SIGNER_STATUS_LABEL[s.status]}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
