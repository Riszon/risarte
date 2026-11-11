import "server-only";

import { prazoDeAssinatura } from "./prazo";
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
import type { SignatureTemplate, StaffSignerOption, TemplateBody } from "./types";
import { telefoneParaZapsign, validarAnexo, validarSignatarios } from "./validate";
import { lerRazaoSocial } from "./razao-social";
import { montarValores } from "./valores";
import { preencherModelo } from "./variables";
import { qualificacaoDoTipo as qualificacao } from "./qualificacao";
import {
  mensagemDoConflito,
  numeroDoConflito,
  pacoteAbertoComOsMesmos,
  pacoteAbertoPeloNumero,
  pacoteAssinadoComOsMesmos,
  podeLiberarNovoEnvio,
  recusaDoNovoEnvio,
  registrarMotivoDoNovoEnvio,
  type PacoteAberto,
  type PacoteAssinado,
} from "./duplicidade";

export { qualificacao };

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
  /**
   * O mesmo documento já assinado por todos: só sai de novo com o MOTIVO
   * escrito, pelo Gerente da unidade ou pelo Admin (`recusaDoNovoEnvio`).
   */
  motivoDoNovoEnvio?: string | null;
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
  | {
      ok: false;
      error: string;
      /** AP108: pacote aguardando assinatura com o mesmo documento — bloqueia. */
      conflito?: PacoteAberto;
      /** O mesmo documento já foi assinado por todos — trava; só sai com motivo. */
      jaAssinado?: PacoteAssinado;
      /** Quem está enviando pode liberar o novo envio (Gerente da unidade ou Admin). */
      podeLiberarNovoEnvio?: boolean;
    };

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
  // 0350: o documento leva a RAZÃO SOCIAL da unidade; sem ela, não sai.
  const razao = await lerRazaoSocial(createAdminClient(), input.clinicId);
  if (!razao.ok) return razao;
  const issuerName = razao.nome;
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
  // AP154: o prazo termina às 23:59 de BRASÍLIA (antes, 23:59 UTC = 20:59 aqui).
  const expiresAt = prazoDeAssinatura(ctx.settings.patientExpiryDays);

  const guardian = ctx.isMinor ? (ctx.guardians[0] ?? null) : null;
  const todayIso = todayInBrazil();
  const valoresSemNumero = montarValores({
    client: ctx.client,
    guardian,
    isMinor: ctx.isMinor,
    clinic: { ...ctx.clinic, legal_name: issuerName },
    treatment: ctx.treatment,
    packageNumber: "",
    todayIso,
  });

  // 1) A porta do banco: o rascunho, os documentos e os signatários.
  const supabase = await createClient();

  // AP108: o mesmo documento aguardando assinatura bloqueia (o banco também
  // recusa, 0361). Já assinado por todos: TRAVA — só sai com o motivo escrito,
  // pelo Gerente da unidade ou pelo Admin (pedido do dono, 04/11/2026).
  const modelos = templates.map((t) => t.id);
  const aberto = await pacoteAbertoComOsMesmos(supabase, { clientId: input.clientId }, modelos, input.session.userId);
  if (aberto) return { ok: false, error: mensagemDoConflito(aberto.number, aberto), conflito: aberto };
  const assinado = await pacoteAssinadoComOsMesmos(supabase, { clientId: input.clientId }, modelos, input.session.userId);
  const podeLiberar = podeLiberarNovoEnvio(input.session, input.clinicId);
  if (assinado) {
    const recusa = recusaDoNovoEnvio({ assinado, motivo: input.motivoDoNovoEnvio, podeLiberar });
    if (recusa) return { ok: false, error: recusa, jaAssinado: assinado, podeLiberarNovoEnvio: podeLiberar };
  }
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
    p_cover_data: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, issuer_name: issuerName, negotiation_id: ctx.negotiationId },
    p_issuer_cnpj: ctx.clinic.cnpj,
  });
  if (rpcError || !created) {
    const conflitoNoBanco = numeroDoConflito(rpcError?.message);
    if (conflitoNoBanco) {
      const conflito = await pacoteAbertoPeloNumero(supabase, conflitoNoBanco, input.session.userId);
      return { ok: false, error: mensagemDoConflito(conflitoNoBanco, conflito), conflito };
    }
    return { ok: false, error: mensagemDaPorta(rpcError?.message) };
  }
  const packageId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);
  if (assinado && input.motivoDoNovoEnvio) {
    await registrarMotivoDoNovoEnvio(createAdminClient(), { packageId, actorUserId: input.session.userId, motivo: input.motivoDoNovoEnvio, anterior: assinado });
  }

  // 2) O PDF: cada modelo, a capa, os anexos, tudo num arquivo.
  const pdf = await gerarPdfDoPacote({
    packageId,
    number,
    clinicId: input.clinicId,
    issuerName,
    issuerCnpj: ctx.clinic.cnpj,
    clientName: ctx.client.full_name,
    docs: templates.map((t) => ({ title: t.name, body: t.body!, provisional: t.is_provisional_text })),
    valores: valoresSemNumero,
    signers: montado.signers,
    attachments: input.attachments.map((a) => ({ title: a.name.replace(/\.pdf$/i, ""), bytes: a.bytes })),
    coverData: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, issuer_name: issuerName, negotiation_id: ctx.negotiationId },
    actorUserId: input.session.userId,
  });
  if (!pdf.ok) return pdf;
  return {
    ok: true,
    packageId,
    number,
    previewUrl: pdf.previewUrl,
    pageCount: pdf.pageCount,
    expiresAt: expiresAt.toISOString(),
    authReason: auth.reason,
    signers: montado.signers.map((s) => ({ name: s.name, qualification: s.qualification, order_group: s.order_group })),
  };
}

export type PdfDoc = { title: string; body: TemplateBody; provisional: boolean };

/**
 * Monta o PDF do pacote (cada modelo preenchido, a capa com o índice, os
 * anexos), grava `merged.pdf` no bucket, acerta as páginas dos itens e
 * devolve a pré-visualização. Serve ao envio (`prepararPacote`) e ao
 * "Reenviar como novo pacote" (ZS4, `reenvio.ts`). Falhou? O rascunho vira
 * `cancelled` com `pdf_failed` (pacote nunca é apagado).
 */
export async function gerarPdfDoPacote(input: {
  packageId: string;
  number: string;
  clinicId: string;
  /** A RAZÃO SOCIAL de quem emite (0350): capa e rodapé. Nunca o nome de fantasia. */
  issuerName: string;
  issuerCnpj: string | null;
  clientName: string;
  docs: PdfDoc[];
  valores: Record<string, string | null | undefined>;
  signers: { sort_order: number; name: string; qualification: string }[];
  attachments: { title: string; bytes: Uint8Array }[];
  coverData: Record<string, unknown>;
  actorUserId: string;
  /** A pasta no bucket: `{unidade}/{público}/{pacote}/` (plano §6). Padrão: paciente. */
  audience?: "patient" | "company";
}): Promise<{ ok: true; previewUrl: string; pageCount: number } | { ok: false; error: string }> {
  const { packageId, number } = input;
  const admin = createAdminClient();
  try {
    const valores = { ...input.valores, documento_numero: number };
    const footer = `${number}  ·  ${input.issuerName}`;
    const boxSpecs = input.signers.map((s) => ({ key: `s${s.sort_order}`, name: s.name, qualification: s.qualification }));
    const docs = [];
    for (const t of input.docs) {
      docs.push(await renderTemplatePdf({ title: t.title, body: preencherModelo(t.body, valores), provisional: t.provisional, footer, signers: boxSpecs }));
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
        ranges.push({ title: input.docs[i].title, firstPage: cursor, lastPage: cursor + d.pageCount - 1 });
        cursor += d.pageCount;
      });
      input.attachments.forEach((a, i) => {
        ranges.push({ title: a.title, firstPage: cursor, lastPage: cursor + attachmentsPages[i] - 1 });
        cursor += attachmentsPages[i];
      });
      cover = await renderCoverPdf({
        packageNumber: number,
        clientName: input.clientName,
        issuerName: input.issuerName,
        issuerCnpj: input.issuerCnpj,
        dateLabel: formatBrDate(new Date()),
        items: ranges,
        signers: input.signers.map((s) => ({ name: s.name, qualification: s.qualification })),
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

    const path = `${input.clinicId}/${input.audience ?? "patient"}/${packageId}/merged.pdf`;
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
        cover_data: { ...input.coverData, placement },
      })
      .eq("id", packageId)
      .eq("status", "draft");
    if (upd.error) throw new Error(`DB: ${upd.error.message}`);

    const { data: items } = await admin.from("signature_package_items").select("id, sort_order").eq("package_id", packageId).order("sort_order");
    for (const it of items ?? []) {
      const r = merged.ranges[it.sort_order + 1];
      if (r) await admin.from("signature_package_items").update({ first_page: r.first_page, last_page: r.last_page }).eq("id", it.id);
    }
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "pdf_generated", actor_user_id: input.actorUserId, payload: { pages: merged.pageCount, bytes: merged.bytes.byteLength } });

    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 60); // AP158 (item 9): 60 s, como o resto do módulo (o visualizador baixa o PDF inteiro de uma vez)
    if (signed.error || !signed.data) throw new Error(`STORAGE_URL: ${signed.error?.message}`);

    return { ok: true, previewUrl: signed.data.signedUrl, pageCount: merged.pageCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("signature prepare failed:", msg);
    await admin.from("signature_events").insert({ package_id: packageId, event_type: "pdf_failed", actor_user_id: input.actorUserId, error: msg.slice(0, 500) });
    await admin.from("signature_packages").update({ status: "cancelled", cancel_reason: "pdf_failed", cancelled_at: new Date().toISOString() }).eq("id", packageId).eq("status", "draft");
    if (msg === "PACKAGE_TOO_LARGE") return { ok: false, error: "O pacote passou de 10 MB (limite da ZapSign). Tire algum anexo ou divida em dois envios." };
    return { ok: false, error: "Não foi possível montar o PDF do pacote. Tente de novo; se repetir, avise o suporte." };
  }
}

/** O mês do consumo do plano da ZapSign ("2026-11"), no relógio de Brasília. */
export function mesDoConsumo(quando: Date): string {
  return formatInBrazil(quando, { year: "numeric", month: "2-digit" }).split("/").reverse().join("-");
}

/** A criação pode ter acontecido mesmo sem resposta (tempo esgotado, rede, 5xx). */
export function criacaoIncerta(e: unknown): boolean {
  if (!(e instanceof ZapsignError)) return false;
  return e.code === "timeout" || e.code === "network" || (e.httpStatus ?? 0) >= 500;
}

export const MENSAGEM_ENVIO_EM_ANDAMENTO =
  "Este pacote já está sendo enviado (outro clique ou outra aba). Aguarde alguns segundos e confira a ficha antes de tentar de novo.";

/**
 * AP151: a reserva do envio. Devolve a mensagem da recusa, ou `null` quando
 * esta tentativa pode seguir. A chave `send_claim|pacote|N` (N = falhas já
 * registradas) é única em `signature_events.event_key`.
 */
export async function reservarEnvio(admin: ReturnType<typeof createAdminClient>, packageId: string, userId: string): Promise<string | null> {
  const { count, error } = await admin
    .from("signature_events")
    .select("id", { count: "exact", head: true })
    .eq("package_id", packageId)
    .eq("event_type", "send_failed");
  if (error || count === null) return "Não foi possível conferir o pacote agora. Tente de novo em instantes.";
  const { error: erro } = await admin.from("signature_events").insert({
    package_id: packageId,
    event_type: "send_claimed",
    event_key: `send_claim|${packageId}|${count}`,
    actor_user_id: userId,
  });
  if (!erro) return null;
  if (erro.code === "23505") return MENSAGEM_ENVIO_EM_ANDAMENTO;
  console.error("signature send claim failed:", erro.message);
  return "Não foi possível reservar o envio agora. Tente de novo em instantes.";
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

  // AP151: RESERVA O ENVIO antes de criar na ZapSign. Dois cliques ou duas
  // abas criavam dois documentos (o perdedor ficava vivo lá, fora do riSZon).
  // A chave do evento é única: só uma tentativa por vez passa. Depois de uma
  // falha registrada (`send_failed`), a chave muda e a pessoa pode tentar de
  // novo.
  const reserva = await reservarEnvio(admin, pkg.id, input.session.userId);
  if (reserva) return { ok: false, error: reserva };

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
        plan_month: mesDoConsumo(now),
        channel_used: fake ? "fake" : "zapsign",
      })
      .eq("id", pkg.id)
      .eq("status", "draft")
      .select("id");
    if (u.error) throw new Error(`DB: ${u.error.message}`);
    // ZS8: a gravação só vale sobre rascunho. Se nada foi gravado, o documento
    // JÁ está na ZapSign e os links já existem — não desfazer; deixar no rastro
    // para alguém olhar (antes ficava calado e o pacote perdia quem enviou).
    if ((u.data ?? []).length === 0) {
      console.error("signature send: package was no longer a draft when marking it sent");
      await admin.from("signature_events").insert({
        package_id: pkg.id,
        event_type: "send_mark_skipped",
        actor_user_id: input.session.userId,
        error: "O pacote já não era rascunho ao gravar o envio (quem enviou e o mês do consumo podem faltar).",
      });
    }
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
    // AP151: o documento criado é cancelado na ZapSign; se o cancelamento
    // falhar, o token FICA no rastro (antes só ia para o log e o documento
    // vivo ficava sem registro no riSZon).
    let cancelado: boolean | null = null;
    if (docToken) {
      // AP158 (item 4): a ZapSign cobra o documento AO CRIAR, mesmo cancelado
      // logo depois. Antes o mês do consumo só era gravado no sucesso, e o
      // alerta de 80%/100% contava a menos.
      await admin.from("signature_packages").update({ plan_month: mesDoConsumo(new Date()) }).eq("id", pkg.id).eq("status", "draft");
      try {
        if (fake) await refuseDocumentFake();
        else await refuseDocument({ doc_token: docToken, rejected_reason: "riSZon: falha ao concluir o envio", notify_signer: false });
        cancelado = true;
      } catch (e2) {
        cancelado = false;
        console.error("signature refuse after failure failed:", e2 instanceof Error ? e2.message : String(e2));
      }
    }
    await admin.from("signature_events").insert({
      package_id: pkg.id,
      event_type: "send_failed",
      actor_user_id: input.session.userId,
      error: msg.slice(0, 500),
      payload: {
        doc_token: docToken,
        doc_cancelled: cancelado,
        // Sem resposta da criação, o documento PODE existir na ZapSign: a
        // conferência (scripts/conferir-assinatura-digital.mjs) acha pelo
        // external_id = este pacote.
        creation_uncertain: !docToken && criacaoIncerta(e),
      },
    });
    await admin.from("signature_signers").update({ zapsign_signer_token: null, sign_url: null }).eq("package_id", pkg.id);
    // AP108: outro envio do mesmo documento passou na frente (0361) — o
    // documento recém-criado já foi cancelado na ZapSign acima.
    const conflito = numeroDoConflito(msg);
    if (conflito) {
      const aberto = await pacoteAbertoPeloNumero(admin, conflito, input.session.userId);
      return { ok: false, error: `${mensagemDoConflito(conflito, aberto)} Este envio foi desfeito na ZapSign.` };
    }
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


export function mensagemDaPorta(msg: string | undefined): string {
  const m = msg ?? "";
  if (m.includes("NOT_ALLOWED")) return "Você não tem permissão para enviar documentos nesta unidade.";
  if (m.includes("CLIENT_NOT_FOUND")) return "O paciente não pertence a esta unidade.";
  if (m.includes("LEAD_NOT_FOUND")) return "Este lead não foi encontrado no funil.";
  if (m.includes("COMPANY_NOT_FOUND")) return "Esta empresa não foi encontrada.";
  if (m.includes("ORIGIN_REQUIRED") || m.includes("ORIGIN_INVALID") || m.includes("CLIENT_NOT_ALLOWED")) return "A origem do envio é inválida para uma empresa.";
  if (m.includes("ITEMS_REQUIRED")) return "Escolha ao menos um documento.";
  if (m.includes("SIGNERS_REQUIRED")) return "O pacote precisa de ao menos um signatário.";
  const conflito = numeroDoConflito(m);
  if (conflito) return mensagemDoConflito(conflito);
  if (/does not exist|Could not find the function/i.test(m)) return "A assinatura digital ainda não está instalada neste banco (falta a migração 0342).";
  return "Não foi possível criar o pacote. Tente de novo em instantes.";
}

export { type SendOrigin };
