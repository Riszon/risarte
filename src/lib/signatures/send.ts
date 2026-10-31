import "server-only";

import type { SessionContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { formatBrDate, formatInBrazil, todayInBrazil } from "@/lib/dates";
import { montarMensagem, primeiroNome } from "@/lib/notify/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ZapsignError,
  createDocumentFromPdf,
  createDocumentFromPdfFake,
  isZapsignFake,
  mensagemDaZapsign,
  placeSignatures,
  placeSignaturesFake,
  refuseDocument,
  refuseDocumentFake,
  zapsignEnv,
} from "@/lib/zapsign";
import type { ZapsignCreateDocInput, ZapsignSignerInput } from "@/lib/zapsign/types";
import { canSendSignatures } from "./access";
import { modoDeAutenticacao, nivelDeAutenticacao } from "./auth-level";
import { loadSendContext, type SendOrigin } from "./envio-dados";
import { renderCoverPdf } from "./pdf/cover";
import { MAX_PACKAGE_BYTES, bytesToBase64, inspectAttachment, mergePdfs } from "./pdf/merge";
import { renderTemplatePdf } from "./pdf/render-template";
import { montarRubricas, type DocumentPlacement } from "./pdf/signature-block";
import { candidatosDoRepresentante, montarSignatarios } from "./signers";
import type { SignatureTemplate, SignerDraft, StaffSignerOption } from "./types";
import { telefoneParaZapsign, validarAnexo, validarSignatarios } from "./validate";
import { montarValores } from "./valores";
import { preencherModelo } from "./variables";

/**
 * O FLUXO DE ENVIO (plano ZS0 §5.3), em duas gravações:
 *
 *   1. `prepararPacote`  — a porta `signature_create_package` cria o rascunho
 *      (quem envia, com a guarda do banco); o servidor gera o PDF, grava no
 *      bucket e devolve o link de pré-visualização. Nada vai para a ZapSign.
 *   2. `enviarPacote`    — cria o documento na ZapSign com o PDF gravado,
 *      posiciona assinaturas e rubricas, guarda tokens e links, marca `sent`.
 *      Falhou depois de criar? Cancela lá (`refuse`) e o pacote volta a
 *      rascunho, com o erro no `signature_events`.
 *   3. `descartarRascunho` — quem desistiu antes do envio: vira `cancelled`
 *      (pacote nunca é apagado, 0340).
 *
 * As escritas depois da porta são pela chave de serviço: a guarda já passou
 * na criação, e o pacote é conferido (`created_by`, `status`) antes de cada
 * passo.
 */

export const BUCKET = "signature-documents";

export type PrepareInput = {
  session: SessionContext;
  clientId: string;
  clinicId: string;
  origin: SendOrigin;
  templateIds: string[];
  witnessKeys: string[];
  /** template_id → chave da pessoa escolhida para assinar pela Risarte. */
  representativeKeys: Record<string, string>;
  attachments: { name: string; bytes: Uint8Array }[];
};

export type PrepareResult =
  | {
      ok: true;
      packageId: string;
      number: string;
      previewUrl: string;
      pageCount: number;
      expiresAt: string;
      authReason: string;
      signers: { name: string; qualification: string; order_group: number }[];
    }
  | { ok: false; error: string };

export type SendResult =
  | {
      ok: true;
      number: string;
      links: { name: string; qualification: string; order_group: number; signUrl: string; phone: string | null; message: string }[];
    }
  | { ok: false; error: string };

type Placement = { coverPages: number; documents: DocumentPlacement[] };

export async function prepararPacote(input: PrepareInput): Promise<PrepareResult> {
  const loaded = await loadSendContext(input);
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;
  if (!ctx.zapsign.configured) {
    return { ok: false, error: "A ZapSign não está configurada neste ambiente (falta o token). Peça ao Admin Master." };
  }

  const templates: SignatureTemplate[] = [];
  for (const id of input.templateIds) {
    const t = ctx.templates.find((x) => x.id === id);
    if (t && !templates.some((x) => x.id === id)) templates.push(t);
  }
  if (templates.length === 0 && input.attachments.length === 0) {
    return { ok: false, error: "Escolha ao menos um documento para enviar." };
  }
  if (templates.some((t) => !t.body)) {
    return { ok: false, error: "Um dos modelos escolhidos não tem texto cadastrado. Veja em Assinaturas → Configurações → Modelos." };
  }
  for (const a of input.attachments) {
    const erro = validarAnexo({ name: a.name, size: a.bytes.byteLength, type: "application/pdf" });
    if (erro) return { ok: false, error: `Anexo: ${erro}` };
    const insp = await inspectAttachment(a.bytes);
    if (!insp.ok) return { ok: false, error: `Anexo "${a.name}": ${insp.error}` };
  }

  const witnesses = input.witnessKeys
    .map((k) => ctx.staff.find((s) => s.key === k) ?? null)
    .filter((s): s is StaffSignerOption => s !== null);
  const representatives = templates.map((t) => {
    const candidatos = candidatosDoRepresentante({
      template: t,
      sender: ctx.sender,
      staff: ctx.staff,
      byRole: { ...ctx.byRole, [""]: ctx.byRole.owner ?? [] },
    });
    const lista = t.risarte_signer_mode === "role" && !t.risarte_signer_role ? (ctx.byRole.owner ?? []) : candidatos;
    const escolhido = input.representativeKeys[t.id];
    return (escolhido ? lista.find((c) => c.key === escolhido) : null) ?? lista[0] ?? null;
  });

  const montado = montarSignatarios({
    client: { name: ctx.client.full_name, cpf: ctx.client.cpf, email: ctx.client.email, phone: ctx.client.phone, birthDate: ctx.client.birth_date },
    guardians: ctx.guardians,
    todayIso: todayInBrazil(),
    templates,
    witnesses,
    representatives,
  });
  if (montado.blockers.length > 0) return { ok: false, error: montado.blockers.join(" ") };
  const problemas = validarSignatarios(montado.signers);
  if (problemas.length > 0) {
    return { ok: false, error: problemas.map((p) => `${p.signer}: ${p.message}`).join(" ") };
  }

  const linkedAmountCents = ctx.treatment?.totalCents ?? null;
  const auth = nivelDeAutenticacao({ templates, linkedAmountCents, thresholdCents: ctx.settings.thresholdCents });
  const expiresAt = new Date(Date.now() + ctx.settings.patientExpiryDays * 86_400_000);
  expiresAt.setUTCHours(23, 59, 0, 0);

  const guardian = ctx.isMinor ? (ctx.guardians[0] ?? null) : null;
  const todayIso = todayInBrazil();
  const valoresSemNumero = montarValores({
    client: ctx.client,
    guardian,
    isMinor: ctx.isMinor,
    clinic: ctx.clinic,
    treatment: ctx.treatment,
    packageNumber: "",
    todayIso,
  });

  // 1) A porta do banco: o rascunho, os documentos e os signatários.
  const supabase = await createClient();
  const signersPayload = montado.signers.map((s) => ({
    ...s,
    auth_mode_applied: modoDeAutenticacao({ level: auth.level, orderGroup: s.order_group, phone: s.phone, email: s.email }).auth_mode,
  }));
  const itemsPayload = [
    ...templates.map((t, i) => ({
      template_id: t.id,
      title: t.name,
      sort_order: i,
      rendered_data: valoresSemNumero,
      origin_type: input.origin.type,
      origin_id: input.origin.id,
    })),
    ...input.attachments.map((a, i) => ({
      template_id: null,
      title: a.name.replace(/\.pdf$/i, ""),
      sort_order: templates.length + i,
      rendered_data: null,
      origin_type: null,
      origin_id: null,
    })),
  ];
  const { data: created, error: rpcError } = await supabase.rpc("signature_create_package", {
    p_clinic_id: input.clinicId,
    p_audience: "patient",
    p_origin_type: input.origin.type,
    p_origin_id: input.origin.id,
    p_client_id: input.clientId,
    p_linked_amount_cents: linkedAmountCents,
    p_auth_level: auth.level,
    p_auth_reason: auth.reason,
    p_expires_at: expiresAt.toISOString(),
    p_items: itemsPayload,
    p_signers: signersPayload,
    p_cover_data: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, negotiation_id: ctx.negotiationId },
    p_issuer_cnpj: ctx.clinic.cnpj,
  });
  if (rpcError || !created) {
    return { ok: false, error: mensagemDaPorta(rpcError?.message) };
  }
  const packageId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);

  // 2) O PDF: cada modelo, a capa, os anexos, tudo num arquivo.
  const admin = createAdminClient();
  try {
    const valores = { ...valoresSemNumero, documento_numero: number };
    const footer = `${number}  ·  ${ctx.clinic.name}`;
    const boxSpecs = montado.signers.map((s) => ({ key: signerKey(s), name: s.name, qualification: s.qualification }));
    const docs = [];
    for (const t of templates) {
      docs.push(await renderTemplatePdf({ title: t.name, body: preencherModelo(t.body!, valores), provisional: t.is_provisional_text, footer, signers: boxSpecs }));
    }
    const attachmentsPages: number[] = [];
    for (const a of input.attachments) {
      const insp = await inspectAttachment(a.bytes);
      attachmentsPages.push(insp.ok ? insp.pageCount : 0);
    }
    // A capa tem uma página; se crescer, a segunda passagem acerta o índice.
    let coverPages = 1;
    let cover: Uint8Array;
    let ranges: { title: string; firstPage: number; lastPage: number }[];
    for (let pass = 0; ; pass++) {
      let cursor = coverPages + 1;
      ranges = [];
      docs.forEach((d, i) => {
        ranges.push({ title: templates[i].name, firstPage: cursor, lastPage: cursor + d.pageCount - 1 });
        cursor += d.pageCount;
      });
      input.attachments.forEach((a, i) => {
        ranges.push({ title: a.name.replace(/\.pdf$/i, ""), firstPage: cursor, lastPage: cursor + attachmentsPages[i] - 1 });
        cursor += attachmentsPages[i];
      });
      cover = await renderCoverPdf({
        packageNumber: number,
        clientName: ctx.client.full_name,
        clinicName: ctx.clinic.name,
        dateLabel: formatBrDate(new Date()),
        items: ranges,
        signers: montado.signers.map((s) => ({ name: s.name, qualification: s.qualification })),
      });
      const { PDFDocument } = await import("pdf-lib");
      const n = (await PDFDocument.load(cover)).getPageCount();
      if (n === coverPages || pass > 0) break;
      coverPages = n;
    }
    const merged = await mergePdfs([{ bytes: cover! }, ...docs.map((d) => ({ bytes: d.bytes })), ...input.attachments.map((a) => ({ bytes: a.bytes }))]);
    if (merged.bytes.byteLength > MAX_PACKAGE_BYTES) {
      throw new Error("PACKAGE_TOO_LARGE");
    }

    const path = `${input.clinicId}/patient/${packageId}/merged.pdf`;
    const up = await admin.storage.from(BUCKET).upload(path, new Blob([Buffer.from(merged.bytes)], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    if (up.error) throw new Error(`STORAGE: ${up.error.message}`);

    const placement: Placement = {
      coverPages,
      documents: docs.map((d, i) => ({ firstPage: merged.ranges[i + 1].first_page, boxes: d.boxes })),
    };
    const upd = await admin
      .from("signature_packages")
      .update({
        merged_pdf_path: path,
        merged_page_count: merged.pageCount,
        cover_data: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, negotiation_id: ctx.negotiationId, placement },
      })
      .eq("id", packageId)
      .eq("status", "draft");
    if (upd.error) throw new Error(`DB: ${upd.error.message}`);

    const { data: items } = await admin.from("signature_package_items").select("id, sort_order").eq("package_id", packageId).order("sort_order");
    for (const it of items ?? []) {
      const r = merged.ranges[it.sort_order + 1];
      if (r) await admin.from("signature_package_items").update({ first_page: r.first_page, last_page: r.last_page }).eq("id", it.id);
    }
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "pdf_generated", actor_user_id: input.session.userId, payload: { pages: merged.pageCount, bytes: merged.bytes.byteLength } });

    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
    if (signed.error || !signed.data) throw new Error(`STORAGE_URL: ${signed.error?.message}`);

    return {
      ok: true,
      packageId,
      number,
      previewUrl: signed.data.signedUrl,
      pageCount: merged.pageCount,
      expiresAt: expiresAt.toISOString(),
      authReason: auth.reason,
      signers: montado.signers.map((s) => ({ name: s.name, qualification: s.qualification, order_group: s.order_group })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("signature prepare failed:", msg);
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "pdf_failed", actor_user_id: input.session.userId, error: msg.slice(0, 500) });
    await admin.from("signature_packages").update({ status: "cancelled", cancel_reason: "pdf_failed", cancelled_at: new Date().toISOString() }).eq("id", packageId).eq("status", "draft");
    if (msg === "PACKAGE_TOO_LARGE") return { ok: false, error: "O pacote passou de 10 MB (limite da ZapSign). Tire algum anexo ou divida em dois envios." };
    return { ok: false, error: "Não foi possível montar o PDF do pacote. Tente de novo; se repetir, avise o suporte." };
  }
}

export async function enviarPacote(input: { session: SessionContext; packageId: string }): Promise<SendResult> {
  const admin = createAdminClient();
  const { data: pkg, error } = await admin
    .from("signature_packages")
    .select("id, number, clinic_id, client_id, status, created_by, merged_pdf_path, expires_at, cover_data, auth_level_applied")
    .eq("id", input.packageId)
    .maybeSingle();
  if (error || !pkg) return { ok: false, error: "Pacote não encontrado." };
  if (pkg.created_by !== input.session.userId || !canSendSignatures(input.session, pkg.clinic_id)) {
    return { ok: false, error: "Só quem preparou o pacote pode enviá-lo." };
  }
  if (pkg.status !== "draft") return { ok: false, error: "Este pacote já foi enviado (ou foi cancelado)." };
  if (!pkg.merged_pdf_path) return { ok: false, error: "O PDF do pacote ainda não foi gerado." };
  const placement = (pkg.cover_data as { placement?: Placement } | null)?.placement;
  if (!placement) return { ok: false, error: "O pacote está incompleto: gere a pré-visualização de novo." };

  const [{ data: signers }, { data: settingsRow }, { data: clinic }, file] = await Promise.all([
    admin.from("signature_signers").select("id, sort_order, order_group, signer_type, name, cpf, email, phone, auth_mode_applied").eq("package_id", pkg.id).order("sort_order"),
    admin.from("signature_settings").select("default_message, zapsign_emails_enabled").eq("id", true).maybeSingle(),
    admin.from("clinics").select("name").eq("id", pkg.clinic_id).maybeSingle(),
    admin.storage.from(BUCKET).download(pkg.merged_pdf_path),
  ]);
  if (!signers?.length) return { ok: false, error: "O pacote não tem signatários." };
  if (file.error || !file.data) return { ok: false, error: "Não foi possível ler o PDF gravado." };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const emailsEnabled = settingsRow?.zapsign_emails_enabled ?? false;
  const clientName = (pkg.cover_data as { client_name?: string } | null)?.client_name ?? "Paciente";

  const zapSigners: ZapsignSignerInput[] = signers.map((s) => {
    const tel = telefoneParaZapsign(s.phone);
    const strong = pkg.auth_level_applied === "strong" && s.order_group === 1;
    return {
      name: s.name,
      email: s.email ?? undefined,
      ...(tel ?? {}),
      auth_mode: (s.auth_mode_applied as ZapsignSignerInput["auth_mode"]) ?? "assinaturaTela",
      order_group: s.order_group,
      qualification: qualificacao(s.signer_type),
      external_id: s.id,
      cpf: s.cpf ?? undefined,
      require_cpf: true,
      validate_cpf: true,
      require_selfie_photo: strong,
      require_document_photo: false,
      send_automatic_email: emailsEnabled,
      send_automatic_whatsapp: false,
      lock_name: true,
      lock_cpf: !!s.cpf,
    };
  });
  const docInput: ZapsignCreateDocInput = {
    name: `${pkg.number} — ${clientName}`,
    base64_pdf: bytesToBase64(bytes),
    external_id: pkg.id,
    lang: "pt-br",
    disable_signer_emails: !emailsEnabled,
    date_limit_to_sign: pkg.expires_at ?? undefined,
    signature_order_active: true,
    allow_refuse_signature: true,
    metadata: [{ key: "package", value: pkg.number }],
    signers: zapSigners,
    sandbox: zapsignEnv() === "sandbox",
  };

  const fake = isZapsignFake();
  let docToken: string | null = null;
  try {
    const doc = fake ? await createDocumentFromPdfFake(docInput) : await createDocumentFromPdf(docInput);
    docToken = doc.token;
    const byExternal = new Map((doc.signers ?? []).map((z) => [z.external_id ?? "", z]));
    const tokens: { key: string; token: string }[] = [];
    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      const z = byExternal.get(s.id) ?? doc.signers?.[i];
      if (!z?.token) throw new Error("ZapSign did not return a token for every signer");
      tokens.push({ key: `s${s.sort_order}`, token: z.token });
      const u = await admin.from("signature_signers").update({ zapsign_signer_token: z.token, sign_url: z.sign_url ?? null }).eq("id", s.id);
      if (u.error) throw new Error(`DB: ${u.error.message}`);
    }
    const pageCount = (await admin.from("signature_packages").select("merged_page_count").eq("id", pkg.id).maybeSingle()).data?.merged_page_count ?? 0;
    const rubricas = montarRubricas({
      pageCount,
      skipPages: Array.from({ length: placement.coverPages }, (_, i) => i),
      documents: placement.documents,
      signerTokens: tokens,
    });
    if (rubricas.length > 0) {
      if (fake) await placeSignaturesFake(doc.token, rubricas);
      else await placeSignatures(doc.token, rubricas);
    }
    const now = new Date();
    const u = await admin
      .from("signature_packages")
      .update({
        status: "sent",
        current_stage: "client",
        sent_at: now.toISOString(),
        sent_by: input.session.userId,
        zapsign_doc_token: doc.token,
        zapsign_open_id: doc.open_id ?? null,
        plan_month: formatInBrazil(now, { year: "numeric", month: "2-digit" }).split("/").reverse().join("-"),
        channel_used: fake ? "fake" : "zapsign",
      })
      .eq("id", pkg.id)
      .eq("status", "draft");
    if (u.error) throw new Error(`DB: ${u.error.message}`);
    await admin.from("signature_events").insert({
      package_id: pkg.id,
      event_type: "sent",
      actor_user_id: input.session.userId,
      payload: { doc_token: doc.token, signers: tokens.length, fake },
    });
    await logAudit({ action: "create", entityType: "signature_package", entityId: pkg.id, clinicId: pkg.clinic_id });

    const { data: updated } = await admin.from("signature_signers").select("name, signer_type, order_group, sign_url, phone").eq("package_id", pkg.id).order("sort_order");
    const prazo = pkg.expires_at ? formatBrDate(pkg.expires_at) : "";
    const unidade = clinic?.name ?? "";
    const template = settingsRow?.default_message ?? "{{link}}";
    return {
      ok: true,
      number: pkg.number,
      links: (updated ?? []).map((s) => ({
        name: s.name,
        qualification: qualificacao(s.signer_type),
        order_group: s.order_group,
        signUrl: s.sign_url ?? "",
        phone: s.phone,
        message: montarMensagem(template, { nome: primeiroNome(s.name), unidade, link: s.sign_url ?? "", prazo }),
      })),
    };
  } catch (e) {
    const msg = e instanceof ZapsignError ? e.logMessage : e instanceof Error ? e.message : String(e);
    console.error("signature send failed:", msg);
    if (docToken) {
      try {
        if (fake) await refuseDocumentFake();
        else await refuseDocument({ doc_token: docToken, rejected_reason: "riSZon: falha ao concluir o envio", notify_signer: false });
      } catch (e2) {
        console.error("signature refuse after failure failed:", e2 instanceof Error ? e2.message : String(e2));
      }
    }
    await admin.from("signature_events").insert({ package_id: pkg.id, event_type: "send_failed", actor_user_id: input.session.userId, error: msg.slice(0, 500) });
    await admin.from("signature_signers").update({ zapsign_signer_token: null, sign_url: null }).eq("package_id", pkg.id);
    return { ok: false, error: e instanceof ZapsignError ? mensagemDaZapsign(e) : "Não foi possível enviar à ZapSign. O pacote continua como rascunho; tente de novo." };
  }
}

export async function descartarRascunho(input: { session: SessionContext; packageId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: pkg } = await admin.from("signature_packages").select("id, status, created_by").eq("id", input.packageId).maybeSingle();
  if (!pkg) return { ok: false, error: "Pacote não encontrado." };
  if (pkg.created_by !== input.session.userId) return { ok: false, error: "Só quem preparou o pacote pode descartá-lo." };
  if (pkg.status !== "draft") return { ok: true };
  const u = await admin
    .from("signature_packages")
    .update({ status: "cancelled", cancel_reason: "draft_discarded", cancelled_by: input.session.userId, cancelled_at: new Date().toISOString() })
    .eq("id", pkg.id)
    .eq("status", "draft");
  if (u.error) return { ok: false, error: "Não foi possível descartar o rascunho." };
  await admin.from("signature_events").insert({ package_id: pkg.id, event_type: "draft_discarded", actor_user_id: input.session.userId });
  return { ok: true };
}

function signerKey(s: SignerDraft): string {
  return `s${s.sort_order}`;
}

function qualificacao(signerType: string): string {
  switch (signerType) {
    case "client":
      return "Paciente";
    case "legal_guardian":
      return "Responsável legal";
    case "witness":
      return "Testemunha";
    case "risarte_representative":
      return "Representante da Risarte";
    case "company_representative":
      return "Representante da empresa";
    default:
      return "Signatário";
  }
}

function mensagemDaPorta(msg: string | undefined): string {
  const m = msg ?? "";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para enviar documentos nesta unidade.";
  if (m.includes("CLIENT_NOT_FOUND")) return "O paciente não pertence a esta unidade.";
  if (m.includes("ITEMS_REQUIRED")) return "Escolha ao menos um documento.";
  if (m.includes("SIGNERS_REQUIRED")) return "O pacote precisa de ao menos um signatário.";
  if (/does not exist|Could not find the function/i.test(m)) return "A assinatura digital ainda não está instalada neste banco (falta a migração 0342).";
  return "Não foi possível criar o pacote. Tente de novo em instantes.";
}

export { type SendOrigin };
