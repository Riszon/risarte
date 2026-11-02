"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import {
  abrirPdf,
  baixarAssinado,
  baixarCopia,
  cancelarPacote,
  carregarReenvio,
  reenviarPorEmailZapsign,
  registrarReenvio,
  type ActionResult,
  type ResendChannel,
  type ResendSigner,
} from "@/lib/signatures/pacote";
import { reenviarComoNovo } from "@/lib/signatures/reenvio";
import type { PrepareResult } from "@/lib/signatures/send";

/**
 * AS AÇÕES SOBRE UM PACOTE (ZS4), para o detalhe `/assinaturas/pacotes/[id]`
 * e para a aba Documentos da ficha. O trabalho mora em
 * `src/lib/signatures/{pacote,reenvio}.ts`; aqui é a sessão e o
 * `revalidatePath`. Padrão do projeto: `{ ok, error? }` pt-BR.
 */

function revalidar(packageId: string, clientId?: string | null) {
  revalidatePath(`/assinaturas/pacotes/${packageId}`);
  revalidatePath("/assinaturas/pacotes");
  if (clientId) revalidatePath(`/prontuarios/${clientId}`);
}

export async function abrirPdfDoPacote(packageId: string): Promise<ActionResult<{ url: string; kind: "merged" | "signed" }>> {
  return abrirPdf(await getSessionContext(), packageId);
}

export async function baixarPdfAssinado(packageId: string): Promise<ActionResult<{ url: string }>> {
  return baixarAssinado(await getSessionContext(), packageId);
}

export async function baixarCopiaDoDocumento(packageId: string, itemId: string): Promise<ActionResult<{ url: string }>> {
  return baixarCopia(await getSessionContext(), packageId, itemId);
}

export async function carregarLinksParaReenvio(
  packageId: string
): Promise<ActionResult<{ number: string; signers: ResendSigner[]; zapsignEmail: boolean }>> {
  return carregarReenvio(await getSessionContext(), packageId);
}

export async function marcarReenviado(input: { packageId: string; signerId: string; channel: ResendChannel; clientId?: string | null }): Promise<ActionResult> {
  const r = await registrarReenvio(await getSessionContext(), input.packageId, input.signerId, input.channel);
  if (r.ok) revalidar(input.packageId, input.clientId);
  return r;
}

export async function reenviarPeloEmailDaZapsign(input: { packageId: string; clientId?: string | null }): Promise<ActionResult> {
  const r = await reenviarPorEmailZapsign(await getSessionContext(), input.packageId);
  if (r.ok) revalidar(input.packageId, input.clientId);
  return r;
}

export async function cancelarPacoteDeAssinatura(input: { packageId: string; reason: string; clientId?: string | null }): Promise<ActionResult<{ number: string }>> {
  const r = await cancelarPacote(await getSessionContext(), input.packageId, input.reason);
  if (r.ok) revalidar(input.packageId, input.clientId);
  return r;
}

export async function prepararReenvioComoNovo(packageId: string): Promise<PrepareResult> {
  return reenviarComoNovo(await getSessionContext(), packageId);
}
