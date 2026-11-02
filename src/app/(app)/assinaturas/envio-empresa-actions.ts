"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { isValidCpf } from "@/lib/masks";
import { enviarPacote, type PrepareResult, type SendResult } from "@/lib/signatures/send";
import {
  candidatosDaRisarte,
  loadEmpresaSendContext,
  prepararPacoteDaEmpresa,
  type EmpresaOrigin,
} from "@/lib/signatures/send-empresa";
import { MAX_ATTACHMENT_BYTES } from "@/lib/signatures/validate";

/**
 * AS AÇÕES DA JANELA "ENVIAR PARA ASSINATURA" DA EMPRESA (ZS5). O trabalho de
 * verdade mora em `src/lib/signatures/send-empresa.ts`; aqui é a sessão, o
 * FormData e o `revalidatePath`. O descarte do rascunho é o mesmo do paciente
 * (`descartarEnvio`).
 */

export type EmpresaDialogContext = {
  companyName: string;
  contrato:
    | { disponivel: true; titulo: string; faltando: string[]; avisos: string[] }
    | { disponivel: false; motivo: string };
  representante: { name: string; role: string; cpf: string; email: string; phone: string };
  template: { name: string; witnessCount: number; authLevel: string };
  risarte: { mode: string; candidates: { key: string; name: string; roleLabel: string }[] };
  /** O representante digitado em Configurações → Contrato (o nome que o texto cita). */
  contratadaRepName: string | null;
  staff: { key: string; name: string; roleLabel: string; hasCpf: boolean; hasContact: boolean }[];
  expiryDays: number;
  zapsign: { configured: boolean; fake: boolean; env: "sandbox" | "production" };
};

export type EmpresaContextResult = { ok: true; ctx: EmpresaDialogContext } | { ok: false; error: string };

function parseOrigin(raw: { type: string; id: string }): EmpresaOrigin | null {
  if (raw.type !== "commercial_lead" && raw.type !== "company") return null;
  if (!/^[0-9a-f-]{36}$/i.test(raw.id)) return null;
  return { type: raw.type, id: raw.id };
}

const temContato = (phone: string | null, email: string | null) => !!(phone && phone.replace(/\D/g, "").length >= 10) || !!email;

export async function carregarContextoDaEmpresa(input: { origin: EmpresaOrigin }): Promise<EmpresaContextResult> {
  const session = await getSessionContext();
  const origin = parseOrigin(input.origin);
  if (!origin) return { ok: false, error: "Origem do envio inválida." };
  const loaded = await loadEmpresaSendContext({ session, origin });
  if (!loaded.ok) return loaded;
  const c = loaded.ctx;
  const r = c.representante;
  return {
    ok: true,
    ctx: {
      companyName: c.companyName,
      contrato: c.contrato.disponivel
        ? { disponivel: true, titulo: c.contrato.titulo, faltando: c.contrato.faltando, avisos: c.contrato.avisos }
        : { disponivel: false, motivo: c.contrato.motivo },
      representante: { name: r.name ?? "", role: r.role ?? "", cpf: r.cpf ?? "", email: r.email ?? "", phone: r.phone ?? "" },
      template: { name: c.template.name, witnessCount: c.template.witness_count, authLevel: c.template.auth_level },
      risarte: {
        mode: c.template.risarte_signer_mode,
        candidates: candidatosDaRisarte(c).map((p) => ({ key: p.key, name: p.name, roleLabel: p.role_label })),
      },
      contratadaRepName: c.contratada.repName,
      staff: c.staff.map((s) => ({ key: s.key, name: s.name, roleLabel: s.role_label, hasCpf: isValidCpf(s.cpf), hasContact: temContato(s.phone, s.email) })),
      expiryDays: c.settings.companyExpiryDays,
      zapsign: c.zapsign,
    },
  };
}

/**
 * Cria o rascunho e o PDF. O FormData leva `origin_type`, `origin_id`,
 * `incluir_contrato` ("1"), `avisos_lidos` ("1"), `rep_name`, `rep_cpf`,
 * `rep_email`, `rep_phone`, `witness_keys` (JSON), `representative_key` e os
 * arquivos em `attachments`.
 */
export async function prepararEnvioDaEmpresa(formData: FormData): Promise<PrepareResult> {
  const session = await getSessionContext();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const origin = parseOrigin({ type: str("origin_type"), id: str("origin_id") });
  if (!origin) return { ok: false, error: "Origem do envio inválida." };
  let witnessKeys: string[] = [];
  try {
    const raw = JSON.parse(str("witness_keys") || "[]");
    witnessKeys = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    witnessKeys = [];
  }
  const attachments: { name: string; bytes: Uint8Array }[] = [];
  for (const f of formData.getAll("attachments")) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `O anexo "${f.name}" passa de 8 MB.` };
    attachments.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  if (attachments.length > 10) return { ok: false, error: "No máximo 10 anexos por pacote." };

  return prepararPacoteDaEmpresa({
    session,
    origin,
    incluirContrato: str("incluir_contrato") === "1",
    avisosLidos: str("avisos_lidos") === "1",
    representante: { name: str("rep_name"), cpf: str("rep_cpf"), email: str("rep_email"), phone: str("rep_phone") },
    witnessKeys,
    representativeKey: str("representative_key") || null,
    attachments,
  });
}

export async function concluirEnvioDaEmpresa(input: { packageId: string; origin: EmpresaOrigin }): Promise<SendResult> {
  const session = await getSessionContext();
  const r = await enviarPacote({ session, packageId: input.packageId });
  if (r.ok) {
    if (input.origin.type === "commercial_lead") {
      revalidatePath(`/empresarial/funil/${input.origin.id}`);
      revalidatePath(`/empresarial/funil/${input.origin.id}/contrato`);
    } else {
      revalidatePath(`/empresarial/${input.origin.id}`);
    }
    revalidatePath("/assinaturas");
  }
  return r;
}
