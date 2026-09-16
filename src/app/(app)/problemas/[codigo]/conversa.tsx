"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatBrDateTime } from "@/lib/dates";
import { RELATOS_VISTOS } from "@/components/report-nav-item";
import {
  SITUACAO_ROTULO,
  estaEncerrado,
  type MensagemDeRelato,
  type Relato,
} from "@/lib/system-reports";
import {
  complementarProblema,
  marcarRelatoVisto,
  reabrirProblema,
  responderProblema,
} from "../actions";
import { PrepararBriefing } from "../preparar-briefing";

const ITENS_SITUACAO = (
  Object.keys(SITUACAO_ROTULO) as (keyof typeof SITUACAO_ROTULO)[]
).map((v) => ({ value: v, label: SITUACAO_ROTULO[v] }));

const CAIXA_DE_TEXTO =
  "w-full rounded-md border bg-background px-3 py-2 text-sm";

/**
 * A CONVERSA DE UM RELATO (0256).
 *
 * ⚠️ NADA AQUI SE EDITA NEM SE APAGA. A resposta de ontem continua visível
 * embaixo da de hoje — era exatamente isso que faltava: a 0247 guardava uma
 * resposta só, e responder de novo apagava a anterior.
 *
 * Três vozes, três aparências: o suporte (à esquerda), quem relatou (à
 * direita) e as mudanças de situação (uma linha fina no meio, porque são
 * fatos, não falas).
 */
export function Conversa({
  relato,
  mensagens,
  isAdminMaster,
  conversaLigada,
}: {
  relato: Relato;
  mensagens: MensagemDeRelato[];
  isAdminMaster: boolean;
  /** Banco sem a 0256: não há complemento nem reabertura. */
  conversaLigada: boolean;
}) {
  const encerrado = estaEncerrado(relato.status);
  const naoLida = relato.meu && relato.respostas > 0 && !relato.respostaLida;

  // ABRIR O RELATO É LER A RESPOSTA — é o que apaga a etiqueta "Resposta nova"
  // deste relato e desconta um da boia. Por relato, não por tela: a pessoa pode
  // ter três respostas novas e ler uma só.
  useEffect(() => {
    if (!naoLida) return;
    marcarRelatoVisto(relato.id)
      .then(() => window.dispatchEvent(new Event(RELATOS_VISTOS)))
      .catch(() => {
        /* migração pendente: o número fica teimoso, a tela não quebra */
      });
  }, [naoLida, relato.id]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Conversa</h2>
        {isAdminMaster && <PrepararBriefing relato={relato} mensagens={mensagens} />}
      </div>

      {mensagens.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {relato.meu
            ? "Ainda sem resposta. Você é avisado pelo ícone da boia, lá em cima, quando ela chegar."
            : "Ainda sem resposta."}
        </p>
      ) : (
        <ol className="space-y-3">
          {mensagens.map((m) => (
            <Mensagem key={m.id} mensagem={m} />
          ))}
        </ol>
      )}

      {isAdminMaster && <Responder relato={relato} />}

      {relato.meu && conversaLigada && !encerrado && <Complementar relato={relato} />}
      {relato.meu && conversaLigada && encerrado && <Reabrir relato={relato} />}
    </section>
  );
}

function Mensagem({ mensagem: m }: { mensagem: MensagemDeRelato }) {
  const quando = formatBrDateTime(m.createdAt);

  if (m.kind === "situacao") {
    return (
      <li className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>
          {m.authorName} mudou para{" "}
          <strong className="font-medium text-foreground">
            {m.statusTo ? SITUACAO_ROTULO[m.statusTo] : "—"}
          </strong>{" "}
          · {quando}
        </span>
        <span className="h-px flex-1 bg-border" />
      </li>
    );
  }

  const doRelator = m.kind === "complemento" || m.kind === "reabertura";
  const titulo =
    m.kind === "reabertura"
      ? `${m.authorName} reabriu — não resolveu`
      : doRelator
        ? `${m.authorName} complementou`
        : `Resposta de ${m.authorName}`;

  return (
    <li className={cn("flex", doRelator ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
          doRelator
            ? "rounded-tr-none bg-muted/60"
            : "rounded-tl-none border-l-4 border-l-gold bg-card",
          m.kind === "reabertura" && "border-destructive/40 bg-destructive/5"
        )}
      >
        <p className="text-xs font-medium">
          {titulo}
          <span className="font-normal text-muted-foreground"> · {quando}</span>
        </p>
        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
      </div>
    </li>
  );
}

/** A resposta do Admin Master. A guarda de verdade está no banco. */
function Responder({ relato }: { relato: Relato }) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function salvar(fd: FormData) {
    iniciar(async () => {
      const r = await responderProblema(fd);
      if (r.ok) {
        toast.success("Resposta registrada.");
        formRef.current?.reset();
        // A fila do Admin Master pode ter encolhido. Sem este aviso o número
        // da boia só cairia na consulta seguinte.
        window.dispatchEvent(new Event(RELATOS_VISTOS));
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={salvar}
      className="space-y-3 rounded-lg border bg-muted/20 p-4"
    >
      <p className="text-sm font-medium">Responder</p>
      <input type="hidden" name="id" value={relato.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="status">Situação</Label>
          <Select items={ITENS_SITUACAO} defaultValue={relato.status} name="status">
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITENS_SITUACAO.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="versao">Corrigido na versão</Label>
          <Input
            id="versao"
            name="resolved_version"
            defaultValue={relato.resolvedVersion ?? ""}
            placeholder="Ex.: 0.247.0"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="resposta">Nova mensagem</Label>
        <textarea
          id="resposta"
          name="answer"
          rows={3}
          className={CAIXA_DE_TEXTO}
          placeholder="Quem relatou vai ler isto. As mensagens anteriores continuam na conversa — escreva só o que é novo."
        />
      </div>
      <Button type="submit" size="sm" disabled={salvando}>
        <Send className="mr-1.5 size-4" />
        {salvando ? "Enviando…" : "Enviar"}
      </Button>
    </form>
  );
}

function Complementar({ relato }: { relato: Relato }) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function salvar(fd: FormData) {
    iniciar(async () => {
      const r = await complementarProblema(fd);
      if (r.ok) {
        toast.success("Complemento registrado.");
        formRef.current?.reset();
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <form ref={formRef} action={salvar} className="space-y-2 rounded-lg border p-4">
      <Label htmlFor="complemento">Acrescentar informação</Label>
      <input type="hidden" name="id" value={relato.id} />
      <textarea
        id="complemento"
        name="body"
        rows={2}
        required
        className={CAIXA_DE_TEXTO}
        placeholder="Aconteceu de novo? Descobriu mais algum detalhe? Escreva aqui — fica na conversa."
      />
      <Button type="submit" size="sm" variant="outline" disabled={salvando}>
        {salvando ? "Enviando…" : "Acrescentar"}
      </Button>
    </form>
  );
}

function Reabrir({ relato }: { relato: Relato }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, iniciar] = useTransition();

  function salvar(fd: FormData) {
    iniciar(async () => {
      const r = await reabrirProblema(fd);
      if (r.ok) {
        toast.success("Relato reaberto. Ele voltou para a fila.");
        setAberto(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível reabrir.");
      }
    });
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm">
        <p className="text-muted-foreground">
          A solução não funcionou? Você pode reabrir este relato.
        </p>
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          <RotateCcw className="mr-1.5 size-4" />
          Não resolveu
        </Button>
      </div>
    );
  }

  return (
    <form action={salvar} className="space-y-2 rounded-lg border border-destructive/30 p-4">
      <Label htmlFor="motivo">O que não funcionou?</Label>
      <input type="hidden" name="id" value={relato.id} />
      <textarea
        id="motivo"
        name="reason"
        rows={3}
        required
        minLength={10}
        className={CAIXA_DE_TEXTO}
        placeholder="Conte o que você fez e o que aconteceu depois da resposta. É por aqui que a correção recomeça."
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>
          {salvando ? "Reabrindo…" : "Reabrir relato"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAberto(false)}
          disabled={salvando}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
