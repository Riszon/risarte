import "server-only";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ehFranqueadoraIndica } from "@/lib/indica/access";
import { monthRangeOf, todayInBrazil } from "@/lib/dates";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/;

export type Recorte = {
  franqueadora: boolean;
  /** Unidades que a pessoa pode escolher (franqueadora: todas). */
  unidades: { id: string; nome: string }[];
  /** null = rede inteira (só a franqueadora). */
  unidadeId: string | null;
  unidadeNome: string;
  de: string;
  ate: string;
  campanhaId: string | null;
  /** Sem unidade possível (não é da franqueadora nem de nenhuma unidade). */
  semAcesso: boolean;
};

/**
 * Lê período, unidade e campanha da URL. A franqueadora escolhe a unidade
 * (vazio = rede); os demais ficam na unidade ativa — o banco confere de novo.
 */
export async function lerRecorte(sp: Record<string, string | string[] | undefined>): Promise<Recorte> {
  const session = await getSessionContext();
  const franqueadora = ehFranqueadoraIndica(session);
  const supabase = await createClient();
  const { data: todas } = await supabase
    .from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name")
    .returns<{ id: string; name: string }[]>();
  const minhas = (todas ?? []).filter((u) => franqueadora || (session.rolesByClinic[u.id]?.length ?? 0) > 0);
  const unidades = minhas.map((u) => ({ id: u.id, nome: u.name }));

  const texto = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const pedida = texto("unidade");
  const ativa = session.activeClinic?.type === "franchise_unit" ? session.activeClinic.id : null;
  let unidadeId: string | null;
  if (franqueadora) unidadeId = pedida && unidades.some((u) => u.id === pedida) ? pedida : null;
  else unidadeId = (ativa && unidades.some((u) => u.id === ativa) ? ativa : unidades[0]?.id) ?? null;

  const hoje = todayInBrazil();
  const mes = monthRangeOf(hoje);
  let de = DATA.test(texto("de")) ? texto("de") : mes.from;
  let ate = DATA.test(texto("ate")) ? texto("ate") : hoje;
  if (ate < de) [de, ate] = [ate, de];
  const campanhaId = UUID.test(texto("campanha")) ? texto("campanha") : null;

  return {
    franqueadora,
    unidades,
    unidadeId,
    unidadeNome: unidadeId ? unidades.find((u) => u.id === unidadeId)?.nome ?? "Unidade" : "Rede inteira",
    de,
    ate,
    campanhaId,
    semAcesso: !franqueadora && unidadeId === null,
  };
}

/** Os parâmetros do recorte para montar links (CSV, abas). */
export function paramsDoRecorte(r: Recorte, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ de: r.de, ate: r.ate, ...extra });
  if (r.franqueadora && r.unidadeId) p.set("unidade", r.unidadeId);
  if (r.campanhaId) p.set("campanha", r.campanhaId);
  return p.toString();
}
