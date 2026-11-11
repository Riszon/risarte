"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { empresarialDb } from "@/lib/empresarial/db";
import { isValidCpf } from "@/lib/masks";
import { enviarPacote, type PrepareResult, type SendResult } from "@/lib/signatures/send";
import {
  candidatosDaRisarte,
  loadEmpresaSendContext,
  prepararPacoteDaEmpresa,
  type AnexoDoPacote,
  type EmpresaOrigin,
} from "@/lib/signatures/send-empresa";
import { lerAnexosEnviados, lerReferencias } from "@/lib/signatures/anexos-enviados";

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
  risarte: {
    mode: string;
    candidates: { key: string; name: string; roleLabel: string }[];
    /** AP95: o modelo pede o consultor responsável e a empresa não tem — assina quem envia. */
    semConsultorResponsavel: boolean;
    /** O modelo pede o Consultor RisLife responsável. */
    pedeConsultor: boolean;
  };
  /** O representante que o texto do contrato cita (desde a 1039, o de quem assina). */
  contratadaRepName: string | null;
  /** Os PDFs da aba Documentos da empresa que podem entrar no pacote (sem o caminho no bucket). */
  arquivosGuardados: { id: string; nome: string; tipo: string }[];
  /** Há empresa cadastrada? Sem ela não há aba Documentos de onde tirar arquivos. */
  temEmpresa: boolean;
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
        semConsultorResponsavel: c.semConsultorResponsavel,
        pedeConsultor: c.template.risarte_signer_mode === "role" && c.template.risarte_signer_role === "rislife_consultant",
      },
      contratadaRepName: c.contratada.repName,
      arquivosGuardados: c.arquivosGuardados.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo })),
      temEmpresa: !!c.companyId,
      staff: c.staff.map((s) => ({ key: s.key, name: s.name, roleLabel: s.role_label, hasCpf: isValidCpf(s.cpf), hasContact: temContato(s.phone, s.email) })),
      expiryDays: c.settings.companyExpiryDays,
      zapsign: c.zapsign,
    },
  };
}

/**
 * Cria o rascunho e o PDF. O FormData leva `origin_type`, `origin_id`,
 * `incluir_contrato` ("1"), `avisos_lidos` ("1"), `rep_name`, `rep_cpf`,
 * `rep_email`, `rep_phone`, `witness_keys` (JSON), `representative_key`, os
 * arquivos do computador já mandados ao armazenamento em `attachment_refs`
 * (JSON; AP150 — o arquivo não passa aqui) e `anexos_ordem` (JSON): a ordem dos
 * anexos, cada um `{ "origem": "computador", "indice": n }` (n = posição em
 * `attachment_refs`) ou `{ "origem": "guardado", "id": "<company_files.id>" }`.
 */
export async function prepararEnvioDaEmpresa(formData: FormData): Promise<PrepareResult> {
  const session = await getSessionContext();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const origin = parseOrigin({ type: str("origin_type"), id: str("origin_id") });
  if (!origin) return { ok: false, error: "Origem do envio inválida." };
  const json = (k: string): unknown => {
    try {
      return JSON.parse(str(k) || "[]");
    } catch {
      return [];
    }
  };
  const witnessRaw = json("witness_keys");
  const witnessKeys = Array.isArray(witnessRaw) ? witnessRaw.filter((x): x is string => typeof x === "string") : [];

  const lidos = await lerAnexosEnviados(session.userId, lerReferencias(str("attachment_refs")));
  if (!lidos.ok) return lidos;
  const arquivos = lidos.anexos;

  const ordemRaw = json("anexos_ordem");
  const anexos: AnexoDoPacote[] = [];
  if (Array.isArray(ordemRaw)) {
    for (const item of ordemRaw) {
      if (!item || typeof item !== "object") continue;
      const o = item as { origem?: unknown; indice?: unknown; id?: unknown };
      if (o.origem === "computador" && typeof o.indice === "number" && arquivos[o.indice]) {
        anexos.push({ origem: "computador", ...arquivos[o.indice] });
      } else if (o.origem === "guardado" && typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id)) {
        if (!anexos.some((a) => a.origem === "guardado" && a.arquivoId === o.id)) anexos.push({ origem: "guardado", arquivoId: o.id });
      }
    }
  }
  if (anexos.length > 10) return { ok: false, error: "No máximo 10 anexos por pacote." };

  return prepararPacoteDaEmpresa({
    session,
    origin,
    incluirContrato: str("incluir_contrato") === "1",
    avisosLidos: str("avisos_lidos") === "1",
    representante: { name: str("rep_name"), cpf: str("rep_cpf"), email: str("rep_email"), phone: str("rep_phone") },
    witnessKeys,
    representativeKey: str("representative_key") || null,
    anexos,
    motivoDoNovoEnvio: str("motivo_do_novo_envio") || null,
  });
}

export async function concluirEnvioDaEmpresa(input: {
  packageId: string;
  origin: EmpresaOrigin;
  incluiuContrato: boolean;
  temAnexos: boolean;
}): Promise<SendResult> {
  const session = await getSessionContext();
  const r = await enviarPacote({ session, packageId: input.packageId });
  if (r.ok) {
    if (input.origin.type === "commercial_lead") {
      await registrarEnvioNoFunil(input.origin.id, session.userId, r.number, input.incluiuContrato, input.temAnexos);
      revalidatePath(`/empresarial/funil/${input.origin.id}`);
      revalidatePath(`/empresarial/funil/${input.origin.id}/contrato`);
    } else {
      revalidatePath(`/empresarial/${input.origin.id}`);
    }
    revalidatePath("/assinaturas");
  }
  return r;
}

/**
 * O envio pela assinatura digital entra sozinho no registro da aba Envio e
 * selos (decisão do dono, 02/11/2026): canal "Outro", itens Contrato e/ou
 * Documentos adicionais — SEM a proposta, então a fase não muda (gatilho da
 * 1010). Falhar aqui não desfaz o envio: o pacote já está na ZapSign.
 */
async function registrarEnvioNoFunil(leadId: string, userId: string, numero: string, contrato: boolean, anexos: boolean) {
  const itens = [...(contrato ? ["CONTRACT"] : []), ...(anexos ? ["EXTRA"] : [])];
  if (itens.length === 0) return;
  const db = await empresarialDb();
  const nota = `Assinatura digital (ZapSign) — pacote ${numero}`;
  const { error } = await db.from("lead_dispatches").insert({ lead_id: leadId, channel: "OTHER", items: itens, note: nota, sent_by: userId });
  if (error) {
    console.error("signature dispatch record failed:", error.message);
    return;
  }
  await db.from("commercial_lead_activities").insert({
    lead_id: leadId,
    author_id: userId,
    kind: "PROPOSAL",
    note: `${nota}: ${contrato ? "contrato de adesão" : ""}${contrato && anexos ? " e " : ""}${anexos ? "documentos adicionais" : ""}.`,
  });
}
