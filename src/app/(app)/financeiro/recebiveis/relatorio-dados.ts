import "server-only";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
import { dataDoFiltro, noPeriodo } from "@/lib/finance/collection";
import type { RelatorioPronto } from "@/lib/finance/relatorio";
import { totaisDaRede, porAtencao } from "@/lib/finance/network-receivables";
import { carregarRecebiveis } from "./dados";
import { carregarFilaDeCobranca } from "./inadimplentes/dados";
import {
  relatorioDaRede,
  relatorioDeInadimplentes,
  relatorioDeRecebiveis,
} from "./montar-relatorios";

/**
 * QUEM CARREGA OS RELATÓRIOS — a página de impressão E a rota da planilha.
 *
 * As duas saídas chamam daqui. Se cada uma carregasse os próprios dados, o PDF
 * e a planilha poderiam mostrar números diferentes para o mesmo filtro — e
 * ninguém descobriria até alguém comparar os dois papéis na mesa.
 */

export type Filtros = { [k: string]: string | string[] | undefined };

function pick(params: Filtros, k: string): string | null {
  const v = params[k];
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").trim() || null;
}

/** `null` = sem permissão; quem chama devolve 403 ou manda embora. */
type Carga = { relatorio: RelatorioPronto } | null;

async function contexto() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) return null;
  const supabase = await createClient();
  const quem = session.fullName || session.email || null;
  return { session, supabase, quem };
}

/** A unidade do relatório: a escolhida pela rede, senão a ativa. */
async function resolverUnidade(
  ctx: NonNullable<Awaited<ReturnType<typeof contexto>>>,
  params: Filtros
): Promise<{ clinicId: string; nome: string } | null> {
  const podeEscolher =
    ctx.session.isAdminMaster || isFinanceFranchisor(ctx.session);
  const escolhida = pick(params, "unidade");

  if (podeEscolher && escolhida) {
    const { data } = await ctx.supabase
      .from("clinics")
      .select("id, name")
      .eq("id", escolhida)
      .maybeSingle<{ id: string; name: string }>();
    if (data) return { clinicId: data.id, nome: data.name };
  }

  const ativa = ctx.session.activeClinic;
  return ativa ? { clinicId: ativa.id, nome: ativa.name } : null;
}

async function taxaDaUnidade(
  ctx: NonNullable<Awaited<ReturnType<typeof contexto>>>,
  clinicId: string
) {
  const { data } = await ctx.supabase.rpc("clinic_overdue_rate", {
    p_clinic_id: clinicId,
  });
  const t = ((data ?? []) as {
    overdue_percent: number | null;
    limit_percent: number | null;
  }[])[0];
  return {
    taxaPercent: t?.overdue_percent == null ? null : Number(t.overdue_percent),
    limitePercent: t?.limit_percent == null ? null : Number(t.limit_percent),
  };
}

// -----------------------------------------------------------------------------

export async function carregarRelatorioDeInadimplentes(
  params: Filtros
): Promise<Carga> {
  const ctx = await contexto();
  if (!ctx) return null;
  const unidade = await resolverUnidade(ctx, params);
  if (!unidade) return null;

  const de = dataDoFiltro(pick(params, "de"));
  const ate = dataDoFiltro(pick(params, "ate"));

  const [{ fila, semCliente }, taxa] = await Promise.all([
    carregarFilaDeCobranca(ctx.supabase, unidade.clinicId, { de, ate }),
    taxaDaUnidade(ctx, unidade.clinicId),
  ]);

  return {
    relatorio: relatorioDeInadimplentes({
      fila,
      unidade: unidade.nome,
      de,
      ate,
      quem: ctx.quem,
      semCliente,
      ...taxa,
    }),
  };
}

export async function carregarRelatorioDeRecebiveis(
  params: Filtros
): Promise<Carga> {
  const ctx = await contexto();
  if (!ctx) return null;
  const unidade = await resolverUnidade(ctx, params);
  if (!unidade) return null;

  const de = dataDoFiltro(pick(params, "de"));
  const ate = dataDoFiltro(pick(params, "ate"));
  const mostrar = pick(params, "mostrar");
  const busca = (pick(params, "cliente") ?? "").toLowerCase();

  const { linhas, resumo } = await carregarRecebiveis(
    ctx.supabase,
    unidade.clinicId
  );
  // ⚠️ OS MESMOS FILTROS DA TELA, na mesma ordem. O relatório que sai do botão
  // tem de ser o que está na tela; filtrar diferente aqui faria o papel
  // discordar do que a pessoa acabou de ver.
  const visiveis = linhas
    .filter((l) =>
      mostrar === "vencidas"
        ? l.isLate
        : mostrar === "a_vencer"
          ? !l.isLate
          : true
    )
    .filter((l) => (busca ? l.cliente.toLowerCase().includes(busca) : true))
    .filter((l) => noPeriodo(l.dataEfetiva, de, ate));

  return {
    relatorio: relatorioDeRecebiveis({
      linhas: visiveis,
      unidade: unidade.nome,
      de,
      ate,
      quem: ctx.quem,
      abertoCents: resumo.abertoCents,
      vencidoCents: resumo.vencidoCents,
      taxaPercent: resumo.taxaPercent,
      limitePercent: resumo.limitePercent,
      recebidoNoMesCents: resumo.recebidoNoMesCents,
    }),
  };
}

export async function carregarRelatorioDaRede(): Promise<Carga> {
  const ctx = await contexto();
  if (!ctx) return null;
  // A tela da rede é da Franqueadora; o relatório segue a mesma porta.
  if (!ctx.session.isAdminMaster && !isFinanceFranchisor(ctx.session)) {
    return null;
  }

  const { data } = await ctx.supabase.rpc("network_receivables");
  const unidades = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    clinicId: String(r.clinic_id),
    nome: String(r.clinic_name),
    ownership: r.ownership === "own" ? ("own" as const) : ("franchised" as const),
    abertoCents: Number(r.open_cents ?? 0),
    vencidoCents: Number(r.overdue_cents ?? 0),
    vencidoQuantidade: Number(r.overdue_count ?? 0),
    abertoQuantidade: Number(r.open_count ?? 0),
    taxaPercent:
      r.overdue_percent == null ? null : Number(r.overdue_percent),
    limitePercent: r.limit_percent == null ? null : Number(r.limit_percent),
    // As escadas não entram no relatório da rede (são um gráfico, não uma
    // tabela), mas o tipo compartilhado as exige — e é ele que garante que a
    // ordenação daqui seja a MESMA da tela.
    aVencer: [
      Number(r.due_30_cents ?? 0),
      Number(r.due_60_cents ?? 0),
      Number(r.due_90_cents ?? 0),
      Number(r.due_more_cents ?? 0),
    ] as [number, number, number, number],
    atrasadas: [
      Number(r.late_30_cents ?? 0),
      Number(r.late_60_cents ?? 0),
      Number(r.late_90_cents ?? 0),
      Number(r.late_more_cents ?? 0),
    ] as [number, number, number, number],
  }));

  const totais = totaisDaRede(unidades);

  return {
    relatorio: relatorioDaRede({
      // A MESMA ordem da tela: quem pede atenção primeiro.
      unidades: [...unidades].sort(porAtencao),
      quem: ctx.quem,
      totalAbertoCents: totais.abertoCents,
      totalVencidoCents: totais.vencidoCents,
      taxaDaRede: totais.taxaPercent,
      acimaDoLimite: totais.acimaDoLimite,
    }),
  };
}
