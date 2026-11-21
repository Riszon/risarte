import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { ESTADO_DA_CONTA, abasVisiveis, podeVerAba, rotaDaRede } from "@/lib/central/central";
import { carregarContas, producaoLigada } from "@/lib/central/dados";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AbasDaCentral, AvisoSemMigracao } from "../../abas";
import { AbaComercialDaRede } from "../../aba-comercial";
import { AbaFinanceiroDaRede } from "../../aba-financeiro";
import { AbaCobrancaDaRede } from "../../aba-cobranca";
import { AbaTaxasDaRede } from "../../aba-taxas";
import { AbaEmpresarialDaRede } from "../../aba-empresarial";
import { BotaoDeAcao, HistoricoDaAba } from "../../conta-client";
import { ContaETarifas } from "../../conta-e-tarifas";
import { InterruptorNaCentral, PilotoDaContaNaCentral } from "../../pecas-do-piloto";
import { AvisosComErro } from "../../avisos-com-erro";

export const metadata: Metadata = { title: "Central de Configuração — Rede" };

/**
 * O NÍVEL REDE: o padrão que as unidades herdam. Na aba Conta e tarifas, a
 * conta raiz da franqueadora e as carteiras que só recebem repasse.
 */
export default async function CentralDaRedePage({ params, searchParams }: PageProps<"/central/rede/[aba]">) {
  const { aba } = await params;
  const session = await getSessionContext();
  if (!podeVerAba(session, aba, "rede")) notFound();

  const supabase = await createClient();
  const franqueadoras = session.clinics
    .filter((c) => c.type === "franchisor" && c.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className={cn("mx-auto space-y-5 px-4 py-8", aba === "taxas" ? "max-w-5xl" : "max-w-4xl")}>
      <CabecalhoDeModulo
        chapeu="Central de Configuração"
        icone={SlidersHorizontal}
        titulo="Rede"
        descricao="O padrão da rede. O que for definido aqui vale para toda unidade que não tiver um valor próprio."
        voltar={{ href: "/central", rotulo: "Central de Configuração" }}
      />

      <AbasDaCentral abas={abasVisiveis(session, "rede")} ativa={aba} hrefDaAba={(a) => rotaDaRede(a)} />

      {aba === "conta" && <AbaContaDaRede session={session} franqueadoras={franqueadoras} />}
      {aba === "financeiro" && <AbaFinanceiroDaRede supabase={supabase} session={session} franqueadoras={franqueadoras} />}
      {aba === "comercial" && <AbaComercialDaRede supabase={supabase} />}
      {aba === "cobranca" && <AbaCobrancaDaRede supabase={supabase} session={session} />}
      {aba === "taxas" && <AbaTaxasDaRede supabase={supabase} session={session} params={await searchParams} />}
      {aba === "empresarial" && <AbaEmpresarialDaRede supabase={supabase} />}

      {/* A aba Empresarial (4023) não tem histórico próprio: as mudanças ficam na auditoria. */}
      {aba !== "empresarial" && <HistoricoDaAba aba={aba} clinicId={null} />}
    </div>
  );
}

async function AbaContaDaRede({
  session,
  franqueadoras,
}: {
  session: Awaited<ReturnType<typeof getSessionContext>>;
  franqueadoras: { id: string; name: string }[];
}) {
  const supabase = await createClient();
  const { contas, semMigracao } = await carregarContas(supabase);
  if (semMigracao) return <AvisoSemMigracao />;
  const carteiras = contas.filter((c) => c.ownerType === "recipient");
  const producao = session.isAdminMaster ? await producaoLigada(supabase) : false;
  const ambienteAtual = producao ? "production" : "sandbox";
  const rislife = carteiras.find((c) => c.environment === ambienteAtual && c.label.toLowerCase().startsWith("rislife")) ?? null;
  return (
    <>
      {franqueadoras.map((f) => {
        const conta = contas.find((c) => c.clinicId === f.id) ?? null;
        return (
          <div key={f.id} className="space-y-4">
            <ContaETarifas
              supabase={supabase}
              session={session}
              clinicId={f.id}
              clinicName={f.name}
              conta={conta}
            />
            {conta && <PilotoDaContaNaCentral supabase={supabase} accountId={conta.id} admin={session.isAdminMaster} />}
            {session.isAdminMaster && conta && <AvisosComErro supabase={supabase} accountId={conta.id} />}
          </div>
        );
      })}
      <InterruptorNaCentral />
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Carteiras de repasse</CardTitle>
          <p className="text-sm text-muted-foreground">
            Contas sem unidade: recebem repasse por split e, no caso da RisLife, faturam a implantação do Empresarial
            (ASA5). Com a produção ligada, o cadastro da RisLife nasce como conta real.
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
          {session.isAdminMaster && !rislife && (
            <div className="mt-3">
              <BotaoDeAcao
                acao="abrir_rislife"
                alvo=""
                rotulo={producao ? "Abrir o cadastro da conta real da RisLife" : "Abrir o cadastro da conta de teste da RisLife"}
                sucesso="Cadastro da RisLife aberto."
                variante="default"
              />
            </div>
          )}
        </CardContent>
      </Card>
      {carteiras.map((c) => (
        <div key={c.id} className="space-y-4">
          <ContaETarifas supabase={supabase} session={session} clinicId="" clinicName={c.label} conta={c} />
          <PilotoDaContaNaCentral supabase={supabase} accountId={c.id} admin={session.isAdminMaster} />
          {session.isAdminMaster && <AvisosComErro supabase={supabase} accountId={c.id} />}
        </div>
      ))}
    </>
  );
}
