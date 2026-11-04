import "server-only";
import { createClient } from "@/lib/supabase/server";
import { INDICA_SCHEMA } from "@/lib/indica/db";
import type { PresenteDaNegociacao, SituacaoDoPresente } from "@/lib/indica/presente";

/**
 * AP24: o presente de boas-vindas do cliente para a tela da negociação.
 *
 * Leitura TOLERANTE: sem a 0363/2011 no banco, ou sem o schema do Indica, a
 * tela segue como antes (nulo) — o presente só aparece quando o banco sabe dele.
 * A situação e a validade vêm do banco (`indica.presente_do_cliente`); o
 * percentual aplicado é lido à parte da negociação.
 */
export async function carregarPresente(
  clientId: string,
  negotiationId: string | null
): Promise<PresenteDaNegociacao | null> {
  const supabase = await createClient();
  const [{ data: linhas, error }, aplicado] = await Promise.all([
    supabase.schema(INDICA_SCHEMA).rpc("presente_do_cliente", { p_cliente_id: clientId }),
    negotiationId
      ? supabase
          .from("plan_negotiations")
          .select("indica_presente_percent")
          .eq("id", negotiationId)
          .maybeSingle<{ indica_presente_percent: number | string | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) return null;
  const p = ((linhas ?? []) as {
    codigo: string;
    percentual: number | string;
    valido_ate: string | null;
    situacao: SituacaoDoPresente;
  }[])[0];
  if (!p) return null;
  const pct = aplicado.error ? null : aplicado.data?.indica_presente_percent ?? null;
  return {
    codigo: p.codigo,
    percentual: Number(p.percentual),
    validoAte: p.valido_ate,
    situacao: p.situacao,
    aplicadoPercentual: pct === null ? null : Number(pct),
  };
}
