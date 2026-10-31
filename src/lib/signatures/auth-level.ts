import type { ZapsignAuthMode } from "@/lib/zapsign/types";
import type { AuthLevel, OrderGroup, SignatureTemplate } from "./types";

/**
 * Qual autenticação o cliente enfrenta (plano ZS0 §7): `strong` quando algum
 * modelo do pacote exige, ou quando o valor ligado passa do corte da rede
 * (`signature_settings.strong_auth_threshold_cents`). A tela mostra o motivo.
 */
export function nivelDeAutenticacao(input: {
  templates: Pick<SignatureTemplate, "auth_level" | "name">[];
  linkedAmountCents: number | null;
  thresholdCents: number;
}): { level: AuthLevel; reason: string } {
  const exige = input.templates.find((t) => t.auth_level === "strong");
  if (exige) {
    return { level: "strong", reason: `reforçada (o modelo "${exige.name}" exige)` };
  }
  const porValor = input.templates.some((t) => t.auth_level === "by_amount");
  const valor = input.linkedAmountCents ?? 0;
  if (porValor && valor > input.thresholdCents) {
    return {
      level: "strong",
      reason: `reforçada (valor ${brl(valor)} acima do corte de ${brl(input.thresholdCents)})`,
    };
  }
  return { level: "simple", reason: "simples (assinatura na tela)" };
}

/**
 * O modo da ZapSign para cada signatário. A reforçada é só do cliente (grupo 1):
 * com telefone vai por WhatsApp; sem telefone, por e-mail. Testemunhas e
 * Risarte assinam sempre na tela.
 */
export function modoDeAutenticacao(input: {
  level: AuthLevel;
  orderGroup: OrderGroup;
  phone: string | null;
  email: string | null;
}): { auth_mode: ZapsignAuthMode; require_selfie_photo: boolean } {
  if (input.level === "strong" && input.orderGroup === 1) {
    const temTelefone = (input.phone ?? "").replace(/\D/g, "").length >= 10;
    return {
      auth_mode: temTelefone ? "assinaturaTela-tokenWhatsapp" : "assinaturaTela-tokenEmail",
      require_selfie_photo: true,
    };
  }
  return { auth_mode: "assinaturaTela", require_selfie_photo: false };
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}
