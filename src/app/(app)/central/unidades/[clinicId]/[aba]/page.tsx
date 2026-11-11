import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { getSessionContext } from "@/lib/auth";
import { abaValida, podeVerUnidadeNaCentral, rotaDaUnidade } from "@/lib/central/central";
import { carregarContas, carregarProntidao } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { AbasDaCentral, AvisoSemMigracao } from "../../../abas";
import { HistoricoDaAba } from "../../../conta-client";
import { ContaETarifas } from "../../../conta-e-tarifas";
import { FaixaDeProntidao } from "../../../prontidao";

export const metadata: Metadata = { title: "Central de Configuração — Unidade" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Central de UMA unidade: a faixa de prontidão, as abas e o histórico da aba. */
export default async function CentralDaUnidadePage({
  params,
}: PageProps<"/central/unidades/[clinicId]/[aba]">) {
  const { clinicId, aba } = await params;
  const session = await getSessionContext();
  if (!UUID.test(clinicId) || !abaValida("unidade", aba)) notFound();
  const clinica = session.clinics.find((c) => c.id === clinicId && c.type !== "franchisor");
  if (!clinica || !podeVerUnidadeNaCentral(session, clinicId)) notFound();

  const supabase = await createClient();
  const { contas, semMigracao } = await carregarContas(supabase);
  const conta = contas.find((c) => c.clinicId === clinicId) ?? null;
  const prontidao = semMigracao ? null : await carregarProntidao(supabase, clinicId);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Central de Configuração"
        icone={SlidersHorizontal}
        titulo={clinica.name}
        descricao="O que esta unidade usa de diferente do padrão da rede — e o que falta para ela poder cobrar pelo riSZon."
        voltar={{ href: "/central", rotulo: "Central de Configuração" }}
      />

      {semMigracao ? (
        <AvisoSemMigracao />
      ) : (
        <>
          {prontidao && <FaixaDeProntidao clinicId={clinicId} prontidao={prontidao} admin={session.isAdminMaster} />}
          <AbasDaCentral nivel="unidade" ativa={aba} hrefDaAba={(a) => rotaDaUnidade(clinicId, a)} />
          {aba === "conta" && (
            <ContaETarifas supabase={supabase} session={session} clinicId={clinicId} clinicName={clinica.name} conta={conta} />
          )}
          <HistoricoDaAba aba={aba} clinicId={clinicId} />
        </>
      )}
    </div>
  );
}
