// ASA2, entrega 2 (4006) — O SELO "EM ATRASO" (spec 17.1).
//
// UMA REGRA SÓ: a parcela em aberto conta como "em atraso" depois de N dias
// ÚTEIS do vencimento (rede; padrão 3; fora sábado, domingo e feriado
// nacional). Quem decide o corte do dia é o BANCO (`overdue_badge_cutoff`): o
// selo, o aviso da ficha, o número vermelho da aba Financeiro e o filtro da
// lista de prontuários perguntam a mesma coisa. Multa e juros não mudam.
//
// QUEM VÊ também é o banco (`client_overdue_badges`): só devolve os pacientes
// das unidades em que a pessoa tem `acao.cobranca.selo_atraso`, e nunca para
// Dentista, Planner, TSB, ASB e SDR. Aqui ninguém repete a lista de papéis.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";
import { podeComPapeis } from "@/lib/permissions";

/** O último vencimento que já conta como "em atraso" hoje (AAAA-MM-DD), ou null sem a 4006. */
export async function corteDoAtraso(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("overdue_badge_cutoff");
  if (error || !data) return null;
  return String(data).slice(0, 10);
}

/**
 * A parcela conta como "em atraso" pela regra do selo? Sem o corte (banco sem
 * a 4006), volta à regra antiga: vencida desde o dia seguinte.
 */
export function parcelaEmAtraso(
  p: { dueDate: string; emAberto: boolean },
  corte: string | null,
  hoje: string
): boolean {
  if (!p.emAberto) return false;
  return corte ? p.dueDate <= corte : p.dueDate < hoje;
}

/** Dias desde o vencimento, por paciente, só dos que a pessoa pode ver. */
export async function selosDeAtraso(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(clientIds.filter(Boolean))];
  const mapa = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data, error } = await supabase.rpc("client_overdue_badges", {
      p_client_ids: ids.slice(i, i + 1000),
    });
    if (error || !data) return mapa;
    for (const r of data as { client_id: string; days_late: number }[]) {
      mapa.set(r.client_id, r.days_late);
    }
  }
  return mapa;
}

export function textoDoSelo(dias: number): string {
  return dias === 1 ? "Em atraso há 1 dia" : `Em atraso há ${dias} dias`;
}

/** O TETO do Painel de cobranças (o banco tem o mesmo): fora daqui, nunca. */
const TETO_DO_PAINEL: UserRole[] = ["unit_manager", "franchisee", "finance_franchisor"];

/** O menu e a página do Painel de cobranças (a matriz, dentro do teto). */
export function podeVerPainelDeCobrancas(session: SessionContext): boolean {
  if (session.isAdminMaster) return true;
  const papeis = Object.values(session.rolesByClinic)
    .flat()
    .filter((r) => TETO_DO_PAINEL.includes(r));
  return podeComPapeis(session.permissoes, "modulo.painel_cobrancas", papeis);
}
