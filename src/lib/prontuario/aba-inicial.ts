import type { UserRole } from "@/lib/roles";

/**
 * A ABA EM QUE O PRONTUÁRIO ABRE (28/10/2026).
 *
 * Antes toda ficha abria no Cadastro, e o dentista rolava a barra até o
 * Desenvolvimento Clínico em cada atendimento. Agora cada papel cai na aba
 * do seu trabalho. O `?aba=` do endereço (vindo de um aviso) continua
 * mandando — esta regra só vale quando ninguém pediu uma aba.
 *
 * Ordem de desempate, para quem acumula papéis: o Coordenador manda na
 * avaliação, o Planner no plano, o dentista na execução; o resto é cadastro.
 */
export function abaInicialDoProntuario(opts: {
  abaPedida: string | null;
  isAdminMaster: boolean;
  rolesNaUnidade: readonly UserRole[];
  isPlannerAnywhere: boolean;
}): string {
  if (opts.abaPedida) return opts.abaPedida;
  if (opts.isAdminMaster) return "cadastro";
  const r = opts.rolesNaUnidade;
  if (r.includes("clinical_coordinator")) return "clinico";
  if (opts.isPlannerAnywhere || r.includes("planner_dentist")) return "plano";
  if (r.includes("dentist")) return "desenvolvimento";
  return "cadastro";
}
