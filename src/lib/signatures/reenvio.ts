import "server-only";

import type { SessionContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isZapsignConfigured, isZapsignFake } from "@/lib/zapsign";
import { canSendSignatures } from "./access";
import { extrairPaginas } from "./pdf/copy";
import { lerRazaoSocial } from "./razao-social";
import { BUCKET, gerarPdfDoPacote, mensagemDaPorta, qualificacao, type PdfDoc, type PrepareResult } from "./send";
import type { TemplateBody } from "./types";

/**
 * "REENVIAR COMO NOVO PACOTE" (ZS4) — para o pacote recusado, expirado ou
 * cancelado. Pacote não volta à vida (a ZapSign não reabre documento
 * recusado/expirado), então nasce OUTRO, com:
 *
 *   * os mesmos documentos, na mesma ordem: modelo com o texto ATUAL do
 *     modelo e os valores RETRATADOS no envio original (`rendered_data`) —
 *     só o número do pacote muda; anexo avulso = as páginas dele recortadas
 *     do PDF original (o arquivo enviado não fica guardado à parte);
 *   * os mesmos signatários, na mesma ordem e com a mesma autenticação;
 *   * a mesma origem (cliente, negociação, plano) e o valor ligado;
 *   * prazo novo, contado de hoje pela configuração;
 *   * `resent_from_package_id` apontando o antigo.
 *
 * Devolve o rascunho com a pré-visualização, como o passo 3 da janela de
 * envio; dali em diante é o mesmo caminho (`enviarPacote` /
 * `descartarRascunho`).
 */

type OldItem = {
  sort_order: number;
  template_id: string | null;
  title: string;
  rendered_data: Record<string, string | null> | null;
  first_page: number | null;
  last_page: number | null;
  origin_type: string | null;
  origin_id: string | null;
};

type OldSigner = {
  sort_order: number;
  order_group: number;
  signer_type: string;
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  staff_member_id: string | null;
  auth_mode_applied: string | null;
};

export async function reenviarComoNovo(session: SessionContext, packageId: string): Promise<PrepareResult> {
  // 1) O antigo, pela sessão de quem pediu (RLS: quem não vê não reenvia).
  const supabase = await createClient();
  const { data: old } = await supabase
    .from("signature_packages")
    .select(
      "id, number, clinic_id, status, audience, origin_type, origin_id, client_id, sent_at, merged_pdf_path, linked_amount_cents, auth_level_applied, auth_reason, issuer_cnpj, cover_data"
    )
    .eq("id", packageId)
    .maybeSingle();
  if (!old) return { ok: false, error: "Pacote não encontrado, ou você não tem acesso a ele." };
  if (!canSendSignatures(session, old.clinic_id)) return { ok: false, error: "Você não tem permissão para enviar documentos nesta unidade." };
  if (!["refused", "expired", "cancelled"].includes(old.status) || !old.sent_at) {
    return { ok: false, error: "Só pacote recusado, expirado ou cancelado depois de enviado pode ser reenviado como novo." };
  }
  if (old.audience !== "patient" || !old.client_id) return { ok: false, error: "O reenvio como novo pacote vale só para pacientes por enquanto." };
  if (!isZapsignConfigured() && !isZapsignFake()) {
    return { ok: false, error: "A ZapSign não está configurada neste ambiente (falta o token). Peça ao Admin Master." };
  }

  const admin = createAdminClient();
  const { data: already } = await admin
    .from("signature_packages")
    .select("number")
    .eq("resent_from_package_id", old.id)
    .not("sent_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (already) return { ok: false, error: `Este pacote já foi reenviado como ${already.number}.` };

  const [{ data: itemsRaw }, { data: signersRaw }, { data: settings }, { data: clinic }] = await Promise.all([
    supabase
      .from("signature_package_items")
      .select("sort_order, template_id, title, rendered_data, first_page, last_page, origin_type, origin_id")
      .eq("package_id", old.id)
      .order("sort_order"),
    supabase
      .from("signature_signers")
      .select("sort_order, order_group, signer_type, name, cpf, email, phone, user_id, staff_member_id, auth_mode_applied")
      .eq("package_id", old.id)
      .order("sort_order"),
    admin.from("signature_settings").select("patient_expiry_days").eq("id", true).maybeSingle(),
    admin.from("clinics").select("name").eq("id", old.clinic_id).maybeSingle(),
  ]);
  // 0350: o pacote novo sai com a razão social de HOJE (e não sai sem ela).
  const razao = await lerRazaoSocial(admin, old.clinic_id);
  if (!razao.ok) return razao;
  const issuerName = razao.nome;
  const items = (itemsRaw ?? []) as OldItem[];
  const signers = (signersRaw ?? []) as OldSigner[];
  if (items.length === 0 || signers.length === 0) return { ok: false, error: "O pacote original está incompleto (sem documentos ou signatários)." };

  // 2) O texto atual de cada modelo.
  const templateIds = items.map((i) => i.template_id).filter((x): x is string => !!x);
  const { data: templates } = templateIds.length
    ? await admin.from("signature_templates").select("id, name, body, is_provisional_text").in("id", templateIds)
    : { data: [] as { id: string; name: string; body: TemplateBody | null; is_provisional_text: boolean }[] };
  const docs: PdfDoc[] = [];
  const attachments: { title: string; bytes: Uint8Array }[] = [];
  let merged: Uint8Array | null = null;
  for (const it of items) {
    if (it.template_id) {
      const t = (templates ?? []).find((x) => x.id === it.template_id);
      if (!t?.body) return { ok: false, error: `O modelo "${it.title}" não tem mais texto cadastrado. Envie um pacote novo pela ficha.` };
      docs.push({ title: it.title, body: t.body as TemplateBody, provisional: t.is_provisional_text });
    } else {
      if (!old.merged_pdf_path || !it.first_page || !it.last_page) {
        return { ok: false, error: `O anexo "${it.title}" não pode ser recuperado do pacote original. Envie um pacote novo pela ficha.` };
      }
      if (!merged) {
        const file = await supabase.storage.from(BUCKET).download(old.merged_pdf_path);
        if (file.error || !file.data) return { ok: false, error: "Não foi possível ler o PDF do pacote original." };
        merged = new Uint8Array(await file.data.arrayBuffer());
      }
      const doc = await extrairPaginas(merged, it.first_page, it.last_page);
      attachments.push({ title: it.title, bytes: await doc.save() });
    }
  }
  // Os modelos vêm antes dos anexos, como no envio (a ordem do PDF manda).
  const orderedItems = [...items.filter((i) => i.template_id), ...items.filter((i) => !i.template_id)];

  // 3) O rascunho novo pela porta do banco (a guarda de quem envia vale de novo).
  const expiryDays = settings?.patient_expiry_days ?? 7;
  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000);
  expiresAt.setUTCHours(23, 59, 0, 0);
  const oldCover = (old.cover_data ?? {}) as { client_name?: string; clinic_name?: string; negotiation_id?: string | null };
  const clientName = oldCover.client_name ?? "Paciente";
  const clinicName = clinic?.name ?? oldCover.clinic_name ?? "";
  const coverData = { client_name: clientName, clinic_name: clinicName, issuer_name: issuerName, negotiation_id: oldCover.negotiation_id ?? null, resent_from: old.number };
  const valores = { ...(orderedItems.find((i) => i.rendered_data)?.rendered_data ?? {}), unidade_razao_social: issuerName };

  const { data: created, error: rpcError } = await supabase.rpc("signature_create_package", {
    p_clinic_id: old.clinic_id,
    p_audience: "patient",
    p_origin_type: old.origin_type,
    p_origin_id: old.origin_id,
    p_client_id: old.client_id,
    p_linked_amount_cents: old.linked_amount_cents,
    p_auth_level: old.auth_level_applied ?? "simple",
    p_auth_reason: old.auth_reason,
    p_expires_at: expiresAt.toISOString(),
    p_items: orderedItems.map((it, i) => ({
      template_id: it.template_id,
      title: it.title,
      sort_order: i,
      rendered_data: it.rendered_data,
      origin_type: it.origin_type,
      origin_id: it.origin_id,
    })),
    p_signers: signers,
    p_cover_data: coverData,
    p_issuer_cnpj: old.issuer_cnpj,
  });
  if (rpcError || !created) return { ok: false, error: mensagemDaPorta(rpcError?.message) };
  const newId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);
  await admin.from("signature_packages").update({ resent_from_package_id: old.id }).eq("id", newId).eq("status", "draft");
  await admin.from("signature_events").insert({ package_id: newId, event_type: "resent_from", actor_user_id: session.userId, payload: { from_package_id: old.id } });

  // 4) O PDF novo, igual ao do envio.
  const signerSpecs = signers.map((s) => ({ sort_order: s.sort_order, name: s.name, qualification: qualificacao(s.signer_type) }));
  const pdf = await gerarPdfDoPacote({
    packageId: newId,
    number,
    clinicId: old.clinic_id,
    issuerName,
    issuerCnpj: old.issuer_cnpj ?? null,
    clientName,
    docs,
    valores,
    signers: signerSpecs,
    attachments,
    coverData,
    actorUserId: session.userId,
  });
  if (!pdf.ok) return pdf;
  return {
    ok: true,
    packageId: newId,
    number,
    previewUrl: pdf.previewUrl,
    pageCount: pdf.pageCount,
    expiresAt: expiresAt.toISOString(),
    authReason: old.auth_reason ?? "",
    signers: signers.map((s) => ({ name: s.name, qualification: qualificacao(s.signer_type), order_group: s.order_group })),
  };
}
