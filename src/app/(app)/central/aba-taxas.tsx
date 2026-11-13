import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionContext } from "@/lib/auth";
import { podeEditarRegua } from "@/lib/central/central";
import { COBRANCAS_POR_CONTA } from "@/lib/asaas/split-servidor";
import { TaxasDaRedeConteudo } from "../financeiro/taxas-da-rede/conteudo";
import { AvisoSemMigracao } from "./abas";
import { ConfiguracaoDoSplit, type CarteiraDeRepasse, type DestinoDaTaxa } from "./split-form";
import { BotaoAtualizarAgora, ConfirmarTaxasEmZero, QuemPedeEstorno, SaldoMinimo } from "./split-unidade";

/** ASA3, entrega 2 (4009): o retrato de uma unidade (fila, motivo, zero). */
export type RetratoDoSplit = {
  podeSplit: boolean;
  motivo: string | null;
  splitConfirmado: boolean;
  naFila: number;
  comErro: number;
  todasEmZero: number;
  comSplit: number;
  refundRoles: string[];
  ultimas: { at: string; reasons: string[]; outcome: string }[];
};

const MOTIVO_SEM_SPLIT: Record<string, string> = {
  sem_conta: "a unidade ainda não tem conta Asaas",
  franqueadora: "a franqueadora não faz split para si mesma",
  split_nao_habilitado: "o split não está habilitado no painel do Asaas da unidade (aba Conta e tarifas)",
};
const MOTIVO_DA_ATUALIZACAO: Record<string, string> = {
  taxa: "taxa",
  campanha: "campanha",
  destino: "destino",
  tarifa: "tarifa do Asaas",
  split_habilitado: "split habilitado",
  diaria: "virada do dia",
  manual: "atualizar agora",
  bloqueio: "bloqueio do Asaas",
};
const RESULTADO: Record<string, string> = {
  atualizado: "split atualizado",
  acrescentado: "split acrescentado",
  removido: "split retirado (taxas em zero)",
  fora_da_janela: "cartão fora da janela do Asaas",
  teto: "não coube no líquido (mantido)",
  reduzido_bloqueio: "reduzido ao líquido (bloqueio)",
};

/** A previsão de término da fila: 150 por unidade a cada 10 minutos. */
export function previsaoDaFila(naFila: number): string {
  if (naFila <= 0) return "em dia";
  const minutos = Math.ceil(naFila / COBRANCAS_POR_CONTA) * 10;
  return minutos < 60 ? `cerca de ${minutos} min` : `cerca de ${Math.round(minutos / 6) / 10} h`;
}

async function lerRetrato(supabase: SupabaseClient, clinicId: string): Promise<RetratoDoSplit | null> {
  const { data, error } = await supabase.rpc("gateway_split_unit_overview", { p_clinic_id: clinicId });
  if (error) return null;
  return data as RetratoDoSplit;
}

/**
 * A ABA TAXAS DA FRANQUIA (ASA3, entrega 1; 4008), no nível Rede. Em cima, o
 * split: para onde vai cada taxa, a tolerância (S5), a multa e os juros da
 * cobrança à unidade; o saldo mínimo da franqueadora e a fila por unidade
 * (4009). Embaixo, as taxas (a tela de Taxas da rede, que mudou para cá — D19).
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
    settings: {
      tolerance_cents: number;
      unit_charge_fine_percent: number | null;
      unit_charge_interest_percent: number | null;
      min_balance_cents?: number | null;
    };
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

      {!semMigracao && lido && (
        <Card>
          <CardContent className="pt-6">
            <SaldoMinimo
              podeEditar={podeEditar}
              inicialCentavos={lido.settings?.min_balance_cents == null ? null : Number(lido.settings.min_balance_cents)}
            />
          </CardContent>
        </Card>
      )}
      {!semMigracao && <FilaPorUnidade supabase={supabase} session={session} />}

      <TaxasDaRedeConteudo session={session} params={params} basePath="/central/rede/taxas" />
    </>
  );
}

/** O andamento da fila por unidade, no nível da Rede (ajuste do dono, 18.7.2). */
async function FilaPorUnidade({ supabase, session }: { supabase: SupabaseClient; session: SessionContext }) {
  const unidades = session.clinics
    .filter((c) => c.type === "franchise_unit" && c.is_active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const linhas = await Promise.all(unidades.map(async (u) => ({ u, r: await lerRetrato(supabase, u.id) })));
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">A fila do split por unidade</CardTitle>
        <p className="text-sm text-muted-foreground">
          Quantas cobranças em aberto esperam o split novo e a previsão de término (150 por unidade a cada 10 minutos).
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {linhas.map(({ u, r }) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <Link className="font-medium hover:underline" href={`/central/unidades/${u.id}/taxas`}>
                {u.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {!r
                  ? "—"
                  : !r.podeSplit
                    ? `sem split (${MOTIVO_SEM_SPLIT[r.motivo ?? ""] ?? r.motivo})`
                    : `${r.comSplit} com split · ${r.naFila} na fila · ${previsaoDaFila(r.naFila)}${r.todasEmZero ? ` · ${r.todasEmZero} com taxas em zero` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * A ABA TAXAS DA FRANQUIA no nível da UNIDADE (U9): pode ter split? a fila
 * (quantas faltam e a previsão), as cobranças com todas as taxas em zero, as
 * últimas atualizações, quem pede estorno e as taxas que valem para ela.
 * Gerente e Franqueado: só leitura (o banco decide de novo).
 */
export async function AbaTaxasDaUnidade({
  supabase,
  session,
  clinicId,
  clinicName,
  params,
}: {
  supabase: SupabaseClient;
  session: SessionContext;
  clinicId: string;
  clinicName: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const edita = podeEditarRegua(session);
  const r = await lerRetrato(supabase, clinicId);
  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Split em {clinicName}</CardTitle>
          {r ? (
            <p className="text-sm text-muted-foreground">
              {r.podeSplit
                ? `As cobranças desta unidade saem com split${r.splitConfirmado ? " (confirmado pelo Asaas)" : ""}.`
                : `As cobranças desta unidade saem SEM split: ${MOTIVO_SEM_SPLIT[r.motivo ?? ""] ?? r.motivo}. As taxas viram conta a pagar.`}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Não foi possível ler o split desta unidade.</p>
          )}
        </CardHeader>
        {r && (
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">{r.comSplit}</p>
                <p className="text-xs text-muted-foreground">cobranças em aberto com split</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">{r.naFila}</p>
                <p className="text-xs text-muted-foreground">esperando o split novo · {previsaoDaFila(r.naFila)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">{r.comErro}</p>
                <p className="text-xs text-muted-foreground">com erro no Asaas (tentam de novo sozinhas)</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Quando uma taxa, campanha, destino ou tarifa do Asaas muda, o riSZon atualiza o split das cobranças em aberto
              sozinho, a cada 10 minutos, as vencidas e as de vencimento mais próximo primeiro. Só o split muda: o boleto, o
              Pix e o link continuam os mesmos, e o paciente não recebe aviso.
            </p>
            {edita && <BotaoAtualizarAgora clinicId={clinicId} />}
            {edita && r.todasEmZero > 0 && <ConfirmarTaxasEmZero clinicId={clinicId} quantas={r.todasEmZero} />}
            {r.ultimas.length > 0 && (
              <div>
                <p className="pb-1 text-xs font-medium uppercase text-muted-foreground">Últimas atualizações</p>
                <ul className="space-y-0.5 text-xs">
                  {r.ultimas.map((u, i) => (
                    <li key={i}>
                      {new Date(u.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} —{" "}
                      {RESULTADO[u.outcome] ?? u.outcome} ({u.reasons.map((x) => MOTIVO_DA_ATUALIZACAO[x] ?? x).join(", ")})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Quem pode pedir estorno</CardTitle>
        </CardHeader>
        <CardContent>
          <QuemPedeEstorno
            clinicId={clinicId}
            gerenteTambem={(r?.refundRoles ?? []).includes("unit_manager")}
            podeEditar={session.isAdminMaster}
          />
        </CardContent>
      </Card>

      <TaxasDaRedeConteudo session={session} params={params} unidadeFixa={clinicId} basePath={`/central/unidades/${clinicId}/taxas`} />
    </>
  );
}
