// A TRANCA DO SISTEMA REAL POR UNIDADE E FUNÇÃO (0276).
//
// A regra mora no BANCO (`system_access_by_clinic`), numa função só, para a
// sessão, a ficha do Risartano e o Início responderem igual. Aqui fica o que o
// app faz com a resposta — puro e testado, porque decide quem entra.

import type { UserRole } from "@/lib/roles";

export const MOTIVOS_DE_ACESSO = [
  "admin_master",
  "sistema_fechado",
  "anterior",
  "manual",
  "sem_metas",
  "certificado",
  "aguardando_grupo",
  "aguardando_missao",
] as const;
export type MotivoDeAcesso = (typeof MOTIVOS_DE_ACESSO)[number];

/** O porquê, na voz de quem lê a ficha ou o Início. */
export const ROTULO_DO_MOTIVO: Record<MotivoDeAcesso, string> = {
  admin_master: "Admin Master",
  sistema_fechado: "Sistema real fechado na ficha",
  anterior: "Liberado antes do portão",
  manual: "Liberado sem missão pelo Admin",
  sem_metas: "Função sem metas definidas",
  certificado: "Missão cumprida",
  aguardando_grupo: "Aguardando o grupo da unidade cumprir",
  aguardando_missao: "Aguardando a missão desta função",
};

export type AcessoDaUnidade = {
  clinic_id: string;
  role: UserRole;
  allowed: boolean;
  reason: MotivoDeAcesso;
};

export type LeituraDoAcesso =
  | { tipo: "ok"; linhas: AcessoDaUnidade[] }
  /** Banco ainda sem a 0276 — o código chega antes da migração (CLAUDE.md §0b). */
  | { tipo: "sem_funcao" }
  | { tipo: "erro"; mensagem: string };

// PGRST202 = o PostgREST não conhece a função; 42883 = o Postgres não conhece.
const FUNCAO_AUSENTE = new Set(["PGRST202", "42883"]);

/**
 * Lê a resposta do banco SEPARANDO os três casos.
 *
 * ⚠️ "Não existe a função" e "a consulta falhou" NÃO são a mesma coisa. O
 * primeiro é a janela entre o código subir e a migração rodar: aí vale o
 * comportamento de antes (a porta da 0259), como a 0259 fez na sua própria
 * janela. O segundo é falha de verdade, e guarda que não consegue conferir
 * FECHA (AP11) — senão uma queda do banco abriria todas as unidades.
 */
export function lerAcessoPorUnidade(resposta: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}): LeituraDoAcesso {
  if (resposta.error) {
    if (resposta.error.code && FUNCAO_AUSENTE.has(resposta.error.code)) {
      return { tipo: "sem_funcao" };
    }
    return { tipo: "erro", mensagem: resposta.error.message ?? "erro sem mensagem" };
  }
  if (!Array.isArray(resposta.data)) {
    return { tipo: "erro", mensagem: "resposta sem lista" };
  }
  const linhas: AcessoDaUnidade[] = [];
  for (const r of resposta.data as Record<string, unknown>[]) {
    const motivo = String(r.reason);
    if (!(MOTIVOS_DE_ACESSO as readonly string[]).includes(motivo)) {
      // Motivo desconhecido = banco e código divergiram. Não se adivinha o
      // que ele quer dizer: a linha conta como fechada.
      linhas.push({
        clinic_id: String(r.clinic_id),
        role: r.role as UserRole,
        allowed: false,
        reason: "aguardando_missao",
      });
      continue;
    }
    linhas.push({
      clinic_id: String(r.clinic_id),
      role: r.role as UserRole,
      allowed: r.allowed === true,
      reason: motivo as MotivoDeAcesso,
    });
  }
  return { tipo: "ok", linhas };
}

export type UnidadeFechada = {
  clinicId: string;
  role: UserRole;
  motivo: MotivoDeAcesso;
};

/**
 * Quais unidades da pessoa ficam na sessão.
 *
 * ⚠️ UNIDADE SEM RESPOSTA DO BANCO FICA FECHADA. As duas listas vêm da mesma
 * tabela (`user_clinic_roles`), então a falta de uma linha só acontece se algo
 * divergiu — e divergência não abre porta.
 */
export function aplicarTranca(
  unidadesDaPessoa: readonly string[],
  leitura: LeituraDoAcesso
): { liberadas: Set<string>; fechadas: UnidadeFechada[] } {
  if (leitura.tipo === "sem_funcao") {
    return { liberadas: new Set(unidadesDaPessoa), fechadas: [] };
  }
  if (leitura.tipo === "erro") {
    return { liberadas: new Set(), fechadas: [] };
  }
  const porUnidade = new Map(leitura.linhas.map((l) => [l.clinic_id, l]));
  const liberadas = new Set<string>();
  const fechadas: UnidadeFechada[] = [];
  for (const id of unidadesDaPessoa) {
    const l = porUnidade.get(id);
    if (l?.allowed) liberadas.add(id);
    else if (l) fechadas.push({ clinicId: id, role: l.role, motivo: l.reason });
  }
  return { liberadas, fechadas };
}
