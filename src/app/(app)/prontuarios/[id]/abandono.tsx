"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarX2, ChevronRight, FileWarning, PhoneCall, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  acoesDoAbandono,
  CANAL_DA_TENTATIVA_LABEL,
  CANAL_DOS_RISCOS_LABEL,
  detalheDoAbandono,
  MINIMO_DOS_RISCOS,
  TENTATIVAS_DA_RECEPCAO,
  tituloDoAbandono,
  type Abandono,
  type CanalDaTentativa,
  type CanalDosRiscos,
  type DecisaoDoGerente,
} from "@/lib/abandono";
import { retornoSugerido } from "@/lib/fim-do-tratamento";
import { decidirAbandono, registrarAbandono, registrarTentativaDeAbandono } from "./abandono-actions";

const LINK_BOTAO =
  "inline-flex items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted";
const CAMPO = "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm";

/**
 * O ABANDONO DE TRATAMENTO NA FICHA (0423): a tarefa aberta, como linha do
 * painel "Precisa de atenção". Reagendar (Recepção) → contato (Coordenador) →
 * registro com os riscos (Coordenador) → decisão (Gerente). Agendar a próxima
 * sessão encerra sozinho.
 */
export function AbandonoNaFicha({
  clientId,
  abandono,
  agoraMs,
  hoje,
  ehRecepcao,
  ehCoordenador,
  ehGerente,
}: {
  clientId: string;
  abandono: Abandono | null;
  agoraMs: number;
  /** Hoje no Brasil (aaaa-mm-dd), vindo do servidor. */
  hoje: string;
  ehRecepcao: boolean;
  ehCoordenador: boolean;
  ehGerente: boolean;
}) {
  const [janela, setJanela] = useState<"tentativa" | "registro" | "decisao" | null>(null);
  if (!abandono || abandono.status === "encerrado") return null;

  const acoes = acoesDoAbandono(abandono.status, { ehRecepcao, ehCoordenador, ehGerente });
  const Icone =
    abandono.status === "reagendar" ? CalendarX2 : abandono.status === "contato" ? PhoneCall : abandono.status === "gerente" ? Scale : FileWarning;
  const cor = abandono.status === "reagendar" ? "text-amber-700 dark:text-amber-300" : "text-destructive";

  return (
    <>
      <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
        <Icone className={cn("mt-0.5 size-4 shrink-0", cor)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", cor)}>{tituloDoAbandono(abandono.status)}</p>
          <p className="mt-0.5 text-xs text-foreground/80">{detalheDoAbandono(abandono, agoraMs)}</p>
          {abandono.risksInformed && (
            <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs">
              <span className="font-medium">Riscos informados ao cliente</span>
              {abandono.risksChannel && ` (${CANAL_DOS_RISCOS_LABEL[abandono.risksChannel]}`}
              {abandono.risksInformedOn && `, ${abandono.risksInformedOn.split("-").reverse().join("/")}`}
              {abandono.risksChannel && ")"}: {abandono.risksInformed}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {acoes.agendar && (
            <Link href={`/agenda?cliente=${clientId}&tipo=treatment_session`} className={LINK_BOTAO}>
              Agendar sessão
              <ChevronRight className="size-3.5" />
            </Link>
          )}
          {acoes.tentativa && (
            <Button size="sm" variant={acoes.registrar ? "outline" : "default"} onClick={() => setJanela("tentativa")}>
              {abandono.status === "reagendar" ? "Registrar tentativa" : "Registrar contato"}
            </Button>
          )}
          {acoes.registrar && (
            <Button size="sm" onClick={() => setJanela("registro")}>
              Registrar abandono
            </Button>
          )}
          {acoes.decidir && (
            <Button size="sm" onClick={() => setJanela("decisao")}>
              Decidir
            </Button>
          )}
          {acoes.termo && (
            <Link href={`/prontuarios/${clientId}?aba=plano`} className={LINK_BOTAO}>
              Abrir o cancelamento
              <ChevronRight className="size-3.5" />
            </Link>
          )}
        </div>
      </li>
      <TentativaDialog
        aberto={janela === "tentativa"}
        clientId={clientId}
        abandono={abandono}
        onClose={() => setJanela(null)}
      />
      <RegistroDialog
        aberto={janela === "registro"}
        clientId={clientId}
        abandono={abandono}
        hoje={hoje}
        onClose={() => setJanela(null)}
      />
      <DecisaoDialog
        aberto={janela === "decisao"}
        clientId={clientId}
        abandono={abandono}
        hoje={hoje}
        onClose={() => setJanela(null)}
      />
    </>
  );
}

function TentativaDialog({
  aberto,
  clientId,
  abandono,
  onClose,
}: {
  aberto: boolean;
  clientId: string;
  abandono: Abandono;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [canal, setCanal] = useState<CanalDaTentativa>("ligacao");
  const [falou, setFalou] = useState(false);
  const [resumo, setResumo] = useState("");
  const [encaminhar, setEncaminhar] = useState(false);
  const daRecepcao = abandono.status === "reagendar";

  function fechar() {
    setCanal("ligacao");
    setFalou(false);
    setResumo("");
    setEncaminhar(false);
    onClose();
  }

  function salvar() {
    startTransition(async () => {
      const res = await registrarTentativaDeAbandono(clientId, abandono.id, { canal, falou, resumo, encaminhar });
      if (res.ok) {
        toast.success(
          daRecepcao && res.etapa === "contato"
            ? "Registrado. A tarefa passou para o Coordenador."
            : "Registrado. A tarefa continua aberta."
        );
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{daRecepcao ? "Tentativa de reagendar" : "Contato com o cliente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {daRecepcao && (
            <p className="text-xs text-muted-foreground">
              Conseguiu agendar? Marque o horário na agenda: a tarefa some sozinha. Aqui você registra a
              tentativa que não deu certo. Depois de {TENTATIVAS_DA_RECEPCAO} tentativas, a tarefa passa ao
              Coordenador ({abandono.tentativasRecepcao} até agora).
            </p>
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Como foi o contato</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CANAL_DA_TENTATIVA_LABEL) as CanalDaTentativa[]).map((c) => (
                <Button key={c} size="sm" type="button" variant={canal === c ? "default" : "outline"} onClick={() => setCanal(c)}>
                  {CANAL_DA_TENTATIVA_LABEL[c]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Conseguiu falar com o cliente?</p>
            <div className="flex gap-1.5">
              <Button size="sm" type="button" variant={!falou ? "default" : "outline"} onClick={() => { setFalou(false); setEncaminhar(false); }}>
                Não atendeu
              </Button>
              <Button size="sm" type="button" variant={falou ? "default" : "outline"} onClick={() => setFalou(true)}>
                Falei
              </Button>
            </div>
          </div>
          <textarea
            value={resumo}
            onChange={(e) => setResumo(e.target.value)}
            rows={3}
            placeholder={falou ? "O que o cliente disse (obrigatório)" : "Observação (opcional)"}
            className={CAMPO}
          />
          {daRecepcao && falou && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={encaminhar} onChange={(e) => setEncaminhar(e.target.checked)} />
              O cliente não quer marcar agora: encaminhar ao Coordenador já.
            </label>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button disabled={isPending || (falou && resumo.trim().length < 5)} onClick={salvar}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegistroDialog({
  aberto,
  clientId,
  abandono,
  hoje,
  onClose,
}: {
  aberto: boolean;
  clientId: string;
  abandono: Abandono;
  hoje: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [riscos, setRiscos] = useState("");
  const [canal, setCanal] = useState<CanalDosRiscos>("ligacao");
  const [informadoEm, setInformadoEm] = useState(hoje);

  function fechar() {
    setRiscos("");
    setCanal("ligacao");
    setInformadoEm(hoje);
    onClose();
  }

  function salvar() {
    startTransition(async () => {
      const res = await registrarAbandono(clientId, abandono.id, { riscos, canal, informadoEm });
      if (res.ok) {
        toast.success("Abandono registrado. O Gerente foi avisado para decidir.");
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registro de abandono de tratamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Fica no prontuário como proteção da clínica. Não apaga nada e não muda a venda: o acerto
            financeiro só acontece pelo cancelamento formal, se o Gerente decidir por ele.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Riscos clínicos informados ao cliente (obrigatório)
            </span>
            <textarea
              value={riscos}
              onChange={(e) => setRiscos(e.target.value)}
              rows={4}
              placeholder="Ex.: informado o risco de fratura do dente sem a coroa definitiva."
              className={CAMPO}
            />
          </label>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Por qual meio</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CANAL_DOS_RISCOS_LABEL) as CanalDosRiscos[]).map((c) => (
                <Button key={c} size="sm" type="button" variant={canal === c ? "default" : "outline"} onClick={() => setCanal(c)}>
                  {CANAL_DOS_RISCOS_LABEL[c]}
                </Button>
              ))}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Em que data</span>
            <input type="date" value={informadoEm} max={hoje} onChange={(e) => setInformadoEm(e.target.value)} className={CAMPO} />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button disabled={isPending || riscos.trim().length < MINIMO_DOS_RISCOS || !informadoEm} onClick={salvar}>
            Registrar abandono
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisaoDialog({
  aberto,
  clientId,
  abandono,
  hoje,
  onClose,
}: {
  aberto: boolean;
  clientId: string;
  abandono: Abandono;
  hoje: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [decisao, setDecisao] = useState<DecisaoDoGerente | null>(null);
  const [retorno, setRetorno] = useState(retornoSugerido(hoje));
  const [observacao, setObservacao] = useState("");

  function fechar() {
    setDecisao(null);
    setRetorno(retornoSugerido(hoje));
    setObservacao("");
    onClose();
  }

  function salvar() {
    if (!decisao) return;
    startTransition(async () => {
      const res = await decidirAbandono(clientId, abandono.id, { decisao, retorno, observacao });
      if (res.ok) {
        toast.success(
          decisao === "fase7"
            ? "O cliente foi para o Acompanhamento. As sessões pendentes ficam abertas para a volta."
            : "Decidido. Abra o termo de cancelamento na aba Plano."
        );
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abandono: a decisão do Gerente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="decisao" className="mt-1" checked={decisao === "fase7"} onChange={() => setDecisao("fase7")} />
            <span>
              <span className="font-medium">Acompanhamento (Fase 7) com retorno</span>
              <span className="block text-xs text-muted-foreground">
                As sessões pendentes ficam abertas para quando o cliente voltar.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="decisao" className="mt-1" checked={decisao === "cancelamento"} onChange={() => setDecisao("cancelamento")} />
            <span>
              <span className="font-medium">Cancelamento formal</span>
              <span className="block text-xs text-muted-foreground">
                Termo e acerto financeiro. A tarefa continua com você até o termo ser aberto (aba Plano).
              </span>
            </span>
          </label>
          {decisao === "fase7" && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Retorno previsto (sugerido: 6 meses)</span>
              <input type="date" value={retorno} min={hoje} onChange={(e) => setRetorno(e.target.value)} className={CAMPO} />
            </label>
          )}
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder="Observação (opcional)"
            className={CAMPO}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button disabled={isPending || !decisao || (decisao === "fase7" && !retorno)} onClick={salvar}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
