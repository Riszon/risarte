import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarPlus,
  FileSignature,
  HeartHandshake,
  History,
  ListChecks,
  SmilePlus,
  User,
  Wallet,
} from "lucide-react";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  canEvolveOrtho,
  canManageOrtho,
  canSettleOrtho,
  canViewOrtho,
  canViewOrthoDashboard,
  canViewOrthoMoney,
  orthoRestrictedToOwn,
} from "@/lib/ortodontia/access";
import {
  loadCase,
  loadChargesFor,
  loadEffectiveSettings,
  loadEvents,
  loadIndicaReferredSet,
  loadLinkableAppointments,
  loadMaintenancesFor,
  loadOpenRequestsFor,
  loadOrthoProcedures,
  loadOrthodontistOptions,
  loadReferralsMadeBy,
} from "@/lib/ortodontia/db";
import {
  ATTENTION_LABELS,
  ORIGIN_LABELS,
  TIMELINESS_LABELS,
  attendance,
  attentionReasons,
  caseTimeliness,
  chargeStatusToday,
  nextMaintenance,
  originOf,
  progressPercent,
  type MaintenanceLike,
} from "@/lib/ortodontia/regras";
import {
  ORTHO_CHARGE_KIND_LABELS,
  ORTHO_CHARGE_STATUS_LABELS,
  ORTHO_KIND_LABELS,
  ORTHO_MAINTENANCE_STATUS_LABELS,
  ORTHO_STATUS_HINTS,
  ORTHO_STATUS_LABELS,
  type OrthoChargeStatus,
  type OrthoMaintenanceStatus,
} from "@/lib/ortodontia/constants";
import { ORTHO_STATUS_TONE } from "@/components/ortodontia/ortho-client-card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/pricing";
import { formatBrDateTime, formatIsoDateBr, formatIsoMonthBr, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { OrthoChargeRow } from "../../mensalidades/billing-client";
import { AddMaintenance, CaseStatusActions, EditCaseDialog, EvolutionDialog, MaintenanceRowActions } from "./caso-client";

export const metadata: Metadata = { title: "Caso ortodôntico" };

const MAINT_TONE: Record<OrthoMaintenanceStatus, string> = {
  prevista: "border-border bg-muted text-muted-foreground",
  agendada: "border-sky-300 bg-sky-50 text-sky-800",
  realizada: "border-emerald-300 bg-emerald-50 text-emerald-800",
  faltou: "border-rose-300 bg-rose-50 text-rose-800",
  cancelada: "border-border bg-muted text-muted-foreground line-through",
};
const CHARGE_TONE: Record<OrthoChargeStatus, string> = {
  em_aberto: "border-amber-300 bg-amber-50 text-amber-800",
  paga: "border-emerald-300 bg-emerald-50 text-emerald-800",
  atrasada: "border-rose-300 bg-rose-50 text-rose-800",
  cancelada: "border-border bg-muted text-muted-foreground",
};

/**
 * A FICHA DO CASO — tudo do tratamento ortodôntico de um paciente num lugar:
 * situação e prazo, cronograma de manutenções com a evolução, mensalidades,
 * as indicações que o paciente trouxe e o histórico. As ações seguem o papel
 * (gerir, evoluir, agendar, dar baixa) — e o banco confere de novo.
 */
export default async function OrtoCasoPage(props: PageProps<"/ortodontia/casos/[id]">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");
  const { id } = await props.params;
  const supabase = await createClient();
  const c = await loadCase(supabase, id);
  if (!c) notFound();
  if (orthoRestrictedToOwn(session, c.clinic_id) && c.orthodontist_id !== session.userId) notFound();

  const canManage = canManageOrtho(session, c.clinic_id);
  const canEvolve = canEvolveOrtho(session, c.clinic_id, c.orthodontist_id);
  const canSchedule = canManage || hasRoleInClinic(session, c.clinic_id, ["receptionist"]);
  const canMoney = canViewOrthoMoney(session, c.clinic_id);
  const canSettle = canSettleOrtho(session, c.clinic_id);
  const today = todayInBrazil();

  await logAudit({ action: "view", entityType: "ortho_case", entityId: c.id, clinicId: c.clinic_id });

  const [maintRead, chargesRead, events, referrals, indicaSet, openRequests, settings] = await Promise.all([
    loadMaintenancesFor(supabase, [c.id]),
    canMoney ? loadChargesFor(supabase, [c.id]) : Promise.resolve({ ok: true as const, linhas: [], paginas: 0 }),
    loadEvents(supabase, c.id),
    loadReferralsMadeBy(supabase, [c.client_id]),
    loadIndicaReferredSet(supabase, [c.client_id]),
    loadOpenRequestsFor(supabase, [c.client_id]),
    loadEffectiveSettings(supabase, c.clinic_id),
  ]);
  const maintenances = (maintRead.ok ? maintRead.linhas : []).sort((a, b) => a.seq - b.seq);
  const charges = chargesRead.ok ? chargesRead.linhas : [];
  const [linkable, orthodontists, procedures] = await Promise.all([
    canSchedule ? loadLinkableAppointments(supabase, c.client_id, maintenances.map((m) => m.appointment_id).filter((x): x is string => Boolean(x))) : Promise.resolve([]),
    canManage ? loadOrthodontistOptions(supabase, c.clinic_id) : Promise.resolve([]),
    canManage ? loadOrthoProcedures(supabase) : Promise.resolve([]),
  ]);

  const likes: MaintenanceLike[] = maintenances.map((m) => ({
    status: m.status,
    planned_date: m.planned_date,
    done_at: m.done_at,
    appointment_date: m.appointment?.starts_at ? m.appointment.starts_at.slice(0, 10) : null,
  }));
  const reasons = attentionReasons({
    caso: c,
    maintenances: likes,
    charges,
    openClinicalRequests: openRequests.get(c.client_id) ?? 0,
    today,
    toleranceDays: settings?.finish_tolerance_days,
    includeMoney: canMoney,
  });
  const timeliness = caseTimeliness(c, today, settings?.finish_tolerance_days);
  const pct = progressPercent(c, today);
  const next = nextMaintenance(likes, today);
  const assiduidade = attendance(maintenances, c.maintenance_interval_days);
  const { done, missed } = assiduidade;
  const origin = originOf({ ...(c.client ?? {}), has_indica_referral: indicaSet.has(c.client_id) });
  const trouxe = referrals.get(c.client_id) ?? [];
  const isOpen = c.status === "aguardando_inicio" || c.status === "em_tratamento" || c.status === "contencao";

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={SmilePlus}
        titulo={
          <>
            {c.client?.full_name ?? "—"}
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-normal", ORTHO_STATUS_TONE[c.status])}>{ORTHO_STATUS_LABELS[c.status]}</span>
          </>
        }
        descricao={`${c.code} · ${ORTHO_KIND_LABELS[c.treatment_kind]}${c.orthodontist ? ` · ${c.orthodontist.full_name}` : " · ortodontista a definir"}${c.clinic ? ` · ${c.clinic.name}` : ""}`}
        voltar={{ href: "/ortodontia/casos", rotulo: "Casos" }}
      >
        <Button size="sm" variant="secondary" nativeButton={false} render={<Link href={`/prontuarios/${c.client_id}`} />}>
          <User className="mr-1 size-3.5" /> Prontuário
        </Button>
        {canSchedule && isOpen && (
          <Button size="sm" variant="secondary" nativeButton={false} render={<Link href={`/agenda?cliente=${c.client_id}&tipo=treatment_session`} />}>
            <CalendarPlus className="mr-1 size-3.5" /> Agendar
          </Button>
        )}
        {(canManage || canSettle) && (
          <Button size="sm" variant="secondary" nativeButton={false} render={<Link href={`/ortodontia/casos/${c.id}/contrato`} />}>
            <FileSignature className="mr-1 size-3.5" /> Termo
          </Button>
        )}
        {canManage && (
          <EditCaseDialog
            caseId={c.id}
            initial={{
              orthodontistId: c.orthodontist_id,
              kind: c.treatment_kind,
              startDate: c.start_date,
              plannedMonths: c.planned_months,
              intervalDays: c.maintenance_interval_days,
              monthlyCents: c.monthly_fee_cents,
              billingDay: c.billing_day,
              installationCents: c.installation_fee_cents,
              procedureId: c.maintenance_procedure_id,
              nextReevaluationDate: c.next_reevaluation_date,
              notes: c.notes,
              retainerCharged: c.retainer_charged,
              retainerFeeCents: c.retainer_fee_cents,
              retainerTerms: c.retainer_terms,
            }}
            orthodontists={orthodontists}
            procedures={procedures}
          />
        )}
      </CabecalhoDeModulo>

      {/* Situação ------------------------------------------------------------ */}
      <section className="grid gap-3 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Início <strong>{c.start_date ? formatIsoDateBr(c.start_date) : "a definir"}</strong>
                {c.planned_end_date && (
                  <>
                    {" "}· término previsto <strong>{formatIsoDateBr(c.planned_end_date)}</strong> ({c.planned_months} meses
                    {c.extension_days > 0 ? ` + ${c.extension_days} dias pelas faltas` : ""})
                  </>
                )}
                {c.retainer_delivered_at && <> · contenções entregues <strong>{formatIsoDateBr(c.retainer_delivered_at)}</strong></>}
                {c.status === "finalizado" && c.finished_at && !c.retainer_delivered_at && <> · encerrado <strong>{formatIsoDateBr(c.finished_at)}</strong></>}
                {c.discharged_at && <> · alta <strong>{formatIsoDateBr(c.discharged_at)}</strong></>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {timeliness !== "nao_se_aplica" && (
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs", timeliness === "atrasado" || timeliness === "finalizado_atrasado" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-300 bg-emerald-50 text-emerald-800")}>
                    {TIMELINESS_LABELS[timeliness]}
                  </span>
                )}
                {assiduidade.ratePercent !== null && (
                  <span
                    className={cn("rounded-full border px-2 py-0.5 text-xs", assiduidade.ratePercent >= 80 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : assiduidade.ratePercent >= 60 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-rose-300 bg-rose-50 text-rose-800")}
                    title="Assiduidade: manutenções realizadas ÷ (realizadas + faltas)"
                  >
                    assiduidade {assiduidade.ratePercent}%
                  </span>
                )}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{ORTHO_STATUS_HINTS[c.status]}.</p>
            {pct !== null && c.status === "em_tratamento" && (
              <div className="h-2 w-full rounded bg-muted" title={`${pct}% do prazo previsto`}>
                <div className={cn("h-2 rounded", timeliness === "atrasado" ? "bg-rose-500" : "bg-primary/70")} style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>{done} manutenç{done === 1 ? "ão realizada" : "ões realizadas"}</span>
              <span className={missed > 0 ? "text-rose-700" : undefined}>
                {missed} falta{missed === 1 ? "" : "s"}
                {missed > 0 ? ` (o término previsto foi prorrogado em ${c.extension_days} dias)` : ""}
              </span>
              <span>manutenção a cada {c.maintenance_interval_days} dias</span>
              {c.next_reevaluation_date && <span>{c.status === "contencao" ? "controle da contenção" : "reavaliação"} {formatIsoDateBr(c.next_reevaluation_date)}</span>}
              {next && <span>próxima: {formatIsoDateBr((next.appointment_date ?? next.planned_date ?? "").slice(0, 10))} ({ORTHO_MAINTENANCE_STATUS_LABELS[next.status]})</span>}
            </div>
            {reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {reasons.map((r) => (
                  <span key={r} className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{ATTENTION_LABELS[r]}</span>
                ))}
              </div>
            )}
            {c.finish_reason && <p className="text-xs text-muted-foreground">Finalização: {c.finish_reason}</p>}
            {c.interrupt_reason && <p className="text-xs text-rose-700">Interrupção: {c.interrupt_reason}</p>}
            {c.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            {canMoney ? (
              <>
                <p className="text-xs text-muted-foreground">Mensalidade</p>
                <p className="text-xl font-semibold tabular-nums">{formatBRL(c.monthly_fee_cents)}<span className="text-xs font-normal text-muted-foreground"> /mês · dia {c.billing_day}{c.status === "em_tratamento" ? " · até a entrega das contenções" : ""}</span></p>
                {c.installation_fee_cents > 0 && <p className="text-xs text-muted-foreground">Instalação {formatBRL(c.installation_fee_cents)} (pelo plano)</p>}
                <p className="text-xs text-muted-foreground">
                  Contenção: {c.retainer_charged && c.retainer_fee_cents > 0 ? <>cobrada, <strong>{formatBRL(c.retainer_fee_cents)}</strong>{c.retainer_terms ? ` (${c.retainer_terms})` : ""}</> : "incluída no tratamento"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {charges.filter((ch) => ch.status === "paga").length} pagas · {charges.filter((ch) => chargeStatusToday(ch, today) === "atrasada").length} atrasadas
                  {!canSettle && " · a baixa é do Gerente e do Financeiro"}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">A situação financeira é vista por quem tem a permissão de mensalidades.</p>
            )}
            <p className="text-xs text-muted-foreground">Origem do paciente: <strong>{ORIGIN_LABELS[origin]}</strong></p>
            {canManage && (
              <CaseStatusActions
                caseId={c.id}
                status={c.status}
                today={today}
                retainer={{ charged: c.retainer_charged, feeCents: c.retainer_fee_cents, terms: c.retainer_terms }}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Cronograma ------------------------------------------------------------ */}
      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-1.5 text-base"><ListChecks className="size-4 text-primary" /> Cronograma de manutenções e evolução</CardTitle>
            {canSchedule && isOpen && <AddMaintenance caseId={c.id} today={today} />}
          </div>
          <p className="text-xs text-muted-foreground">
            O agendamento do paciente com o ortodontista liga-se sozinho à manutenção; concluir o atendimento marca como realizada (e gera o repasse). A evolução é registrada pelo ortodontista ou pelo Coordenador.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {maintenances.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {c.status === "aguardando_inicio" ? "O cronograma é gerado quando o tratamento for iniciado." : "Nenhuma manutenção no cronograma."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Prevista</th>
                  <th className="px-3 py-2">Agendamento</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2">Evolução</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {maintenances.map((m) => (
                  <tr key={m.id} className="border-b align-top">
                    <td className="px-3 py-2 tabular-nums">{m.seq}</td>
                    <td className="px-3 py-2">{m.planned_date ? formatIsoDateBr(m.planned_date) : "—"}</td>
                    <td className="px-3 py-2">
                      {m.appointment ? formatBrDateTime(m.appointment.starts_at) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", MAINT_TONE[m.status])}>{ORTHO_MAINTENANCE_STATUS_LABELS[m.status]}</span>
                      {m.status === "realizada" && m.done_at && (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatBrDateTime(m.done_at)}{m.done_by_profile ? ` · ${m.done_by_profile.full_name}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {m.arch_wire && <p><span className="text-muted-foreground">Fio/arco:</span> {m.arch_wire}</p>}
                      {m.notes && <p className="whitespace-pre-wrap">{m.notes}</p>}
                      {m.next_steps && <p><span className="text-muted-foreground">Próximo passo:</span> {m.next_steps}</p>}
                      {!m.arch_wire && !m.notes && !m.next_steps && <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        {canEvolve && m.status !== "cancelada" && (
                          <EvolutionDialog
                            maintenanceId={m.id}
                            seq={m.seq}
                            done={m.status === "realizada"}
                            canUndo={canManage}
                            initial={{ archWire: m.arch_wire ?? "", notes: m.notes ?? "", nextSteps: m.next_steps ?? "", doneAt: m.done_at }}
                          />
                        )}
                        {canSchedule && isOpen && (
                          <MaintenanceRowActions maintenanceId={m.id} status={m.status} linkable={m.appointment_id ? [] : linkable} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Mensalidades -------------------------------------------------------- */}
        {canMoney && (
          <Card>
            <CardHeader className="gap-1">
              <CardTitle className="flex items-center gap-1.5 text-base"><Wallet className="size-4 text-primary" /> Mensalidades</CardTitle>
              <p className="text-xs text-muted-foreground">Devidas com ou sem comparecimento, até a entrega das contenções. Geradas em <Link href="/ortodontia/mensalidades" className="underline">Mensalidades</Link>.</p>
            </CardHeader>
            <CardContent className="p-0">
              {charges.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhuma mensalidade gerada ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {[...charges].sort((a, b) => b.reference_month.localeCompare(a.reference_month)).map((ch) => {
                      const s = chargeStatusToday(ch, today);
                      return (
                        <tr key={ch.id} className="border-b">
                          <td className="px-3 py-1.5">
                            {formatIsoMonthBr(ch.reference_month)}
                            {ch.kind === "contencao" && <span className="ml-1 rounded-full border border-sky-300 bg-sky-50 px-1.5 text-[10px] text-sky-800">{ORTHO_CHARGE_KIND_LABELS.contencao}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">venc. {formatIsoDateBr(ch.due_date)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatBRL(ch.amount_cents)}</td>
                          <td className="px-3 py-1.5"><span className={cn("rounded-full border px-2 py-0.5 text-[11px]", CHARGE_TONE[s])}>{ORTHO_CHARGE_STATUS_LABELS[s]}</span></td>
                          <td className="px-3 py-1.5 text-right">{canSettle && ch.status !== "cancelada" && <OrthoChargeRow chargeId={ch.id} paid={ch.status === "paga"} canCancel={canManage} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Indicações ---------------------------------------------------------- */}
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-1.5 text-base"><HeartHandshake className="size-4 text-primary" /> Indicações</CardTitle>
            <p className="text-xs text-muted-foreground">Quem o paciente trouxe para a Risarte (pela ficha “indicado por”). As indicações do Indica +Risos ficam no módulo do programa.</p>
          </CardHeader>
          <CardContent>
            {trouxe.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma indicação registrada ainda. Peça uma na próxima manutenção. 😉</p>
            ) : (
              <ul className="divide-y text-sm">
                {trouxe.map((r) => (
                  <li key={r.id} className="py-1.5">
                    <Link href={`/prontuarios/${r.id}`} className="hover:underline">{r.full_name}</Link>
                    {r.code && <span className="text-xs text-muted-foreground"> · {r.code}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico ------------------------------------------------------------- */}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-1.5 text-base"><History className="size-4 text-primary" /> Histórico do caso</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem registros.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{formatBrDateTime(e.created_at)}</span>
                  <span>{e.description ?? e.event_type}</span>
                  {e.author && <span className="text-xs text-muted-foreground">— {e.author.full_name}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!canViewOrthoDashboard(session) && (
        <p className="text-xs text-muted-foreground">Voltar para <Link href="/ortodontia/atencao" className="underline">Atenção</Link>.</p>
      )}
    </div>
  );
}
