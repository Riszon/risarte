"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  ChevronRight,
  MessageCircle,
  MoreVertical,
  PhoneCall,
  Play,
  Presentation,
  ThumbsDown,
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
  COMMERCIAL_COLUMNS,
  COMMERCIAL_COLUMN_COLORS,
  COMMERCIAL_COLUMN_LABELS,
  FOLLOWUP_CHANNELS,
  FOLLOWUP_CHANNEL_LABELS,
  FOLLOWUP_OUTCOMES,
  FOLLOWUP_OUTCOME_LABELS,
  type CommercialColumn,
} from "@/lib/commercial";
import { logFollowupAttempt, setCardStage, startFollowup } from "./actions";

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
  outcomeReason: string | null;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export function CommercialKanban({
  cards,
  canManage,
}: {
  cards: BoardCard[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Diálogos (motivo de perda/cancelamento + registro de follow-up).
  const [reasonFor, setReasonFor] = useState<{
    card: BoardCard;
    stage: "perdido" | "cancelado";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [followupFor, setFollowupFor] = useState<BoardCard | null>(null);
  const [channel, setChannel] = useState("whatsapp");
  const [outcome, setOutcome] = useState("sem_resposta");
  const [notes, setNotes] = useState("");

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
      const r = await setCardStage(
        reasonFor.card.clientId,
        reasonFor.stage,
        reason
      );
      if (r.ok) {
        toast.success(
          reasonFor.stage === "perdido"
            ? "Cliente marcado como perdido."
            : "Cliente marcado como cancelado."
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

  function saveAttempt() {
    if (!followupFor) return;
    startTransition(async () => {
      const r = await logFollowupAttempt(followupFor.clientId, {
        channel,
        outcome,
        notes,
      });
      if (r.ok) {
        if (r.escalated)
          toast.warning(
            "Tentativas esgotadas — cliente encaminhado à Gerente (follow-up na clínica)."
          );
        else toast.success("Tentativa registrada.");
        setFollowupFor(null);
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }

  return (
    <>
      <div className="flex h-full min-w-max gap-3">
        {COMMERCIAL_COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.column === col);
          const color = COMMERCIAL_COLUMN_COLORS[col];
          return (
            <div
              key={col}
              className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40"
            >
              <div
                className="h-1 w-full shrink-0"
                style={{ backgroundColor: color }}
              />
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
                    canManage={canManage}
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
                  />
                ))}
                {colCards.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                    —
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Motivo de perda/cancelamento (obrigatório). */}
      <Dialog
        open={reasonFor !== null}
        onOpenChange={(o) => !o && setReasonFor(null)}
      >
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
            <Button
              disabled={isPending || !reason.trim()}
              onClick={confirmReason}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registro de tentativa de follow-up. */}
      <Dialog
        open={followupFor !== null}
        onOpenChange={(o) => !o && setFollowupFor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar tentativa de follow-up</DialogTitle>
          </DialogHeader>
          {followupFor && (
            <p className="text-sm text-muted-foreground">
              {followupFor.fullName} — tentativa nº{" "}
              {followupFor.followupAttempts + 1}. Ao esgotar as tentativas ou o
              prazo, o cliente é encaminhado à Gerente.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">Canal</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className={selectClass}
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
                className={selectClass}
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
            <span className="text-xs text-muted-foreground">
              Observações (opcional)
            </span>
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
    </>
  );
}

function BoardCardView({
  card,
  canManage,
  isPending,
  onMove,
  onLose,
  onCancel,
  onStartFollowup,
  onLogFollowup,
}: {
  card: BoardCard;
  canManage: boolean;
  isPending: boolean;
  onMove: (card: BoardCard, stage: Parameters<typeof setCardStage>[1]) => void;
  onLose: (card: BoardCard) => void;
  onCancel: (card: BoardCard) => void;
  onStartFollowup: (card: BoardCard) => void;
  onLogFollowup: (card: BoardCard) => void;
}) {
  const wa = whatsappLink(
    card.phone,
    "Olá, {nome}! Aqui é da Risarte Odontologia, sobre o seu plano de tratamento. 😁",
    card.fullName
  );
  const inFollowup =
    card.column === "follow_up" || card.column === "follow_up_clinica";

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-1">
        <Link
          href={`/comercial/${card.clientId}`}
          className="block min-w-0 text-sm font-medium hover:underline"
        >
          {card.fullName}
        </Link>
        {canManage && (
          <CardMenu
            card={card}
            isPending={isPending}
            onMove={onMove}
            onLose={onLose}
            onCancel={onCancel}
            onStartFollowup={onStartFollowup}
            onLogFollowup={onLogFollowup}
          />
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
        {card.code && <span className="font-mono">{card.code}</span>}
        {card.clinicName && <span>{card.clinicName}</span>}
      </p>
      {card.finalCents != null && card.finalCents > 0 && (
        <p className="mt-1 text-xs font-medium tabular-nums">
          {formatBRL(card.finalCents)}
        </p>
      )}
      {inFollowup && (
        <p className="mt-1 text-[11px] text-amber-700">
          {card.followupAttempts} tentativa(s)
          {card.nextAttemptAt && card.column === "follow_up"
            ? ` · próxima em ${new Date(card.nextAttemptAt).toLocaleDateString("pt-BR")}`
            : ""}
        </p>
      )}
      {(card.column === "perdido" || card.column === "cancelado") &&
        card.outcomeReason && (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
            {card.outcomeReason}
          </p>
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
        <Link
          href={`/comercial/${card.clientId}`}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          Cockpit
          <ChevronRight className="size-3" />
        </Link>
        {canManage && inFollowup && (
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
}: {
  card: BoardCard;
  isPending: boolean;
  onMove: (card: BoardCard, stage: Parameters<typeof setCardStage>[1]) => void;
  onLose: (card: BoardCard) => void;
  onCancel: (card: BoardCard) => void;
  onStartFollowup: (card: BoardCard) => void;
  onLogFollowup: (card: BoardCard) => void;
}) {
  // As colunas de fechamento e Fase 5 são derivadas — o menu só age no funil 4.
  const derived =
    card.column === "fechamento" ||
    card.column === "aguardando_iniciar" ||
    card.column === "tratamento_iniciado";
  if (derived) return null;

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
      <DropdownMenuContent align="end" className="w-52">
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
          {card.column !== "follow_up" && card.column !== "follow_up_clinica" ? (
            <DropdownMenuItem onClick={() => onStartFollowup(card)}>
              <PhoneCall className="mr-2 size-3.5" />
              Iniciar follow-up
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onLogFollowup(card)}>
              <PhoneCall className="mr-2 size-3.5" />
              Registrar tentativa
            </DropdownMenuItem>
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
