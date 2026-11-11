import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth";
import { addDaysIso, monthRangeOf, todayInBrazil } from "@/lib/dates";
import { contagemConfirmada } from "@/lib/contagem";
import { lerTodasAsPaginas } from "@/lib/paginar";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewSignatureNetworkDashboard, canViewSignatureUnitDashboard } from "./access";
import { LISTAS, type LinhaDoPainel, type ListaDoPainel, type Periodo } from "./indicadores";

/**
 * OS FILTROS E A LEITURA DO PAINEL (ZS7). A tela, a página de relatórios e as
 * rotas de PDF e planilha leem os MESMOS filtros da URL e chamam a MESMA
 * leitura (`signature_report_rows`, 0347) — o relatório baixado é o que a tela
 * mostrou.
 */

export const ATALHOS = ["mes", "30d", "mes_passado", "ano", "personalizado"] as const;
export type Atalho = (typeof ATALHOS)[number];

export const ROTULO_DO_ATALHO: Record<Atalho, string> = {
  mes: "Este mês",
  "30d": "Últimos 30 dias",
  mes_passado: "Mês passado",
  ano: "Este ano",
  personalizado: "Escolher datas",
};

export type FiltrosDoPainel = {
  atalho: Atalho;
  periodo: Periodo;
  clinicId: string | null;
  audience: "patient" | "company" | null;
  templateId: string | null;
  sentBy: string | null;
  lista: ListaDoPainel | null;
  faixa: number | null;
  porDocumento: boolean;
};

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function periodoDoAtalho(atalho: Atalho, hoje: string, de?: string, ate?: string): Periodo {
  switch (atalho) {
    case "30d":
      return { de: addDaysIso(hoje, -29), ate: hoje };
    case "mes_passado": {
      const anterior = monthRangeOf(addDaysIso(monthRangeOf(hoje).from, -1));
      return { de: anterior.from, ate: anterior.to };
    }
    case "ano":
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje };
    case "personalizado":
      if (de && ate && DIA.test(de) && DIA.test(ate) && de <= ate) return { de, ate };
      return { de: monthRangeOf(hoje).from, ate: hoje };
    case "mes":
    default:
      return { de: monthRangeOf(hoje).from, ate: hoje };
  }
}

export function lerFiltros(sp: Record<string, string | undefined>, hoje: string = todayInBrazil()): FiltrosDoPainel {
  const atalho = (ATALHOS as readonly string[]).includes(sp.periodo ?? "") ? (sp.periodo as Atalho) : "mes";
  const p = periodoDoAtalho(atalho, hoje, sp.de, sp.ate);
  const faixa = sp.faixa != null && /^\d$/.test(sp.faixa) ? Number(sp.faixa) : null;
  return {
    atalho,
    periodo: { de: p.de, ate: p.ate },
    clinicId: sp.unidade && UUID.test(sp.unidade) ? sp.unidade : null,
    audience: sp.publico === "patient" || sp.publico === "company" ? sp.publico : null,
    templateId: sp.modelo && UUID.test(sp.modelo) ? sp.modelo : null,
    sentBy: sp.enviou && UUID.test(sp.enviou) ? sp.enviou : null,
    lista: (LISTAS as readonly string[]).includes(sp.lista ?? "") ? (sp.lista as ListaDoPainel) : null,
    faixa,
    porDocumento: sp.por === "documento",
  };
}

/** A URL com os filtros de agora (e as trocas pedidas): os cartões e as faixas viram links. */
export function urlDoPainel(base: string, f: FiltrosDoPainel, trocas: Partial<Record<string, string | null>> = {}): string {
  const params = new URLSearchParams();
  const atual: Record<string, string | null> = {
    periodo: f.atalho === "mes" ? null : f.atalho,
    de: f.atalho === "personalizado" ? f.periodo.de : null,
    ate: f.atalho === "personalizado" ? f.periodo.ate : null,
    unidade: f.clinicId,
    publico: f.audience,
    modelo: f.templateId,
    enviou: f.sentBy,
    lista: f.lista,
    faixa: f.faixa == null ? null : String(f.faixa),
    por: f.porDocumento ? "documento" : null,
  };
  for (const [k, v] of Object.entries({ ...atual, ...trocas })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Quem vê o painel: da rede (todas as unidades) ou da unidade (as suas). */
export function alcanceDoPainel(session: SessionContext): "rede" | "unidade" | null {
  if (canViewSignatureNetworkDashboard(session)) return "rede";
  if (canViewSignatureUnitDashboard(session)) return "unidade";
  return null;
}

export type LeituraDoPainel = { ok: true; linhas: LinhaDoPainel[] } | { ok: false; erro: string };

/** Lê em páginas (a API corta em 1.000) — leitura pela metade não vira número. */
export async function lerLinhasDoPainel(
  supabase: SupabaseClient,
  f: FiltrosDoPainel,
  alcance: "rede" | "unidade" = "rede"
): Promise<LeituraDoPainel> {
  const r = await lerTodasAsPaginas<LinhaDoPainel>((de, ate) =>
    supabase
      .rpc("signature_report_rows", {
        p_from: f.periodo.de,
        p_to: f.periodo.ate,
        p_clinic_ids: f.clinicId ? [f.clinicId] : null,
        p_audience: f.audience,
        p_template_id: f.templateId,
        p_sent_by: f.sentBy,
      })
      .range(de, ate)
  );
  if (!r.ok) {
    const msg = String((r.error as { message?: string })?.message ?? r.error ?? "");
    return {
      ok: false,
      erro: /Could not find the function|does not exist/i.test(msg)
        ? "O painel ainda não está instalado neste banco (falta a migração 0347)."
        : "Não foi possível ler os pacotes agora. Recarregue a página.",
    };
  }
  let linhas = r.linhas.map((l) => ({ ...l, items: Array.isArray(l.items) ? l.items : [] }));
  // AP158 (item 3): no painel DA UNIDADE só entram as unidades onde a pessoa
  // tem o painel da unidade — a leitura (RLS) traz também as que ela só pode
  // visualizar. Pergunta ao banco uma vez por unidade.
  if (alcance === "unidade") {
    const unidades = [...new Set(linhas.map((l) => l.clinic_id))];
    const respostas = await Promise.all(
      unidades.map(async (c) => [c, (await supabase.rpc("signature_can", { p_capability: "acao.assinaturas.painel_unidade", p_clinic_id: c })).data === true] as const)
    );
    const permitidas = new Set(respostas.filter(([, ok]) => ok).map(([c]) => c));
    linhas = linhas.filter((l) => permitidas.has(l.clinic_id));
  }
  return { ok: true, linhas };
}

export type OpcoesDosFiltros = {
  unidades: { id: string; nome: string }[];
  modelos: { id: string; nome: string }[];
  remetentes: { id: string; nome: string }[];
  faixas: number[];
  limiteDoPlano: number | null;
  /** `null` = não foi possível contar (AP136); a tela mostra um traço. */
  usadosNoMes: number | null;
};

export async function lerOpcoes(
  supabase: SupabaseClient,
  session: SessionContext,
  alcance: "rede" | "unidade",
  linhas: LinhaDoPainel[]
): Promise<OpcoesDosFiltros> {
  const mes = todayInBrazil().slice(0, 7);
  const [modelos, settings, usados, clinicas] = await Promise.all([
    supabase.from("signature_templates").select("id, name").order("sort_order"),
    supabase.from("signature_settings").select("waiting_buckets_days, zapsign_monthly_limit").eq("id", true).maybeSingle(),
    supabase.from("signature_packages").select("id", { count: "exact", head: true }).eq("plan_month", mes),
    alcance === "rede"
      ? createAdminClient().from("clinics").select("id, name").eq("is_active", true).order("name")
      : Promise.resolve({ data: session.clinics.map((c) => ({ id: c.id, name: c.name })) }),
  ]);
  const remetentes = new Map<string, string>();
  for (const l of linhas) if (l.sent_by) remetentes.set(l.sent_by, l.sent_by_name ?? "Sem nome");
  return {
    unidades: (clinicas.data ?? []).map((c) => ({ id: c.id, nome: c.name })),
    modelos: (modelos.data ?? []).map((m) => ({ id: m.id, nome: m.name })),
    remetentes: [...remetentes].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    faixas: (settings.data?.waiting_buckets_days as number[] | null) ?? [2, 5, 7],
    limiteDoPlano: (settings.data?.zapsign_monthly_limit as number | null) ?? null,
    usadosNoMes: contagemConfirmada(usados),
  };
}
