"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, MessageSquarePlus } from "lucide-react";
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
import { registrarProblema, responderProblema } from "./actions";

export type Relato = {
  id: string;
  code: string;
  kind: "erro" | "duvida" | "sugestao";
  severity: "baixa" | "media" | "alta";
  title: string;
  whatHappened: string;
  expected: string | null;
  screen: string | null;
  appVersion: string | null;
  errorDigest: string | null;
  status: "aberto" | "em_analise" | "resolvido" | "nao_e_defeito";
  answer: string | null;
  answeredAt: string | null;
  resolvedVersion: string | null;
  createdAt: string;
  reporterRole: string | null;
  reporterName: string;
  clinicName: string;
  meu: boolean;
};

const TIPO: Record<Relato["kind"], string> = {
  erro: "Algo deu errado",
  duvida: "Dúvida",
  sugestao: "Sugestão",
};

const SITUACAO: Record<Relato["status"], { rotulo: string; cor: string }> = {
  aberto: { rotulo: "Aberto", cor: "bg-amber-500/15 text-amber-700 dark:text-amber-500" },
  em_analise: { rotulo: "Em análise", cor: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  resolvido: {
    rotulo: "Resolvido",
    cor: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  nao_e_defeito: { rotulo: "Não é defeito", cor: "bg-muted text-muted-foreground" },
};

const GRAVIDADE: Record<Relato["severity"], string> = {
  baixa: "Atrapalha pouco",
  media: "Atrapalha o trabalho",
  alta: "Impede de trabalhar",
};

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Problemas({
  relatos,
  isAdminMaster,
  semTabela,
  semUnidade,
  abrirFormulario,
  telaSugerida,
  digestSugerido,
  versaoAtual,
}: {
  relatos: Relato[];
  isAdminMaster: boolean;
  semTabela: boolean;
  semUnidade: boolean;
  abrirFormulario: boolean;
  telaSugerida: string;
  digestSugerido: string;
  versaoAtual: string;
}) {
  const [aberto, setAberto] = useState(abrirFormulario);
  const [filtro, setFiltro] = useState<"todos" | "abertos" | "meus">("abertos");
  const [enviando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const lista = relatos.filter((r) => {
    if (filtro === "meus") return r.meu;
    if (filtro === "abertos") return r.status === "aberto" || r.status === "em_analise";
    return true;
  });

  function enviar(fd: FormData) {
    // Lido na hora do envio, não guardado em estado: o navegador só existe do
    // lado do cliente, e perguntar por ele durante o desenho faria o servidor e
    // o navegador discordarem (a lição do `useNow`).
    fd.set("user_agent", navigator.userAgent);
    iniciar(async () => {
      const r = await registrarProblema(fd);
      if (r.ok) {
        toast.success(
          `Registrado como ${r.code}. Você acompanha a resposta por aqui.`
        );
        formRef.current?.reset();
        setAberto(false);
        setFiltro("meus");
      } else {
        toast.error(r.error ?? "Não foi possível registrar.");
      }
    });
  }

  return (
    <div className="space-y-5">
      {semTabela && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              Esta parte ainda não foi ligada neste banco.
            </p>
            <p className="mt-1 text-muted-foreground">
              Falta aplicar a <strong>migração 0247</strong>. Até lá o registro
              de problemas não grava — e é melhor dizer isso do que aceitar o
              texto e perdê-lo.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
          {(
            [
              ["abertos", "Em aberto"],
              ["meus", "Os meus"],
              ["todos", "Todos"],
            ] as const
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              type="button"
              onClick={() => setFiltro(chave)}
              className={cn(
                "rounded-md px-3 py-1.5",
                filtro === chave
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <Button onClick={() => setAberto((v) => !v)} disabled={semTabela || semUnidade}>
          <MessageSquarePlus className="mr-2 size-4" />
          Relatar um problema
        </Button>
      </div>

      {semUnidade && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Escolha uma unidade no menu lateral para registrar — o relato pertence
          à unidade em que aconteceu.
        </p>
      )}

      {aberto && !semTabela && !semUnidade && (
        <form
          ref={formRef}
          action={enviar}
          className="space-y-4 rounded-lg border bg-muted/20 p-4"
        >
          <p className="text-sm text-muted-foreground">
            Você não precisa informar quem é, a função, a unidade nem a versão —
            o sistema já sabe e envia junto (versão {versaoAtual}). Escreva só o
            que aconteceu.
          </p>

          {/* `user_agent` é acrescentado no envio, não aqui. */}
          <input type="hidden" name="error_digest" defaultValue={digestSugerido} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kind">O que é</Label>
              <Select items={ITENS_TIPO} defaultValue="erro" name="kind">
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITENS_TIPO.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="severity">Quanto atrapalha</Label>
              <Select items={ITENS_GRAVIDADE} defaultValue="media" name="severity">
                <SelectTrigger id="severity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITENS_GRAVIDADE.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Resumo em uma linha</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={140}
              placeholder="Ex.: a agenda não deixa marcar no sábado"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="screen">Em que tela</Label>
            <Input
              id="screen"
              name="screen"
              defaultValue={telaSugerida}
              maxLength={120}
              placeholder="Ex.: Agenda · Financeiro → Contas a pagar"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="what_happened">O que aconteceu</Label>
            <textarea
              id="what_happened"
              name="what_happened"
              required
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Conte o passo a passo: o que você fez, e o que o sistema respondeu. Se apareceu uma mensagem, copie o texto dela."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expected">O que você esperava que acontecesse</Label>
            <textarea
              id="expected"
              name="expected"
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Opcional — mas é o que separa defeito de regra do sistema."
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={enviando}>
              {enviando ? "Registrando…" : "Registrar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAberto(false)}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {lista.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {filtro === "abertos"
            ? "Nenhum problema em aberto na sua unidade."
            : "Nada registrado ainda."}
        </p>
      ) : (
        <ul className="space-y-3">
          {lista.map((r) => (
            <li key={r.id} className="rounded-lg border">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {/* O código nunca some — é por ele que se conversa sobre a
                        ocorrência sem recontar o caso inteiro. */}
                    <span className="font-mono">{r.code}</span> · {TIPO[r.kind]} ·{" "}
                    {GRAVIDADE[r.severity]} · {r.reporterName}
                    {r.reporterRole && ` (${r.reporterRole})`} · {quando(r.createdAt)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    SITUACAO[r.status].cor
                  )}
                >
                  {SITUACAO[r.status].rotulo}
                </span>
              </div>

              <div className="space-y-2 px-4 py-3 text-sm">
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {r.whatHappened}
                </p>
                {r.expected && (
                  <p className="text-muted-foreground">
                    <strong className="font-medium text-foreground">Esperava:</strong>{" "}
                    {r.expected}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {r.clinicName}
                  {r.screen && ` · tela: ${r.screen}`}
                  {r.appVersion && ` · versão ${r.appVersion}`}
                  {r.errorDigest && ` · código do erro ${r.errorDigest}`}
                </p>

                {r.answer && (
                  <div className="rounded-r-md border-l-4 border-gold bg-muted/50 px-3 py-2">
                    <p className="text-xs font-medium">
                      Resposta
                      {r.answeredAt && ` · ${quando(r.answeredAt)}`}
                      {r.resolvedVersion && ` · corrigido na versão ${r.resolvedVersion}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {r.answer}
                    </p>
                  </div>
                )}

                {isAdminMaster && <Resposta relato={r} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ITENS_TIPO = [
  { value: "erro", label: TIPO.erro },
  { value: "duvida", label: TIPO.duvida },
  { value: "sugestao", label: TIPO.sugestao },
];

const ITENS_GRAVIDADE = [
  { value: "baixa", label: GRAVIDADE.baixa },
  { value: "media", label: GRAVIDADE.media },
  { value: "alta", label: GRAVIDADE.alta },
];

const ITENS_SITUACAO = [
  { value: "aberto", label: SITUACAO.aberto.rotulo },
  { value: "em_analise", label: SITUACAO.em_analise.rotulo },
  { value: "resolvido", label: SITUACAO.resolvido.rotulo },
  { value: "nao_e_defeito", label: SITUACAO.nao_e_defeito.rotulo },
];

/** A resposta do Admin Master. A guarda de verdade está no banco. */
function Resposta({ relato }: { relato: Relato }) {
  const [salvando, iniciar] = useTransition();
  const [aberto, setAberto] = useState(false);

  function salvar(fd: FormData) {
    iniciar(async () => {
      const r = await responderProblema(fd);
      if (r.ok) {
        toast.success("Resposta registrada.");
        setAberto(false);
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
    });
  }

  if (!aberto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        Responder
      </Button>
    );
  }

  return (
    <form action={salvar} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <input type="hidden" name="id" value={relato.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`status-${relato.id}`}>Situação</Label>
          <Select items={ITENS_SITUACAO} defaultValue={relato.status} name="status">
            <SelectTrigger id={`status-${relato.id}`} className="w-full">
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
          <Label htmlFor={`versao-${relato.id}`}>Corrigido na versão</Label>
          <Input
            id={`versao-${relato.id}`}
            name="resolved_version"
            defaultValue={relato.resolvedVersion ?? ""}
            placeholder="Ex.: 0.227.0"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`resposta-${relato.id}`}>Resposta</Label>
        <textarea
          id={`resposta-${relato.id}`}
          name="answer"
          rows={3}
          defaultValue={relato.answer ?? ""}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Quem relatou vai ler isto. Encerrar sem explicar é o que faz a equipe parar de relatar."
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
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
