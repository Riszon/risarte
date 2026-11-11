import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { ESTADO_DA_CONTA, abaValida, podeVerRedeNaCentral, rotaDaRede } from "@/lib/central/central";
import { carregarContas } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AbasDaCentral, AvisoSemMigracao } from "../../abas";
import { HistoricoDaAba } from "../../conta-client";
import { ContaETarifas } from "../../conta-e-tarifas";

export const metadata: Metadata = { title: "Central de Configuração — Rede" };

/**
 * O NÍVEL REDE: o padrão que as unidades herdam e, na aba Conta e tarifas, a
 * conta raiz da franqueadora e as carteiras que só recebem repasse.
 */
export default async function CentralDaRedePage({ params }: PageProps<"/central/rede/[aba]">) {
  const { aba } = await params;
  const session = await getSessionContext();
  if (!abaValida("rede", aba) || !podeVerRedeNaCentral(session)) notFound();

  const supabase = await createClient();
  const { contas, semMigracao } = await carregarContas(supabase);
  const franqueadoras = session.clinics
    .filter((c) => c.type === "franchisor" && c.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const carteiras = contas.filter((c) => c.ownerType === "recipient");

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Central de Configuração"
        icone={SlidersHorizontal}
        titulo="Rede"
        descricao="O padrão da rede. O que for definido aqui vale para toda unidade que não tiver um valor próprio."
        voltar={{ href: "/central", rotulo: "Central de Configuração" }}
      />

      {semMigracao ? (
        <AvisoSemMigracao />
      ) : (
        <>
          <AbasDaCentral nivel="rede" ativa={aba} hrefDaAba={(a) => rotaDaRede(a)} />
          {aba === "conta" && (
            <>
              {franqueadoras.map((f) => (
                <ContaETarifas
                  key={f.id}
                  supabase={supabase}
                  session={session}
                  clinicId={f.id}
                  clinicName={f.name}
                  conta={contas.find((c) => c.clinicId === f.id) ?? null}
                />
              ))}
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="text-base">Carteiras de repasse</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Contas que só recebem repasse por split (a RisLife, por exemplo). O cadastro pela tela chega com o
                    split; por enquanto aparecem aqui as carteiras de teste criadas no sandbox.
                  </p>
                </CardHeader>
                <CardContent>
                  {carteiras.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma carteira de repasse cadastrada.</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {carteiras.map((c) => {
                        const estado = ESTADO_DA_CONTA[c.status] ?? ESTADO_DA_CONTA.awaiting_key;
                        return (
                          <li key={c.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c.label}</span>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", estado.tom)}>{estado.rotulo}</span>
                            <span className="break-all font-mono text-xs text-muted-foreground">{c.walletId ?? "sem carteira"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
          <HistoricoDaAba aba={aba} clinicId={null} />
        </>
      )}
    </div>
  );
}
