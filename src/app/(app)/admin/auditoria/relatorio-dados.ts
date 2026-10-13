import "server-only";
import { requireAdminMaster } from "@/lib/auth";
import {
  lerFuncao,
  lerPessoasDoPainel,
  lerUnidade,
  eventosDe,
} from "@/lib/auditoria-painel";
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
import { lerTodasAsPaginas } from "@/lib/paginar";
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
 *
 * ⚠️ LÊ EM PÁGINAS. A API corta a resposta em 1.000 linhas, e este relatório
 * passa disso com facilidade (pessoas × dias). `lerTodasAsPaginas` segue até
 * acabar; se uma página falhar, o relatório inteiro falha — nunca sai metade.
 */

type Filtros = Record<string, string | string[] | undefined>;

const um = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export type CargaDoRelatorio = {
  periodo: PeriodoDoRelatorio;
  modo: ModoDoRelatorio;
  /** A pessoa filtrada (id), ou vazio para todas. */
  colaborador: string;
  /** A unidade filtrada (id), ou vazio. */
  unidade: string;
  /** A função filtrada, ou vazio. */
  funcao: string;
  /**
   * O banco ainda não tem os filtros de unidade e função (falta a 0290): o
   * relatório saiu SEM eles, e a tela tem de dizer isso em vez de fingir.
   */
  filtrosIndisponiveis: boolean;
  /** `null` = o banco não respondeu (falta a 0289) — diferente de lista vazia. */
  linhas: LinhaDeAtividade[] | null;
  quem: QuemEQuem;
  /** id → nome das unidades (para o filtro e para o cabeçalho da planilha). */
  unidades: Map<string, string>;
  /** Com acesso ativo e sem nada no período (só quando não há pessoa filtrada). */
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

  const [{ data: perfis }, { data: risartanos }, { data: clinicas }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_active").order("full_name"),
    supabase.from("staff_members").select("user_id, code").not("user_id", "is", null),
    supabase.from("clinics").select("id, name").order("name"),
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
  const unidades = new Map<string, string>();
  for (const c of clinicas ?? []) unidades.set(c.id, c.name);

  // O que vem da URL só vai ao banco se existir: nunca texto solto.
  const pedido = um(filtros.colaborador);
  const colaborador = quem.nomes.has(pedido) ? pedido : "";
  const unidade = lerUnidade(filtros.unidade, unidades);
  const funcao = lerFuncao(filtros.funcao);

  // Com a 0290: a função aceita unidade e função.
  let lido = await lerTodasAsPaginas<unknown>((de, ate) =>
    supabase
      .rpc("audit_activity_report", {
        p_from: periodo.de,
        p_to: periodo.ate,
        p_user: colaborador || null,
        p_clinic: unidade || null,
        p_role: funcao || null,
      })
      .range(de, ate)
  );
  // Banco ainda sem a 0290: a função antiga só conhece a pessoa. O relatório
  // sai sem os dois filtros novos, e isso é DITO na tela.
  let filtrosIndisponiveis = false;
  if (!lido.ok) {
    const antigo = await lerTodasAsPaginas<unknown>((de, ate) =>
      supabase
        .rpc("audit_activity_report", {
          p_from: periodo.de,
          p_to: periodo.ate,
          p_user: colaborador || null,
        })
        .range(de, ate)
    );
    if (antigo.ok) {
      lido = antigo;
      filtrosIndisponiveis = true;
    }
  }
  const linhas = lido.ok ? lerLinhasDeAtividade(lido.linhas) : null;

  // Quem tem acesso e não apareceu. Com filtro de unidade/função, a lista de
  // "quem deveria ter aparecido" é a do recorte — e quem sabe o recorte é o
  // banco (`audit_usage_people`, a mesma régua do painel).
  let semAcesso: string[] = [];
  if (linhas && !colaborador) {
    if (!filtrosIndisponiveis && (unidade || funcao)) {
      const { data, error } = await supabase.rpc("audit_usage_people", {
        p_from: periodo.de,
        p_to: periodo.ate,
        p_clinic: unidade || null,
        p_role: funcao || null,
      });
      const gente = error ? null : lerPessoasDoPainel(data);
      semAcesso = (gente ?? [])
        .filter((p) => p.ativa && p.diasComAcesso === 0 && eventosDe(p) === 0)
        .map((p) => p.usuario);
    } else {
      semAcesso = semAtividade(ativos, linhas);
    }
  }

  const nomeDe = (id: string) => quem.nomes.get(id) ?? "";
  semAcesso.sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));

  return {
    periodo,
    modo,
    colaborador,
    unidade: filtrosIndisponiveis ? "" : unidade,
    funcao: filtrosIndisponiveis ? "" : funcao,
    filtrosIndisponiveis: filtrosIndisponiveis && Boolean(unidade || funcao),
    linhas,
    quem,
    unidades,
    semAcesso,
    geradoPor: sessao.fullName || sessao.email || null,
  };
}
