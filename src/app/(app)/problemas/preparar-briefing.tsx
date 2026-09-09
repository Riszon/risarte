"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardCopy, ShieldAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBrDateTime } from "@/lib/dates";
import type { Relato } from "./lista";

/**
 * TRANSFORMAR UM RELATO EM BRIEFING — só para o Admin Master.
 *
 * O sistema já coleta o contexto todo (tela, versão, unidade, função, código do
 * erro, navegador) justamente para não depender da memória de ninguém. Até aqui
 * isso ficava guardado sem servir para nada: na hora de pedir a correção, o
 * Admin Master reescrevia o caso à mão — e reescrever é onde o contexto se
 * perde, que era o problema original.
 *
 * ⚠️ DUAS ETAPAS, E A SEGUNDA É REVISÁVEL DE PROPÓSITO.
 *
 * O texto NÃO é copiado direto para a área de transferência. Ele aparece numa
 * caixa editável porque o relato é **texto livre escrito por gente**, e gente
 * escreve "a ficha da Ana Paula não abre". Copiar isso para fora do sistema tira
 * dado de paciente de dentro dele — e a LGPD não é um detalhe deste projeto, é
 * requisito de arquitetura desde o MVP.
 *
 * A revisão fica **no caminho**, não como lembrete. Não bloqueia: o Admin
 * precisa comunicar o problema, e um bloqueio faria ele copiar por fora.
 *
 * **O nome de quem relatou não entra.** A função e a unidade dizem tudo o que
 * importa para consertar; o nome não ajuda em nada e é dado pessoal viajando à
 * toa.
 */

type Objetivo = "corrigir" | "responder";

const RIGIDEZ: Record<Relato["severity"], string> = {
  baixa: "Atrapalha pouco",
  media: "Atrapalha o trabalho",
  alta: "Impede de trabalhar",
};

const TIPO: Record<Relato["kind"], string> = {
  erro: "Algo deu errado",
  duvida: "Dúvida",
  sugestao: "Sugestão",
};

/**
 * O texto. Pura montagem de string — sem efeito nenhum, fácil de conferir.
 *
 * O bloco final é o que mais importa: ele diz o que fazer COM o texto. Sem
 * isso, um relato de "a tela não deixa" costuma virar mudança de comportamento
 * quando na verdade era o sistema fazendo o combinado.
 */
export function montarBriefing(
  r: Relato,
  objetivo: Objetivo,
  consideracoes: string
): string {
  const linhas: string[] = [];
  const bloco = (titulo: string, corpo: string) => {
    linhas.push(titulo, corpo.trim() || "(não informado)", "");
  };

  linhas.push(`Problema relatado no riSZon — ${r.code}`, "");
  bloco("O QUE ACONTECEU (nas palavras de quem relatou)", r.whatHappened);
  bloco("O QUE A PESSOA ESPERAVA", r.expected ?? "");
  bloco("CONSIDERAÇÕES DO ADMIN MASTER", consideracoes);

  linhas.push("CONTEXTO (preenchido pelo próprio sistema)");
  const contexto: [string, string | null][] = [
    ["Resumo", r.title],
    ["Tela", r.screen],
    ["Versão do sistema", r.appVersion],
    ["Unidade", r.clinicName],
    ["Função de quem relatou", r.reporterRole],
    ["Tipo", TIPO[r.kind]],
    ["Gravidade", RIGIDEZ[r.severity]],
    ["Código do erro", r.errorDigest],
    ["Navegador", r.userAgent],
    ["Registrado em", formatBrDateTime(r.createdAt)],
  ];
  for (const [rotulo, valor] of contexto) {
    if (valor) linhas.push(`- ${rotulo}: ${valor}`);
  }
  linhas.push("");

  linhas.push("O QUE EU PRECISO");
  if (objetivo === "corrigir") {
    linhas.push(
      "Diagnostique a causa e corrija.",
      "",
      "Antes de mexer em qualquer coisa, confirme que o defeito EXISTE: pode ser",
      "o sistema fazendo o que foi combinado. Se for regra, me diga qual é e por",
      "que ela existe, em vez de mudar o comportamento — e, se a regra estiver",
      "certa mas mal explicada na tela, o conserto é o texto, não a regra.",
      "",
      "Se precisar de algo que não está aqui, peça antes de supor."
    );
  } else {
    linhas.push(
      "Escreva a resposta para quem relatou. Não é defeito — é para explicar.",
      "",
      `Quem vai ler: ${r.reporterRole ?? "alguém da operação"}, fora da área`,
      "técnica. Português simples, sem jargão. Diga o que está acontecendo, por",
      "que o sistema se comporta assim e o que a pessoa deve fazer agora.",
      "",
      "Devolva SÓ o texto da resposta, pronto para eu colar no campo Resposta.",
      "Se a explicação revelar que o manual está omisso ou errado nesse ponto,",
      "diga isso ao final, separado da resposta."
    );
  }

  return linhas.join("\n");
}

export function PrepararBriefing({ relato }: { relato: Relato }) {
  const [objetivo, setObjetivo] = useState<Objetivo>(
    // Dúvida e sugestão quase nunca são conserto; o padrão segue o que a pessoa
    // marcou, para o caminho mais provável exigir menos cliques.
    relato.kind === "erro" ? "corrigir" : "responder"
  );
  const [consideracoes, setConsideracoes] = useState("");
  const [texto, setTexto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  function gerar() {
    setTexto(montarBriefing(relato, objetivo, consideracoes));
    setCopiado(false);
  }

  async function copiar() {
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success("Texto copiado. Cole na conversa com o Claude Code.");
    } catch {
      // Alguns navegadores recusam a área de transferência sem gesto direto, e
      // outros só a liberam em endereço seguro. A caixa está logo acima, então
      // dizer "selecione e copie" resolve — melhor que um erro sem saída.
      toast.error("Não consegui copiar. Selecione o texto acima e use Ctrl+C.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Wand2 className="mr-1.5 size-3.5" />
            Preparar para correção
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preparar {relato.code} para o Claude Code</DialogTitle>
          <DialogDescription>
            O sistema já sabe a tela, a versão, a unidade, a função e o
            navegador. Acrescente o que só você sabe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>O que você quer</Label>
            <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
              {(
                [
                  ["corrigir", "Corrigir o problema"],
                  ["responder", "Responder a quem relatou"],
                ] as const
              ).map(([chave, rotulo]) => (
                <button
                  key={chave}
                  type="button"
                  onClick={() => {
                    setObjetivo(chave);
                    setTexto(null);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5",
                    objetivo === chave
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {objetivo === "corrigir"
                ? "O texto pede diagnóstico e conserto — e manda confirmar que é defeito antes de mexer."
                : "O texto pede uma resposta em linguagem simples, pronta para colar no campo Resposta."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`consideracoes-${relato.id}`}>
              Suas considerações
            </Label>
            <textarea
              id={`consideracoes-${relato.id}`}
              rows={4}
              value={consideracoes}
              onChange={(e) => {
                setConsideracoes(e.target.value);
                setTexto(null);
              }}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="O que você sabe e o sistema não sabe. Ex.: acontece só na Cambé; eu reproduzi; já era assim antes da última versão; acho que é permissão, não defeito."
            />
          </div>

          {texto === null ? (
            <Button type="button" onClick={gerar} className="w-full">
              Gerar texto
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p>
                  <strong className="font-medium">
                    Confira se há nome de paciente antes de copiar.
                  </strong>{" "}
                  O relato é texto livre, e copiar daqui tira a informação de
                  dentro do sistema. Troque por “o paciente” — a correção não
                  precisa saber de quem é a ficha.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`texto-${relato.id}`}>
                  Texto final — pode editar antes de copiar
                </Label>
                <textarea
                  id={`texto-${relato.id}`}
                  rows={16}
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    setCopiado(false);
                  }}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={copiar}>
                  {copiado ? (
                    <Check className="mr-1.5 size-4" />
                  ) : (
                    <ClipboardCopy className="mr-1.5 size-4" />
                  )}
                  {copiado ? "Copiado" : "Copiar"}
                </Button>
                <Button type="button" variant="outline" onClick={gerar}>
                  Gerar de novo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                “Gerar de novo” descarta as edições e volta ao texto montado
                pelo sistema.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
