import "server-only";

/**
 * VD3-2 (0415) — O TERMO DA VENDA DIRETA PELA ZAPSIGN, do lado do servidor.
 *
 * O mesmo caminho do termo de renegociação (`renegociacao/termo.ts`): o texto
 * sai do código, o PDF com assinaturas e rubricas, o envio pela ZapSign. A
 * diferença é QUEM ENVIA (decisão V1): quem fecha a venda direta, conferido
 * pelo banco na porta `direct_sale_term_package` — sem a permissão geral de
 * envio. Assina só o cliente (ou o responsável, se menor), sem testemunha e
 * sem a Risarte (D1). A assinatura volta pela ZapSign e marca a venda SOZINHA
 * (gatilho da 0415).
 */
import type { SessionContext } from "@/lib/auth";
import { todayInBrazil } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { modoDeAutenticacao, nivelDeAutenticacao } from "@/lib/signatures/auth-level";
import { prazoDeAssinatura } from "@/lib/signatures/prazo";
import { lerRazaoSocial } from "@/lib/signatures/razao-social";
import { enviarPacote, gerarPdfDoPacote, type SendResult } from "@/lib/signatures/send";
import { loadSignatureSettings } from "@/lib/signatures/settings";
import { montarSignatarios } from "@/lib/signatures/signers";
import type { SignatureTemplate } from "@/lib/signatures/types";
import { validarSignatarios } from "@/lib/signatures/validate";
import { montarValores } from "@/lib/signatures/valores";
import { ehMenorDeIdade } from "@/lib/idade";
import { isZapsignConfigured, isZapsignFake, ZapsignError, refuseDocument, refuseDocumentFake } from "@/lib/zapsign";
import { montarMensagem, primeiroNome } from "@/lib/notify/templates";
import { corpoDoTermoDaVenda, type DadosDoTermoDaVenda } from "./venda-direta-termo-texto";

/** O prazo do link do termo da venda direta (a venda é no balcão). */
export const DIAS_DO_TERMO = 3;

const MODELO_DO_TERMO: SignatureTemplate = {
  id: "termo-de-venda-direta",
  code: "termo_de_venda_direta",
  name: "Termo de venda direta",
  audience: "patient",
  kind: "other",
  body: null,
  source: null,
  variables: [],
  auth_level: "by_amount",
  witness_count: 0,
  witness_mode: "choose_at_send",
  default_witness_staff_ids: [],
  risarte_signer_mode: "none",
  risarte_signer_role: null,
  risarte_signer_user_id: null,
  is_active: true,
  is_provisional_text: true,
  sort_order: 0,
};

export type EnvioDoTermoDaVenda = SendResult;

function mensagemDaPortaDoTermo(m: string | undefined): string {
  const t = m ?? "";
  if (t.includes("NOT_ALLOWED")) return "Quem envia o termo é quem fecha a venda direta (Recepção, Gerente ou SDR).";
  if (t.includes("ALREADY_SIGNED")) return "O termo desta venda já está assinado.";
  if (t.includes("SALE_CANCELLED")) return "Esta venda foi cancelada.";
  if (t.includes("CONDITIONS_REQUIRED")) return "Defina como o cliente paga antes de enviar o termo.";
  const aberto = t.match(/OPEN_PACKAGE_EXISTS:(\S+)/);
  if (aberto) return `O termo desta venda já foi enviado (${aberto[1]}). Use o link dele, ou espere vencer para mandar outro.`;
  if (/does not exist|Could not find the function/i.test(t)) return "O termo da venda direta ainda não está instalado neste banco (falta a migração 0415).";
  return "Não foi possível montar o termo. Tente de novo em instantes.";
}

/** Monta e envia o termo de uma venda direta aberta. */
export async function enviarTermoDaVendaDireta(
  session: SessionContext,
  saleId: string
): Promise<EnvioDoTermoDaVenda> {
  const supabase = await createClient();
  // 1) O banco diz se esta pessoa fecha esta venda (e se ela está aberta).
  const { data: pode, error: pe } = await supabase.rpc("direct_sale_can_handle_term", { p_sale_id: saleId });
  if (pe) return { ok: false, error: mensagemDaPortaDoTermo(pe.message) };
  if (pode !== true) return { ok: false, error: "Esta venda não está aberta para você fechar." };
  if (!isZapsignConfigured() && !isZapsignFake())
    return { ok: false, error: "A ZapSign não está configurada neste ambiente (falta o token). Peça ao Admin Master. Enquanto isso, use \"Assinado em papel\"." };

  // 2) Os dados (a permissão já foi conferida; o cadastro é lido sem a regra
  //    de linha, como nas Assinaturas).
  const admin = createAdminClient();
  const { data: v } = await admin
    .from("direct_sales")
    .select("id, code, clinic_id, client_id, created_at, subtotal_cents, program_discount_cents, discount_cents, surcharge_cents, final_cents, payment_method, installments")
    .eq("id", saleId)
    .maybeSingle();
  if (!v || !v.client_id) return { ok: false, error: "Venda não encontrada." };
  const [{ data: client }, { data: guardians }, { data: clinic }, { data: itens }, { data: parcelas }, settings, razao] = await Promise.all([
    admin
      .from("clients")
      .select("id, full_name, cpf, birth_date, phone, email, address, address_number, complement, neighborhood, city, state, zip_code, anonymized_at, empresarial_active")
      .eq("id", v.client_id)
      .maybeSingle(),
    admin.from("client_guardians").select("full_name, cpf, relationship, phone, email").eq("client_id", v.client_id).order("created_at"),
    admin.from("clinics").select("id, name, cnpj, phone, address, address_number, complement, neighborhood, city, state, zip_code").eq("id", v.clinic_id).maybeSingle(),
    admin.from("direct_sale_items").select("description, quantity, final_cents").eq("sale_id", saleId),
    admin.from("payment_installments").select("seq, due_date, amount_cents, payment_method").eq("direct_sale_id", saleId).order("seq"),
    loadSignatureSettings(admin),
    lerRazaoSocial(admin, v.clinic_id as string),
  ]);
  if (!client || client.anonymized_at) return { ok: false, error: "Não foi possível ler o cadastro do cliente." };
  if (!clinic) return { ok: false, error: "Não foi possível ler os dados da unidade." };
  if (!settings) return { ok: false, error: "A assinatura digital ainda não está instalada neste banco." };
  if (!razao.ok) return razao;

  const hoje = todayInBrazil();
  const guardioes = (guardians ?? []).map((g) => ({
    name: g.full_name as string,
    full_name: g.full_name as string,
    cpf: g.cpf as string | null,
    email: g.email as string | null,
    phone: g.phone as string | null,
    relationship: g.relationship as string | null,
  }));
  const menor = ehMenorDeIdade((client.birth_date as string | null) ?? "", hoje);

  // 3) Quem assina: o cliente, ou o responsável se menor (D1).
  const montado = montarSignatarios({
    client: {
      name: client.full_name as string,
      cpf: client.cpf as string | null,
      email: client.email as string | null,
      phone: client.phone as string | null,
      birthDate: client.birth_date as string | null,
    },
    guardians: guardioes,
    todayIso: hoje,
    templates: [MODELO_DO_TERMO],
    witnesses: [],
    representatives: [null],
  });
  if (montado.blockers.length > 0) return { ok: false, error: `Antes de enviar o termo: ${montado.blockers.join(" ")}` };
  const problemas = validarSignatarios(montado.signers);
  if (problemas.length > 0)
    return { ok: false, error: `Antes de enviar o termo, complete o cadastro: ${problemas.map((p) => `${p.signer}: ${p.message}`).join(" ")}` };

  // 4) O texto.
  const responsavel = menor ? (guardioes[0]?.name ?? null) : null;
  const dados: DadosDoTermoDaVenda = {
    codigo: (v.code as string | null) ?? null,
    cliente: client.full_name as string,
    responsavel,
    unidade: razao.nome,
    data: hoje,
    itens: (itens ?? []).map((i) => ({
      descricao: i.description as string,
      quantidade: Number(i.quantity ?? 1),
      valor: Number(i.final_cents ?? 0),
    })),
    subtotal: Number(v.subtotal_cents ?? 0),
    descontoDoPrograma: Number(v.program_discount_cents ?? 0),
    programa: client.empresarial_active ? "Empresarial" : null,
    desconto: Number(v.discount_cents ?? 0),
    acrescimo: Number(v.surcharge_cents ?? 0),
    total: Number(v.final_cents ?? 0),
    meio: (v.payment_method as string | null) ?? null,
    parcelas: (parcelas ?? []).map((p) => ({
      vencimento: p.due_date as string,
      valor: Number(p.amount_cents ?? 0),
      meio: (p.payment_method as string | null) ?? null,
    })),
    cidade: (clinic.city as string | null) ?? null,
  };

  // 5) O pacote, pela porta do termo (quem fecha, um termo vivo por venda).
  const auth = nivelDeAutenticacao({
    templates: [MODELO_DO_TERMO],
    linkedAmountCents: Number(v.final_cents ?? 0),
    thresholdCents: settings.strong_auth_threshold_cents,
  });
  const expiresAt = prazoDeAssinatura(DIAS_DO_TERMO);
  const guardian = menor ? (guardioes[0] ?? null) : null;
  const valores = montarValores({
    client: client as never,
    guardian,
    isMinor: menor,
    clinic: { ...(clinic as never as Record<string, string | null>), name: clinic.name as string, legal_name: razao.nome } as never,
    treatment: null,
    packageNumber: "",
    todayIso: hoje,
  });
  const signersPayload = montado.signers.map((s) => ({
    ...s,
    auth_mode_applied: modoDeAutenticacao({ level: auth.level, orderGroup: s.order_group, phone: s.phone, email: s.email }).auth_mode,
  }));
  const capa = { client_name: client.full_name, clinic_name: clinic.name, issuer_name: razao.nome, direct_sale_id: saleId };
  const { data: created, error: rpcError } = await supabase.rpc("direct_sale_term_package", {
    p_sale_id: saleId,
    p_auth_level: auth.level,
    p_auth_reason: auth.reason,
    p_expires_at: expiresAt.toISOString(),
    p_items: [{ title: "Termo de venda direta", sort_order: 0, rendered_data: valores }],
    p_signers: signersPayload,
    p_cover_data: capa,
    p_issuer_cnpj: clinic.cnpj,
  });
  if (rpcError || !created) return { ok: false, error: mensagemDaPortaDoTermo(rpcError?.message) };
  const packageId = String((created as { id: string }).id);
  const number = String((created as { number: string }).number);

  const pdf = await gerarPdfDoPacote({
    packageId,
    number,
    clinicId: v.clinic_id as string,
    issuerName: razao.nome,
    issuerCnpj: clinic.cnpj as string | null,
    clientName: client.full_name as string,
    docs: [{ title: "Termo de venda direta", body: corpoDoTermoDaVenda(dados), provisional: true }],
    valores,
    signers: montado.signers,
    attachments: [],
    coverData: capa,
    actorUserId: session.userId,
  });
  if (!pdf.ok) return pdf;

  // 6) Envia.
  return enviarPacote({ session, packageId });
}

export type LinkDoTermo = {
  signUrl: string;
  /** O WhatsApp com a mensagem pronta (nulo sem telefone). */
  whatsapp: string | null;
  nome: string;
};

/**
 * O link de assinatura do cliente (ou do responsável) do termo vivo da venda.
 * O link não é lido com a sessão da pessoa (AP152): a permissão é conferida
 * antes, pelo banco (quem fecha a venda).
 */
export async function linkDoTermo(saleId: string): Promise<{ ok: true; link: LinkDoTermo } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: pode } = await supabase.rpc("direct_sale_can_handle_term", { p_sale_id: saleId });
  if (pode !== true) return { ok: false, error: "Esta venda não está aberta para você fechar." };
  const admin = createAdminClient();
  const { data: v } = await admin.from("direct_sales").select("signature_package_id, clinic_id").eq("id", saleId).maybeSingle();
  if (!v?.signature_package_id) return { ok: false, error: "Esta venda ainda não tem termo enviado." };
  const [{ data: pkg }, { data: signer }, { data: settings }, { data: clinic }] = await Promise.all([
    admin.from("signature_packages").select("status, expires_at").eq("id", v.signature_package_id).maybeSingle(),
    admin
      .from("signature_signers")
      .select("name, sign_url, phone")
      .eq("package_id", v.signature_package_id)
      .eq("order_group", 1)
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
    admin.from("signature_settings").select("default_message").eq("id", true).maybeSingle(),
    admin.from("clinics").select("name").eq("id", v.clinic_id).maybeSingle(),
  ]);
  if (!pkg || !["sent", "partially_signed"].includes(pkg.status as string))
    return { ok: false, error: "O termo não está aguardando assinatura." };
  if (!signer?.sign_url) return { ok: false, error: "A ZapSign ainda não devolveu o link deste termo." };
  const prazo = pkg.expires_at
    ? new Date(pkg.expires_at as string).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "";
  const mensagem = montarMensagem((settings?.default_message as string | null) ?? "{{link}}", {
    nome: primeiroNome(signer.name as string),
    unidade: (clinic?.name as string | null) ?? "",
    link: signer.sign_url as string,
    prazo,
  });
  const fone = String(signer.phone ?? "").replace(/\D/g, "");
  const comPais = fone.length >= 10 ? (fone.startsWith("55") ? fone : `55${fone}`) : null;
  return {
    ok: true,
    link: {
      signUrl: signer.sign_url as string,
      whatsapp: comPais ? `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}` : null,
      nome: signer.name as string,
    },
  };
}

/**
 * Venda cancelada com o termo vivo: o documento é recusado na ZapSign e o
 * pacote fica cancelado (o mesmo caminho da renegociação). Nunca derruba o
 * cancelamento: o erro vai para o log.
 */
export async function cancelarTermoDaVenda(saleId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: pkgs } = await admin
      .from("signature_packages")
      .select("id, status, zapsign_doc_token")
      .eq("origin_type", "direct_sale")
      .eq("origin_id", saleId)
      .in("status", ["draft", "sent", "partially_signed"]);
    for (const p of pkgs ?? []) {
      try {
        if (p.zapsign_doc_token) {
          if (isZapsignFake()) await refuseDocumentFake();
          else
            await refuseDocument({
              doc_token: p.zapsign_doc_token as string,
              rejected_reason: "Cancelado no riSZon: a venda direta foi cancelada",
              notify_signer: false,
            });
        }
      } catch (e) {
        if (!(e instanceof ZapsignError && e.code === "document_already_signed")) {
          console.error("direct sale term cancel failed:", e instanceof ZapsignError ? e.logMessage : String(e));
          continue;
        }
      }
      await admin.rpc("_signature_cancel_package_system", { p_id: p.id, p_reason: "a venda direta foi cancelada" });
    }
  } catch (e) {
    console.error("direct sale term cancel failed:", e instanceof Error ? e.message : e);
  }
}
