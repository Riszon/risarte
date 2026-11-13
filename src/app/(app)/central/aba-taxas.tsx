import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionContext } from "@/lib/auth";
import { podeEditarRegua } from "@/lib/central/central";
import { TaxasDaRedeConteudo } from "../financeiro/taxas-da-rede/conteudo";
import { AvisoSemMigracao } from "./abas";
import { ConfiguracaoDoSplit, type CarteiraDeRepasse, type DestinoDaTaxa } from "./split-form";

/**
 * A ABA TAXAS DA FRANQUIA (ASA3, entrega 1; 4008), no nível Rede. Em cima, o
 * split: para onde vai cada taxa, a tolerância (S5), a multa e os juros da
 * cobrança à unidade. Embaixo, as taxas (a tela de Taxas da rede, que mudou
 * para cá — D19).
 */
export async function AbaTaxasDaRede({
  supabase,
  session,
  params,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
  params: Record<string, string | string[] | undefined>;
}) {
  const podeEditar = podeEditarRegua(session);
  const { data, error } = await supabase.rpc("gateway_split_read");
  const semMigracao = !!error && /does not exist|schema cache/i.test(error.message);
  if (error && !semMigracao) console.error("gateway split read failed:", error.message);

  const lido = (data ?? null) as {
    settings: { tolerance_cents: number; unit_charge_fine_percent: number | null; unit_charge_interest_percent: number | null };
    destinos: DestinoDaTaxa[];
    carteiras: CarteiraDeRepasse[];
  } | null;

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Split das taxas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Nas cobranças emitidas pelo riSZon, as taxas percentuais são retidas na origem pelo Asaas e caem direto na
            carteira da rede. O que é retido não entra na conta a pagar da unidade. Recebimento fora do split (dinheiro,
            maquininha, cobrança sem split) continua virando conta a pagar.
          </p>
        </CardHeader>
        <CardContent>
          {semMigracao ? (
            <AvisoSemMigracao />
          ) : lido ? (
            <ConfiguracaoDoSplit
              podeEditar={podeEditar}
              carteiras={lido.carteiras ?? []}
              inicial={{
                toleranciaCentavos: Number(lido.settings?.tolerance_cents ?? 10),
                multaPercent: lido.settings?.unit_charge_fine_percent == null ? null : Number(lido.settings.unit_charge_fine_percent),
                jurosPercent:
                  lido.settings?.unit_charge_interest_percent == null ? null : Number(lido.settings.unit_charge_interest_percent),
                destinos: lido.destinos ?? [],
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Não foi possível ler a configuração do split.</p>
          )}
        </CardContent>
      </Card>

      <TaxasDaRedeConteudo session={session} params={params} basePath="/central/rede/taxas" />
    </>
  );
}
