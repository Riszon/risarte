import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { holidaysInRange } from "@/lib/holidays";
import {
  mapPlanItem,
  PLAN_ITEM_LABELS,
  PLAN_ITEM_CLASS,
  PLAN_ITEM_TYPES,
  itemDayCount,
  type PlanItem,
  type PlanItemRow,
  type PlanItemType,
} from "@/lib/annual-plan";
import { AnnualPlanManager } from "./annual-plan-manager";
import { NetworkPlanManager } from "./network-plan-manager";
import { HorasDaUnidade } from "./horas-da-unidade";
import { diasDoPeriodo, lerAtendimentosDoPeriodo, lerBaseDasHoras } from "./horas-dados";
import { BRAZIL_TIME_ZONE, formatIsoDayMonthBr, todayInBrazil } from "@/lib/dates";
import {
  formatarHoras,
  lerPeriodo,
  montarQuadro,
  resumir,
} from "@/lib/horas-da-agenda";

export const metadata: Metadata = { title: "Planejamento anual" };

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function AnnualPlanPage(
  props: PageProps<"/agenda/planejamento-anual">
) {
  const session = await getSessionContext();
  const clinic = session.activeClinic;

  const sp = await props.searchParams;
  // "Hoje" é o dia BRASILEIRO: no servidor (UTC), das 21h em diante o relógio
  // da máquina já está no dia seguinte — e na virada do ano, no ano seguinte.
  const todayIso = todayInBrazil();
  const year =
    typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano)
      ? Number(sp.ano)
      : Number(todayIso.slice(0, 4));
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;

  if (!clinic) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Planejamento anual de atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma clínica no menu lateral.
        </p>
      </div>
    );
  }

  // H4.8: na franqueadora, edita o CALENDÁRIO DA REDE (vale para todas).
  if (clinic.type === "franchisor") {
    const canManageNetwork =
      session.isAdminMaster ||
      hasRoleInClinic(session, clinic.id, ["unit_manager", "franchisee"]);
    if (!canManageNetwork) redirect("/agenda");

    const supabase = await createClient();
    const { data: netRows } = await supabase
      .from("agenda_plan_items")
      .select("id, clinic_id, type, locked, starts_date, ends_date, title, note")
      .is("clinic_id", null)
      .lte("starts_date", dec31)
      .gte("ends_date", jan1)
      .order("starts_date");
    const netItems = (netRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));

    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Calendário anual da rede
            </h1>
            <p className="text-sm text-muted-foreground">
              Recessos, eventos, treinamentos, manutenções e campanhas que valem
              para todas as unidades.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/agenda/planejamento-anual?ano=${year - 1}`} />
              }
            >
              ← {year - 1}
            </Button>
            <span className="px-2 text-lg font-semibold">{year}</span>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/agenda/planejamento-anual?ano=${year + 1}`} />
              }
            >
              {year + 1} →
            </Button>
          </div>
        </div>

        <NetworkPlanManager
          year={year}
          todayIso={todayIso}
          items={netItems.map((i) => ({
            id: i.id,
            type: i.type,
            startsDate: i.startsDate,
            endsDate: i.endsDate,
            title: i.title,
            note: i.note,
            locked: i.locked,
            isPast: i.endsDate < todayIso,
          }))}
        />
      </div>
    );
  }

  const canManage = hasRoleInClinic(session, clinic.id, ["unit_manager"]);
  if (!canManage) redirect("/agenda");

  // OC-00071: o período da conta de horas (o ano inteiro, se nada foi pedido).
  const periodo = lerPeriodo({ de: sp.de, ate: sp.ate }, year);
  // Uma leitura só serve ao resumo do ano e ao período escolhido.
  const leituraDe = periodo.de < jan1 ? periodo.de : jan1;
  const leituraAte = periodo.ate > dec31 ? periodo.ate : dec31;

  const supabase = await createClient();
  const [
    { data: planRows },
    { data: staffRows },
    { data: holidayRows },
    { data: netRows },
    baseDasHoras,
    atendimentos,
  ] = await Promise.all([
    supabase
      .from("agenda_plan_items")
      .select(
        "id, type, starts_date, ends_date, title, note, agenda_plan_item_people ( user_id )"
      )
      .eq("clinic_id", clinic.id)
      .lte("starts_date", dec31)
      .gte("ends_date", jan1)
      .order("starts_date"),
    supabase
      .from("user_clinic_roles")
      .select("user_id, profiles ( full_name )")
      .eq("clinic_id", clinic.id),
    supabase
      .from("clinic_holiday_decisions")
      .select("holiday_date, will_attend")
      .eq("clinic_id", clinic.id)
      .gte("holiday_date", jan1)
      .lte("holiday_date", dec31),
    // H4.8: itens da REDE (clinic_id NULL) — leitura, para a unidade saber.
    supabase
      .from("agenda_plan_items")
      .select("id, clinic_id, type, locked, starts_date, ends_date, title, note")
      .is("clinic_id", null)
      .lte("starts_date", dec31)
      .gte("ends_date", jan1)
      .order("starts_date"),
    lerBaseDasHoras(supabase, clinic.id, leituraDe, leituraAte),
    lerAtendimentosDoPeriodo(supabase, clinic.id, periodo.de, periodo.ate),
  ]);

  const items = (planRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));
  const networkItems = (netRows ?? []).map((r) => mapPlanItem(r as PlanItemRow));

  const staffMap = new Map<string, string>();
  for (const r of (staffRows ?? []) as unknown as {
    user_id: string;
    profiles: { full_name: string } | null;
  }[]) {
    if (!staffMap.has(r.user_id)) {
      staffMap.set(r.user_id, r.profiles?.full_name ?? "—");
    }
  }
  const staff = [...staffMap.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const holidayDecision = new Map<string, boolean>();
  for (const r of (holidayRows ?? []) as {
    holiday_date: string;
    will_attend: boolean;
  }[]) {
    holidayDecision.set(r.holiday_date, r.will_attend);
  }
  const yearHolidays = holidaysInRange(jan1, dec31);

  // -------------------------------------------------------------------------
  // As horas possíveis do ANO (resumo) e do PERÍODO escolhido (OC-00071).
  //
  // ⚠️ A conta mora em `src/lib/horas-da-agenda.ts`. Até a 0.309.0 ela era
  // feita aqui (dias da semana × jornada) e não via horário avulso, fechamento
  // de agenda nem período planejado pela rede.
  // -------------------------------------------------------------------------
  const entrada = baseDasHoras.entrada;
  const resumoDoAno = entrada ? resumir(diasDoPeriodo(entrada, jan1, dec31)) : null;
  const quadro = entrada
    ? montarQuadro(diasDoPeriodo(entrada, periodo.de, periodo.ate), atendimentos, todayIso)
    : null;

  const countByType: Record<PlanItemType, { items: number; days: number }> =
    Object.fromEntries(
      PLAN_ITEM_TYPES.map((t) => [t, { items: 0, days: 0 }])
    ) as Record<PlanItemType, { items: number; days: number }>;
  for (const i of items) {
    countByType[i.type].items += 1;
    countByType[i.type].days += itemDayCount(i);
  }
  const holidaysWorked = yearHolidays.filter(
    (h) => holidayDecision.get(h.date) === true
  ).length;
  const holidaysClosed = yearHolidays.filter(
    (h) => holidayDecision.get(h.date) === false
  ).length;
  const holidaysPending = yearHolidays.length - holidaysWorked - holidaysClosed;

  // 12-month overview: which items touch each month.
  const months = Array.from({ length: 12 }, (_, m) => {
    const mStart = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    const mEnd = ymd(new Date(year, m + 1, 0));
    const monthItems = items.filter(
      (i) => i.startsDate <= mEnd && i.endsDate >= mStart
    );
    const monthHolidays = yearHolidays.filter(
      (h) => h.date >= mStart && h.date <= mEnd
    ).length;
    return {
      label: new Date(year, m, 1).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE,
        month: "short",
      }),
      items: monthItems,
      holidays: monthHolidays,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Planejamento anual de atendimento
          </h1>
          <p className="text-sm text-muted-foreground">
            {clinic.name} — recessos, férias, eventos, treinamentos e
            manutenções programadas.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda/planejamento-anual?ano=${year - 1}`} />}
          >
            ← {year - 1}
          </Button>
          <span className="px-2 text-lg font-semibold">{year}</span>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/agenda/planejamento-anual?ano=${year + 1}`} />}
          >
            {year + 1} →
          </Button>
        </div>
      </div>

      {/* Relatório-resumo --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo do ano {year}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">
                {resumoDoAno ? resumoDoAno.diasAbertos : "—"}
              </p>
              <p className="text-xs text-muted-foreground">dias trabalháveis</p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">
                {resumoDoAno ? formatarHoras(resumoDoAno.funcionamento) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                horas de funcionamento
                {resumoDoAno
                  ? ` · ${formatarHoras(resumoDoAno.cadeira)} de cadeira`
                  : " (não consegui calcular)"}
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{yearHolidays.length}</p>
              <p className="text-xs text-muted-foreground">
                feriados ({holidaysWorked} trabalha · {holidaysClosed} fecha ·{" "}
                {holidaysPending} a decidir)
              </p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{items.length}</p>
              <p className="text-xs text-muted-foreground">itens planejados</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PLAN_ITEM_TYPES.map((t) =>
              countByType[t].items > 0 ? (
                <span
                  key={t}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${PLAN_ITEM_CLASS[t]}`}
                >
                  {PLAN_ITEM_LABELS[t]}: {countByType[t].items} ({countByType[t].days}{" "}
                  dia{countByType[t].days === 1 ? "" : "s"})
                </span>
              ) : null
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Estimativa do ano inteiro pelos dias e horários configurados. Desconta
            o almoço, os feriados fechados, os períodos planejados (da unidade e
            da rede) e a agenda fechada; soma os horários avulsos liberados. O
            passo a passo da conta está no quadro abaixo.
          </p>
        </CardContent>
      </Card>

      <HorasDaUnidade
        ano={year}
        hoje={todayIso}
        periodo={periodo}
        quadro={quadro}
        cadeiras={baseDasHoras.cadeiras}
        cadeirasPelaConfiguracao={baseDasHoras.cadeirasPelaConfiguracao}
        naoLido={baseDasHoras.naoLido}
      />

      {/* Visão dos 12 meses ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visão dos 12 meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {months.map((m, i) => (
              <div key={i} className="rounded-lg border p-2">
                <p className="text-xs font-semibold capitalize">
                  {m.label.replace(".", "")}
                  {m.holidays > 0 && (
                    <span className="ml-1 font-normal text-red-700">
                      · {m.holidays} feriado{m.holidays === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.items.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  ) : (
                    m.items.map((it) => (
                      <span
                        key={it.id}
                        className={`rounded px-1 text-[10px] ${PLAN_ITEM_CLASS[it.type]}`}
                        title={it.title ?? PLAN_ITEM_LABELS[it.type]}
                      >
                        {PLAN_ITEM_LABELS[it.type]}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* H4.8: itens da rede (só leitura para a unidade) ------------------- */}
      {networkItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Calendário da rede{" "}
              <span className="font-normal text-muted-foreground">
                (definido pela franqueadora)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {networkItems.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${PLAN_ITEM_CLASS[it.type]}`}
                    >
                      {PLAN_ITEM_LABELS[it.type]}
                    </span>
                    <span className="ml-1.5 font-medium">
                      {formatIsoDayMonthBr(it.startsDate)}
                      {it.endsDate !== it.startsDate
                        ? ` – ${formatIsoDayMonthBr(it.endsDate)}`
                        : ""}
                    </span>
                    {it.title && (
                      <span className="ml-1.5 text-muted-foreground">
                        · {it.title}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs">
                    {it.type === "campaign" ? (
                      <span className="text-pink-700">informativo</span>
                    ) : it.locked ? (
                      <span className="text-red-700">
                        travado pela rede (não abre)
                      </span>
                    ) : (
                      <span className="text-emerald-700">
                        a unidade pode abrir
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AnnualPlanManager
        clinicId={clinic.id}
        year={year}
        todayIso={todayIso}
        items={items.map((i: PlanItem) => ({
          id: i.id,
          type: i.type,
          startsDate: i.startsDate,
          endsDate: i.endsDate,
          title: i.title,
          note: i.note,
          userIds: i.userIds,
          isPast: i.endsDate < todayIso,
        }))}
        staff={staff}
        holidays={yearHolidays.map((h) => ({
          date: h.date,
          name: h.name,
          decision: holidayDecision.has(h.date)
            ? (holidayDecision.get(h.date) as boolean)
            : null,
        }))}
      />
    </div>
  );
}
