import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import { abasVisiveis, podeVerAba, rotaDaUnidade } from "@/lib/central/central";
import { carregarContas, carregarProntidao } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { AbasDaCentral, AvisoSemMigracao } from "../../../abas";
import { AbaComercialDaUnidade } from "../../../aba-comercial";
import { AbaFinanceiroDaUnidade } from "../../../aba-financeiro";
import { AbaCobrancaDaUnidade } from "../../../aba-cobranca";
import { HistoricoDaAba } from "../../../conta-client";
import { ContaETarifas } from "../../../conta-e-tarifas";
import { AvisosComErro } from "../../../avisos-com-erro";
import { FaixaDeProntidao } from "../../../prontidao";

export const metadata: Metadata = { title: "Central de Configuração — Unidade" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Central de UMA unidade: a faixa de prontidão (para quem vê a conta Asaas),
 * as abas que a pessoa vê e o histórico da aba aberta.
 */
export default async function CentralDaUnidadePage({
  params,
}: PageProps<"/central/unidades/[clinicId]/[aba]">) {
  const { clinicId, aba } = await params;
  const session = await getSessionContext();
  if (!UUID.test(clinicId) || !podeVerAba(session, aba, "unidade", clinicId)) notFound();
  const clinica = session.clinics.find((c) => c.id === clinicId && c.type !== "franchisor");
  if (!clinica) notFound();

  const supabase = await createClient();
  const veConta = podeVerAba(session, "conta", "unidade", clinicId);
  const { contas, semMigracao } = veConta
    ? await carregarContas(supabase)
    : { contas: [], semMigracao: false };
  const conta = contas.find((c) => c.clinicId === clinicId) ?? null;
  const prontidao = veConta && !semMigracao ? await carregarProntidao(supabase, clinicId) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Central de Configuração"
        icone={SlidersHorizontal}
        titulo={clinica.name}
        descricao="O que esta unidade usa de diferente do padrão da rede — e o que falta para ela poder cobrar pelo riSZon."
        voltar={{ href: "/central", rotulo: "Central de Configuração" }}
      />

      {prontidao && <FaixaDeProntidao clinicId={clinicId} prontidao={prontidao} admin={session.isAdminMaster} />}
      <AbasDaCentral
        abas={abasVisiveis(session, "unidade", clinicId)}
        ativa={aba}
        hrefDaAba={(a) => rotaDaUnidade(clinicId, a)}
      />

      {aba === "conta" &&
        (semMigracao ? (
          <AvisoSemMigracao />
        ) : (
          <>
            <ContaETarifas supabase={supabase} session={session} clinicId={clinicId} clinicName={clinica.name} conta={conta} />
            {session.isAdminMaster && conta && <AvisosComErro supabase={supabase} accountId={conta.id} />}
          </>
        ))}
      {aba === "financeiro" && (
        <AbaFinanceiroDaUnidade supabase={supabase} session={session} clinicId={clinicId} clinicName={clinica.name} />
      )}
      {aba === "comercial" && <AbaComercialDaUnidade supabase={supabase} clinicId={clinicId} clinicName={clinica.name} />}
      {aba === "cobranca" && <AbaCobrancaDaUnidade supabase={supabase} clinicId={clinicId} clinicName={clinica.name} />}

      <HistoricoDaAba aba={aba} clinicId={clinicId} />
    </div>
  );
}
