"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, ChevronRight, CircleHelp, ClipboardCheck, PhoneCall } from "lucide-react";
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
  botoesDaResposta,
  CANAL_LABEL,
  DESFECHO_LABEL,
  desfechosDoContato,
  detalheDoFechamento,
  ESCALA_DE_SATISFACAO,
  horarioLonge,
  NIVEIS_DE_QUALIDADE,
  NIVEL_LABEL,
  nivelPedeObservacao,
  PERGUNTA_DO_FIM,
  RESPOSTA_LABEL,
  retornoSugerido,
  TENTATIVAS_PARA_SEM_CONTATO,
  tituloDoFechamento,
  type CanalDoContato,
  type DesfechoDoContato,
  type Fechamento,
  type HorarioComCoordenador,
  type NivelDeQualidade,
  type RespostaDoFechamento,
} from "@/lib/fim-do-tratamento";
import {
  pedirReavaliacaoMaisProxima,
  registrarContato,
  registrarReavaliacao,
  type PerguntaPendente,
} from "./fim-do-tratamento-actions";
import { PerguntaDoFimDialog } from "./pergunta-do-fim-dialog";

/**
 * O FIM DO TRATAMENTO NA FICHA (0418): as tarefas abertas do fechamento, como
 * linhas do painel "Precisa de atenção". Substitui a pergunta antiga (0019),
 * que nunca chegou a abrir. Cada linha só some quando a tarefa é resolvida.
 *
 * 0422 (OC-00185): uma decisão por cliente. A decisão pendente de quem abre
 * a ficha abre sozinha (obrigatória); os botões das linhas abrem a mesma
 * janela, com as considerações e o horário com o Coordenador.
 */
export function FimDoTratamento({
  clientId,
  fechamentos,
  userId,
  ehCoordenador,
  ehRecepcao,
  clienteNaFase5,
  hoje,
  horarioAtual,
  clientName,
}: {
  clientId: string;
  fechamentos: Fechamento[];
  userId: string;
  ehCoordenador: boolean;
  ehRecepcao: boolean;
  clienteNaFase5: boolean;
  /** Hoje no Brasil (aaaa-mm-dd), vindo do servidor. */
  hoje: string;
  /** 0422 (F1): o próximo horário do cliente com o Coordenador, se houver. */
  horarioAtual: HorarioComCoordenador | null;
  clientName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [contatoDe, setContatoDe] = useState<Fechamento | null>(null);
  const [reavaliacaoDe, setReavaliacaoDe] = useState<Fechamento | null>(null);
  // A janela aberta por um botão da linha (não obrigatória).
  const [respostaDe, setRespostaDe] = useState<{ f: Fechamento; r: RespostaDoFechamento } | null>(null);
  // A decisão já respondida aqui (até a ficha recarregar, não reabre).
  const [respondida, setRespondida] = useState<string | null>(null);

  if (fechamentos.length === 0) return null;

  function pendente(f: Fechamento): PerguntaPendente {
    return {
      id: f.id,
      scope: f.scope,
      escopos: f.escopos,
      clientId,
      clientName,
      treatmentEnd: f.treatmentEnd,
      horario: horarioAtual,
    };
  }

  // 0422: a decisão de quem executou abre sozinha quando essa pessoa abre a ficha.
  const obrigatoria = fechamentos.find(
    (f) => f.groupedInto === null && f.status === "pergunta" && f.askedUserId === userId && f.id !== respondida
  );

  function pedirMaisProxima(f: Fechamento) {
    startTransition(async () => {
      const res = await pedirReavaliacaoMaisProxima(clientId, f.id);
      if (res.ok) {
        toast.success("Pedido registrado. A Recepção foi avisada para agendar com prioridade.");
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <>
      {fechamentos.map((f) => {
        const botoes = botoesDaResposta(f, { userId, ehCoordenador, clienteNaFase5 });
        const urgente = f.status === "pergunta" || f.status === "coordenador" || f.status === "contato";
        const cor = urgente ? "text-destructive" : "text-amber-700 dark:text-amber-300";
        const Icone = f.status === "contato" ? PhoneCall : f.status === "reavaliacao" ? ClipboardCheck : CircleHelp;
        // 0422 (F1): com horário ligado (e sem pedido de antecipar), não se agenda outro.
        const temHorario = f.horario !== null && f.waitChoice !== "antecipar";
        const seguidor = f.groupedInto !== null;
        const agenda =
          ehRecepcao && f.status === "reavaliacao" && !temHorario && !seguidor
            ? { href: `/agenda?cliente=${clientId}&tipo=reevaluation`, rotulo: "Agendar reavaliação" }
            : ehRecepcao && f.status === "agendar_avaliacao"
              ? { href: `/agenda?cliente=${clientId}&tipo=evaluation`, rotulo: "Agendar avaliação" }
              : null;
        return (
          <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
            <Icone className={cn("mt-0.5 size-4 shrink-0", cor)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", cor)}>{tituloDoFechamento(f)}</p>
              <p className="mt-0.5 text-xs text-foreground/80">
                {(f.status === "pergunta" || f.status === "coordenador") && (
                  <span className="block">{PERGUNTA_DO_FIM}</span>
                )}
                {detalheDoFechamento(f)}
                {f.changedByCoordinator && " A resposta foi mudada pelo Coordenador."}
              </p>
              {f.status === "reavaliacao" && f.horario && horarioLonge(f.horario) && f.waitChoice !== "antecipar" && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                  O horário está longe ({f.horario.dias} dias). Dá para pedir uma reavaliação mais próxima.
                </p>
              )}
              {f.dentistNotes && !seguidor && (
                <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs">
                  <span className="font-medium">Considerações de quem executou:</span> {f.dentistNotes}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {botoes.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={r === "sim" ? "default" : r === "nao" ? "outline" : "ghost"}
                  disabled={isPending}
                  onClick={() => setRespostaDe({ f, r })}
                >
                  {f.status === "reavaliacao" || f.status === "contato"
                    ? r === "sim"
                      ? "Mudar para Sim"
                      : "Mudar para Não"
                    : RESPOSTA_LABEL[r]}
                </Button>
              ))}
              {f.status === "reavaliacao" && ehCoordenador && !seguidor && temHorario && (
                <Button size="sm" variant="outline" disabled={isPending} onClick={() => pedirMaisProxima(f)}>
                  Pedir reavaliação mais próxima
                </Button>
              )}
              {f.status === "contato" && ehCoordenador && (
                <Button size="sm" disabled={isPending} onClick={() => setContatoDe(f)}>
                  Registrar contato
                </Button>
              )}
              {/* 0421: a reavaliação. Plano: por procedimento, no cockpit;
                  ortodontia e venda direta: um nível, aqui mesmo. */}
              {f.status === "reavaliacao" && ehCoordenador && f.scope === "plano" && !seguidor && (
                <Link
                  href={`/avaliacao/${clientId}`}
                  className="inline-flex items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Avaliar procedimentos
                  <ChevronRight className="size-3.5" />
                </Link>
              )}
              {f.status === "reavaliacao" && ehCoordenador && f.scope !== "plano" && (
                <Button size="sm" disabled={isPending} onClick={() => setReavaliacaoDe(f)}>
                  Registrar reavaliação
                </Button>
              )}
              {agenda && (
                <Link
                  href={agenda.href}
                  className="inline-flex items-center gap-0.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  {agenda.rotulo}
                  <ChevronRight className="size-3.5" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
      <ContatoDialog
        clientId={clientId}
        fechamento={contatoDe}
        hoje={hoje}
        onClose={() => setContatoDe(null)}
      />
      <ReavaliacaoDialog
        clientId={clientId}
        fechamento={reavaliacaoDe}
        onClose={() => setReavaliacaoDe(null)}
      />
      {/* A decisão obrigatória de quem executou; senão, a aberta por um botão. */}
      {obrigatoria ? (
        <PerguntaDoFimDialog
          key={obrigatoria.id}
          pergunta={pendente(obrigatoria)}
          onRespondida={() => setRespondida(obrigatoria.id)}
        />
      ) : (
        <PerguntaDoFimDialog
          key={respostaDe ? `${respostaDe.f.id}:${respostaDe.r}` : "nenhuma"}
          pergunta={respostaDe ? pendente(respostaDe.f) : null}
          respostas={respostaDe ? botoesDaResposta(respostaDe.f, { userId, ehCoordenador, clienteNaFase5 }) : []}
          status={respostaDe?.f.status ?? "pergunta"}
          respostaInicial={respostaDe?.r ?? null}
          obrigatoria={false}
          onCancelar={() => setRespostaDe(null)}
          onRespondida={() => setRespostaDe(null)}
        />
      )}
    </>
  );
}

/** 0421: um nível para a reavaliação da ortodontia ou da venda direta. */
function ReavaliacaoDialog({
  clientId,
  fechamento,
  onClose,
}: {
  clientId: string;
  fechamento: Fechamento | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [nivel, setNivel] = useState<NivelDeQualidade | null>(null);
  const [obs, setObs] = useState("");

  function fechar() {
    setNivel(null);
    setObs("");
    onClose();
  }

  function salvar() {
    if (!fechamento || !nivel) return;
    startTransition(async () => {
      const res = await registrarReavaliacao(clientId, fechamento.id, nivel, obs);
      if (res.ok) {
        toast.success(
          nivelPedeObservacao(nivel)
            ? "Registrado. A Recepção foi avisada para agendar."
            : "Reavaliação registrada."
        );
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  const pedeObs = nivel !== null && nivelPedeObservacao(nivel);

  return (
    <Dialog open={fechamento !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reavaliação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Como ficou o resultado? Excelente, Bom e Aceitável encerram a
            reavaliação; Revisar e Refazer pedem nova sessão.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NIVEIS_DE_QUALIDADE.map((n) => (
              <Button
                key={n}
                size="sm"
                type="button"
                variant={nivel === n ? "default" : "outline"}
                onClick={() => setNivel(n)}
              >
                {NIVEL_LABEL[n]}
              </Button>
            ))}
          </div>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={3}
            placeholder={pedeObs ? "O motivo (obrigatório)" : "Observação (opcional)"}
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            disabled={isPending || nivel === null || (pedeObs && obs.trim().length === 0)}
            onClick={salvar}
          >
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContatoDialog({
  clientId,
  fechamento,
  hoje,
  onClose,
}: {
  clientId: string;
  fechamento: Fechamento | null;
  hoje: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [canal, setCanal] = useState<CanalDoContato>("ligacao");
  const [falou, setFalou] = useState(true);
  const [resumo, setResumo] = useState("");
  const [desfecho, setDesfecho] = useState<DesfechoDoContato | null>(null);
  const [retorno, setRetorno] = useState(retornoSugerido(hoje));
  // 0421 (D18): a satisfação do cliente (0 a 10) e se ele tem queixa.
  const [satisfacao, setSatisfacao] = useState<number | null>(null);
  const [queixa, setQueixa] = useState<boolean | null>(null);

  // Esta tentativa sem sucesso completaria as 3? Então dá para encerrar.
  const podeSemContato =
    !falou && (fechamento?.tentativasSemSucesso ?? 0) + 1 >= TENTATIVAS_PARA_SEM_CONTATO;
  const opcoes: DesfechoDoContato[] = falou
    ? desfechosDoContato(queixa)
    : podeSemContato
      ? ["sem_contato"]
      : [];
  const pedeRetorno = desfecho === "aguardar_retorno" || desfecho === "sem_contato";

  function fechar() {
    setCanal("ligacao");
    setFalou(true);
    setResumo("");
    setDesfecho(null);
    setRetorno(retornoSugerido(hoje));
    setSatisfacao(null);
    setQueixa(null);
    onClose();
  }

  function salvar() {
    if (!fechamento) return;
    startTransition(async () => {
      const res = await registrarContato(clientId, fechamento.id, {
        canal,
        falou,
        resumo,
        desfecho,
        retorno: pedeRetorno ? retorno : null,
        satisfacao,
        queixa,
      });
      if (res.ok) {
        toast.success(falou || desfecho ? "Contato registrado." : "Tentativa registrada. A tarefa continua aberta.");
        fechar();
        router.refresh();
      } else toast.error(res.error ?? "Algo deu errado.");
    });
  }

  return (
    <Dialog open={fechamento !== null} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contato com o cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Como foi o contato</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CANAL_LABEL) as CanalDoContato[]).map((c) => (
                <Button
                  key={c}
                  size="sm"
                  type="button"
                  variant={canal === c ? "default" : "outline"}
                  onClick={() => setCanal(c)}
                >
                  {CANAL_LABEL[c]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Conseguiu falar com o cliente?</p>
            <div className="flex gap-1.5">
              <Button size="sm" type="button" variant={falou ? "default" : "outline"} onClick={() => { setFalou(true); setDesfecho(null); }}>
                Sim
              </Button>
              <Button size="sm" type="button" variant={!falou ? "default" : "outline"} onClick={() => { setFalou(false); setDesfecho(null); }}>
                Não atendeu
              </Button>
            </div>
          </div>
          <textarea
            value={resumo}
            onChange={(e) => setResumo(e.target.value)}
            rows={3}
            placeholder={falou ? "O que o cliente disse (obrigatório)" : "Observação (opcional)"}
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
          />
          {falou && (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  De 0 a 10, quanto o cliente ficou satisfeito?
                </p>
                <div className="flex flex-wrap gap-1">
                  {ESCALA_DE_SATISFACAO.map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      type="button"
                      className="h-7 w-8 px-0"
                      variant={satisfacao === n ? "default" : "outline"}
                      onClick={() => setSatisfacao(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">O cliente tem alguma queixa?</p>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    type="button"
                    variant={queixa === false ? "default" : "outline"}
                    onClick={() => setQueixa(false)}
                  >
                    Não
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant={queixa === true ? "default" : "outline"}
                    onClick={() => {
                      setQueixa(true);
                      // Com queixa, só "chamar para revisar".
                      setDesfecho((d) => (d === "revisar" ? d : null));
                    }}
                  >
                    Sim, tem queixa
                  </Button>
                </div>
                {queixa && (
                  <p className="text-xs text-destructive">
                    Com queixa, o próximo passo é chamar o cliente para revisar.
                  </p>
                )}
              </div>
            </>
          )}
          {opcoes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {falou ? "E agora?" : "Encerrar?"}
              </p>
              {opcoes.map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="desfecho"
                    checked={desfecho === o}
                    onChange={() => setDesfecho(o)}
                  />
                  {DESFECHO_LABEL[o]}
                </label>
              ))}
            </div>
          )}
          {!falou && !podeSemContato && (
            <p className="text-xs text-muted-foreground">
              A tentativa fica registrada e a tarefa continua aberta. Depois de{" "}
              {TENTATIVAS_PARA_SEM_CONTATO} tentativas sem falar com o cliente, dá para encerrar sem contato.
            </p>
          )}
          {pedeRetorno && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Retorno previsto (sugerido: 6 meses)
              </span>
              <input
                type="date"
                value={retorno}
                min={hoje}
                onChange={(e) => setRetorno(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
              />
            </label>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            disabled={
              isPending ||
              (falou &&
                (resumo.trim().length < 5 ||
                  desfecho === null ||
                  satisfacao === null ||
                  queixa === null)) ||
              (pedeRetorno && !retorno)
            }
            onClick={salvar}
          >
            {falou || desfecho ? "Registrar" : "Registrar tentativa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
