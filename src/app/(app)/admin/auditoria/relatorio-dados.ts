import "server-only";
import { requireAdminMaster } from "@/lib/auth";
import {
  lerLinhasDeAtividade,
  lerModo,
  lerPeriodoDoRelatorio,
  semAtividade,
  type LinhaDeAtividade,
  type ModoDoRelatorio,
  type PeriodoDoRelatorio,
  type QuemEQuem,
} from "@/lib/auditoria-relatorio";
import { todayInBrazil } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

/**
 * QUEM CARREGA O RELATÓRIO DE ATIVIDADE — a aba da Auditoria E a planilha.
 *
 * As duas saídas chamam daqui (lição do OC-00009): se cada uma lesse o banco
 * por conta própria, a tela e a planilha poderiam mostrar números diferentes
 * para o mesmo filtro.
 *
 * ⚠️ A guarda vem ANTES de qualquer leitura: só o Admin Master passa. E o
 * banco repete a regra — para qualquer outra pessoa a função devolve vazio.
 */

type Filtros = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export type CargaDoRelatorio = {
  periodo: PeriodoDoRelatorio;
  modo: ModoDoRelatorio;
  /** A pessoa filtrada (id), ou vazio para todas. */
  colaborador: string;
  /** `null` = o banco não respondeu (falta a 0289) — diferente de lista vazia. */
  linhas: LinhaDeAtividade[] | null;
  quem: QuemEQuem;
  /** Com acesso ativo e sem nada no período (só quando o relatório é de todos). */
  semAcesso: string[];
  geradoPor: string | null;
};

export async function carregarRelatorioDeAtividade(
  filtros: Filtros
): Promise<CargaDoRelatorio> {
  const sessao = await requireAdminMaster();
  const supabase = await createClient();

  const periodo = lerPeriodoDoRelatorio(um(filtros.de), um(filtros.ate), todayInBrazil());
  const modo = lerModo(um(filtros.modo));

  const [{ data: perfis }, { data: risartanos }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_active").order("full_name"),
    supabase.from("staff_members").select("user_id, code").not("user_id", "is", null),
  ]);

  const quem: QuemEQuem = { nomes: new Map(), codigos: new Map() };
  const ativos: string[] = [];
  for (const p of perfis ?? []) {
    quem.nomes.set(p.id, p.full_name || p.email || "—");
    if (p.is_active) ativos.push(p.id);
  }
  for (const s of risartanos ?? []) {
    if (s.user_id && s.code) quem.codigos.set(s.user_id, s.code);
  }

  // Pessoa vinda da URL só vale se existir: nunca vai texto solto para o banco.
  const pedido = um(filtros.colaborador);
  const colaborador = quem.nomes.has(pedido) ? pedido : "";

  const { data, error } = await supabase.rpc("audit_activity_report", {
    p_from: periodo.de,
    p_to: periodo.ate,
    p_user: colaborador || null,
  });
  const linhas = error ? null : lerLinhasDeAtividade(data);

  return {
    periodo,
    modo,
    colaborador,
    linhas,
    quem,
    semAcesso: colaborador || !linhas ? [] : semAtividade(ativos, linhas),
    geradoPor: sessao.fullName || sessao.email || null,
  };
}
