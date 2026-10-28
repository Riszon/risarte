"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, CalendarX2, Link2, Pencil, Plus, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORTHO_KIND_LABELS, ORTHO_KINDS, type OrthoKind, type OrthoMaintenanceStatus, type OrthoStatus } from "@/lib/ortodontia/constants";
import type { ProcedureOption, StaffOption } from "@/lib/ortodontia/db";
import {
  addOrthoMaintenance,
  linkOrthoAppointment,
  markOrthoMaintenance,
  saveOrthoEvolution,
  setOrthoStatus,
  updateOrthoCase,
} from "../../actions";

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";
const textareaClass = "w-full rounded-lg border border-input bg-transparent p-2 text-sm";

// ---------------------------------------------------------------------------
// Situação do caso: iniciar, contenção, finalizar, interromper, reabrir
// ---------------------------------------------------------------------------
export function CaseStatusActions({ caseId, status, today }: { caseId: string; status: OrthoStatus; today: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<null | "em_tratamento" | "contencao" | "finalizado" | "interrompido">(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);

  const TITULO = {
    em_tratamento: status === "aguardando_inicio" ? "Iniciar o tratamento" : "Reabrir o caso",
    contencao: "Passar para contenção",
    finalizado: "Finalizar o tratamento",
    interrompido: "Interromper o tratamento",
  } as const;
  const AJUDA = {
    em_tratamento:
      status === "aguardando_inicio"
        ? "O aparelho foi instalado. O cronograma de manutenções é gerado a partir desta data e a mensalidade passa a ser cobrada."
        : "O caso volta a 'em tratamento' e o cronograma é completado.",
    contencao: "O tratamento ativo terminou; o paciente segue em acompanhamento. A mensalidade dos meses seguintes é cancelada.",
    finalizado: "Encerra o caso. As manutenções previstas e as mensalidades dos meses seguintes são canceladas.",
    interrompido: "Desistência, transferência ou abandono. Escreva o motivo — ele fica no histórico.",
  } as const;

  function confirm() {
    if (!open) return;
    startTransition(async () => {
      const r = await setOrthoStatus(caseId, open, reason, date);
      if (!r.ok) toast.error(r.error ?? "Não foi possível mudar a situação.");
      else {
        toast.success("Situação atualizada.");
        setOpen(null);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {status === "aguardando_inicio" && <Button size="sm" onClick={() => setOpen("em_tratamento")}>Iniciar tratamento</Button>}
      {status === "em_tratamento" && (
        <>
          <Button size="sm" variant="outline" onClick={() => setOpen("contencao")}>Contenção</Button>
          <Button size="sm" onClick={() => setOpen("finalizado")}>Finalizar</Button>
        </>
      )}
      {status === "contencao" && (
        <>
          <Button size="sm" variant="outline" onClick={() => setOpen("em_tratamento")}>Voltar a tratamento</Button>
          <Button size="sm" onClick={() => setOpen("finalizado")}>Finalizar</Button>
        </>
      )}
      {(status === "aguardando_inicio" || status === "em_tratamento" || status === "contencao") && (
        <Button size="sm" variant="ghost" onClick={() => setOpen("interrompido")}>Interromper</Button>
      )}
      {(status === "finalizado" || status === "interrompido") && (
        <Button size="sm" variant="outline" onClick={() => setOpen("em_tratamento")}>Reabrir</Button>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{open ? TITULO[open] : ""}</DialogTitle>
            <DialogDescription>{open ? AJUDA[open] : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="status-date">Data</Label>
              <Input id="status-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="status-reason">{open === "interrompido" ? "Motivo (obrigatório)" : "Observação"}</Label>
              <textarea id="status-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={isPending}>Voltar</Button>
            <Button onClick={confirm} disabled={isPending || (open === "interrompido" && reason.trim().length < 3)} variant={open === "interrompido" ? "destructive" : "default"}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editar o caso
// ---------------------------------------------------------------------------
export function EditCaseDialog({
  caseId,
  initial,
  orthodontists,
  procedures,
}: {
  caseId: string;
  initial: {
    orthodontistId: string | null;
    kind: OrthoKind;
    startDate: string | null;
    plannedMonths: number;
    intervalDays: number;
    monthlyCents: number;
    billingDay: number;
    installationCents: number;
    procedureId: string | null;
    nextReevaluationDate: string | null;
    notes: string | null;
  };
  orthodontists: StaffOption[];
  procedures: ProcedureOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateOrthoCase(caseId, fd);
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success("Caso atualizado.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="mr-1 size-3.5" /> Editar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar o caso</DialogTitle>
            <DialogDescription>Mudar início, meses ou intervalo refaz as manutenções previstas futuras sem agendamento; o que já aconteceu fica.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="e-orthodontist">Ortodontista</Label>
              <select id="e-orthodontist" name="orthodontist_id" defaultValue={initial.orthodontistId ?? ""} className={selectClass}>
                <option value="">— a definir —</option>
                {orthodontists.map((o) => (
                  <option key={o.userId} value={o.userId}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-kind">Tipo</Label>
              <select id="e-kind" name="treatment_kind" defaultValue={initial.kind} className={selectClass}>
                {ORTHO_KINDS.map((k) => (
                  <option key={k} value={k}>{ORTHO_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-start">Início</Label>
              <Input id="e-start" name="start_date" type="date" defaultValue={initial.startDate ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-months">Meses previstos</Label>
              <Input id="e-months" name="planned_months" type="number" min={1} max={120} defaultValue={initial.plannedMonths} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-interval">Manutenção a cada (dias)</Label>
              <Input id="e-interval" name="maintenance_interval_days" type="number" min={7} max={180} defaultValue={initial.intervalDays} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-reeval">Próxima reavaliação</Label>
              <Input id="e-reeval" name="next_reevaluation_date" type="date" defaultValue={initial.nextReevaluationDate ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-fee">Mensalidade (R$)</Label>
              <Input id="e-fee" name="monthly_fee" inputMode="decimal" defaultValue={brl(initial.monthlyCents)} />
              <p className="text-[11px] text-muted-foreground">Vale para as mensalidades geradas daqui em diante.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-billing">Dia de vencimento</Label>
              <Input id="e-billing" name="billing_day" type="number" min={1} max={28} defaultValue={initial.billingDay} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-inst">Instalação (R$, informativo)</Label>
              <Input id="e-inst" name="installation_fee" inputMode="decimal" defaultValue={brl(initial.installationCents)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-proc">Procedimento da manutenção (repasse)</Label>
              <select id="e-proc" name="maintenance_procedure_id" defaultValue={initial.procedureId ?? ""} className={selectClass}>
                <option value="">— o da configuração —</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="e-notes">Observações</Label>
              <textarea id="e-notes" name="notes" rows={3} defaultValue={initial.notes ?? ""} className={textareaClass} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Evolução da manutenção (e marcar como realizada)
// ---------------------------------------------------------------------------
export function EvolutionDialog({
  maintenanceId,
  seq,
  done,
  canUndo,
  initial,
}: {
  maintenanceId: string;
  seq: number;
  done: boolean;
  canUndo: boolean;
  initial: { archWire: string; notes: string; nextSteps: string; doneAt: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [archWire, setArchWire] = useState(initial.archWire);
  const [notes, setNotes] = useState(initial.notes);
  const [nextSteps, setNextSteps] = useState(initial.nextSteps);
  const [markDone, setMarkDone] = useState(true);
  const [doneAt, setDoneAt] = useState(() => {
    const d = initial.doneAt ? new Date(initial.doneAt) : new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  function save(undo = false) {
    startTransition(async () => {
      const r = await saveOrthoEvolution(maintenanceId, {
        done: undo ? false : done || markDone,
        doneAt: !done && markDone && !undo ? new Date(doneAt).toISOString() : null,
        archWire,
        notes,
        nextSteps,
      });
      if (!r.ok) toast.error(r.error ?? "Não foi possível salvar.");
      else {
        toast.success(undo ? "Manutenção desfeita." : done ? "Evolução salva." : markDone ? "Manutenção realizada e evolução salva." : "Evolução salva.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant={done ? "ghost" : "outline"} onClick={() => setOpen(true)} title={done ? "Ver/editar a evolução" : "Registrar a manutenção"}>
        <Stethoscope className="mr-1 size-3.5" /> {done ? "Evolução" : "Registrar"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manutenção {seq} — evolução</DialogTitle>
            <DialogDescription>O que foi feito, o fio/arco em uso e o próximo passo. Fica no histórico do caso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!done && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} className="size-4" />
                Marcar como <strong>realizada</strong> (gera o repasse do ortodontista)
              </label>
            )}
            {!done && markDone && (
              <div className="space-y-1">
                <Label htmlFor="ev-done-at">Realizada em</Label>
                <Input id="ev-done-at" type="datetime-local" value={doneAt} onChange={(e) => setDoneAt(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ev-wire">Fio / arco / alinhador</Label>
              <Input id="ev-wire" value={archWire} onChange={(e) => setArchWire(e.target.value)} placeholder="Ex.: NiTi 0.016 superior · alinhador 12/40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-notes">Observações</Label>
              <textarea id="ev-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass} placeholder="Troca de fio, elásticos, colagem, higiene…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-next">Próximo passo</Label>
              <Input id="ev-next" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder="Ex.: trocar para aço 0.018 na próxima" />
            </div>
          </div>
          <DialogFooter className="flex-wrap">
            {done && canUndo && (
              <Button variant="ghost" onClick={() => save(true)} disabled={isPending} className="mr-auto text-rose-700">Desfazer realizada</Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancelar</Button>
            <Button onClick={() => save(false)} disabled={isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Falta, cancelar, voltar a prevista e vincular agendamento
// ---------------------------------------------------------------------------
export function MaintenanceRowActions({
  maintenanceId,
  status,
  linkable,
}: {
  maintenanceId: string;
  status: OrthoMaintenanceStatus;
  linkable: { id: string; starts_at: string; type: string; status: string; provider: string | null }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [linkOpen, setLinkOpen] = useState(false);
  const [apptId, setApptId] = useState("");

  function mark(s: "faltou" | "cancelada" | "prevista") {
    startTransition(async () => {
      const r = await markOrthoMaintenance(maintenanceId, s);
      if (!r.ok) toast.error(r.error ?? "Não foi possível atualizar.");
      else {
        toast.success("Manutenção atualizada.");
        router.refresh();
      }
    });
  }
  function link() {
    if (!apptId) return;
    startTransition(async () => {
      const r = await linkOrthoAppointment(maintenanceId, apptId);
      if (!r.ok) toast.error(r.error ?? "Não foi possível vincular.");
      else {
        toast.success("Agendamento vinculado.");
        setLinkOpen(false);
        router.refresh();
      }
    });
  }
  if (status === "realizada") return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {(status === "agendada" || status === "prevista") && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => mark("faltou")} title="Marcar falta">
          <CalendarX2 className="size-3.5" />
        </Button>
      )}
      {status === "faltou" && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => mark("prevista")} title="Voltar a prevista (reagendar)">
          Reagendar
        </Button>
      )}
      {status !== "cancelada" && linkable.length > 0 && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setLinkOpen(true)} title="Vincular um agendamento do paciente">
          <Link2 className="size-3.5" />
        </Button>
      )}
      {status === "prevista" && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => mark("cancelada")} title="Cancelar esta manutenção">
          <Ban className="size-3.5" />
        </Button>
      )}
      {status === "cancelada" && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => mark("prevista")} title="Restaurar">
          Restaurar
        </Button>
      )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Vincular agendamento</DialogTitle>
            <DialogDescription>Agendamentos do paciente ainda não ligados a uma manutenção. Normalmente a agenda liga sozinha (quando o profissional é o ortodontista do caso).</DialogDescription>
          </DialogHeader>
          <select value={apptId} onChange={(e) => setApptId(e.target.value)} className={selectClass}>
            <option value="">Escolha</option>
            {linkable.map((a) => (
              <option key={a.id} value={a.id}>{fmt(a.starts_at)} · {a.type}{a.provider ? ` · ${a.provider}` : ""} ({a.status})</option>
            ))}
          </select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)} disabled={isPending}>Voltar</Button>
            <Button onClick={link} disabled={isPending || !apptId}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Manutenção extra
// ---------------------------------------------------------------------------
export function AddMaintenance({ caseId, today }: { caseId: string; today: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(today);
  function add() {
    startTransition(async () => {
      const r = await addOrthoMaintenance(caseId, date);
      if (!r.ok) toast.error(r.error ?? "Não foi possível acrescentar.");
      else {
        toast.success("Manutenção extra acrescentada.");
        router.refresh();
      }
    });
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-36" aria-label="Data da manutenção extra" />
      <Button size="sm" variant="outline" disabled={isPending} onClick={add}>
        <Plus className="mr-1 size-3.5" /> Manutenção extra
      </Button>
    </div>
  );
}
