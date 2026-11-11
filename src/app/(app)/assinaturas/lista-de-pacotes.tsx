import { Badge } from "@/components/ui/badge";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { permissoesPorUnidade } from "@/lib/signatures/acesso-no-banco";

const SEM_PERMISSAO = { view: false, download: false, send: false, cancel: false };
import { acoesPermitidas } from "@/lib/signatures/actions-permitidas";
import { PACKAGE_STATUS_CLASS, PACKAGE_STATUS_LABEL, SIGNER_STATUS_LABEL, STAGE_LABEL, isWaiting } from "@/lib/signatures/status";
import type { PackageStage, PackageStatus, SignerStatus } from "@/lib/signatures/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AcoesDoPacote } from "./acoes-do-pacote";

/**
 * A LISTA DE PACOTES de uma ficha — a do paciente (aba Documentos, ZS2/ZS4) e
 * a da empresa ou do lead (ZS5). Cada pacote com a situação, quem já assinou
 * e as mesmas ações do detalhe, cada uma só para quem pode
 * (`acoesPermitidas`). Lê pela RLS: quem não pode ver não vê.
 */

export const PACOTE_DA_LISTA_SELECT =
  "id, number, status, current_stage, sent_at, expires_at, completed_at, created_at, clinic_id, audience, merged_pdf_path, signed_pdf_path, signature_package_items ( id, title, sort_order, first_page, last_page ), signature_signers ( name, order_group, sort_order, status )";

export type PacoteDaLista = {
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

/** Rascunho descartado antes do envio não interessa a ninguém na ficha. */
export function pacotesVisiveis(pacotes: PacoteDaLista[]): PacoteDaLista[] {
  return pacotes.filter((p) => p.status !== "draft" && !(p.status === "cancelled" && !p.sent_at));
}

export async function ListaDePacotes({
  pacotes,
  clientId,
  vazio,
}: {
  pacotes: PacoteDaLista[];
  clientId: string | null;
  vazio: string;
}) {
  if (pacotes.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">{vazio}</p>;
  }
  const supabase = await createClient();
  const ids = pacotes.map((p) => p.id);
  const [{ data: reenvios }, { data: settings }] = await Promise.all([
    supabase.from("signature_packages").select("number, resent_from_package_id").in("resent_from_package_id", ids).not("sent_at", "is", null),
    createAdminClient().from("signature_settings").select("zapsign_emails_enabled").eq("id", true).maybeSingle(),
  ]);

  // AP158 (item 2): a tela segue o banco — uma pergunta por unidade.
  const perguntar = permissoesPorUnidade(supabase);
  const unidades = [...new Set(pacotes.map((p) => p.clinic_id))];
  const permissoes = new Map(await Promise.all(unidades.map(async (c) => [c, await perguntar(c)] as const)));

  return (
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
          permissoes.get(p.clinic_id) ?? SEM_PERMISSAO
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
  );
}
