import "server-only";

import type { SessionContext } from "@/lib/auth";
import { anexoDoContrato, carregarContratoDoLead, type ContratoDoLead } from "@/lib/empresarial/contrato-do-lead";
import { corpoDoContratoParaAssinatura } from "@/lib/empresarial/contrato-para-assinatura";
import { lerContratada } from "@/lib/empresarial/contrato-dados";
import { isProgramManager, isRislifeConsultant } from "@/lib/empresarial/access";
import { empresarialAdminDb, empresarialDb } from "@/lib/empresarial/db";
import { COMPANY_DOCS_BUCKET, COMPANY_FILE_TYPE_LABELS, type CompanyFileType } from "@/lib/empresarial/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isZapsignConfigured, isZapsignFake, zapsignEnv } from "@/lib/zapsign/env";
import { canSendSignatures } from "./access";
import { modoDeAutenticacao, nivelDeAutenticacao } from "./auth-level";
import { loadStaffOptions } from "./envio-dados";
import { inspectAttachment } from "./pdf/merge";
import { gerarPdfDoPacote, mensagemDaPorta, type PrepareResult } from "./send";
import { loadSignatureSettings } from "./settings";
import { candidatosDoRepresentante, montarSignatariosDaEmpresa } from "./signers";
import type { SignatureTemplate, StaffSignerOption, TemplateBody } from "./types";
import { validarAnexo, validarSignatarios } from "./validate";
import { corpoValido } from "./variables";

/**
 * O ENVIO PARA ASSINATURA DE UMA EMPRESA (ZS5, plano ZS0 §4.6).
 *
 * Duas origens, o mesmo caminho:
 *   * o LEAD do funil (tela do contrato): o contrato de adesão montado com a
 *     proposta salva — a MESMA leitura que a tela desenha
 *     (`carregarContratoDoLead`);
 *   * a EMPRESA (aba Contratos): aditivos e outros PDFs; e o contrato de
 *     adesão quando a empresa veio do funil (o lead de origem tem a proposta).
 *
 * Decisões do dono (02/11/2026):
 *   1. Campo em branco no contrato BLOQUEIA o envio; aviso não bloqueia, mas
 *      quem envia confirma que leu.
 *   2. Assina pela empresa o responsável da proposta (corrigível na janela).
 *   3. Pela Risarte, o do modelo (padrão: o titular); a janela avisa quando o
 *      nome difere do representante digitado em Configurações → Contrato.
 *   4. Autenticação = a do modelo; sem o corte de R$ (a mensalidade não é um
 *      valor único como o orçamento do paciente).
 *   5. Prazo = o configurado para empresas.
 *
 * A guarda é dupla: a tela (gestor do programa ou Consultor RisLife, e
 * `acao.assinaturas.enviar` na Franqueadora) e o banco (a porta da 0345
 * confere a empresa/lead e a trava do RisLife).
 */

export type EmpresaOrigin = { type: "commercial_lead" | "company"; id: string };

export type RepresentanteDaEmpresa = { name: string | null; role: string | null; cpf: string | null; email: string | null; phone: string | null };

export type EmpresaSendContext = {
  origin: EmpresaOrigin;
  leadId: string | null;
  companyId: string | null;
  companyName: string;
  clinic: { id: string; name: string };
  template: SignatureTemplate;
  /** O contrato de adesão: só existe quando há um lead com a proposta. */
  contrato:
    | { disponivel: true; titulo: string; faltando: string[]; avisos: string[]; dados: ContratoDoLead }
    | { disponivel: false; motivo: string };
  representante: RepresentanteDaEmpresa;
  /** Os PDFs já guardados na aba Documentos da empresa (lidos pela RLS). */
  arquivosGuardados: ArquivoGuardado[];
  contratada: { legalName: string | null; cnpj: string | null; repName: string | null };
  settings: { companyExpiryDays: number; defaultMessage: string };
  sender: StaffSignerOption;
  staff: StaffSignerOption[];
  byRole: Record<string, StaffSignerOption[]>;
  /**
   * AP95: quem assina pela Risarte quando o modelo pede o Consultor RisLife —
   * o responsável pela empresa/lead; sem ele, quem envia
   * (`semConsultorResponsavel`). É a mesma pessoa que o texto do contrato cita.
   */
  responsavel: StaffSignerOption | null;
  semConsultorResponsavel: boolean;
  zapsign: { configured: boolean; fake: boolean; env: "sandbox" | "production" };
};

type LoadResult = { ok: true; ctx: EmpresaSendContext } | { ok: false; error: string };

export type ArquivoGuardado = { id: string; nome: string; tipo: string; storagePath: string };

/**
 * Um anexo do pacote, NA ORDEM em que entra (depois do contrato de adesão,
 * que vai sempre primeiro): um PDF que veio do computador ou um arquivo já
 * guardado na aba Documentos da empresa.
 */
export type AnexoDoPacote =
  | { origem: "computador"; name: string; bytes: Uint8Array }
  | { origem: "guardado"; arquivoId: string };

/**
 * A unidade emissora do pacote da empresa: a Franqueadora (é a Risarte
 * Administração quem contrata). Quem tem função numa Franqueadora usa a sua;
 * o Admin Master, a Franqueadora ativa ou a primeira da lista.
 */
export function clinicaEmissoraDaEmpresa(session: SessionContext): { id: string; name: string } | null {
  const franqueadoras = session.clinics.filter((c) => c.type === "franchisor" && c.is_active !== false);
  const comFuncao = franqueadoras.find((c) => (session.rolesByClinic[c.id] ?? []).length > 0);
  const ativa = session.activeClinic?.type === "franchisor" ? session.activeClinic : null;
  const c = comFuncao ?? ativa ?? franqueadoras[0] ?? null;
  return c ? { id: c.id, name: c.name } : null;
}

export async function loadEmpresaSendContext(input: { session: SessionContext; origin: EmpresaOrigin }): Promise<LoadResult> {
  const { session, origin } = input;
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    return { ok: false, error: "Você não tem acesso ao Risarte Empresarial." };
  }
  const clinic = clinicaEmissoraDaEmpresa(session);
  if (!clinic) return { ok: false, error: "Não encontrei a Franqueadora entre as suas unidades: o contrato da empresa sai por ela." };
  if (!canSendSignatures(session, clinic.id)) {
    return { ok: false, error: "Você não tem permissão para enviar documentos para assinatura pela Franqueadora." };
  }

  const db = await empresarialDb();
  let leadId: string | null = null;
  let companyId: string | null = null;
  let companyName = "";
  let representante: RepresentanteDaEmpresa = { name: null, role: null, cpf: null, email: null, phone: null };
  // O Consultor RisLife responsável (da empresa; senão, do lead de origem).
  let consultorId: string | null = null;

  if (origin.type === "commercial_lead") {
    const [{ data: lead }, { data: q }] = await Promise.all([
      db.from("commercial_leads").select("id, company_name, company_id, consultant_id").eq("id", origin.id).maybeSingle<{ id: string; company_name: string; company_id: string | null; consultant_id: string | null }>(),
      db
        .from("lead_qualification")
        .select("legal_name, responsible_name, responsible_role, responsible_cpf, responsible_email, responsible_phone")
        .eq("lead_id", origin.id)
        .maybeSingle<{ legal_name: string | null; responsible_name: string | null; responsible_role: string | null; responsible_cpf: string | null; responsible_email: string | null; responsible_phone: string | null }>(),
    ]);
    if (!lead) return { ok: false, error: "Lead não encontrado (ou você não tem acesso a ele)." };
    leadId = lead.id;
    companyId = lead.company_id;
    consultorId = lead.consultant_id;
    companyName = q?.legal_name?.trim() || lead.company_name;
    representante = {
      name: q?.responsible_name ?? null,
      role: q?.responsible_role ?? null,
      cpf: q?.responsible_cpf ?? null,
      email: q?.responsible_email ?? null,
      phone: q?.responsible_phone ?? null,
    };
  } else {
    const { data: company } = await db
      .from("companies")
      .select("id, legal_name, trade_name, origin_lead_id, assigned_consultant_id, responsible_name, responsible_role, responsible_cpf, responsible_email, responsible_phone")
      .eq("id", origin.id)
      .maybeSingle<{
        id: string;
        assigned_consultant_id: string | null;
        legal_name: string;
        trade_name: string | null;
        origin_lead_id: string | null;
        responsible_name: string | null;
        responsible_role: string | null;
        responsible_cpf: string | null;
        responsible_email: string | null;
        responsible_phone: string | null;
      }>();
    if (!company) return { ok: false, error: "Empresa não encontrada (ou você não tem acesso a ela)." };
    companyId = company.id;
    leadId = company.origin_lead_id;
    consultorId = company.assigned_consultant_id;
    if (!consultorId && leadId) {
      const { data: l } = await db.from("commercial_leads").select("consultant_id").eq("id", leadId).maybeSingle<{ consultant_id: string | null }>();
      consultorId = l?.consultant_id ?? null;
    }
    companyName = company.legal_name || company.trade_name || "Empresa";
    representante = {
      name: company.responsible_name,
      role: company.responsible_role,
      cpf: company.responsible_cpf,
      email: company.responsible_email,
      phone: company.responsible_phone,
    };
  }

  const supabase = await createClient();
  const [templatesRes, settings, contratadaLida] = await Promise.all([
    supabase
      .from("signature_templates")
      .select("id, code, name, audience, kind, body, source, variables, auth_level, witness_count, witness_mode, default_witness_staff_ids, risarte_signer_mode, risarte_signer_role, risarte_signer_user_id, is_active, is_provisional_text, sort_order")
      .eq("audience", "company")
      .eq("kind", "adhesion")
      .eq("is_active", true)
      .order("sort_order")
      .limit(1),
    loadSignatureSettings(supabase),
    lerContratada(db),
  ]);
  if (!settings) return { ok: false, error: "A assinatura digital ainda não está instalada neste banco (falta a migração 0340)." };
  const tpl = templatesRes.data?.[0];
  if (templatesRes.error || !tpl) {
    return { ok: false, error: "O modelo \"Contrato de adesão empresarial\" está desativado ou não existe (Assinaturas → Configurações → Modelos)." };
  }
  const template = {
    ...tpl,
    body: corpoValido(tpl.body) ? tpl.body : null,
    variables: tpl.variables ?? [],
    default_witness_staff_ids: tpl.default_witness_staff_ids ?? [],
  } as SignatureTemplate;

  let contrato: EmpresaSendContext["contrato"];
  if (!leadId) {
    contrato = { disponivel: false, motivo: "Esta empresa não veio do funil: não há proposta salva de onde montar o contrato de adesão. Envie o contrato como PDF." };
  } else {
    // O texto cita quem vai assinar: o consultor responsável; sem ele, quem envia.
    const c = await carregarContratoDoLead(leadId, { representanteUserId: consultorId ?? session.userId });
    if (c.ok) {
      const corpo = corpoDoContratoParaAssinatura({ modelo: c.dados.modelo, valores: c.dados.contrato.valores, anexo: anexoDoContrato(c.dados) });
      contrato = { disponivel: true, titulo: corpo.titulo, faltando: c.dados.contrato.faltando, avisos: c.dados.contrato.avisos, dados: c.dados };
    } else if (c.motivo === "modelo") {
      contrato = { disponivel: false, motivo: "Ainda não há modelo de contrato cadastrado (Risarte Empresarial → Configurações → Contrato)." };
    } else if (c.motivo === "leitura") {
      contrato = { disponivel: false, motivo: `Não foi possível conferir ${c.naoLido.join(", ")} agora. Recarregue a página.` };
    } else {
      contrato = { disponivel: false, motivo: "O lead de origem não foi encontrado." };
    }
  }

  // Os PDFs guardados na aba Documentos da empresa — pela RLS: quem não vê a
  // empresa não vê os arquivos (e o servidor só baixa o que apareceu aqui).
  let arquivosGuardados: ArquivoGuardado[] = [];
  if (companyId) {
    const { data: arquivos } = await db
      .from("company_files")
      .select("id, file_type, file_name, storage_path")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .returns<{ id: string; file_type: CompanyFileType; file_name: string; storage_path: string }[]>();
    arquivosGuardados = (arquivos ?? [])
      .filter((a) => /\.pdf$/i.test(a.file_name) || /\.pdf$/i.test(a.storage_path))
      .map((a) => ({ id: a.id, nome: a.file_name, tipo: COMPANY_FILE_TYPE_LABELS[a.file_type] ?? "Outro", storagePath: a.storage_path }));
  }

  const admin = createAdminClient();
  const { sender, staff, byRole } = await loadStaffOptions(admin, session, clinic.id);
  const responsavel = consultorId
    ? (byRole.rislife_consultant ?? []).find((o) => o.user_id === consultorId) ??
      staff.find((o) => o.user_id === consultorId) ??
      (sender.user_id === consultorId ? sender : null)
    : sender;

  return {
    ok: true,
    ctx: {
      origin,
      leadId,
      companyId,
      companyName,
      clinic,
      template,
      contrato,
      representante,
      arquivosGuardados,
      contratada: {
        legalName: contratadaLida.contratada?.legalName ?? null,
        cnpj: contratadaLida.contratada?.cnpj ?? null,
        // O nome que o TEXTO cita (desde a 1039, o de quem assina, da ficha).
        repName: (contrato.disponivel ? contrato.dados.contratada?.repName : null) ?? contratadaLida.contratada?.repName ?? null,
      },
      settings: { companyExpiryDays: settings.company_expiry_days, defaultMessage: settings.default_message },
      sender,
      staff,
      byRole,
      responsavel,
      semConsultorResponsavel: !consultorId,
      zapsign: { configured: isZapsignConfigured() || isZapsignFake(), fake: isZapsignFake(), env: zapsignEnv() },
    },
  };
}

/**
 * Quem pode assinar pela Risarte neste modelo (papel nulo = o titular). O
 * papel Consultor RisLife = o responsável pela empresa/lead, ou quem envia
 * quando não há (AP95) — uma pessoa só, a que o texto cita.
 */
export function candidatosDaRisarte(
  ctx: Pick<EmpresaSendContext, "template" | "sender" | "staff" | "byRole"> & Partial<Pick<EmpresaSendContext, "responsavel">>
): StaffSignerOption[] {
  const t = ctx.template;
  if (t.risarte_signer_mode === "role" && !t.risarte_signer_role) return ctx.byRole.owner ?? [];
  if (t.risarte_signer_mode === "role" && t.risarte_signer_role === "rislife_consultant") {
    return ctx.responsavel ? [ctx.responsavel] : [];
  }
  return candidatosDoRepresentante({ template: t, sender: ctx.sender, staff: ctx.staff, byRole: ctx.byRole });
}

export async function prepararPacoteDaEmpresa(input: {
  session: SessionContext;
  origin: EmpresaOrigin;
  incluirContrato: boolean;
  avisosLidos: boolean;
  representante: { name: string; cpf: string; email: string; phone: string };
  witnessKeys: string[];
  representativeKey: string | null;
  /** Os anexos na ordem escolhida (o contrato de adesão vai antes de todos). */
  anexos: AnexoDoPacote[];
}): Promise<PrepareResult> {
  const loaded = await loadEmpresaSendContext({ session: input.session, origin: input.origin });
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;
  if (!ctx.zapsign.configured) {
    return { ok: false, error: "A ZapSign não está configurada neste ambiente (falta o token). Peça ao Admin Master." };
  }

  // 1) O que vai no pacote.
  const docs: { title: string; body: TemplateBody }[] = [];
  let valores: Record<string, string | null> = {};
  if (input.incluirContrato) {
    if (!ctx.contrato.disponivel) return { ok: false, error: ctx.contrato.motivo };
    if (ctx.contrato.faltando.length > 0) {
      return { ok: false, error: `O contrato não pode sair com linha em branco. Falta: ${ctx.contrato.faltando.join(", ")}.` };
    }
    if (ctx.contrato.avisos.length > 0 && !input.avisosLidos) {
      return { ok: false, error: "Leia os avisos do contrato e confirme antes de enviar." };
    }
    const d = ctx.contrato.dados;
    const corpo = corpoDoContratoParaAssinatura({ modelo: d.modelo, valores: d.contrato.valores, anexo: anexoDoContrato(d) });
    docs.push({ title: corpo.titulo, body: corpo.body });
    valores = d.contrato.valores;
  }
  if (docs.length === 0 && input.anexos.length === 0) {
    return { ok: false, error: "Escolha o contrato de adesão ou anexe ao menos um PDF." };
  }
  // Os anexos na ordem escolhida. O arquivo guardado só é baixado se estava na
  // lista que a pessoa enxerga (pela RLS) — o id sozinho não abre nada.
  const attachments: { name: string; bytes: Uint8Array }[] = [];
  const adminStorage = createAdminClient().storage;
  for (const a of input.anexos) {
    if (a.origem === "computador") {
      attachments.push({ name: a.name, bytes: a.bytes });
      continue;
    }
    const guardado = ctx.arquivosGuardados.find((g) => g.id === a.arquivoId);
    if (!guardado) return { ok: false, error: "Um dos documentos escolhidos não está mais na aba Documentos da empresa." };
    const baixado = await adminStorage.from(COMPANY_DOCS_BUCKET).download(guardado.storagePath);
    if (baixado.error || !baixado.data) return { ok: false, error: `Não foi possível ler "${guardado.nome}" dos documentos da empresa.` };
    attachments.push({ name: guardado.nome, bytes: new Uint8Array(await baixado.data.arrayBuffer()) });
  }
  for (const a of attachments) {
    const erro = validarAnexo({ name: a.name, size: a.bytes.byteLength, type: "application/pdf" });
    if (erro) return { ok: false, error: `Anexo: ${erro}` };
    const insp = await inspectAttachment(a.bytes);
    if (!insp.ok) return { ok: false, error: `Anexo "${a.name}": ${insp.error}` };
  }

  // 2) Quem assina.
  const witnesses = input.witnessKeys
    .map((k) => ctx.staff.find((s) => s.key === k) ?? null)
    .filter((s): s is StaffSignerOption => s !== null);
  const candidatos = candidatosDaRisarte(ctx);
  const representative = (input.representativeKey ? candidatos.find((c) => c.key === input.representativeKey) : null) ?? candidatos[0] ?? null;
  const montado = montarSignatariosDaEmpresa({
    representante: {
      name: input.representante.name || ctx.representante.name,
      cpf: input.representante.cpf || ctx.representante.cpf,
      email: input.representante.email || ctx.representante.email,
      phone: input.representante.phone || ctx.representante.phone,
    },
    templates: [ctx.template],
    witnesses,
    representatives: [representative],
  });
  if (montado.blockers.length > 0) return { ok: false, error: montado.blockers.join(" ") };
  const problemas = validarSignatarios(montado.signers);
  if (problemas.length > 0) return { ok: false, error: problemas.map((p) => `${p.signer}: ${p.message}`).join(" ") };

  // 3) Autenticação (decisão 4: sem o corte de R$) e prazo (decisão 5).
  const auth = nivelDeAutenticacao({ templates: [ctx.template], linkedAmountCents: null, thresholdCents: 0 });
  const expiresAt = new Date(Date.now() + ctx.settings.companyExpiryDays * 86_400_000);
  expiresAt.setUTCHours(23, 59, 0, 0);

  // 4) A porta do banco (0345 confere a empresa/lead e a trava do RisLife).
  const supabase = await createClient();
  // 0350: capa e rodapé com a RAZÃO SOCIAL da contratada, nunca o nome de fantasia.
  const issuerName = ctx.contratada.legalName?.trim() || "";
  if (!issuerName) {
    return { ok: false, error: "Falta a razão social da contratada. Preencha em Empresarial → Configurações → Contrato e envie de novo." };
  }
  const coverData = { client_name: ctx.companyName, clinic_name: "Risarte Empresarial", issuer_name: issuerName, lead_id: ctx.leadId, company_id: ctx.companyId };
  const itemsPayload = [
    ...docs.map((d, i) => ({
      template_id: ctx.template.id,
      title: d.title,
      sort_order: i,
      rendered_data: valores,
      origin_type: input.origin.type,
      origin_id: input.origin.id,
    })),
    ...attachments.map((a, i) => ({
      template_id: null,
      title: a.name.replace(/\.pdf$/i, ""),
      sort_order: docs.length + i,
      rendered_data: null,
      origin_type: null,
      origin_id: null,
    })),
  ];
  const { data: created, error: rpcError } = await supabase.rpc("signature_create_package", {
    p_clinic_id: ctx.clinic.id,
    p_audience: "company",
    p_origin_type: input.origin.type,
    p_origin_id: input.origin.id,
    p_client_id: null,
    p_linked_amount_cents: null,
    p_auth_level: auth.level,
    p_auth_reason: auth.reason,
    p_expires_at: expiresAt.toISOString(),
    p_items: itemsPayload,
    p_signers: montado.signers.map((s) => ({
      ...s,
      auth_mode_applied: modoDeAutenticacao({ level: auth.level, orderGroup: s.order_group, phone: s.phone, email: s.email }).auth_mode,
    })),
    p_cover_data: coverData,
    p_issuer_cnpj: ctx.contratada.cnpj,
  });
  if (rpcError || !created) return { ok: false, error: mensagemDaPorta(rpcError?.message) };
  const packageId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);

  // 5) O contrato antigo da empresa espelha o pacote (1038).
  if (ctx.companyId && input.origin.type === "company") {
    const rep = montado.signers.find((s) => s.order_group === 1);
    const { error: erroDoContrato } = await empresarialAdminDb()
      .from("contracts")
      .insert({
        company_id: ctx.companyId,
        title: docs[0]?.title ?? itemsPayload[0]?.title ?? "Documento para assinatura",
        status: "DRAFT",
        package_id: packageId,
        signer_name: rep?.name ?? null,
        signer_email: rep?.email ?? null,
      });
    // Sem a 1038 a coluna não existe: o pacote segue; só a aba antiga não espelha.
    if (erroDoContrato) console.error("signature company contract mirror:", erroDoContrato.message);
  }

  // 6) O PDF.
  const pdf = await gerarPdfDoPacote({
    packageId,
    number,
    clinicId: ctx.clinic.id,
    issuerName,
    issuerCnpj: ctx.contratada.cnpj,
    clientName: ctx.companyName,
    docs: docs.map((d) => ({ title: d.title, body: d.body, provisional: false })),
    valores: {},
    signers: montado.signers,
    attachments: attachments.map((a) => ({ title: a.name.replace(/\.pdf$/i, ""), bytes: a.bytes })),
    coverData,
    actorUserId: input.session.userId,
    audience: "company",
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
