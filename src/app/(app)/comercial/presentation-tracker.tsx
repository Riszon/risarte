"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, CalendarPlus, MessageSquarePlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
// A lista de tipos vem do módulo puro; de `./actions` vêm SÓ as ações. Um
// arquivo `"use server"` não pode exportar constante — ver o comentário em
// `@/lib/commercial`.
import { PRESENTATION_EVENT_KINDS } from "@/lib/commercial";
import { logPresentationEvent, requestPresentationScheduling } from "./actions";

/**
 * O QUE ACONTECE ENTRE O ENVIO AO COMERCIAL E A APRESENTAÇÃO.
 *
 * Pedido do dono (05/09/2026). O cliente é enviado ao Comercial, a apresentação
 * é marcada — e aí a vida acontece: ele não comparece, pede para remarcar, some.
 * Antes disto o cartão ficava parado sem contar nada, e a memória do caso
 * morava só na cabeça do consultor.
 *
 * Três coisas na mesma caixa, e a ordem importa:
 *
 * 1. **Quando é a apresentação** — ou, se não houver nenhuma marcada, um aviso
 *    vermelho. A AUSÊNCIA é a informação mais importante: é o estado que trava
 *    o funil e o único que não aparecia em lugar nenhum.
 * 2. **Quantas vezes já se tentou**, e o que houve da última vez.
 * 3. **Os dois botões**: registrar o que aconteceu, e pedir à Recepção um novo
 *    agendamento.
 */

function quando(iso: string, comHora = true): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: BRAZIL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    ...(comHora ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}),
    hour12: false,
  });
}

export type PresentationInfo = {
  clientId: string;
  clientName: string;
  presentationAt: string | null;
  presentationWith: string | null;
  attemptCount: number;
  noShowCount: number;
  lastAttemptLabel: string | null;
  lastAttemptAt: string | null;
  schedulingRequestedAt: string | null;
  /** Só o time comercial escreve; a unidade enxerga. */
  podeAgir: boolean;
};

export function PresentationTracker({ info }: { info: PresentationInfo }) {
  const [registrando, setRegistrando] = useState(false);
  const [pedindo, setPedindo] = useState(false);

  const semAgendamento = info.presentationAt === null;
  // O pedido só "conta" enquanto não houver agendamento: assim que a Recepção
  // marca, o aviso de espera some sozinho em vez de virar entulho no cartão.
  const esperandoRecepcao = semAgendamento && info.schedulingRequestedAt !== null;

  return (
    <div className="mt-2 space-y-1.5 border-t pt-2 text-xs">
      {info.presentationAt ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarClock className="size-3.5 shrink-0 text-primary" />
          <span>
            Apresentação <strong className="font-medium text-foreground">
              {quando(info.presentationAt)}
            </strong>
            {info.presentationWith && ` · ${info.presentationWith}`}
          </span>
        </p>
      ) : (
        <p
          className={cn(
            "flex items-center gap-1.5 font-medium",
            esperandoRecepcao ? "text-amber-700 dark:text-amber-500" : "text-red-600"
          )}
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          {esperandoRecepcao
            ? `Aguardando a Recepção agendar (pedido em ${quando(info.schedulingRequestedAt!, false)})`
            : "Sem apresentação marcada"}
        </p>
      )}

      {info.attemptCount > 0 && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {info.attemptCount}ª tentativa
          </span>
          {info.noShowCount > 0 &&
            ` · ${info.noShowCount} não comparecimento${info.noShowCount > 1 ? "s" : ""}`}
          {info.lastAttemptLabel && info.lastAttemptAt && (
            <>
              <br />
              <span className="italic">
                {info.lastAttemptLabel} · {quando(info.lastAttemptAt)}
              </span>
            </>
          )}
        </p>
      )}

      {info.podeAgir && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setRegistrando(true)}
          >
            <MessageSquarePlus className="mr-1 size-3.5" />
            Registrar acontecimento
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPedindo(true)}
          >
            <CalendarPlus className="mr-1 size-3.5" />
            Pedir agendamento
          </Button>
        </div>
      )}

      <RegistrarDialog
        aberto={registrando}
        fechar={() => setRegistrando(false)}
        clientId={info.clientId}
        clientName={info.clientName}
      />
      <PedirDialog
        aberto={pedindo}
        fechar={() => setPedindo(false)}
        clientId={info.clientId}
        clientName={info.clientName}
        jaPediuHoje={
          info.schedulingRequestedAt !== null &&
          new Date(info.schedulingRequestedAt).toDateString() ===
            new Date().toDateString()
        }
      />
    </div>
  );
}

function RegistrarDialog({
  aberto,
  fechar,
  clientId,
  clientName,
}: {
  aberto: boolean;
  fechar: () => void;
  clientId: string;
  clientName: string;
}) {
  const [salvando, iniciar] = useTransition();
  const [tipo, setTipo] = useState<string>(PRESENTATION_EVENT_KINDS[0].value);
  const [texto, setTexto] = useState("");

  function salvar() {
    iniciar(async () => {
      const r = await logPresentationEvent(clientId, tipo, texto);
      if (r.ok) {
        toast.success("Registrado no histórico do funil.");
        setTexto("");
        setTipo(PRESENTATION_EVENT_KINDS[0].value);
        fechar();
      } else {
        toast.error(r.error ?? "Não foi possível registrar.");
      }
    });
  }

  const itens = PRESENTATION_EVENT_KINDS.map((k) => ({
    value: k.value,
    label: k.label,
  }));

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>O que aconteceu?</DialogTitle>
          <DialogDescription>
            {clientName} — o registro entra no histórico do funil com a data e a
            hora, e não pode ser apagado. Para corrigir, registre outro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tipo-acontecimento">Tipo</Label>
            <Select
              items={itens}
              value={tipo}
              onValueChange={(v) => v && setTipo(v)}
            >
              <SelectTrigger id="tipo-acontecimento" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itens.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="texto-acontecimento">
              Detalhe
              {tipo === "apresentacao_observacao" ? "" : " (opcional)"}
            </Label>
            <textarea
              id="texto-acontecimento"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ex.: liguei às 14h, disse que teve um imprevisto no trabalho e pediu para remarcar na semana que vem."
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={salvar} disabled={salvando}>
              {salvando ? "Registrando…" : "Registrar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={fechar}
              disabled={salvando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PedirDialog({
  aberto,
  fechar,
  clientId,
  clientName,
  jaPediuHoje,
}: {
  aberto: boolean;
  fechar: () => void;
  clientId: string;
  clientName: string;
  jaPediuHoje: boolean;
}) {
  const [enviando, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");

  function enviar() {
    iniciar(async () => {
      const r = await requestPresentationScheduling(clientId, motivo);
      if (r.ok) {
        toast.success("Pedido enviado à Recepção da unidade.");
        setMotivo("");
        fechar();
      } else {
        toast.error(r.error ?? "Não foi possível enviar o pedido.");
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pedir novo agendamento</DialogTitle>
          <DialogDescription>
            O aviso vai para a <strong>Recepção da unidade de {clientName}</strong>,
            que tem a agenda e o contato do paciente. O pedido fica registrado no
            histórico do funil.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {jaPediuHoje && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs dark:bg-amber-950/30">
              Já houve um pedido para este cliente hoje. Enviar de novo{" "}
              <strong>não gera um segundo aviso</strong> para a Recepção — só
              registra no histórico.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="motivo-pedido">Motivo (opcional)</Label>
            <textarea
              id="motivo-pedido"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ex.: o cliente não compareceu duas vezes; pediu para tentar no fim da tarde."
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={enviar} disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar à Recepção"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={fechar}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
