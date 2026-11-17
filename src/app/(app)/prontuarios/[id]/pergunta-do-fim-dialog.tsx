"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CircleHelp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CONSIDERACOES_MINIMO,
  horarioLonge,
  LIMITE_DIAS_DO_HORARIO,
  oQueTerminou,
  pedeConsideracoes,
  PERGUNTA_DO_FIM,
  RESPOSTA_EFEITO,
  RESPOSTA_LABEL,
  textoDoHorario,
  type RespostaDoFechamento,
  type SituacaoDoFechamento,
} from "@/lib/fim-do-tratamento";
import { responderFechamento, type PerguntaPendente } from "./fim-do-tratamento-actions";

/**
 * A DECISÃO DO FIM (0418; 0422 — relato OC-00185). Abre para quem executou
 * logo depois de concluir a última sessão (pelo Atendimento ou pela ficha) e
 * toda vez que essa pessoa abre a ficha com a decisão pendente. Obrigatória:
 * sem "X", clicar fora ou Esc não fecha. É UMA decisão por cliente — o que
 * terminar depois entra nela.
 *
 * 0422: no Sim e no Não sei, as considerações para o Coordenador (F2). Se o
 * cliente já tem horário com o Coordenador, ele aparece com os dias que
 * faltam (F1); a mais de 30 dias, o Sim pede a escolha: manter o horário ou
 * pedir uma reavaliação mais próxima (F4/F5).
 *
 * Também serve à ficha para o Coordenador responder ou mudar a resposta
 * (`obrigatoria={false}`, com Cancelar).
 */
export function PerguntaDoFimDialog({
  pergunta,
  onRespondida,
  respostas = ["sim", "nao", "nao_sei"],
  status = "pergunta",
  obrigatoria = true,
  respostaInicial = null,
  onCancelar,
}: {
  pergunta: PerguntaPendente | null;
  onRespondida: () => void;
  respostas?: RespostaDoFechamento[];
  status?: SituacaoDoFechamento;
  obrigatoria?: boolean;
  respostaInicial?: RespostaDoFechamento | null;
  onCancelar?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [escolhida, setEscolhida] = useState<RespostaDoFechamento | null>(respostaInicial);
  const [notas, setNotas] = useState("");
  const [espera, setEspera] = useState<"manter" | "antecipar" | null>(null);
  // Uma janela nova (outra decisão ou outro botão) começa limpa.
  const [chave, setChave] = useState<string | null>(null);
  const chaveAtual = pergunta ? `${pergunta.id}:${respostaInicial ?? ""}` : null;
  if (chave !== chaveAtual) {
    setChave(chaveAtual);
    setEscolhida(respostaInicial);
    setNotas("");
    setEspera(null);
  }

  const horario = pergunta?.horario ?? null;
  const longe = horarioLonge(horario);
  const precisaNotas = escolhida !== null && pedeConsideracoes(status, escolhida);
  const precisaEspera = escolhida === "sim" && longe;
  const notasCurtas = precisaNotas && notas.trim().length < CONSIDERACOES_MINIMO;
  const pode = escolhida !== null && !notasCurtas && (!precisaEspera || espera !== null);

  function efeito(r: RespostaDoFechamento): string {
    if (r === "sim" && horario && !longe)
      return "A reavaliação fica no horário que o cliente já tem com o Coordenador — não se marca outro.";
    if (r === "sim" && horario && longe)
      return "O cliente já tem horário com o Coordenador, mas está longe: escolha abaixo.";
    return RESPOSTA_EFEITO[r];
  }

  function confirmar() {
    if (!pergunta || !escolhida || !pode) return;
    startTransition(async () => {
      const res = await responderFechamento(
        pergunta.clientId,
        pergunta.id,
        escolhida,
        notas,
        precisaEspera ? espera : null
      );
      if (res.ok) {
        toast.success(
          escolhida === "sim" && espera === "antecipar"
            ? "Resposta registrada. A Recepção foi avisada para agendar uma reavaliação mais próxima."
            : "Resposta registrada."
        );
        onRespondida();
        router.refresh();
      } else {
        toast.error(res.error ?? "Algo deu errado.");
      }
    });
  }

  const terminou = pergunta
    ? oQueTerminou(pergunta.escopos.length > 0 ? pergunta.escopos : [pergunta.scope])
    : "o plano";

  return (
    <Dialog
      open={pergunta !== null}
      // Obrigatória: controlado e sem "X" — clicar fora ou Esc não fecha.
      onOpenChange={(o) => {
        if (!o && !obrigatoria && !isPending) onCancelar?.();
      }}
    >
      <DialogContent showCloseButton={!obrigatoria} className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleHelp className="size-5 shrink-0 text-destructive" aria-hidden />
            {obrigatoria ? "Decisão obrigatória" : "Necessita de reavaliação?"}
          </DialogTitle>
          <DialogDescription>
            {pergunta?.clientName} terminou {terminou}.
            {pergunta?.treatmentEnd
              ? " Não sobra outro tratamento."
              : " Ainda há outro tratamento em andamento."}
          </DialogDescription>
        </DialogHeader>

        {horario && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              longe
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                : "bg-muted/40"
            )}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {longe ? (
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
              ) : (
                <CalendarClock className="size-4 shrink-0" aria-hidden />
              )}
              Já tem horário com o Coordenador: {textoDoHorario(horario)}
            </p>
            {longe && (
              <p className="mt-0.5 text-xs">
                Mais de {LIMITE_DIAS_DO_HORARIO} dias: pode ser tempo demais para a reavaliação.
              </p>
            )}
          </div>
        )}

        <p className="text-sm font-medium">{PERGUNTA_DO_FIM}</p>
        <div className="grid gap-2" role="radiogroup" aria-label={PERGUNTA_DO_FIM}>
          {respostas.map((r) => (
            <Button
              key={r}
              type="button"
              role="radio"
              aria-checked={escolhida === r}
              variant={escolhida === r ? "default" : "outline"}
              disabled={isPending}
              onClick={() => {
                setEscolhida(r);
                if (r !== "sim") setEspera(null);
              }}
              className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
            >
              <span>{RESPOSTA_LABEL[r]}</span>
              <span className="text-xs font-normal opacity-80">{efeito(r)}</span>
            </Button>
          ))}
        </div>

        {precisaEspera && (
          <div className="space-y-1.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">O horário está longe. O que fazer?</p>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="espera"
                className="mt-1"
                checked={espera === "manter"}
                onChange={() => setEspera("manter")}
              />
              <span>Manter o horário já marcado (a reavaliação será nele)</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="espera"
                className="mt-1"
                checked={espera === "antecipar"}
                onChange={() => setEspera("antecipar")}
              />
              <span>Pedir uma reavaliação mais próxima (a Recepção é avisada com prioridade)</span>
            </label>
          </div>
        )}

        {escolhida !== null && status === "pergunta" && (
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Considerações para o Coordenador{" "}
              {precisaNotas ? `(obrigatório, pelo menos ${CONSIDERACOES_MINIMO} letras)` : "(opcional)"}
            </span>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              disabled={isPending}
              placeholder="O que o Coordenador deve olhar com mais atenção na reavaliação"
              className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
            />
          </label>
        )}

        <DialogFooter className="gap-2">
          {!obrigatoria && (
            <Button variant="outline" onClick={onCancelar} disabled={isPending}>
              Cancelar
            </Button>
          )}
          <Button disabled={isPending || !pode} onClick={confirmar}>
            Confirmar resposta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
