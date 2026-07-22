"use client";

import { CalendarDays, FileText, Layers, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type ProgressHistory = {
  id: string;
  body: string;
  authorName: string | null;
  clinicName: string | null;
  createdAt: string;
};
export type ApptHistory = {
  id: string;
  startsAt: string;
  typeLabel: string;
  statusLabel: string;
  statusKind: "done" | "future" | "cancelled" | "other";
  providerName: string | null;
};
export type PlanHistory = {
  id: string;
  label: string;
  stageLabel: string;
  createdAt: string;
  optionTitle: string | null;
  itemCount: number;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

/**
 * Bloco F do cockpit — histórico completo do cliente em pop-ups, para o
 * Coordenador consultar durante a avaliação/reavaliação sem sair da tela:
 * desenvolvimento clínico (anotações do dentista), atendimentos e planos.
 */
export function HistoryDialogs({
  progress,
  appointments,
  plans,
}: {
  progress: ProgressHistory[];
  appointments: ApptHistory[];
  plans: PlanHistory[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        Histórico:
      </span>

      {/* Desenvolvimento clínico. */}
      <Dialog>
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <NotebookPen className="mr-1 size-3.5" />
              Desenvolvimento clínico
              <Count n={progress.length} />
            </Button>
          }
        />
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Desenvolvimento clínico</DialogTitle>
            <DialogDescription>
              Anotações de evolução do tratamento feitas pelos dentistas.
            </DialogDescription>
          </DialogHeader>
          {progress.length === 0 ? (
            <Empty text="Nenhuma anotação de desenvolvimento clínico ainda." />
          ) : (
            <ul className="space-y-2">
              {progress.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {p.authorName ?? "Profissional"}
                    </span>
                    {p.clinicName && <span>· {p.clinicName}</span>}
                    <span>· {fmtDateTime(p.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{p.body}</p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Atendimentos. */}
      <Dialog>
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <CalendarDays className="mr-1 size-3.5" />
              Atendimentos
              <Count n={appointments.length} />
            </Button>
          }
        />
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de atendimentos</DialogTitle>
            <DialogDescription>
              Todos os agendamentos do cliente (mais recentes primeiro).
            </DialogDescription>
          </DialogHeader>
          {appointments.length === 0 ? (
            <Empty text="Nenhum atendimento registrado." />
          ) : (
            <ul className="space-y-1.5">
              {appointments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{a.typeLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(a.startsAt)}
                      {a.providerName ? ` · ${a.providerName}` : ""}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      a.statusKind === "done"
                        ? "border-emerald-300 text-emerald-700"
                        : a.statusKind === "future"
                          ? "border-primary/40 text-primary"
                          : a.statusKind === "cancelled"
                            ? "border-rose-300 text-rose-700"
                            : ""
                    }
                  >
                    {a.statusLabel}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Planos. */}
      <Dialog>
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <Layers className="mr-1 size-3.5" />
              Planos
              <Count n={plans.length} />
            </Button>
          }
        />
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Planos de tratamento</DialogTitle>
            <DialogDescription>
              Todos os planos do cliente e a situação de cada um.
            </DialogDescription>
          </DialogHeader>
          {plans.length === 0 ? (
            <Empty text="Nenhum plano de tratamento registrado." />
          ) : (
            <ul className="space-y-2">
              {plans.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileText className="size-3.5 text-muted-foreground" />
                      {p.label}
                    </span>
                    <Badge variant="secondary">{p.stageLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.optionTitle ? `${p.optionTitle} · ` : ""}
                    {p.itemCount} procedimento(s) · criado em{" "}
                    {fmtDate(p.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
