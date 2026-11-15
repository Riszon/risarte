import "server-only";

/**
 * 4017 (19.28) — O ENVIO DO TERMO DE RENEGOCIAÇÃO PELA ZAPSIGN.
 *
 * Reaproveita o envio das Assinaturas (a porta `signature_create_package`, o PDF
 * com assinaturas e rubricas, `enviarPacote`). O documento sai do código
 * (`termo-texto.ts`), sem modelo cadastrado. Quem assina pelo cliente é o
 * RESPONSÁVEL FINANCEIRO, se houver (a regra do pagador da cobrança); pela
 * Risarte, quem envia. O prazo da ZapSign é o prazo do termo (19.28.9, 1a).
 */
import type { SessionContext } from "@/lib/auth";
import { todayInBrazil } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { modoDeAutenticacao, nivelDeAutenticacao } from "@/lib/signatures/auth-level";
import { loadSendContext } from "@/lib/signatures/envio-dados";
import { prazoDeAssinatura } from "@/lib/signatures/prazo";
import { lerRazaoSocial } from "@/lib/signatures/razao-social";
import { enviarPacote, gerarPdfDoPacote, mensagemDaPorta, type SendResult } from "@/lib/signatures/send";
import { montarSignatarios } from "@/lib/signatures/signers";
import type { SignatureTemplate } from "@/lib/signatures/types";
import { validarSignatarios } from "@/lib/signatures/validate";
import { montarValores } from "@/lib/signatures/valores";
import { corpoDoTermo, type DadosDoTermo } from "./termo-texto";

const MODELO_DO_TERMO: SignatureTemplate = {
  id: "termo-de-renegociacao",
  code: "termo_de_renegociacao",
  name: "Termo de renegociação",
  audience: "patient",
  kind: "other",
  body: null,
  source: null,
  variables: [],
  auth_level: "by_amount",
  witness_count: 0,
  witness_mode: "choose_at_send",
  default_witness_staff_ids: [],
  risarte_signer_mode: "sender",
  risarte_signer_role: null,
  risarte_signer_user_id: null,
  is_active: true,
  is_provisional_text: true,
  sort_order: 0,
};

function diasAte(prazo: string, hoje: string): number {
  const a = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10));
  const b = Date.UTC(+prazo.slice(0, 4), +prazo.slice(5, 7) - 1, +prazo.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type EnvioDoTermo =
  | SendResult
  | { ok: false; error: string; externas?: { charge_id: string; seq: number; vencimento: string; valor: number; nota: string | null }[] };

export async function enviarTermoDeRenegociacao(session: SessionContext, renegotiationId: string): Promise<EnvioDoTermo> {
  const supabase = await createClient();
  const admin = createAdminClient();

  // 1) O que o banco diz antes de enviar (permissão, prazo, cobranças externas).
  const { data: check, error: ce } = await supabase.rpc("renegotiation_send_check", { p_id: renegotiationId });
  if (ce || !check) return { ok: false, error: /NOT_ALLOWED/.test(ce?.message ?? "") ? "Quem envia o termo é quem negociou, o Gerente, o Financeiro da Franqueadora ou o Admin Master." : "Não foi possível ler a renegociação." };
  const c = check as { status: string; prazo: string | null; vencido: boolean; boletos_vivos: number; externas: { charge_id: string; seq: number; vencimento: string; valor: number; nota: string | null }[] };
  if (c.status !== "aguardando_assinatura") return { ok: false, error: "Esta renegociação não está aguardando assinatura." };
  if (c.vencido || !c.prazo) return { ok: false, error: "O prazo do termo venceu. Refaça a renegociação com o saldo de hoje." };
  if (c.externas.length > 0) {
    return {
      ok: false,
      error: "Estas cobranças foram emitidas fora do riSZon. Cancele cada uma no painel do Asaas e confirme antes de enviar o termo.",
      externas: c.externas,
    };
  }

  const { data: r } = await admin
    .from("payment_renegotiations")
    .select("id, code, clinic_id, client_id, created_at, original_principal_cents, original_benefit_cents, original_fee_cents, original_interest_cents, discount_cents, new_total_cents, monthly_interest_percent, pending_entries, sign_deadline, signature_package_id")
    .eq("id", renegotiationId)
    .maybeSingle();
  if (!r) return { ok: false, error: "Renegociação não encontrada." };
  if (r.signature_package_id) {
    const { data: pkg } = await admin.from("signature_packages").select("status, number").eq("id", r.signature_package_id).maybeSingle();
    if (pkg && ["draft", "sent", "partially_signed"].includes(pkg.status as string)) {
      return { ok: false, error: `O termo já foi enviado (pacote ${pkg.number}). Use "Reenviar" no pacote, ou cancele o envio antes de mandar outro.` };
    }
  }

  // 2) O contexto de envio das Assinaturas (permissão de enviar, cadastro, quem assina pela Risarte).
  const loaded = await loadSendContext({ session, clientId: r.client_id, clinicId: r.clinic_id, origin: { type: "client", id: r.client_id } });
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;
  if (!ctx.zapsign.configured) return { ok: false, error: "A ZapSign não está configurada neste ambiente (falta o token). Peça ao Admin Master." };
  const razao = await lerRazaoSocial(admin, r.clinic_id);
  if (!razao.ok) return razao;

  // O pagador: o responsável financeiro do cliente, se houver (a regra da cobrança).
  const { data: fin } = await admin
    .from("client_guardians")
    .select("full_name, cpf, relationship, phone, email")
    .eq("client_id", r.client_id)
    .eq("is_financial", true)
    .limit(1)
    .maybeSingle();
  const pagador = fin ? { name: fin.full_name as string, cpf: fin.cpf as string | null, email: fin.email as string | null, phone: fin.phone as string | null, relationship: fin.relationship as string | null } : null;

  const montado = montarSignatarios({
    client: { name: ctx.client.full_name, cpf: ctx.client.cpf, email: ctx.client.email, phone: ctx.client.phone, birthDate: ctx.client.birth_date },
    guardians: ctx.guardians,
    todayIso: todayInBrazil(),
    templates: [MODELO_DO_TERMO],
    witnesses: [],
    representatives: [ctx.sender],
    pagador,
  });
  if (montado.blockers.length > 0) return { ok: false, error: montado.blockers.join(" ") };
  const problemas = validarSignatarios(montado.signers);
  if (problemas.length > 0) return { ok: false, error: problemas.map((p) => `${p.signer}: ${p.message}`).join(" ") };

  // 3) O texto do termo.
  const { data: fontes } = await admin
    .from("payment_renegotiation_sources")
    .select("seq, due_date, total_rem_cents, negotiation_id, direct_sale_id")
    .eq("renegotiation_id", renegotiationId)
    .order("due_date");
  const negIds = [...new Set((fontes ?? []).map((f) => f.negotiation_id).filter(Boolean))] as string[];
  const dsIds = [...new Set((fontes ?? []).map((f) => f.direct_sale_id).filter(Boolean))] as string[];
  const [{ data: negs }, { data: dss }] = await Promise.all([
    negIds.length ? admin.from("plan_negotiations").select("id, code").in("id", negIds) : Promise.resolve({ data: [] as { id: string; code: string | null }[] }),
    dsIds.length ? admin.from("direct_sales").select("id, code").in("id", dsIds) : Promise.resolve({ data: [] as { id: string; code: string | null }[] }),
  ]);
  const codigo = (f: { negotiation_id: string | null; direct_sale_id: string | null }) =>
    (negs ?? []).find((n) => n.id === f.negotiation_id)?.code ?? (dss ?? []).find((d) => d.id === f.direct_sale_id)?.code ?? null;
  const entradas = (r.pending_entries ?? []) as { due_date: string; amount_cents: number; payment_method: string; descricao?: string }[];
  const dados: DadosDoTermo = {
    codigo: r.code,
    cliente: ctx.client.full_name,
    pagador: pagador?.name ?? null,
    unidade: razao.nome,
    calculadoEm: String(r.created_at).slice(0, 10),
    prazo: r.sign_deadline as string,
    antigas: (fontes ?? []).map((f) => ({ seq: f.seq, vencimento: f.due_date, valor: Number(f.total_rem_cents), venda: codigo(f) })),
    principal: Number(r.original_principal_cents),
    beneficio: Number(r.original_benefit_cents),
    multa: Number(r.original_fee_cents),
    juros: Number(r.original_interest_cents),
    desconto: Number(r.discount_cents),
    novoTotal: Number(r.new_total_cents),
    jurosAoMes: Number(r.monthly_interest_percent ?? 0),
    novas: [...entradas].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((e) => ({ vencimento: e.due_date, valor: Number(e.amount_cents), meio: e.payment_method, descricao: e.descricao ?? null })),
  };

  // 4) O pacote: a porta do banco (quem envia, com a guarda de envio da unidade).
  const auth = nivelDeAutenticacao({ templates: [MODELO_DO_TERMO], linkedAmountCents: Number(r.new_total_cents), thresholdCents: ctx.settings.thresholdCents });
  const expiresAt = prazoDeAssinatura(diasAte(r.sign_deadline as string, todayInBrazil()));
  const guardian = ctx.isMinor ? (ctx.guardians[0] ?? null) : null;
  const valores = montarValores({ client: ctx.client, guardian, isMinor: ctx.isMinor, clinic: { ...ctx.clinic, legal_name: razao.nome }, treatment: null, packageNumber: "", todayIso: todayInBrazil() });
  const signersPayload = montado.signers.map((s) => ({
    ...s,
    auth_mode_applied: modoDeAutenticacao({ level: auth.level, orderGroup: s.order_group, phone: s.phone, email: s.email }).auth_mode,
  }));
  const { data: created, error: rpcError } = await supabase.rpc("signature_create_package", {
    p_clinic_id: r.clinic_id,
    p_audience: "patient",
    p_origin_type: "payment_renegotiation",
    p_origin_id: renegotiationId,
    p_client_id: r.client_id,
    p_linked_amount_cents: Number(r.new_total_cents),
    p_auth_level: auth.level,
    p_auth_reason: auth.reason,
    p_expires_at: expiresAt.toISOString(),
    p_items: [{ template_id: null, title: "Termo de renegociação", sort_order: 0, rendered_data: valores, origin_type: "payment_renegotiation", origin_id: renegotiationId }],
    p_signers: signersPayload,
    p_cover_data: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, issuer_name: razao.nome, renegotiation_id: renegotiationId },
    p_issuer_cnpj: ctx.clinic.cnpj,
  });
  if (rpcError || !created) return { ok: false, error: mensagemDaPorta(rpcError?.message) };
  const packageId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);
  const pdf = await gerarPdfDoPacote({
    packageId,
    number,
    clinicId: r.clinic_id,
    issuerName: razao.nome,
    issuerCnpj: ctx.clinic.cnpj,
    clientName: ctx.client.full_name,
    docs: [{ title: "Termo de renegociação", body: corpoDoTermo(dados), provisional: true }],
    valores,
    signers: montado.signers,
    attachments: [],
    coverData: { client_name: ctx.client.full_name, clinic_name: ctx.clinic.name, issuer_name: razao.nome, renegotiation_id: renegotiationId },
    actorUserId: session.userId,
  });
  if (!pdf.ok) return pdf;

  // 5) Envia e grava o envio na renegociação.
  const enviado = await enviarPacote({ session, packageId });
  if (!enviado.ok) return enviado;
  const { error: me } = await admin.rpc("renegotiation_mark_sent", { p_id: renegotiationId, p_package_id: packageId, p_actor: session.userId });
  if (me) console.error("renegotiation_mark_sent failed:", me.message);
  return enviado;
}
