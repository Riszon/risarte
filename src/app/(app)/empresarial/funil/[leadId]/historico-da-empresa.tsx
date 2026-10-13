"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  Milestone,
  Phone,
  Send,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBrDate, formatBrTime } from "@/lib/dates";
import type {
  EventoDoHistorico,
  TipoDeEvento,
} from "@/lib/empresarial/ficha-do-funil";
import { addLeadActivity } from "../actions";
import {
  ReunioesDoLead,
  TentativasDeContato,
  type LeadView,
} from "../lead-board";

/**
 * A ABA HISTÓRICO (OC-00083, 3ª volta) — tudo o que já aconteceu com a
 * empresa no funil, numa linha só, e o lugar de registrar o que acontecer.
 *
 * ⚠️ REGISTRAR USA AS PEÇAS DO CARTÃO DO FUNIL (`TentativasDeContato`,
 * `ReunioesDoLead`), sem a lista delas: aqui a lista é a linha do tempo, que
 * junta as tentativas com o resto. Reescrever os dois formulários deixaria o
 * cartão e a ficha registrando a mesma coisa por dois caminhos.
 */

const TIPO: Record<TipoDeEvento, { rotulo: string; icone: LucideIcon; cor: string }> = {
  fase: { rotulo: "Fases", icone: Milestone, cor: "text-gold-tinta" },
  tentativa: { rotulo: "Contatos", icone: Phone, cor: "text-muted-foreground" },
  reuniao: { rotulo: "Reuniões", icone: CalendarClock, cor: "text-muted-foreground" },
  envio: { rotulo: "Envios", icone: Send, cor: "text-muted-foreground" },
  selo: { rotulo: "Selos", icone: BadgeCheck, cor: "text-emerald-600 dark:text-emerald-400" },
  conferencia: {
    rotulo: "Conferência",
    icone: ClipboardCheck,
    cor: "text-emerald-600 dark:text-emerald-400",
  },
  nota: { rotulo: "Anotações", icone: StickyNote, cor: "text-muted-foreground" },
};

const ORDEM: TipoDeEvento[] = [
  "fase",
  "tentativa",
  "reuniao",
  "envio",
  "selo",
  "conferencia",
  "nota",
];

export function HistoricoDaEmpresa({
  lead,
  eventos,
}: {
  lead: LeadView;
  /** A linha do tempo, já montada e ordenada no servidor. */
  eventos: EventoDoHistorico[];
}) {
  const [filtro, setFiltro] = useState<TipoDeEvento | "tudo">("tudo");
  const presentes = ORDEM.filter((t) => eventos.some((e) => e.tipo === t));
  const visiveis =
    filtro === "tudo" ? eventos : eventos.filter((e) => e.tipo === filtro);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        <p className="text-sm font-medium">Registrar</p>
        <TentativasDeContato lead={lead} semLista />
        <ReunioesDoLead lead={lead} semLista />
        <Anotacao leadId={lead.id} />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">Linha do tempo</p>
            <p className="text-xs text-muted-foreground">
              Do mais recente para o mais antigo: fases, tentativas de contato,
              reuniões, envios, selos e anotações.
            </p>
          </div>

          {presentes.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Filtro ativo={filtro === "tudo"} onClick={() => setFiltro("tudo")}>
                Tudo ({eventos.length})
              </Filtro>
              {presentes.map((t) => (
                <Filtro key={t} ativo={filtro === t} onClick={() => setFiltro(t)}>
                  {TIPO[t].rotulo} ({eventos.filter((e) => e.tipo === t).length})
                </Filtro>
              ))}
            </div>
          )}

          {eventos.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Nada registrado ainda para esta empresa.
            </p>
          ) : (
            <ol className="space-y-3 border-l border-border pl-4">
              {visiveis.map((e) => {
                const Icone = TIPO[e.tipo].icone;
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute top-0.5 -left-[1.6rem] flex size-5 items-center justify-center rounded-full border border-border bg-background">
                      <Icone className={cn("size-3", TIPO[e.tipo].cor)} />
                    </span>
                    <p className="text-sm font-medium">{e.titulo}</p>
                    {e.detalhe && (
                      <p className="text-sm whitespace-pre-line text-muted-foreground">
                        {e.detalhe}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatBrDate(e.quando)} {formatBrTime(e.quando)}
                      {e.autor ? ` · ${e.autor}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Filtro({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        ativo
          ? "border-gold bg-gold/15 font-medium text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Anotacao({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tipo, setTipo] = useState("NOTE");
  const [texto, setTexto] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const r = await addLeadActivity(leadId, tipo, texto);
      if (r.ok) {
        toast.success("Registrado.");
        setTexto("");
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Anotação</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Tipo da anotação"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="NOTE">Nota</option>
          <option value="CALL">Ligação</option>
          <option value="MEETING">Reunião</option>
          <option value="PROPOSAL">Proposta</option>
        </select>
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="O que aconteceu..."
          className="h-8 min-w-40 flex-1 text-xs"
        />
        <Button type="submit" size="sm" disabled={isPending || !texto.trim()}>
          Adicionar
        </Button>
      </div>
    </form>
  );
}
