import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarPlus, ChevronRight, Phone, SmilePlus } from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewOrtho, canViewOrthoDashboard, canViewOrthoMoney, orthoRestrictedToOwn } from "@/lib/ortodontia/access";
import { resolveOrthoScope } from "@/lib/ortodontia/escopo";
import { activeBatch, groupByCase, loadBatchesFor, loadCases, loadChargesFor, loadMaintenancesFor, loadOpenRequestsFor, loadStartAppointments, type OrthoBatchRow } from "@/lib/ortodontia/db";
import {
  ATTENTION_LABELS,
  attentionReasons,
  nextMaintenance,
  type AttentionReason,
  type MaintenanceLike,
} from "@/lib/ortodontia/regras";
import { ORTHO_OPEN_STATUSES, ORTHO_STATUS_LABELS } from "@/lib/ortodontia/constants";
import { ORTHO_STATUS_TONE } from "@/components/ortodontia/ortho-client-card";
import { CabecalhoDeModulo } from "@/components/cabecalho-modulo";
import { FilterForm } from "@/components/filter-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatIsoDateBr, todayInBrazil } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ortodontia — Atenção" };

const ORDEM: AttentionReason[] = [
  "suspenso",
  "faltou",
  "manutencao_vencida",
  "sem_agendamento",
  "aguardando_inicio",
  "lote_encerrado",
  "reavaliacao_vencida",
  "pedido_clinico_aberto",
  "termino_atrasado",
  "mensalidade_atrasada",
  "lote_terminando",
];

const TONE: Record<AttentionReason, string> = {
  suspenso: "border-orange-300 bg-orange-50 text-orange-800",
  faltou: "border-rose-300 bg-rose-50 text-rose-800",
  manutencao_vencida: "border-rose-300 bg-rose-50 text-rose-800",
  sem_agendamento: "border-amber-300 bg-amber-50 text-amber-800",
  aguardando_inicio: "border-amber-300 bg-amber-50 text-amber-800",
  lote_encerrado: "border-rose-300 bg-rose-50 text-rose-800",
  lote_terminando: "border-amber-300 bg-amber-50 text-amber-800",
  reavaliacao_vencida: "border-sky-300 bg-sky-50 text-sky-800",
  pedido_clinico_aberto: "border-sky-300 bg-sky-50 text-sky-800",
  termino_atrasado: "border-violet-300 bg-violet-50 text-violet-800",
  mensalidade_atrasada: "border-rose-300 bg-rose-50 text-rose-800",
};

/**
 * ATENÇÃO — a tela da RECEPÇÃO (e de todos): quem precisa de ação hoje na
 * ortodontia. Cada paciente aparece uma vez, com todos os motivos; o filtro
 * por motivo mostra só aquele grupo. As regras moram em `regras.ts`.
 */
export default async function OrtoAtencaoPage(props: PageProps<"/ortodontia/atencao">) {
  const session = await getSessionContext();
  if (!canViewOrtho(session)) redirect("/");

  const sp = await props.searchParams;
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const scope = resolveOrthoScope(session, pick("unidade"));
  const motivo = pick("motivo") as AttentionReason | undefined;
  const canMoney = canViewOrthoMoney(session, scope.clinicId);
  const soMeus = orthoRestrictedToOwn(session, scope.clinicId);
  const today = todayInBrazil();

  const supabase = await createClient();
  const casesRead = await loadCases(supabase, {
    clinicIds: scope.clinicIds,
    statuses: ORTHO_OPEN_STATUSES,
    orthodontistId: soMeus ? session.userId : null,
  });
  const cases = casesRead.ok ? casesRead.linhas : [];
  const caseIds = cases.map((c) => c.id);
  const [maintRead, chargesRead, openRequests, startByClient, batchesByCase] = await Promise.all([
    loadMaintenancesFor(supabase, caseIds),
    canMoney ? loadChargesFor(supabase, caseIds) : Promise.resolve({ ok: true as const, linhas: [], paginas: 0 }),
    loadOpenRequestsFor(supabase, [...new Set(cases.map((c) => c.client_id))]),
    // R4 (0334): horário de instalação de quem aguarda início.
    loadStartAppointments(supabase, cases.filter((c) => c.status === "aguardando_inicio").map((c) => c.client_id)),
    // R8 (0335): o lote de mensalidades (só quem vê dinheiro).
    canMoney ? loadBatchesFor(supabase, cases.filter((c) => c.status === "em_tratamento").map((c) => c.id)) : Promise.resolve(new Map<string, OrthoBatchRow[]>()),
  ]);
  const maintByCase = groupByCase(maintRead.ok ? maintRead.linhas : []);
  const chargesByCase = groupByCase(chargesRead.ok ? chargesRead.linhas : []);

  const linhas = cases
    .map((c) => {
      const ms: MaintenanceLike[] = (maintByCase.get(c.id) ?? []).map((m) => ({
        status: m.status,
        planned_date: m.planned_date,
        done_at: m.done_at,
        appointment_date: m.appointment?.starts_at ? m.appointment.starts_at.slice(0, 10) : null,
      }));
      const reasons = attentionReasons({
        caso: c,
        maintenances: ms,
        charges: chargesByCase.get(c.id) ?? [],
        openClinicalRequests: openRequests.get(c.client_id) ?? 0,
        today,
        includeMoney: canMoney,
        startScheduled: startByClient.has(c.client_id),
        batch: activeBatch(batchesByCase.get(c.id)),
      });
      const next = nextMaintenance(ms, today);
      return { c, reasons, next, instalacao: startByClient.get(c.client_id) ?? null };
    })
    .filter((x) => x.reasons.length > 0 && (!motivo || x.reasons.includes(motivo)))
    .sort((a, b) => ORDEM.indexOf(a.reasons[0]) - ORDEM.indexOf(b.reasons[0]));

  const contagem = new Map<AttentionReason, number>();
  for (const x of linhas) for (const r of x.reasons) contagem.set(r, (contagem.get(r) ?? 0) + 1);

  const unitOptions = scope.canSeeNetwork
    ? session.clinics.filter((c) => c.type === "franchise_unit").map((c) => ({ id: c.id, name: c.name }))
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <CabecalhoDeModulo
        chapeu="Ortodontia"
        icone={AlertTriangle}
        titulo="Precisam de atenção"
        descricao="Pacientes de ortodontia que pedem uma ação agora: agendar, remarcar, reavaliar ou cobrar. Em dia não aparece aqui."
        voltar={canViewOrthoDashboard(session) ? { href: "/ortodontia", rotulo: "Painel" } : undefined}
      >
        <Button size="sm" variant="secondary" nativeButton={false} render={<Link href="/ortodontia/casos" />}>
          <SmilePlus className="mr-1 size-3.5" /> Todos os casos
        </Button>
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
        <select name="motivo" defaultValue={motivo ?? ""} className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
          <option value="">Todos os motivos</option>
          {ORDEM.filter((r) => canMoney || r !== "mensalidade_atrasada").map((r) => (
            <option key={r} value={r}>
              {ATTENTION_LABELS[r]} ({contagem.get(r) ?? 0})
            </option>
          ))}
        </select>
        {soMeus && <span className="text-xs text-muted-foreground">Mostrando só os casos em que você é o ortodontista.</span>}
      </FilterForm>

      {!casesRead.ok && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Não foi possível ler os casos agora. Se o banco ainda não recebeu a migração 0329, este módulo aparece vazio.
        </p>
      )}

      {casesRead.ok && linhas.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Ninguém precisa de atenção{motivo ? " por este motivo" : ""} em {scope.label}. 🎉
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {linhas.map(({ c, reasons, next, instalacao }) => (
          <li key={c.id}>
            <Card>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/ortodontia/casos/${c.id}`} className="font-medium hover:underline">
                      {c.client?.full_name ?? "—"}
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.code}{c.client?.code ? ` · ${c.client.code}` : ""}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ORTHO_STATUS_TONE[c.status])}>{ORTHO_STATUS_LABELS[c.status]}</span>
                    {scope.clinicIds === null && c.clinic && <span className="text-xs text-muted-foreground">· {c.clinic.name}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {reasons.map((r) => (
                      <span key={r} className={cn("rounded-md border px-2 py-0.5 text-xs", TONE[r])}>{ATTENTION_LABELS[r]}</span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {c.orthodontist ? `Ortodontista: ${c.orthodontist.full_name}` : "Sem ortodontista definido"}
                    {c.status === "aguardando_inicio"
                      ? instalacao
                        ? ` · instalação marcada para ${formatIsoDateBr(instalacao.slice(0, 10))}`
                        : " · sem horário de instalação (agendar início de tratamento)"
                      : next
                        ? ` · próxima manutenção ${formatIsoDateBr((next.appointment_date ?? next.planned_date ?? "").slice(0, 10))} (${next.status})`
                        : " · sem próxima manutenção"}
                    {c.planned_end_date ? ` · término previsto ${formatIsoDateBr(c.planned_end_date)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {c.client?.phone && (
                    <a href={`https://wa.me/55${c.client.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted" title="WhatsApp">
                      <Phone className="size-3.5" /> {c.client.phone}
                    </a>
                  )}
                  <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/agenda?cliente=${c.client_id}&tipo=treatment_session`} />}>
                    <CalendarPlus className="mr-1 size-3.5" /> Agendar
                  </Button>
                  <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/ortodontia/casos/${c.id}`} />}>
                    Caso <ChevronRight className="ml-1 size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
