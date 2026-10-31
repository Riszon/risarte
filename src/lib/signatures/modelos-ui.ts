import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { RisarteSignerMode, TemplateAuthLevel, TemplateKind } from "./types";

/** Os rótulos das telas de modelos (lista e edição). */

export const AUTH_LEVEL_LABEL: Record<TemplateAuthLevel, string> = {
  simple: "Simples (assinatura na tela)",
  strong: "Reforçada (selfie + código, sempre)",
  by_amount: "Pelo valor (reforçada acima do corte da rede)",
};

export const KIND_LABEL: Record<TemplateKind, string> = {
  contract: "Contrato",
  consent: "Consentimento",
  budget: "Orçamento",
  image_release: "Autorização de imagem",
  adhesion: "Adesão empresarial",
  other: "Outro",
};

export function representanteLabel(mode: RisarteSignerMode, role: UserRole | null): string {
  switch (mode) {
    case "none":
      return "sem assinatura da Risarte";
    case "sender":
      return "quem envia";
    case "user":
      return "pessoa fixa";
    case "role":
      return role ? ROLE_LABELS[role] : "Titular (Admin Principal)";
  }
}
