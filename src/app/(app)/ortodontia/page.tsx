import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CalendarX2,
  CheckCircle2,
  ChevronRight,
  Clock,
  ListChecks,
  Settings,
  SmilePlus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  canManageOrtho,
  canViewOrtho,
  canViewOrthoDashboard,
  canViewOrthoMoney,
} from "@/lib/ortodontia/access";
import { resolveOrthoScope } from "@/lib/ortodontia/escopo";
import {
  groupByCase,
  loadCases,
  loadChargesFor,
  loadIndicaReferredSet,
  loadMaintenancesFor,
  loadOpenRequestsFor,
  loadSalesWithoutCase,
  type OrthoCaseRow,
} from "@/lib/ortodontia/db";
import {
  ORIGIN_LABELS,
  TIMELINESS_LABELS,
  addMonths,
  attentionReasons,
  caseTimeliness,
  chargeStatusToday,
  daysBetween,
  finishForecast,
  monthlyEvolution,
  originOf,
  type MaintenanceLike,
  type OrthoOrigin,
} from "@/lib/ortodontia/regras";
import { ORTHO_STATUS_LABELS, type OrthoStatus } from "@/lib/ortodontia/constants";
import { OrthoDrill, type OrthoDrillItem } from "@/components/ortodontia/ortho-drill";
import { ORTHO_STATUS_TONE } from "@/components/ortodontia/ortho-client-card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr, formatIsoMonthBr, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ortodontia" };

const PERIODS = ["mes", "trimestre", "semestre", "ano", "tudo"] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
  mes: "Este mês",
  trimestre: "Últimos 3 meses",
  semestre: "Últimos 6 meses",
  ano: "Últimos 12 meses",
  tudo: "Tudo",
};

function periodStart(p: Period, today: string): string | null {
  if (p === "mes") return `${today.slice(0, 7)}-01`;
  if (p === "trimestre") return addMonths(today, -3);
  if (p === "semestre") return addMonths(today, -6);
  if (p === "ano") return addMonths(today, -12);
  return null;
}

/** Um cartão de número do painel (fora do desenho, para não renascer a cada passada). */
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card className={cn("h-full", tone)}>
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <Icon className="size-5 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

const toneOf = (s: OrthoStatus): OrthoDrillItem["badgeTone"] =>
  s === "em_tratamento" ? "emerald" : s === "aguardando_inicio" ? "amber" : s === "contencao" ? "sky" : s === "interrompido" ? "rose" : "muted";

/**
 * O PAINEL DA ORTODONTIA — "como vai a ortodontia desta unidade (ou da rede)?"
 *
 * Todo número abre a lista por trás. Estoque (em tratamento, no prazo,
 * previsão) é sempre "hoje"; movimento (novos, finalizados, faltas, receita)
 * segue o período escolhido. A Recepção não vê esta tela: ela cai em Atenção.
 */
export default async function OrtodontiaPage(props: PageProps<"/ortodontia">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  if (!canViewOrthoDashboard(session)) redirect("/ortodontia/atencao");

  const sp = await props.searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const scope = resolveOrthoScope(session, pick("unidade"));
  const periodParam = pick("periodo");
  const period: Period = PERIODS.includes(periodParam as Period) ? (periodParam as Period) : "trimestre";
  const today = todayInBrazil();
  const start = periodStart(period, today);
  const inPeriod = (iso: string | null | undefined) =>
    Boolean(iso) && (start === null || iso!.slice(0, 10) >= start);

  const canMoney = canViewOrthoMoney(session, scope.clinicId);
  const canManage = canManageOrtho(session, scope.clinicId);

  await logAudit({
    action: "view",
    entityType: "ortho_dashboard",
    entityId: scope.clinicId ?? "all",
    clinicId: scope.clinicId ?? undefined,
  });

  const supabase = await createClient();
  const casesRead = await loadCases(supabase, { clinicIds: scope.clinicIds });
  if (!casesRead.ok) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <CabecalhoDeModulo chapeu="Ortodontia" icone={SmilePlus} titulo="Painel da Ortodontia" descricao={scope.label} />
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Não foi possível ler os casos agora ({casesRead.error.message}). Se o banco ainda não recebeu a
          migração 0329, este módulo aparece vazio até ela rodar.
        </p>
      </div>
    );
  }
  const cases = casesRead.linhas;
  const caseIds = cases.map((c) => c.id);
  const clientIds = [...new Set(cases.map((c) => c.client_id))];

  const [maintRead, chargesRead, openRequests, indicaSet, salesPending] = await Promise.all([
    loadMaintenancesFor(supabase, caseIds),
    canMoney ? loadChargesFor(supabase, caseIds) : Promise.resolve({ ok: true as const, linhas: [], paginas: 0 }),
    loadOpenRequestsFor(supabase, clientIds),
    loadIndicaReferredSet(supabase, clientIds),
    canManage ? loadSalesWithoutCase(supabase, scope.clinicIds) : Promise.resolve([]),
  ]);
  const maintByCase = groupByCase(maintRead.ok ? maintRead.linhas : []);
  const chargesByCase = groupByCase(chargesRead.ok ? chargesRead.linhas : []);
  const leituraIncompleta = !maintRead.ok || !chargesRead.ok;

  const likeOf = (caseId: string): MaintenanceLike[] =>
    (maintByCase.get(caseId) ?? []).map((m) => ({
      status: m.status,
      planned_date: m.planned_date,
      done_at: m.done_at,
      appointment_date: m.appointment?.starts_at ? m.appointment.starts_at.slice(0, 10) : null,
    }));

  const item = (c: OrthoCaseRow, extra?: Partial<OrthoDrillItem>): OrthoDrillItem => ({
    key: c.id,
    href: `/ortodontia/casos/${c.id}`,
    title: c.client?.full_name ?? "—",
    subtitle: `${c.code}${scope.clinicIds === null && c.clinic ? ` · ${c.clinic.name}` : ""}${c.orthodontist ? ` · ${c.orthodontist.full_name}` : ""}`,
    badge: ORTHO_STATUS_LABELS[c.status],
    badgeTone: toneOf(c.status),
    ...extra,
  });

  // -- Estoque (hoje) --------------------------------------------------------
  const emTratamento = cases.filter((c) => c.status === "em_tratamento");
  const aguardando = cases.filter((c) => c.status === "aguardando_inicio");
  const contencao = cases.filter((c) => c.status === "contencao");
  const abertos = [...aguardando, ...emTratamento, ...contencao];
  const noPrazo = emTratamento.filter((c) => caseTimeliness(c, today) === "no_prazo");
  const atrasados = emTratamento.filter((c) => caseTimeliness(c, today) === "atrasado");
  const forecast = finishForecast(cases, today);
  const terminam = (lo: string, hi: string) =>
    emTratamento.filter((c) => c.planned_end_date && c.planned_end_date > lo && c.planned_end_date <= hi);

  // -- Movimento (período) ---------------------------------------------------
  const novos = cases.filter((c) => inPeriod(c.start_date ?? c.created_at));
  const finalizados = cases.filter((c) => c.status === "finalizado" && inPeriod(c.finished_at));
  const finalizadosNoPrazo = finalizados.filter((c) => caseTimeliness(c, today) === "finalizado_no_prazo");
  const interrompidos = cases.filter((c) => c.status === "interrompido" && inPeriod(c.interrupted_at));
  const faltas = cases
    .map((c) => ({
      c,
      n: (maintByCase.get(c.id) ?? []).filter(
        (m) => m.status === "faltou" && inPeriod(m.appointment?.starts_at ?? m.planned_date)
      ).length,
    }))
    .filter((x) => x.n > 0);
  const realizadas = cases.reduce(
    (s, c) => s + (maintByCase.get(c.id) ?? []).filter((m) => m.status === "realizada" && inPeriod(m.done_at)).length,
    0
  );

  // -- Atenção -----------------------------------------------------------------
  const atencao = abertos
    .map((c) => ({
      c,
      reasons: attentionReasons({
        caso: c,
        maintenances: likeOf(c.id),
        charges: chargesByCase.get(c.id) ?? [],
        openClinicalRequests: openRequests.get(c.client_id) ?? 0,
        today,
        includeMoney: canMoney,
      }),
    }))
    .filter((x) => x.reasons.length > 0);
  const semAgendamento = atencao.filter((x) =>
    x.reasons.some((r) => r === "sem_agendamento" || r === "manutencao_vencida" || r === "aguardando_inicio")
  );

  // -- Dinheiro ----------------------------------------------------------------
  const allCharges = chargesRead.ok ? chargesRead.linhas : [];
  const receita = allCharges.filter((ch) => ch.status === "paga" && inPeriod(ch.paid_at));
  const receitaCents = receita.reduce((s, ch) => s + ch.amount_cents, 0);
  const atrasadas = allCharges.filter((ch) => chargeStatusToday(ch, today) === "atrasada");
  const atrasadasCents = atrasadas.reduce((s, ch) => s + ch.amount_cents, 0);
  const mensalidadeMedia =
    emTratamento.length > 0 ? Math.round(emTratamento.reduce((s, c) => s + c.monthly_fee_cents, 0) / emTratamento.length) : 0;
  const receitaPrevistaMes = emTratamento.reduce((s, c) => s + c.monthly_fee_cents, 0);
  const caseById = new Map(cases.map((c) => [c.id, c]));

  // -- Origem ------------------------------------------------------------------
  const origens = new Map<OrthoOrigin, OrthoCaseRow[]>();
  for (const c of abertos) {
    const o = originOf({ ...(c.client ?? {}), has_indica_referral: indicaSet.has(c.client_id) });
    origens.set(o, [...(origens.get(o) ?? []), c]);
  }

  // -- Evolução e por unidade ---------------------------------------------------
  const evolucao = monthlyEvolution(cases, today, 12);
  const maxEvo = Math.max(1, ...evolucao.map((p) => p.active));
  const porUnidade =
    scope.clinicIds === null
      ? [...new Map(cases.map((c) => [c.clinic_id, c.clinic?.name ?? "—"])).entries()]
          .map(([id, name]) => {
            const mine = cases.filter((c) => c.clinic_id === id);
            const tr = mine.filter((c) => c.status === "em_tratamento");
            return {
              id,
              name,
              emTratamento: tr.length,
              atrasados: tr.filter((c) => caseTimeliness(c, today) === "atrasado").length,
              novos: mine.filter((c) => inPeriod(c.start_date ?? c.created_at)).length,
              finalizados: mine.filter((c) => c.status === "finalizado" && inPeriod(c.finished_at)).length,
              atencao: atencao.filter((x) => x.c.clinic_id === id).length,
              receita: receita.filter((ch) => ch.clinic_id === id).reduce((s, ch) => s + ch.amount_cents, 0),
            };
          })
          .sort((a, b) => b.emTratamento - a.emTratamento)
      : [];

  const unitOptions = scope.canSeeNetwork
    ? session.clinics.filter((c) => c.type === "franchise_unit").map((c) => ({ id: c.id, name: c.name }))
    : [];
  const scopeLabel = `${scope.label} · ${PERIOD_LABELS[period]}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={SmilePlus}
        titulo="Painel da Ortodontia"
        descricao="Quem está em tratamento, quem está no prazo, quem precisa de atenção e quanto a ortodontia rende."
      >
        <Button size="sm" variant="secondary" nativeButton={false} render={<Link href="/ortodontia/atencao" />}>
          <AlertTriangle className="mr-1 size-3.5" /> Atenção
          {atencao.length > 0 && <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[10px] text-white">{atencao.length}</span>}
        </Button>
        <Button size="sm" variant="secondary" nativeButton={false} render={<Link href="/ortodontia/casos" />}>
          <ListChecks className="mr-1 size-3.5" /> Casos
        </Button>
        {canMoney && (
          <Button size="sm" variant="secondary" nativeButton={false} render={<Link href="/ortodontia/mensalidades" />}>
            <Wallet className="mr-1 size-3.5" /> Mensalidades
          </Button>
        )}
        {canManage && (
          <Button size="sm" nativeButton={false} render={<Link href="/ortodontia/casos/novo" />}>
            <UserPlus className="mr-1 size-3.5" /> Novo caso
          </Button>
        )}
        {(session.isAdminMaster || canManage) && (
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/ortodontia/configuracao" />} title="Configuração">
            <Settings className="size-4" />
          </Button>
        )}
      </CabecalhoDeModulo>

      <FilterForm className="flex flex-wrap items-center gap-2 text-sm">
        {scope.canSeeNetwork && (
          <select name="unidade" defaultValue={pick("unidade") ?? (scope.clinicId ?? "all")} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
            <option value="all">Rede toda</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        <select name="periodo" defaultValue={period} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          {PERIODS.map((p) => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Em tratamento, no prazo e previsão são de hoje; novos, finalizados, faltas e receita seguem o período.
        </span>
      </FilterForm>

      {leituraIncompleta && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Parte das leituras falhou (manutenções ou mensalidades): os números dependentes delas podem estar incompletos.
        </p>
      )}

      {/* Estoque ------------------------------------------------------------ */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OrthoDrill items={emTratamento.map((c) => item(c))} dialogTitle="Em tratamento" scopeLabel={scope.label}>
          <Kpi icon={Users} label="Em tratamento" value={emTratamento.length} hint={`${aguardando.length} aguardando início · ${contencao.length} em contenção`} />
        </OrthoDrill>
        <OrthoDrill items={noPrazo.map((c) => item(c, { value: c.planned_end_date ? `até ${formatIsoDateBr(c.planned_end_date)}` : null }))} dialogTitle="No prazo" scopeLabel={scope.label} dialogHint="término previsto ainda não passou (com a tolerância)">
          <Kpi icon={CheckCircle2} label="No prazo" value={noPrazo.length} hint={emTratamento.length ? `${Math.round((noPrazo.length / emTratamento.length) * 100)}% dos em tratamento` : undefined} tone="border-emerald-200" />
        </OrthoDrill>
        <OrthoDrill items={atrasados.map((c) => item(c, { value: c.planned_end_date ? `+${daysBetween(c.planned_end_date, today)} dias` : null, badgeTone: "rose" }))} dialogTitle="Atrasados" scopeLabel={scope.label} dialogHint="já deviam ter finalizado">
          <Kpi icon={Clock} label="Atrasados" value={atrasados.length} hint="passaram do término previsto" tone={atrasados.length > 0 ? "border-rose-300" : undefined} />
        </OrthoDrill>
        <OrthoDrill items={semAgendamento.map((x) => item(x.c, { badge: "sem agendamento", badgeTone: "amber" }))} dialogTitle="Sem agendamento" scopeLabel={scope.label}>
          <Kpi icon={CalendarX2} label="Sem agendamento" value={semAgendamento.length} hint={`${atencao.length} precisam de atenção`} tone={semAgendamento.length > 0 ? "border-amber-300" : undefined} />
        </OrthoDrill>
      </section>

      {/* Movimento --------------------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <OrthoDrill items={novos.map((c) => item(c, { value: formatIsoDateBr((c.start_date ?? c.created_at).slice(0, 10)) }))} dialogTitle="Novos pacientes" scopeLabel={scopeLabel}>
          <Kpi icon={UserPlus} label="Novos no período" value={novos.length} />
        </OrthoDrill>
        <OrthoDrill items={finalizados.map((c) => item(c, { value: TIMELINESS_LABELS[caseTimeliness(c, today)] }))} dialogTitle="Finalizados" scopeLabel={scopeLabel}>
          <Kpi icon={Sparkles} label="Finalizados" value={finalizados.length} hint={finalizados.length ? `${finalizadosNoPrazo.length} no prazo · ${interrompidos.length} interrompidos` : `${interrompidos.length} interrompidos`} />
        </OrthoDrill>
        <OrthoDrill items={faltas.map((x) => item(x.c, { value: `${x.n} falta${x.n === 1 ? "" : "s"}` }))} dialogTitle="Faltas nas manutenções" scopeLabel={scopeLabel}>
          <Kpi icon={CalendarX2} label="Faltas" value={faltas.reduce((s, x) => s + x.n, 0)} hint={`${realizadas} manutenções realizadas`} />
        </OrthoDrill>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Previsão de término</p>
            <div className="mt-1 grid grid-cols-3 gap-1 text-center">
              {[
                { l: "3 meses", v: forecast.in3, items: terminam(today, addMonths(today, 3)) },
                { l: "6 meses", v: forecast.in6, items: terminam(addMonths(today, 3), addMonths(today, 6)) },
                { l: "12 meses", v: forecast.in12, items: terminam(addMonths(today, 6), addMonths(today, 12)) },
              ].map((b) => (
                <OrthoDrill key={b.l} items={b.items.map((c) => item(c, { value: c.planned_end_date ? formatIsoDateBr(c.planned_end_date) : null }))} dialogTitle={`Terminam em até ${b.l}`} scopeLabel={scope.label} className="rounded-md">
                  <div className="rounded-md border p-1.5">
                    <p className="text-lg font-semibold tabular-nums">{b.v}</p>
                    <p className="text-[10px] text-muted-foreground">{b.l}</p>
                  </div>
                </OrthoDrill>
              ))}
            </div>
            {forecast.overdue > 0 && <p className="mt-1 text-[11px] text-rose-700">{forecast.overdue} já passaram da previsão.</p>}
          </CardContent>
        </Card>
      </section>

      {/* Dinheiro ----------------------------------------------------------- */}
      {canMoney && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OrthoDrill
            items={receita.map((ch) => {
              const c = caseById.get(ch.case_id);
              return { key: ch.id, href: c ? `/ortodontia/casos/${c.id}` : null, title: c?.client?.full_name ?? "—", subtitle: `Competência ${formatIsoMonthBr(ch.reference_month)}${ch.paid_at ? ` · paga em ${formatIsoDateBr(ch.paid_at.slice(0, 10))}` : ""}`, value: formatBRL(ch.amount_cents), badgeTone: "emerald" as const };
            })}
            dialogTitle="Mensalidades recebidas"
            scopeLabel={scopeLabel}
          >
            <Kpi icon={Wallet} label="Receita recebida" value={formatBRL(receitaCents)} hint={`${receita.length} mensalidade${receita.length === 1 ? "" : "s"} · conta 1.1.04 na DRE`} />
          </OrthoDrill>
          <Kpi icon={TrendingUp} label="Receita prevista / mês" value={formatBRL(receitaPrevistaMes)} hint={`mensalidade média ${formatBRL(mensalidadeMedia)}`} />
          <OrthoDrill
            items={atrasadas.map((ch) => {
              const c = caseById.get(ch.case_id);
              return { key: ch.id, href: c ? `/ortodontia/casos/${c.id}` : null, title: c?.client?.full_name ?? "—", subtitle: `Venceu em ${formatIsoDateBr(ch.due_date)} · ${formatIsoMonthBr(ch.reference_month)}`, value: formatBRL(ch.amount_cents), badge: `${daysBetween(ch.due_date, today)} dias`, badgeTone: "rose" as const };
            })}
            dialogTitle="Mensalidades atrasadas"
            scopeLabel={scope.label}
          >
            <Kpi icon={AlertTriangle} label="Inadimplência" value={formatBRL(atrasadasCents)} hint={`${atrasadas.length} mensalidade${atrasadas.length === 1 ? "" : "s"} em atraso`} tone={atrasadas.length > 0 ? "border-rose-300" : undefined} />
          </OrthoDrill>
          <Kpi icon={BarChart3} label="Taxa de atraso" value={allCharges.filter((ch) => ch.status !== "cancelada").length ? `${Math.round((atrasadas.length / allCharges.filter((ch) => ch.status !== "cancelada").length) * 100)}%` : "—"} hint="atrasadas ÷ mensalidades geradas" />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evolução ---------------------------------------------------------- */}
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <TrendingUp className="size-4 text-primary" /> Evolução — pacientes em tratamento
            </CardTitle>
            <p className="text-xs text-muted-foreground">Quantos estavam em tratamento no fim de cada mês (últimos 12). Embaixo: começaram / terminaram.</p>
          </CardHeader>
          <CardContent>
            <div className="flex h-36 items-end gap-1">
              {evolucao.map((p) => (
                <div key={p.month} className="flex flex-1 flex-col items-center gap-1" title={`${formatIsoMonthBr(p.month)}: ${p.active} em tratamento · +${p.started} · −${p.finished}`}>
                  <span className="text-[10px] tabular-nums">{p.active}</span>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(2, (p.active / maxEvo) * 100)}%` }} />
                  <span className="text-[9px] text-muted-foreground">{formatIsoMonthBr(p.month).slice(0, 3)}</span>
                  <span className="text-[9px] text-muted-foreground tabular-nums">
                    <span className="text-emerald-700">+{p.started}</span>/<span className="text-rose-700">−{p.finished}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Origem ------------------------------------------------------------ */}
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Users className="size-4 text-primary" /> De onde vêm os pacientes de ortodontia
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Os casos abertos, pela origem do paciente: Indica +Risos, Riso+ (PPR+), Empresarial, indicação de cliente ou direto na unidade. É assim que se mede o que Metas, Indica, Empresarial e Riso+ trazem para a ortodontia.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {(Object.keys(ORIGIN_LABELS) as OrthoOrigin[]).map((o) => {
              const list = origens.get(o) ?? [];
              const pct = abertos.length ? Math.round((list.length / abertos.length) * 100) : 0;
              return (
                <OrthoDrill key={o} items={list.map((c) => item(c))} dialogTitle={ORIGIN_LABELS[o]} scopeLabel={scope.label} className="rounded-md">
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <span className="w-40 shrink-0">{ORIGIN_LABELS[o]}</span>
                    <div className="h-2 flex-1 rounded bg-muted">
                      <div className="h-2 rounded bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-16 text-right tabular-nums text-xs">{list.length} · {pct}%</span>
                  </div>
                </OrthoDrill>
              );
            })}
            {abertos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum caso aberto ainda.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Por unidade (rede) ------------------------------------------------- */}
      {porUnidade.length > 0 && (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <BarChart3 className="size-4 text-primary" /> Por unidade
            </CardTitle>
            <p className="text-xs text-muted-foreground">Clique na unidade para abrir o painel dela.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2">Unidade</th>
                  <th className="py-1.5 pr-2 text-right">Em tratamento</th>
                  <th className="py-1.5 pr-2 text-right">Atrasados</th>
                  <th className="py-1.5 pr-2 text-right">Novos</th>
                  <th className="py-1.5 pr-2 text-right">Finalizados</th>
                  <th className="py-1.5 pr-2 text-right">Atenção</th>
                  {canMoney && <th className="py-1.5 text-right">Receita</th>}
                </tr>
              </thead>
              <tbody>
                {porUnidade.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="py-1.5 pr-2">
                      <Link href={`/ortodontia?unidade=${u.id}&periodo=${period}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                        {u.name} <ChevronRight className="size-3" />
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{u.emTratamento}</td>
                    <td className={cn("py-1.5 pr-2 text-right tabular-nums", u.atrasados > 0 && "text-rose-700")}>{u.atrasados}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{u.novos}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{u.finalizados}</td>
                    <td className={cn("py-1.5 pr-2 text-right tabular-nums", u.atencao > 0 && "text-amber-700")}>{u.atencao}</td>
                    {canMoney && <td className="py-1.5 text-right tabular-nums">{formatBRL(u.receita)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Vendas com ortodontia sem caso (ORTO5 manual) ----------------------- */}
      {salesPending.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <AlertTriangle className="size-4 text-amber-600" /> Vendas com Ortodontia sem caso aberto
            </CardTitle>
            <p className="text-xs text-muted-foreground">Plano vendido com procedimento de Ortodontia e o paciente ainda não tem o caso. Abra para o cronograma e a mensalidade começarem.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {salesPending.map((s) => (
                <li key={s.negotiationId} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{s.clientName}{s.closedAt ? <span className="text-xs text-muted-foreground"> · venda em {formatIsoDateBr(s.closedAt.slice(0, 10))}</span> : null}</span>
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/ortodontia/casos/novo?cliente=${s.clientId}&negociacao=${s.negotiationId}`} />}>
                    Abrir caso
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Lista rápida das situações --------------------------------------------- */}
      <section className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(ORTHO_STATUS_LABELS) as OrthoStatus[]).map((s) => {
          const n = cases.filter((c) => c.status === s).length;
          return (
            <Link key={s} href={`/ortodontia/casos?situacao=${s}`} className={cn("rounded-full border px-2.5 py-1", ORTHO_STATUS_TONE[s])}>
              {ORTHO_STATUS_LABELS[s]}: <strong>{n}</strong>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
