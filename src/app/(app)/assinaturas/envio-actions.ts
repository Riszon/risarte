"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { loadSendContext, type SendOrigin } from "@/lib/signatures/envio-dados";
import { descartarRascunho, enviarPacote, prepararPacote, type PrepareResult, type SendResult } from "@/lib/signatures/send";
import { candidatosDoRepresentante } from "@/lib/signatures/signers";
import type { PackageOriginType } from "@/lib/signatures/types";
import { MAX_ATTACHMENT_BYTES } from "@/lib/signatures/validate";
import { isValidCpf } from "@/lib/masks";

/**
 * AS AÇÕES DA JANELA "ENVIAR PARA ASSINATURA" (ZS2). O trabalho de verdade
 * mora em `src/lib/signatures/{envio-dados,send}.ts`; aqui é a sessão, o
 * FormData e o `revalidatePath`. Padrão do projeto: `{ ok, error? }` pt-BR.
 */

const ORIGINS: PackageOriginType[] = ["client", "plan_negotiation", "treatment_plan"];

export type DialogOrigin = { type: "client" | "plan_negotiation" | "treatment_plan"; id: string | null };

/** O que a janela mostra — sem CPF nem contatos inteiros de ninguém (`hasCpf` = CPF VÁLIDO). */
export type DialogContext = {
  client: { name: string; isMinor: boolean; guardianName: string | null; hasCpf: boolean; hasContact: boolean };
  clinicName: string;
  templates: {
    id: string;
    name: string;
    kind: string;
    witnessCount: number;
    isProvisional: boolean;
    authLevel: string;
    representative: { mode: string; candidates: { key: string; name: string; roleLabel: string }[] };
  }[];
  kits: { id: string; name: string; templateIds: string[] }[];
  staff: { key: string; name: string; roleLabel: string; hasCpf: boolean; hasContact: boolean }[];
  senderKey: string;
  treatment: { totalCents: number; conditions: string | null; procedures: number } | null;
  thresholdCents: number;
  expiryDays: number;
  zapsign: { configured: boolean; fake: boolean; env: "sandbox" | "production" };
};

export type ContextResult = { ok: true; ctx: DialogContext } | { ok: false; error: string };

function parseOrigin(raw: { type: string; id: string | null }): SendOrigin | null {
  if (!ORIGINS.includes(raw.type as PackageOriginType)) return null;
  return { type: raw.type as PackageOriginType, id: raw.id || null };
}

export async function carregarContextoDeEnvio(input: { clientId: string; clinicId: string; origin: DialogOrigin }): Promise<ContextResult> {
  const session = await getSessionContext();
  const origin = parseOrigin(input.origin);
  if (!origin) return { ok: false, error: "Origem do envio inválida." };
  const loaded = await loadSendContext({ session, clientId: input.clientId, clinicId: input.clinicId, origin });
  if (!loaded.ok) return loaded;
  const c = loaded.ctx;
  const temContato = (phone: string | null, email: string | null) => !!(phone && phone.replace(/\D/g, "").length >= 10) || !!email;
  return {
    ok: true,
    ctx: {
      client: {
        name: c.client.full_name,
        isMinor: c.isMinor,
        guardianName: c.isMinor ? (c.guardians[0]?.name ?? null) : null,
        hasCpf: isValidCpf(c.isMinor ? c.guardians[0]?.cpf : c.client.cpf),
        hasContact: c.isMinor ? temContato(c.guardians[0]?.phone ?? null, c.guardians[0]?.email ?? null) : temContato(c.client.phone, c.client.email),
      },
      clinicName: c.clinic.name,
      templates: c.templates.map((t) => {
        const lista =
          t.risarte_signer_mode === "role" && !t.risarte_signer_role
            ? (c.byRole.owner ?? [])
            : candidatosDoRepresentante({ template: t, sender: c.sender, staff: c.staff, byRole: c.byRole });
        return {
          id: t.id,
          name: t.name,
          kind: t.kind,
          witnessCount: t.witness_count,
          isProvisional: t.is_provisional_text,
          authLevel: t.auth_level,
          representative: {
            mode: t.risarte_signer_mode,
            candidates: lista.map((p) => ({ key: p.key, name: p.name, roleLabel: p.role_label })),
          },
        };
      }),
      kits: c.kits.map((k) => ({ id: k.id, name: k.name, templateIds: k.template_ids })),
      staff: c.staff.map((s) => ({ key: s.key, name: s.name, roleLabel: s.role_label, hasCpf: isValidCpf(s.cpf), hasContact: temContato(s.phone, s.email) })),
      senderKey: c.sender.key,
      treatment: c.treatment ? { totalCents: c.treatment.totalCents, conditions: c.treatment.conditions, procedures: c.treatment.procedures.length } : null,
      thresholdCents: c.settings.thresholdCents,
      expiryDays: c.settings.patientExpiryDays,
      zapsign: c.zapsign,
    },
  };
}

/**
 * Passo 3: cria o rascunho e o PDF. O FormData leva `client_id`, `clinic_id`,
 * `origin_type`, `origin_id`, `template_ids` (JSON), `witness_keys` (JSON),
 * `representative_keys` (JSON objeto) e os arquivos em `attachments`.
 */
export async function prepararEnvio(formData: FormData): Promise<PrepareResult> {
  const session = await getSessionContext();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const origin = parseOrigin({ type: str("origin_type"), id: str("origin_id") || null });
  if (!origin) return { ok: false, error: "Origem do envio inválida." };
  const json = <T,>(k: string, fallback: T): T => {
    try {
      const v = str(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const templateIds = json<string[]>("template_ids", []).filter((x) => typeof x === "string");
  const witnessKeys = json<string[]>("witness_keys", []).filter((x) => typeof x === "string");
  const repRaw = json<Record<string, unknown>>("representative_keys", {});
  const representativeKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(repRaw)) if (typeof v === "string") representativeKeys[k] = v;

  const attachments: { name: string; bytes: Uint8Array }[] = [];
  for (const f of formData.getAll("attachments")) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `O anexo "${f.name}" passa de 8 MB.` };
    attachments.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  if (attachments.length > 10) return { ok: false, error: "No máximo 10 anexos por pacote." };

  return prepararPacote({
    session,
    clientId: str("client_id"),
    clinicId: str("clinic_id"),
    origin,
    templateIds,
    witnessKeys,
    representativeKeys,
    attachments,
  });
}

export async function concluirEnvio(input: { packageId: string; clientId: string }): Promise<SendResult> {
  const session = await getSessionContext();
  const r = await enviarPacote({ session, packageId: input.packageId });
  if (r.ok) {
    revalidatePath(`/prontuarios/${input.clientId}`);
    revalidatePath(`/apresentacao/${input.clientId}`);
    revalidatePath(`/comercial/${input.clientId}`);
    revalidatePath("/assinaturas");
  }
  return r;
}

export async function descartarEnvio(input: { packageId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionContext();
  return descartarRascunho({ session, packageId: input.packageId });
}
