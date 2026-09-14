import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { empresarialDb } from "@/lib/empresarial/db";
import {
  canViewEmpresarial,
  isProgramManager,
  isRislifeConsultant,
} from "@/lib/empresarial/access";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatBrDate } from "@/lib/dates";
import {
  CAPTURE_CHANNEL_LABELS,
  LEAD_STAGE_LABELS,
  type CaptureChannel,
  type LeadStage,
} from "@/lib/empresarial/constants";
import type { StagePeriod } from "@/lib/empresarial/funnel";
import { LimitesDoFunil } from "./limites";
import {
  conversaoDoFunil,
  paradasAlemDoLimite,
  porCanal,
  porConsultor,
  tempoMedioPorFase,
  type LeadDoPainel,
} from "@/lib/empresarial/painel-funil";

export const metadata: Metadata = { title: "Painel do funil · Risarte Empresarial" };

type LeadRow = {
  id: string;
  company_name: string;
  stage: LeadStage;
  consultant_id: string | null;
  capture_channel: CaptureChannel | null;
  estimated_value_cents: number | null;
};

type HistRow = {
  lead_id: string;
  stage: LeadStage;
  entered_at: string;
  left_at: string | null;
  is_initial: boolean;
};

type AlertRow = {
  lead_id: string;
  rule: string;
  detail: string | null;
  days: number | null;
  first_seen_at: string;
};

export default async function PainelDoFunilPage() {
  const session = await getSessionContext();
  if (!canViewEmpresarial(session)) redirect("/");
  if (!isProgramManager(session) && !isRislifeConsultant(session)) {
    redirect("/empresarial");
  }

  const db = await empresarialDb();
  const [
    { data: leadRows },
    { data: histRows },
    { data: limitRows },
    { data: settings },
    { data: alertRows },
  ] =
    await Promise.all([
      db
        .from("commercial_leads")
        .select(
          "id, company_name, stage, consultant_id, capture_channel, estimated_value_cents"
        )
        .returns<LeadRow[]>(),
      db
        .from("commercial_lead_stage_history")
        .select("lead_id, stage, entered_at, left_at, is_initial")
        .order("entered_at", { ascending: true })
        .returns<HistRow[]>(),
      db
        .from("funnel_stage_limits")
        .select("stage, max_days")
        .returns<{ stage: string; max_days: number }[]>(),
      db
        .from("funnel_settings")
        .select("inactivity_days")
        .maybeSingle<{ inactivity_days: number }>(),
      db
        .from("funnel_alerts")
        .select("lead_id, rule, detail, days, first_seen_at")
        .is("cleared_at", null)
        .order("days", { ascending: false })
        .returns<AlertRow[]>(),
    ]);

  const leads = leadRows ?? [];

  const nomePorId = new Map<string, string>();
  const consultantIds = [
    ...new Set(leads.map((l) => l.consultant_id).filter((x): x is string => !!x)),
  ];
  if (consultantIds.length) {
    const supabase = await createClient();
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", consultantIds);
    for (const p of profs ?? [])
      nomePorId.set(p.id, p.full_name || p.email || "—");
  }

  const historyByLead = new Map<string, StagePeriod[]>();
  for (const h of histRows ?? []) {
    historyByLead.set(h.lead_id, [
      ...(historyByLead.get(h.lead_id) ?? []),
      {
        stage: h.stage,
        enteredAt: h.entered_at,
        leftAt: h.left_at,
        isInitial: h.is_initial,
      },
    ]);
  }

  const doPainel: LeadDoPainel[] = leads.map((l) => ({
    id: l.id,
    companyName: l.company_name,
    stage: l.stage,
    consultantId: l.consultant_id,
    consultantName: l.consultant_id
      ? nomePorId.get(l.consultant_id) ?? null
      : null,
    captureChannel: l.capture_channel,
    estimatedValueCents: l.estimated_value_cents,
    history: historyByLead.get(l.id) ?? [],
  }));

  const limites = new Map((limitRows ?? []).map((l) => [l.stage, l.max_days]));
  const conversao = conversaoDoFunil(doPainel);
  const tempos = tempoMedioPorFase(doPainel);
  const paradas = paradasAlemDoLimite(doPainel, limites, new Date());
  const consultores = porConsultor(doPainel);
  const canais = porCanal(doPainel, CAPTURE_CHANNEL_LABELS);
  const nomeDoLead = new Map(doPainel.map((l) => [l.id, l.companyName]));

  const emAberto = doPainel.filter(
    (l) => l.stage !== "CLOSED_WON" && l.stage !== "CLOSED_LOST" && l.stage !== "IMPLEMENTATION"
  );
  const valorEmAberto = emAberto.reduce(
    (a, l) => a + (l.estimatedValueCents ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Programa corporativo"
        icone={BarChart3}
        titulo="Painel do funil"
        descricao="Conversão, tempo em cada fase, quem está parado e o desempenho por consultor e por canal."
        voltar={{ href: "/empresarial/funil", rotulo: "Funil" }}
      />

      {leads.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma empresa no funil ainda. O painel começa a responder assim que
            houver movimento.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero rotulo="Em negociação" valor={String(emAberto.length)} destaque />
            <Numero rotulo="Valor em aberto" valor={formatBRL(valorEmAberto)} destaque />
            <Numero
              rotulo="Ganhas"
              valor={String(
                doPainel.filter(
                  (l) => l.stage === "CLOSED_WON" || l.stage === "IMPLEMENTATION"
                ).length
              )}
            />
            <Numero
              rotulo="Perdidas"
              valor={String(doPainel.filter((l) => l.stage === "CLOSED_LOST").length)}
            />
          </div>

          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="text-sm font-medium">Conversão fase a fase</p>
                <p className="text-xs text-muted-foreground">
                  Quantas empresas <strong>já passaram</strong> por cada fase — não
                  quantas estão nela agora.
                  {conversao.foraDaMedicao > 0 && (
                    <>
                      {" "}
                      <strong>{conversao.foraDaMedicao}</strong>{" "}
                      {conversao.foraDaMedicao === 1
                        ? "empresa fica de fora"
                        : "empresas ficam de fora"}{" "}
                      da conta: já estavam no funil antes de o relógio ser
                      ligado, e o caminho delas nunca foi registrado.
                    </>
                  )}
                </p>
              </div>

              {conversao.medidas === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ainda não há nenhuma empresa com caminho registrado — a
                  conversão aparece assim que a primeira andar pelo funil.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {conversao.degraus.map((d) => (
                    <li key={d.key} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-sm">
                        <span className="text-muted-foreground">{d.numero}.</span>{" "}
                        {d.titulo}
                      </span>
                      <span className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
                        <span
                          className="block h-full bg-primary/70"
                          style={{
                            width: `${
                              conversao.degraus[0].alcancaram === 0
                                ? 0
                                : Math.round(
                                    (d.alcancaram /
                                      conversao.degraus[0].alcancaram) *
                                      100
                                  )
                            }%`,
                          }}
                        />
                      </span>
                      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {d.alcancaram}
                        {d.conversao != null ? ` · ${d.conversao}%` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          <Card>
            <CardContent className="space-y-2 p-4">
              <div>
                <p className="text-sm font-medium">Tempo médio em cada fase</p>
                <p className="text-xs text-muted-foreground">
                  Conta só as passagens que <strong>terminaram</strong>. Incluir a
                  que ainda está aberta faria a fase parecer mais rápida
                  justamente onde há empresa empacada.
                </p>
              </div>
              <ul className="space-y-1 text-sm">
                {tempos.map((t) => (
                  <li
                    key={t.stage}
                    className="flex items-center justify-between gap-2 border-b py-1 last:border-0"
                  >
                    <span>{LEAD_STAGE_LABELS[t.stage]}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.mediaDias == null
                        ? "sem passagem concluída"
                        : `${t.mediaDias} ${t.mediaDias === 1 ? "dia" : "dias"} · ${t.passagensCompletas} ${
                            t.passagensCompletas === 1 ? "passagem" : "passagens"
                          }`}
                      {t.emAberto > 0 ? ` · ${t.emAberto} em aberto` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          <Card className={paradas.length > 0 ? "border-destructive/40" : undefined}>
            <CardContent className="space-y-2 p-4">
              <div>
                <p className="text-sm font-medium">
                  Paradas além do limite ({paradas.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  O limite é por fase, e o gestor do programa ajusta em
                  Configurações. Fase sem limite cadastrado não vira alerta.
                </p>
              </div>
              {paradas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma empresa passou do limite da fase em que está.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {paradas.slice(0, 20).map((p) => (
                    <li
                      key={p.lead.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0"
                    >
                      <Link
                        href={`/empresarial/funil/${p.lead.id}`}
                        className="hover:underline"
                      >
                        {p.lead.companyName}
                      </Link>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {LEAD_STAGE_LABELS[p.lead.stage]}
                        <Badge variant="destructive" className="text-xs">
                          {p.dias} dias (limite {p.limite})
                        </Badge>
                        {p.parcial && (
                          <span className="text-xs">sem histórico anterior</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------------------------- */}
          {(alertRows ?? []).length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div>
                  <p className="text-sm font-medium">
                    Avisos em aberto ({alertRows!.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Apurados uma vez por dia, às 9h. Cada aviso sai{" "}
                    <strong>uma vez</strong> — só volta se a condição sumir e
                    reaparecer.
                  </p>
                </div>
                <ul className="space-y-1 text-sm">
                  {alertRows!.slice(0, 20).map((a) => (
                    <li
                      key={`${a.lead_id}-${a.rule}`}
                      className="flex flex-wrap items-center justify-between gap-2 border-b py-1 last:border-0"
                    >
                      <Link
                        href={`/empresarial/funil/${a.lead_id}`}
                        className="hover:underline"
                      >
                        {nomeDoLead.get(a.lead_id) ?? "—"}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {a.detail} · desde {formatBrDate(a.first_seen_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* ---------------------------------------------------------------- */}
          <div className="grid gap-4 md:grid-cols-2">
            <Recorte titulo="Por consultor" linhas={consultores} />
            <Recorte titulo="Por canal de captação" linhas={canais} />
          </div>

          <LimitesDoFunil
            limites={(limitRows ?? []).map((l) => ({
              stage: l.stage as LeadStage,
              maxDays: l.max_days,
            }))}
            inatividadeDias={settings?.inactivity_days ?? 7}
            podeEditar={isProgramManager(session)}
          />
        </>
      )}
    </div>
  );
}

function Recorte({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: ReturnType<typeof porConsultor>;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium">{titulo}</p>
        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {linhas.map((r) => (
              <li key={r.chave} className="border-b py-1 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span>{r.rotulo}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {/* Sem nenhum fechamento não existe taxa: "0%" diria que
                        perdeu tudo, quando ainda não fechou nada. */}
                    {r.taxaDeGanho == null
                      ? "sem fechamento ainda"
                      : `${r.taxaDeGanho}% de ganho`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.emAberto} em aberto · {r.ganhos} ganha
                  {r.ganhos === 1 ? "" : "s"} · {r.perdas} perdida
                  {r.perdas === 1 ? "" : "s"}
                  {r.valorEmAbertoCents > 0
                    ? ` · ${formatBRL(r.valorEmAbertoCents)} em aberto`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Numero({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-primary/35" : undefined}>
      <CardContent className="p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </p>
        <p className="text-lg font-semibold">{valor}</p>
      </CardContent>
    </Card>
  );
}
