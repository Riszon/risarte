"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  Building2,
  ChevronRight,
  MessageCircle,
  MoreVertical,
  PhoneCall,
  Play,
  Presentation,
  ThumbsDown,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/pricing";
import { whatsappLink } from "@/lib/whatsapp";
import {
  BOARD_COLUMNS,
  COMMERCIAL_COLUMN_COLORS,
  COMMERCIAL_COLUMN_LABELS,
  FOLLOWUP_CHANNELS,
  FOLLOWUP_CHANNEL_LABELS,
  FOLLOWUP_OUTCOMES,
  FOLLOWUP_OUTCOME_LABELS,
  type BoardColumn,
  type CommercialColumn,
} from "@/lib/commercial";
import {
  logFollowupAttempt,
  setCardStage,
  startFollowup,
  transferFollowup,
} from "./actions";

export type BoardCard = {
  clientId: string;
  fullName: string;
  code: string | null;
  phone: string | null;
  clinicName: string | null;
  column: CommercialColumn;
  finalCents: number | null;
  followupAttempts: number;
  nextAttemptAt: string | null;
  followupByClinic: boolean;
  presentingSince: string | null;
  outcomeReason: string | null;
  outcomeAt: string | null;
  outcomeByName: string | null;
};

/** Como o usuário enxerga o funil: comercial (age) × unidade (visualiza). */
export type ViewerKind = "commercial" | "unit";

export function CommercialKanban({
  cards,
  lost,
  cancelled,
  viewer,
}: {
  cards: BoardCard[];
  lost: BoardCard[];
  cancelled: BoardCard[];
  viewer: ViewerKind;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [reasonFor, setReasonFor] = useState<{
    card: BoardCard;
    stage: "perdido" | "cancelado";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [followupFor, setFollowupFor] = useState<BoardCard | null>(null);
  const [channel, setChannel] = useState("whatsapp");
  const [outcome, setOutcome] = useState("sem_resposta");
  const [notes, setNotes] = useState("");
  const [outcomeList, setOutcomeList] = useState<null | "perdido" | "cancelado">(
    null
  );

  function move(card: BoardCard, stage: Parameters<typeof setCardStage>[1]) {
    startTransition(async () => {
      const r = await setCardStage(card.clientId, stage);
      if (r.ok) {
        toast.success("Cartão atualizado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function confirmReason() {
    if (!reasonFor || !reason.trim()) return;
    startTransition(async () => {
      const r = await setCardStage(reasonFor.card.clientId, reasonFor.stage, reason);
      if (r.ok) {
        toast.success(
          reasonFor.stage === "perdido" ? "Marcado como perdido." : "Marcado como cancelado."
        );
        setReasonFor(null);
        setReason("");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function openFollowup(card: BoardCard) {
    setFollowupFor(card);
    setChannel("whatsapp");
    setOutcome("sem_resposta");
    setNotes("");
  }

  function beginFollowup(card: BoardCard) {
    startTransition(async () => {
      const r = await startFollowup(card.clientId);
      if (r.ok) {
        toast.success("Follow-up iniciado.");
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function toggleClinic(card: BoardCard, toClinic: boolean) {
    startTransition(async () => {
      const r = await transferFollowup(card.clientId, toClinic);
      if (r.ok) {
        toast.success(
          toClinic
            ? "Follow-up liberado para a clínica."
            : "Follow-up de volta ao Consultor."
        );
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  function saveAttempt() {
    if (!followupFor) return;
    startTransition(async () => {
      const r = await logFollowupAttempt(followupFor.clientId, { channel, outcome, notes });
      if (r.ok) {
        if (r.escalated)
          toast.warning(
            "Tentativas esgotadas — follow-up liberado para a clínica (reforço)."
          );
        else toast.success("Tentativa registrada.");
        setFollowupFor(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  const outcomeItems = outcomeList === "perdido" ? lost : cancelled;

  return (
    <>
      {/* Botões de detalhe: Perdidos e Cancelados (fora do board). */}
      <div className="mb-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOutcomeList("perdido")}
        >
          <ThumbsDown className="mr-1 size-3.5 text-rose-600" />
          Perdidos
          <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
            {lost.length}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOutcomeList("cancelado")}
        >
          <Ban className="mr-1 size-3.5 text-muted-foreground" />
          Cancelados
          <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
            {cancelled.length}
          </span>
        </Button>
      </div>

      <div className="flex h-full min-w-max gap-3">
        {BOARD_COLUMNS.map((col: BoardColumn) => {
          const colCards = cards.filter((c) => c.column === col);
          const color = COMMERCIAL_COLUMN_COLORS[col];
          return (
            <div
              key={col}
              className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40"
            >
              <div className="h-1 w-full shrink-0" style={{ backgroundColor: color }} />
              <div className="flex items-center justify-between gap-2 border-b bg-background/50 px-3 py-2.5">
                <h2 className="truncate text-sm font-semibold">
                  {COMMERCIAL_COLUMN_LABELS[col]}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {colCards.length}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {colCards.map((card) => (
                  <BoardCardView
                    key={card.clientId}
                    card={card}
                    viewer={viewer}
                    isPending={isPending}
                    onMove={move}
                    onLose={(c) => {
                      setReasonFor({ card: c, stage: "perdido" });
                      setReason("");
                    }}
                    onCancel={(c) => {
                      setReasonFor({ card: c, stage: "cancelado" });
                      setReason("");
                    }}
                    onStartFollowup={beginFollowup}
                    onLogFollowup={openFollowup}
                    onToggleClinic={toggleClinic}
                  />
                ))}
                {colCards.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Motivo de perda/cancelamento (obrigatório). */}
      <Dialog open={reasonFor !== null} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonFor?.stage === "perdido"
                ? "Marcar como perdido"
                : "Marcar como cancelado"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Informe o motivo — fica registrado no funil comercial.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente decidiu tratar em outro lugar; sem retorno após várias tentativas..."
            className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReasonFor(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending || !reason.trim()} onClick={confirmReason}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registro de tentativa de follow-up. */}
      <Dialog open={followupFor !== null} onOpenChange={(o) => !o && setFollowupFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar tentativa de follow-up</DialogTitle>
          </DialogHeader>
          {followupFor && (
            <p className="text-sm text-muted-foreground">
              {followupFor.fullName} — tentativa nº {followupFor.followupAttempts + 1}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Canal</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {FOLLOWUP_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {FOLLOWUP_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Resultado</span>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {FOLLOWUP_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {FOLLOWUP_OUTCOME_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Observações (opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="O que foi conversado, próximo passo combinado..."
              className="mt-1 min-h-20 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
            />
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFollowupFor(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending} onClick={saveAttempt}>
              Registrar tentativa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lista de Perdidos / Cancelados com detalhes. */}
      <Dialog open={outcomeList !== null} onOpenChange={(o) => !o && setOutcomeList(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {outcomeList === "perdido" ? "Clientes perdidos" : "Clientes cancelados"}
            </DialogTitle>
          </DialogHeader>
          {outcomeItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum por aqui.</p>
          ) : (
            <ul className="space-y-2">
              {outcomeItems.map((c) => (
                <li key={c.clientId} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/prontuarios/${c.clientId}`}
                      className="font-medium hover:underline"
                    >
                      {c.fullName}
                    </Link>
                    {c.clinicName && (
                      <span className="text-[11px] text-muted-foreground">
                        {c.clinicName}
                      </span>
                    )}
                  </div>
                  {c.outcomeReason && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.outcomeReason}
                    </p>
                  )}
                  {(c.outcomeAt || c.outcomeByName) && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {c.outcomeAt
                        ? new Date(c.outcomeAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                      {c.outcomeByName ? ` · por ${c.outcomeByName}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Cronômetro ao vivo do tempo na etapa (Acontecendo agora). */
function ElapsedTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const label =
    (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) +
    ":" +
    String(s).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-violet-800">
      <Timer className="size-3" />
      {label}
    </span>
  );
}

function BoardCardView({
  card,
  viewer,
  isPending,
  onMove,
  onLose,
  onCancel,
  onStartFollowup,
  onLogFollowup,
  onToggleClinic,
}: {
  card: BoardCard;
  viewer: ViewerKind;
  isPending: boolean;
  onMove: (card: BoardCard, stage: Parameters<typeof setCardStage>[1]) => void;
  onLose: (card: BoardCard) => void;
  onCancel: (card: BoardCard) => void;
  onStartFollowup: (card: BoardCard) => void;
  onLogFollowup: (card: BoardCard) => void;
  onToggleClinic: (card: BoardCard, toClinic: boolean) => void;
}) {
  const isCommercial = viewer === "commercial";
  const wa = whatsappLink(
    card.phone,
    "Olá, {nome}! Aqui é da Risarte Odontologia, sobre o seu plano de tratamento. 😁",
    card.fullName
  );
  const inFollowup = card.column === "follow_up";
  // A unidade só age (registrar tentativa) quando o cliente foi liberado.
  const unitCanFollowup = !isCommercial && inFollowup && card.followupByClinic;
  // Link do nome: comercial vai ao cockpit; unidade vai à ficha.
  const href = isCommercial ? `/comercial/${card.clientId}` : `/prontuarios/${card.clientId}`;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-1">
        <Link href={href} className="block min-w-0 text-sm font-medium hover:underline">
          {card.fullName}
        </Link>
        {isCommercial && (
          <CardMenu
            card={card}
            isPending={isPending}
            onMove={onMove}
            onLose={onLose}
            onCancel={onCancel}
            onStartFollowup={onStartFollowup}
            onLogFollowup={onLogFollowup}
            onToggleClinic={onToggleClinic}
          />
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
        {card.code && <span className="font-mono">{card.code}</span>}
        {card.clinicName && <span>{card.clinicName}</span>}
      </p>

      {card.column === "acontecendo_agora" && card.presentingSince && (
        <div className="mt-1">
          <ElapsedTimer since={card.presentingSince} />
        </div>
      )}

      {card.finalCents != null && card.finalCents > 0 && (
        <p className="mt-1 text-xs font-medium tabular-nums">{formatBRL(card.finalCents)}</p>
      )}

      {inFollowup && (
        <div className="mt-1 space-y-0.5">
          {card.followupByClinic && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
              <Building2 className="size-3" />
              Conduzido pela clínica
            </span>
          )}
          <p className="text-[11px] text-amber-700">
            {card.followupAttempts} tentativa(s)
            {card.nextAttemptAt
              ? ` · próxima ${new Date(card.nextAttemptAt).toLocaleDateString("pt-BR")}`
              : ""}
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-3" />
            WhatsApp
          </a>
        )}
        {isCommercial && (
          <Link
            href={`/comercial/${card.clientId}`}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
          >
            Cockpit
            <ChevronRight className="size-3" />
          </Link>
        )}
        {(unitCanFollowup || (isCommercial && inFollowup)) && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onLogFollowup(card)}
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted"
          >
            <PhoneCall className="size-3" />
            Registrar
          </button>
        )}
      </div>
    </div>
  );
}

function CardMenu({
  card,
  isPending,
  onMove,
  onLose,
  onCancel,
  onStartFollowup,
  onLogFollowup,
  onToggleClinic,
}: {
  card: BoardCard;
  isPending: boolean;
  onMove: (card: BoardCard, stage: Parameters<typeof setCardStage>[1]) => void;
  onLose: (card: BoardCard) => void;
  onCancel: (card: BoardCard) => void;
  onStartFollowup: (card: BoardCard) => void;
  onLogFollowup: (card: BoardCard) => void;
  onToggleClinic: (card: BoardCard, toClinic: boolean) => void;
}) {
  // Fechamento e Fase 5 são derivados — o menu só age nas etapas do funil 4.
  const derived =
    card.column === "fechamento" ||
    card.column === "aguardando_iniciar" ||
    card.column === "tratamento_iniciado";
  if (derived) return null;

  const inFollowup = card.column === "follow_up";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            disabled={isPending}
            aria-label="Ações do cartão"
          >
            <MoreVertical className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mover no funil</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {card.column !== "acontecendo_agora" && (
            <DropdownMenuItem onClick={() => onMove(card, "acontecendo_agora")}>
              <Play className="mr-2 size-3.5" />
              Iniciar apresentação
            </DropdownMenuItem>
          )}
          {card.column !== "apresentado" && (
            <DropdownMenuItem onClick={() => onMove(card, "apresentado")}>
              <Presentation className="mr-2 size-3.5" />
              Marcar como apresentado
            </DropdownMenuItem>
          )}
          {!inFollowup ? (
            <DropdownMenuItem onClick={() => onStartFollowup(card)}>
              <PhoneCall className="mr-2 size-3.5" />
              Iniciar follow-up
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => onLogFollowup(card)}>
                <PhoneCall className="mr-2 size-3.5" />
                Registrar tentativa
              </DropdownMenuItem>
              {card.followupByClinic ? (
                <DropdownMenuItem onClick={() => onToggleClinic(card, false)}>
                  <Building2 className="mr-2 size-3.5" />
                  Retomar do Consultor
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onToggleClinic(card, true)}>
                  <Building2 className="mr-2 size-3.5" />
                  Liberar p/ a clínica
                </DropdownMenuItem>
              )}
            </>
          )}
          {card.column !== "a_apresentar" && (
            <DropdownMenuItem onClick={() => onMove(card, "a_apresentar")}>
              <ChevronRight className="mr-2 size-3.5" />
              Voltar para &quot;A apresentar&quot;
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onLose(card)}>
            <ThumbsDown className="mr-2 size-3.5 text-rose-600" />
            Marcar como perdido
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCancel(card)}>
            <Ban className="mr-2 size-3.5 text-muted-foreground" />
            Cancelar
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
