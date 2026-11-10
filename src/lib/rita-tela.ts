// A tela "O que a Rita sabe" (Rita, Fase 0A.7a — migração 3006). As regras
// puras: o estado de cada unidade, quem liga e quem desliga, e o que dizer
// quando o banco recusa. A barreira real é o banco (`rita._can_read_unit`,
// `rita.set_enabled`); aqui é a tela (menu, botões, mensagens).

import { hasRoleInClinic, pode, type SessionContext } from "@/lib/auth";

export type UnidadeDaLista = {
  clinic_id: string;
  clinic_name: string;
  enabled: boolean;
  paused_at: string | null;
  paused_auto: boolean;
  paused_reason: string | null;
  mode: string;
  gaps: number;
  network_enabled: boolean;
};

export type EstadoDaRita = "ligada" | "pausada" | "pronta" | "desligada";

export const ESTADO_DA_RITA: Record<EstadoDaRita, { rotulo: string; tom: string }> = {
  ligada: {
    rotulo: "Ligada",
    tom: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  pausada: {
    rotulo: "Pausada sozinha",
    tom: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  },
  pronta: {
    rotulo: "Pronta para ligar",
    tom: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  desligada: { rotulo: "Desligada", tom: "bg-muted text-muted-foreground" },
};

/**
 * Ligada > pausada sozinha (a régua achou uma lacuna e desligou) > pronta
 * (nada falta, só ninguém ligou) > desligada. A pausa feita por uma pessoa
 * conta como "desligada": não é alarme, foi decisão.
 */
export function estadoDaUnidade(u: Pick<UnidadeDaLista, "enabled" | "paused_auto" | "gaps">): EstadoDaRita {
  if (u.enabled) return "ligada";
  if (u.paused_auto) return "pausada";
  if (u.gaps === 0) return "pronta";
  return "desligada";
}

export const MODO_DA_RITA: Record<string, string> = {
  off: "Desligada",
  sombra: "Sombra (só observa, não responde ninguém)",
  ativo: "Ativa",
};

export const DIAS_DA_SEMANA = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** Vê o módulo (menu e páginas). */
export function podeVerRita(session: SessionContext): boolean {
  return pode(session, "modulo.rita");
}

/** Ligar: só o Admin Master (regra DA6; o banco confere de novo). */
export function podeLigarRita(session: SessionContext): boolean {
  return session.isAdminMaster;
}

/** Desligar: o Admin Master ou o Gerente DA unidade. */
export function podeDesligarRita(session: SessionContext, clinicId: string): boolean {
  return session.isAdminMaster || hasRoleInClinic(session, clinicId, ["unit_manager"]);
}

type ErroDoBanco = { code?: string; message?: string } | null | undefined;

/** O schema `rita` não está exposto na API deste projeto (falta o passo do painel). */
export function faltaExporRita(erro: ErroDoBanco): boolean {
  return erro?.code === "PGRST106" || /invalid schema/i.test(erro?.message ?? "");
}

export const AVISO_SEM_SCHEMA =
  "Falta liberar a área \"rita\" no Supabase deste ambiente (Project Settings → Data API → Exposed schemas). Avise o administrador.";

/** O que dizer quando ligar ou desligar é recusado. */
export function mensagemDoInterruptor(erro: ErroDoBanco): string {
  const texto = erro?.message ?? "";
  if (faltaExporRita(erro)) return AVISO_SEM_SCHEMA;
  if (erro?.code === "PGRST202" || erro?.code === "42883") {
    return "A assistente virtual ainda não está instalada neste banco. Avise o administrador.";
  }
  if (texto.includes("NETWORK_OFF")) return "Ligue a Rita na rede antes de ligar uma unidade.";
  if (texto.includes("RITA_AGENT_MISSING")) {
    return "O usuário técnico da Rita não existe neste banco. Avise o administrador.";
  }
  const lacunas = /ACTIVATION_GAPS:(.*)/.exec(texto);
  if (lacunas) return `Ainda falta: ${lacunas[1].trim()}.`;
  if (texto.includes("CLINIC_NOT_FOUND")) return "Unidade não encontrada.";
  if (texto.includes("NOT_ALLOWED") || erro?.code === "42501") {
    return "Você não tem permissão para esta ação.";
  }
  return "Não foi possível concluir agora. Tente de novo em instantes.";
}
