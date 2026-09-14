"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { formatBRL } from "@/lib/pricing";
import { formatCnpj, formatPhone } from "@/lib/masks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CAPTURE_CHANNELS,
  CAPTURE_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  CONTACT_OUTCOMES,
  CONTACT_OUTCOME_LABELS,
  LEAD_STAGE_LABELS,
  MEETING_MODES,
  MEETING_MODE_LABELS,
  MEETING_STATUS_LABELS,
  type CaptureChannel,
  type ContactChannel,
  type ContactOutcome,
  type LeadStage,
  type MeetingMode,
  type MeetingStatus,
} from "@/lib/empresarial/constants";
import {
  CLOSING_FILTERS,
  CLOSING_FILTER_LABELS,
  ENTRY_STAGES,
  FUNNEL_COLUMNS,
  isOpenStage,
  matchesClosingFilter,
  rotuloDeDuracao,
  type ClosingFilter,
  type TempoNaFase,
} from "@/lib/empresarial/funnel";
import {
  addLeadActivity,
  convertLeadToCompany,
  createLead,
  moveLeadStage,
  registerContactAttempt,
  updateLead,
} from "./actions";
import { scheduleMeeting } from "../agenda/actions";
import {
  BRAZIL_TIME_ZONE,
  brazilInputValue,
  formatBrDate,
  formatBrTime,
} from "@/lib/dates";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs";

export type LeadView = {
  id: string;
  companyName: string;
  cnpj: string | null;
  contactName: string | null;
  contactPhone: string | null;
  stage: LeadStage;
  consultantId: string | null;
  consultantName: string | null;
  lostReason: string | null;
  companyId: string | null;
  estimatedValueCents: number | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  notes: string | null;
  captureChannel: CaptureChannel | null;
  referralName: string | null;
  referralContact: string | null;
  /** null = sem histórico (ver migração 1007). Nunca confundir com "zero dias". */
  tempoNaFase: TempoNaFase | null;
  activities: {
    id: string;
    kind: string;
    note: string | null;
    createdAt: string;
    authorName: string | null;
  }[];
  contactAttempts: {
    id: string;
    channel: ContactChannel;
    outcome: ContactOutcome;
    note: string | null;
    attemptedAt: string;
    authorName: string | null;
  }[];
  meetings: {
    id: string;
    title: string | null;
    mode: MeetingMode;
    location: string | null;
    startsAt: string;
    endsAt: string;
    status: MeetingStatus;
    statusNote: string | null;
  }[];
};

export function LeadBoard({
  leads,
  consultants,
  canManage,
}: {
  leads: LeadView[];
  consultants: { id: string; label: string }[];
  canManage: boolean;
  currentUserId: string;
}) {
  // Filtro da coluna de Fechamento (pedido do dono): Todos / Ganhos / Perdas.
  const [closingFilter, setClosingFilter] = useState<ClosingFilter>("ALL");

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <LeadFormDialog consultants={consultants} canManage={canManage} />
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {FUNNEL_COLUMNS.map((coluna) => {
          const naColuna = leads.filter((l) =>
            (coluna.stages as readonly string[]).includes(l.stage)
          );
          const ehFechamento = coluna.key === "CLOSING";
          const cards = ehFechamento
            ? naColuna.filter((l) => matchesClosingFilter(l.stage, closingFilter))
            : naColuna;
          const soma = cards.reduce(
            (acc, c) => acc + (c.estimatedValueCents ?? 0),
            0
          );
          const ganhos = naColuna.filter((l) => l.stage === "CLOSED_WON").length;
          const perdas = naColuna.filter((l) => l.stage === "CLOSED_LOST").length;

          return (
            <div
              key={coluna.key}
              className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/20"
            >
              <div className="space-y-1 border-b px-3 py-2">
                <p className="text-sm font-medium">
                  <span className="text-muted-foreground">{coluna.numero}.</span>{" "}
                  {coluna.titulo}
                </p>
                {ehFechamento ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {ganhos} ganho{ganhos === 1 ? "" : "s"} · {perdas} perda
                      {perdas === 1 ? "" : "s"}
                    </p>
                    <select
                      aria-label="Mostrar no fechamento"
                      className={selectClass}
                      value={closingFilter}
                      onChange={(e) =>
                        setClosingFilter(e.target.value as ClosingFilter)
                      }
                    >
                      {CLOSING_FILTERS.map((f) => (
                        <option key={f} value={f}>
                          {CLOSING_FILTER_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {cards.length} · {formatBRL(soma)}
                  </p>
                )}
              </div>
              <div className="flex-1 space-y-2 p-2">
                {cards.map((l) => (
                  <LeadCard key={l.id} lead={l} consultants={consultants} />
                ))}
                {cards.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    —
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  consultants,
}: {
  lead: LeadView;
  consultants: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const overdue =
    lead.nextActionAt != null &&
    new Date(lead.nextActionAt) <= new Date() &&
    isOpenStage(lead.stage);

  function move(stage: string) {
    startTransition(async () => {
      const r = await moveLeadStage(lead.id, stage as LeadStage);
      if (r.ok) router.refresh();
      else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="rounded-md border bg-background p-2 shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-medium leading-tight">{lead.companyName}</p>
        <LeadDetailDialog lead={lead} consultants={consultants} />
      </div>
      {lead.contactName && (
        <p className="text-xs text-muted-foreground">{lead.contactName}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {/* Na coluna de Fechamento os dois resultados convivem: o cartão precisa
            dizer qual é qual sem depender da cor de fundo. */}
        {lead.stage === "CLOSED_WON" && (
          <Badge className="bg-emerald-600 text-xs text-white">Ganho</Badge>
        )}
        {lead.stage === "CLOSED_LOST" && (
          <Badge variant="destructive" className="text-xs">
            Perda
          </Badge>
        )}
        {lead.estimatedValueCents != null && (
          <Badge variant="secondary" className="text-xs">
            {formatBRL(lead.estimatedValueCents)}
          </Badge>
        )}
        {overdue && (
          <Badge variant="destructive" className="text-xs">
            ação vencida
          </Badge>
        )}
      </div>

      <TempoNaFaseLinha tempo={lead.tempoNaFase} />

      {lead.stage === "CLOSED_LOST" && lead.lostReason && (
        <p className="mt-1 text-xs text-muted-foreground">
          Motivo: {lead.lostReason}
        </p>
      )}

      {lead.stage === "CLOSED_WON" ? (
        <div className="mt-2 space-y-1">
          {lead.companyId ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-xs"
                nativeButton={false}
                render={<Link href={`/empresarial/${lead.companyId}`} />}
              >
                Ver empresa
              </Button>
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                disabled={isPending}
                onClick={() => move("IMPLEMENTATION")}
              >
                Mover para Implantação
              </Button>
            </>
          ) : (
            // Ganho SEM empresa é beco sem saída: a implantação cadastra os
            // colaboradores, e não há onde cadastrá-los. Em vez de um cartão
            // sem nenhum botão, o caminho de volta fica à vista.
            <>
              <p className="text-xs text-muted-foreground">
                Ganho sem empresa criada.
              </p>
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await convertLeadToCompany(lead.id);
                    if (r.ok) {
                      toast.success("Empresa criada.");
                      router.refresh();
                    } else toast.error(r.error ?? "Erro.");
                  })
                }
              >
                Criar empresa
              </Button>
            </>
          )}
        </div>
      ) : (
        isOpenStage(lead.stage) && (
          <select
            aria-label="Fase do funil"
            className={`${selectClass} mt-2`}
            value={lead.stage}
            disabled={isPending}
            onChange={(e) => move(e.target.value)}
          >
            {/* Fechamento e Implantação NÃO entram aqui: fechar cria a empresa e
                é ato próprio, dentro de "Abrir". */}
            {ENTRY_STAGES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )
      )}
    </div>
  );
}

/**
 * Há quanto tempo a empresa está nesta fase.
 *
 * Os três estados são diferentes de propósito: medido, medido só a partir do
 * dia em que o relógio foi ligado, e **não medido**. Mostrar "0 dias" nos dois
 * últimos seria inventar medição — e o painel passaria a tratar lead antigo
 * como recém-chegado.
 */
function TempoNaFaseLinha({ tempo }: { tempo: TempoNaFase | null }) {
  if (!tempo) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Tempo na fase: sem registro
      </p>
    );
  }
  const alerta = tempo.dias >= 15;
  return (
    <p
      className={`mt-1 text-xs ${alerta ? "font-medium text-destructive" : "text-muted-foreground"}`}
    >
      Nesta fase há {rotuloDeDuracao(tempo.ms)}
      {tempo.desdeQueORelogioLigou && (
        <span className="text-muted-foreground"> (sem histórico anterior)</span>
      )}
    </p>
  );
}

function LeadDetailDialog({
  lead,
  consultants,
}: {
  lead: LeadView;
  consultants: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activityNote, setActivityNote] = useState("");
  const [activityKind, setActivityKind] = useState("NOTE");
  const [lostReason, setLostReason] = useState("");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateLead(lead.id, formData);
      if (r.ok) {
        toast.success("Lead atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
            Abrir
          </Button>
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead.companyName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <LeadFields lead={lead} consultants={consultants} showConsultant={false} />
          <Button type="submit" size="sm" disabled={isPending}>
            Salvar dados
          </Button>
        </form>

        {isOpenStage(lead.stage) && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Fechamento</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  run(
                    async () => convertLeadToCompany(lead.id),
                    "Fechado! Empresa criada."
                  )
                }
              >
                Fechar (ganho) → criar empresa
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Motivo da perda (obrigatório)"
                className="h-8 flex-1 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || !lostReason.trim()}
                onClick={() =>
                  run(
                    async () =>
                      moveLeadStage(lead.id, "CLOSED_LOST", lostReason),
                    "Lead marcado como perdido."
                  )
                }
              >
                Marcar perdido
              </Button>
            </div>
          </div>
        )}

        <TentativasDeContato lead={lead} />
        <ReunioesDoLead lead={lead} />

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Linha do tempo</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activityKind}
              onChange={(e) => setActivityKind(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="NOTE">Nota</option>
              <option value="CALL">Ligação</option>
              <option value="MEETING">Reunião</option>
              <option value="PROPOSAL">Proposta</option>
            </select>
            <Input
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              placeholder="Registrar contato/nota..."
              className="h-8 flex-1 text-xs"
            />
            <Button
              size="sm"
              disabled={isPending || !activityNote.trim()}
              onClick={() =>
                run(async () => {
                  const r = await addLeadActivity(
                    lead.id,
                    activityKind,
                    activityNote
                  );
                  if (r.ok) setActivityNote("");
                  return r;
                }, "Registrado.")
              }
            >
              Adicionar
            </Button>
          </div>
          {lead.activities.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem registros ainda.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
              {lead.activities.map((a) => (
                <li key={a.id} className="border-b pb-1 last:border-0">
                  <span className="font-medium">{a.kind}</span> — {a.note}
                  <span className="block text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}
                    {a.authorName ? ` · ${a.authorName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Fase 2 — toda tentativa de falar com a empresa.
 *
 * Canal e resultado são escolhidos numa lista, não escritos: é o que permite
 * contar depois quantas ligações foram precisas até marcar a reunião. A
 * anotação livre fica no campo de observação, ao lado.
 */
function TentativasDeContato({ lead }: { lead: LeadView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await registerContactAttempt(lead.id, formData);
      if (r.ok) {
        toast.success("Tentativa registrada.");
        form.reset();
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">
        Tentativas de contato ({lead.contactAttempts.length})
      </p>

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <select name="channel" className={`${selectClass} w-auto`} required>
          {CONTACT_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CONTACT_CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
        <select name="outcome" className={`${selectClass} w-auto`} required>
          {CONTACT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {CONTACT_OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
        <Input
          name="note"
          placeholder="Observação (opcional)"
          className="h-8 min-w-40 flex-1 text-xs"
        />
        <Button type="submit" size="sm" disabled={isPending}>
          Registrar
        </Button>
      </form>

      {lead.contactAttempts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma tentativa registrada ainda.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {lead.contactAttempts.map((a) => (
            <li key={a.id} className="border-b pb-1 last:border-0">
              <span className="font-medium">
                {CONTACT_CHANNEL_LABELS[a.channel]}
              </span>{" "}
              — {CONTACT_OUTCOME_LABELS[a.outcome]}
              {a.note ? ` · ${a.note}` : ""}
              <span className="block text-muted-foreground">
                {formatBrDate(a.attemptedAt)} {formatBrTime(a.attemptedAt)}
                {a.authorName ? ` · ${a.authorName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Fase 3 — as reuniões desta empresa.
 *
 * Marcar aqui move o cartão para "Reunião agendada" sozinho; quem faz isso é o
 * banco (migração 1008), então vale por qualquer caminho. O desfecho de cada
 * reunião é dado na Agenda do programa, que é onde elas aparecem todas juntas.
 */
function ReunioesDoLead({ lead }: { lead: LeadView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await scheduleMeeting(lead.id, formData);
      if (r.ok) {
        toast.success("Reunião marcada.");
        form.reset();
        setAberto(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Reuniões ({lead.meetings.length})</p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? "Fechar" : "Marcar reunião"}
        </Button>
      </div>

      {aberto && (
        <form onSubmit={onSubmit} className="space-y-2 rounded-md bg-muted/30 p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`starts_at-${lead.id}`} className="text-xs">
                Data e hora *
              </Label>
              <Input
                id={`starts_at-${lead.id}`}
                name="starts_at"
                type="datetime-local"
                className="h-8 text-xs"
                required
              />
            </div>
            <div>
              <Label htmlFor={`duration-${lead.id}`} className="text-xs">
                Duração (minutos)
              </Label>
              <Input
                id={`duration-${lead.id}`}
                name="duration"
                type="number"
                min={15}
                step={15}
                defaultValue={60}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label htmlFor={`mode-${lead.id}`} className="text-xs">
                Como
              </Label>
              <select
                id={`mode-${lead.id}`}
                name="mode"
                className={selectClass}
                defaultValue="ONLINE"
              >
                {MEETING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MEETING_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`location-${lead.id}`} className="text-xs">
                Link ou endereço
              </Label>
              <Input
                id={`location-${lead.id}`}
                name="location"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Input
            name="title"
            placeholder="Assunto (opcional)"
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" disabled={isPending}>
            Marcar
          </Button>
        </form>
      )}

      {lead.meetings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma reunião marcada ainda.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {lead.meetings.map((m) => (
            <li key={m.id} className="border-b pb-1 last:border-0">
              <span className="font-medium">
                {formatBrDate(m.startsAt)} {formatBrTime(m.startsAt)}
              </span>{" "}
              — {MEETING_STATUS_LABELS[m.status]} ·{" "}
              {MEETING_MODE_LABELS[m.mode]}
              {m.statusNote ? (
                <span className="block text-muted-foreground">
                  {m.statusNote}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        O desfecho de cada reunião é dado na{" "}
        <Link href="/empresarial/agenda" className="underline">
          Agenda do programa
        </Link>
        .
      </p>
    </div>
  );
}

function LeadFields({
  lead,
  consultants,
  showConsultant,
  showStage = false,
}: {
  lead?: LeadView;
  consultants: { id: string; label: string }[];
  showConsultant: boolean;
  /** Só no cadastro: em qual fase o lead entra (padrão, Captação). */
  showStage?: boolean;
}) {
  return (
    <div className="space-y-3">
      {showStage && (
        <div>
          <Label htmlFor="stage">Entra em qual fase do funil?</Label>
          <select
            id="stage"
            name="stage"
            defaultValue="CAPTURE"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {ENTRY_STAGES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Empresa que já está em negociação não precisa começar do zero. O
            fechamento e a implantação têm caminho próprio.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="company_name">Empresa *</Label>
          <Input id="company_name" name="company_name" required defaultValue={lead?.companyName ?? ""} />
        </div>
        <div>
          <Label htmlFor="cnpj">CNPJ</Label>
          <Input
            id="cnpj"
            name="cnpj"
            placeholder="00.000.000/0000-00"
            defaultValue={lead?.cnpj ? formatCnpj(lead.cnpj) : ""}
            onChange={(e) => (e.target.value = formatCnpj(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="contact_name">Contato</Label>
          <Input id="contact_name" name="contact_name" defaultValue={lead?.contactName ?? ""} />
        </div>
        <div>
          <Label htmlFor="contact_phone">Telefone</Label>
          <Input
            id="contact_phone"
            name="contact_phone"
            defaultValue={lead?.contactPhone ?? ""}
            onChange={(e) => (e.target.value = formatPhone(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="estimated_value">Valor estimado (R$)</Label>
          <Input
            id="estimated_value"
            name="estimated_value"
            defaultValue={
              lead?.estimatedValueCents != null
                ? (lead.estimatedValueCents / 100).toFixed(2).replace(".", ",")
                : ""
            }
          />
        </div>
        <div>
          <Label htmlFor="next_action_at">Próxima ação (data/hora)</Label>
          <Input
            id="next_action_at"
            name="next_action_at"
            type="datetime-local"
            defaultValue={
              // `toISOString()` mostrava a hora em UTC: o campo voltava 3h à
              // frente e, salvando sem tocar nele, o compromisso andava +3h a
              // cada edição. Ver `brazilInputValue` em @/lib/dates.
              lead?.nextActionAt ? brazilInputValue(lead.nextActionAt) : ""
            }
          />
        </div>
      </div>
      <div>
        <Label htmlFor="next_action_note">O que fazer na próxima ação</Label>
        <Input id="next_action_note" name="next_action_note" defaultValue={lead?.nextActionNote ?? ""} />
      </div>

      {/* De onde veio a empresa, e quem abre a porta para o primeiro contato. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="capture_channel">Canal da captação</Label>
          <select
            id="capture_channel"
            name="capture_channel"
            defaultValue={lead?.captureChannel ?? ""}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">— não informado —</option>
            {CAPTURE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CAPTURE_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="referral_name">Quem indicou</Label>
          <Input
            id="referral_name"
            name="referral_name"
            placeholder="Nome de quem fez a ponte"
            defaultValue={lead?.referralName ?? ""}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="referral_contact">Contato de quem indicou</Label>
          <Input
            id="referral_contact"
            name="referral_contact"
            placeholder="Telefone ou e-mail"
            defaultValue={lead?.referralContact ?? ""}
          />
        </div>
      </div>
      {showConsultant && consultants.length > 0 && (
        <div>
          <Label htmlFor="consultant_id">Consultor</Label>
          <select
            id="consultant_id"
            name="consultant_id"
            defaultValue={lead?.consultantId ?? ""}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">— eu / definir depois —</option>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor="notes">Observações</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={lead?.notes ?? ""}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

function LeadFormDialog({
  consultants,
  canManage,
}: {
  consultants: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createLead(formData);
      if (r.ok) {
        toast.success("Lead criado.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="mr-1 size-4" />
            Novo lead
          </Button>
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo lead de empresa</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <LeadFields
            consultants={consultants}
            showConsultant={canManage}
            showStage
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Criar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
