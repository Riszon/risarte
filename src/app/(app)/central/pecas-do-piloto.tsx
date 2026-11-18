import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopiarDeOutraUnidade, InterruptorDeProducao, PilotoDaConta } from "@/components/central/pecas-do-piloto";
import { lerLevantamentos, lerProducao } from "./pecas-do-piloto-actions";

/**
 * ASA7 (4022) — as peças do piloto na Central. Lê as colunas novas numa
 * consulta à parte: banco sem a 4022 não quebra a aba (só não mostra nada).
 */
export async function PilotoDaContaNaCentral({
  supabase,
  accountId,
  admin,
}: {
  supabase: SupabaseClient;
  accountId: string;
  admin: boolean;
}) {
  const { data, error } = await supabase
    .from("gateway_accounts")
    .select("owner_type, environment, status, debit_disabled_declared_at, key_min_perm_declared_at, key_perm_probe_at, key_perm_probe_ok, key_perm_probe_detail")
    .eq("id", accountId)
    .maybeSingle<{
      owner_type: string; environment: string; status: string; debit_disabled_declared_at: string | null; key_min_perm_declared_at: string | null;
      key_perm_probe_at: string | null; key_perm_probe_ok: boolean | null; key_perm_probe_detail: Record<string, string> | null;
    }>();
  if (error || !data) return null;
  const levantamentos = admin ? await lerLevantamentos(accountId) : [];
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Antes de ligar: débito, chave e levantamento</CardTitle>
        <p className="text-sm text-muted-foreground">Itens da prontidão para cobrar (ASA7). Sem eles, a conta não fica “Pronta para cobrar”.</p>
      </CardHeader>
      <CardContent>
        <PilotoDaConta
          accountId={accountId}
          producao={data.environment === "production"}
          ehFranqueadora={data.owner_type === "franchisor"}
          admin={admin}
          ativa={data.status === "active"}
          debitoEm={data.debit_disabled_declared_at}
          permissoesEm={data.key_min_perm_declared_at}
          sondaEm={data.key_perm_probe_at}
          sondaOk={data.key_perm_probe_ok}
          sondaDetalhe={data.key_perm_probe_detail}
          levantamentos={levantamentos}
        />
      </CardContent>
    </Card>
  );
}

export async function InterruptorNaCentral() {
  const producao = await lerProducao();
  if (!producao) return null;
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Produção do Asaas (interruptor da rede)</CardTitle>
        <p className="text-sm text-muted-foreground">Só o Admin Master liga, com motivo, e só com a prontidão da rede completa.</p>
      </CardHeader>
      <CardContent>
        <InterruptorDeProducao producao={producao} />
      </CardContent>
    </Card>
  );
}

export async function CopiarNaCentral({ supabase, clinicId }: { supabase: SupabaseClient; clinicId: string }) {
  const { data } = await supabase.from("clinics").select("id, name").eq("type", "franchise_unit").eq("is_active", true).order("name")
    .returns<{ id: string; name: string }[]>();
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Copiar de outra unidade</CardTitle>
        <p className="text-sm text-muted-foreground">Para configurar uma unidade nova a partir de outra. A tela mostra o que muda antes de gravar.</p>
      </CardHeader>
      <CardContent>
        <CopiarDeOutraUnidade destinoId={clinicId} unidades={data ?? []} />
      </CardContent>
    </Card>
  );
}
