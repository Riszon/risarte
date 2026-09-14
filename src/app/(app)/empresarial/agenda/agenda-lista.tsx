"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, MapPin, Video, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MEETING_MODE_LABELS,
  MEETING_STATUS_LABELS,
  type MeetingMode,
  type MeetingStatus,
} from "@/lib/empresarial/constants";
import {
  nextMeetingStatuses,
  requiresStatusNote,
} from "@/lib/empresarial/agenda";
import { formatBrDate, formatBrTime, isoDateIn } from "@/lib/dates";
import { changeMeetingStatus, rescheduleMeeting } from "./actions";

export type ReuniaoView = {
  id: string;
  leadId: string;
  companyName: string;
  contactName: string | null;
  contactPhone: string | null;
  title: string | null;
  mode: MeetingMode;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  statusNote: string | null;
  ownerName: string | null;
  vezesRemarcada: number;
};

const ICONE_DO_MODO = {
  ONLINE: Video,
  IN_PERSON: MapPin,
  PHONE: Phone,
} as const;

export function AgendaLista({
  proximas,
  semDesfecho,
  encerradas,
}: {
  proximas: ReuniaoView[];
  semDesfecho: ReuniaoView[];
  encerradas: ReuniaoView[];
}) {
  return (
    <div className="space-y-5">
      {semDesfecho.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-medium text-destructive">
              Já passaram e ninguém disse o que houve ({semDesfecho.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Enquanto a reunião não recebe desfecho, a empresa fica parada na
              fase 3 — e o funil mente sobre onde ela está.
            </p>
          </div>
          {semDesfecho.map((r) => (
            <ReuniaoCard key={r.id} reuniao={r} destaque />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Próximas ({proximas.length})</h2>
        {proximas.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma reunião marcada. As reuniões são marcadas no cartão da
              empresa, dentro do Funil.
            </CardContent>
          </Card>
        ) : (
          agrupadoPorDia(proximas).map(([dia, lista]) => (
            <div key={dia} className="space-y-2">
              <p className="pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {formatBrDate(lista[0].startsAt)}
              </p>
              {lista.map((r) => (
                <ReuniaoCard key={r.id} reuniao={r} />
              ))}
            </div>
          ))
        )}
      </section>

      {encerradas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Encerradas ({encerradas.length})
          </h2>
          {encerradas.map((r) => (
            <ReuniaoCard key={r.id} reuniao={r} />
          ))}
        </section>
      )}
    </div>
  );
}

/** Agrupa por DIA BRASILEIRO — `isoDateIn` em vez do relógio da máquina. */
function agrupadoPorDia(lista: ReuniaoView[]): [string, ReuniaoView[]][] {
  const mapa = new Map<string, ReuniaoView[]>();
  for (const r of lista) {
    const dia = isoDateIn(new Date(r.startsAt));
    mapa.set(dia, [...(mapa.get(dia) ?? []), r]);
  }
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function ReuniaoCard({
  reuniao,
  destaque = false,
}: {
  reuniao: ReuniaoView;
  destaque?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [destino, setDestino] = useState<MeetingStatus | "">("");
  const [motivo, setMotivo] = useState("");
  const Icone = ICONE_DO_MODO[reuniao.mode];
  const destinos = nextMeetingStatuses(reuniao.status);
  const precisaMotivo = destino !== "" && requiresStatusNote(destino);

  function aplicar() {
    if (destino === "") return;
    startTransition(async () => {
      const r = await changeMeetingStatus(reuniao.id, destino, motivo);
      if (r.ok) {
        toast.success("Situação atualizada.");
        setDestino("");
        setMotivo("");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card className={destaque ? "border-destructive/40" : undefined}>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{reuniao.companyName}</p>
            <p className="text-xs text-muted-foreground">
              {formatBrDate(reuniao.startsAt)} · {formatBrTime(reuniao.startsAt)}
              {" às "}
              {formatBrTime(reuniao.endsAt)}
              {reuniao.ownerName ? ` · ${reuniao.ownerName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className="text-xs">
              {MEETING_STATUS_LABELS[reuniao.status]}
            </Badge>
            {reuniao.vezesRemarcada > 0 && (
              <Badge variant="destructive" className="text-xs">
                remarcada {reuniao.vezesRemarcada}×
              </Badge>
            )}
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Icone className="size-3.5" />
          {MEETING_MODE_LABELS[reuniao.mode]}
          {reuniao.location ? ` · ${reuniao.location}` : ""}
          {reuniao.contactName ? ` · ${reuniao.contactName}` : ""}
          {reuniao.contactPhone ? ` · ${reuniao.contactPhone}` : ""}
        </p>

        {reuniao.statusNote && (
          <p className="text-xs text-muted-foreground">
            Observação: {reuniao.statusNote}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            nativeButton={false}
            render={
              <a href={`/empresarial/agenda/${reuniao.id}/ics`} download />
            }
          >
            <CalendarPlus className="mr-1 size-3.5" />
            Adicionar à minha agenda
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            nativeButton={false}
            render={<Link href="/empresarial/funil" />}
          >
            Ver no funil
          </Button>
          {destinos.includes("RESCHEDULED") && (
            <RemarcarDialog reuniao={reuniao} />
          )}
        </div>

        {destinos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <select
              aria-label="Mudar situação"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={destino}
              disabled={isPending}
              onChange={(e) => setDestino(e.target.value as MeetingStatus | "")}
            >
              <option value="">— mudar situação —</option>
              {/* Remarcar tem caminho próprio: precisa da data nova. */}
              {destinos
                .filter((s) => s !== "RESCHEDULED")
                .map((s) => (
                  <option key={s} value={s}>
                    {MEETING_STATUS_LABELS[s]}
                  </option>
                ))}
            </select>
            {precisaMotivo && (
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo (obrigatório)"
                className="h-8 flex-1 text-xs"
              />
            )}
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={
                isPending || destino === "" || (precisaMotivo && !motivo.trim())
              }
              onClick={aplicar}
            >
              Aplicar
            </Button>
            {destino === "DONE" && (
              <span className="text-xs text-muted-foreground">
                move a empresa para Apresentado
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RemarcarDialog({ reuniao }: { reuniao: ReuniaoView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await rescheduleMeeting(reuniao.id, formData);
      if (r.ok) {
        toast.success("Reunião remarcada.");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="h-7 text-xs">
            Remarcar
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remarcar — {reuniao.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A reunião atual fica registrada como remarcada e a nova aponta para
            ela. É assim que se enxerga a empresa que já adiou várias vezes.
          </p>
          <div>
            <Label htmlFor="starts_at">Nova data e hora *</Label>
            <Input id="starts_at" name="starts_at" type="datetime-local" required />
          </div>
          <div>
            <Label htmlFor="duration">Duração (minutos)</Label>
            <Input
              id="duration"
              name="duration"
              type="number"
              min={15}
              step={15}
              defaultValue={60}
            />
          </div>
          <div>
            <Label htmlFor="status_note">Motivo da remarcação *</Label>
            <Input id="status_note" name="status_note" required />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              Remarcar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
