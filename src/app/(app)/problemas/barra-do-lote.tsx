"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCopy, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import type { Relato } from "@/lib/system-reports";
import { montarBriefingDoConjunto } from "./preparar-briefing";
import { responderVariosProblemas, type ResultadoEmLote } from "./actions";

const ITENS_SITUACAO = [
  { value: "aberto", label: "Aberto" },
  { value: "em_analise", label: "Em análise" },
  { value: "resolvido", label: "Resolvido" },
  { value: "nao_e_defeito", label: "Não é defeito" },
];

const CAIXA =
  "w-full rounded-md border bg-background p-2 text-sm";

/**
 * A BARRA DO LOTE (pedido do dono, 23/09/2026).
 *
 * "Tem vezes que um usuário cria vários relatos de uma mesma tela ou de mesmo
 * tema, ou vários usuários relatam o mesmo problema — deve ter como selecionar
 * e solicitar o conjunto de alterações, ou simplesmente responder todos ao
 * mesmo tempo."
 *
 * São duas ações com a mesma seleção, e é de propósito que estejam juntas: o
 * caminho real é pedir a correção do conjunto, receber, e depois responder o
 * conjunto — a segunda ação usa a resposta que a primeira ajudou a produzir.
 */
export function BarraDoLote({
  selecionados,
  aoLimpar,
}: {
  selecionados: Relato[];
  aoLimpar: () => void;
}) {
  const router = useRouter();
  const [responder, setResponder] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [situacao, setSituacao] = useState("resolvido");
  const [resposta, setResposta] = useState("");
  const [versao, setVersao] = useState("");
  const [resultado, setResultado] = useState<ResultadoEmLote | null>(null);
  const [enviando, iniciar] = useTransition();

  if (selecionados.length === 0) return null;

  const doTreino = selecionados.filter((r) => r.ambiente === "treino").length;

  function gerarBriefing(objetivo: "corrigir" | "responder") {
    // As conversas não entram aqui: a lista não as carrega, e ir buscar a de
    // cada relato faria a barra pesar. Quem precisa do fio inteiro abre o
    // relato e usa o briefing individual, que já traz a conversa.
    setBriefing(montarBriefingDoConjunto(selecionados, objetivo, ""));
  }

  async function copiar() {
    if (!briefing) return;
    try {
      await navigator.clipboard.writeText(briefing);
      toast.success("Texto copiado. Cole na conversa com o Claude Code.");
    } catch {
      toast.error("Não consegui copiar. Selecione o texto acima e use Ctrl+C.");
    }
  }

  function enviar() {
    iniciar(async () => {
      const r = await responderVariosProblemas(
        selecionados.map((x) => ({ id: x.id, codigo: x.code, ambiente: x.ambiente })),
        situacao,
        resposta,
        versao
      );
      if (!r.ok && r.error) {
        toast.error(r.error);
        return;
      }
      setResponder(false);
      setResposta("");
      setResultado(r);
      aoLimpar();
      router.refresh();
    });
  }

  return (
    <>
      {/* Fica no rodapé, sobre a lista: a seleção continua à vista enquanto a
          pessoa rola procurando os outros relatos do mesmo caso. */}
      <div
        data-moldura
        className="sticky bottom-3 z-30 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border-2 border-primary bg-background px-3 py-2.5 shadow-lg"
      >
        <span className="text-sm font-medium">
          {selecionados.length} relato{selecionados.length > 1 ? "s" : ""} escolhido
          {selecionados.length > 1 ? "s" : ""}
          {doTreino > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">
              ({doTreino} do treino)
            </span>
          )}
        </span>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => gerarBriefing("corrigir")}>
            <ClipboardCopy className="mr-1.5 size-4" />
            Pedir a correção do conjunto
          </Button>
          <Button size="sm" onClick={() => setResponder(true)}>
            <Send className="mr-1.5 size-4" />
            Responder juntos
          </Button>
          <Button size="sm" variant="ghost" onClick={aoLimpar} aria-label="Limpar a seleção">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {briefing !== null && (
        <Dialog open onOpenChange={() => setBriefing(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                O conjunto, num texto só ({selecionados.length} relatos)
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Cole na conversa com o Claude Code. Cada relato vai inteiro, com o
              contexto; as instruções aparecem uma vez, no fim.
            </p>
            <textarea
              readOnly
              value={briefing}
              rows={14}
              className={cn(CAIXA, "font-mono text-xs")}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => gerarBriefing("responder")}>
                Gerar como “só explicar”
              </Button>
              <Button size="sm" onClick={copiar}>
                <ClipboardCopy className="mr-1.5 size-4" />
                Copiar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {responder && (
        <Dialog open onOpenChange={() => setResponder(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Responder {selecionados.length} relatos de uma vez
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                A <strong>mesma mensagem</strong> será gravada em cada um dos
                relatos escolhidos, e cada pessoa a lê no relato dela. Escreva
                pensando em quem não conhece os outros casos.
                {doTreino > 0 && (
                  <>
                    {" "}
                    {doTreino} {doTreino > 1 ? "deles vêm" : "dele vem"} do{" "}
                    <strong>treino</strong> — a resposta é gravada lá, sem você
                    sair daqui.
                  </>
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="situacao-lote" className="text-xs">
                    Situação
                  </Label>
                  <Select
                    items={ITENS_SITUACAO}
                    value={situacao}
                    onValueChange={(v) => v && setSituacao(v)}
                  >
                    <SelectTrigger id="situacao-lote" className="w-full">
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
                  <Label htmlFor="versao-lote" className="text-xs">
                    Corrigido na versão
                  </Label>
                  <Input
                    id="versao-lote"
                    value={versao}
                    onChange={(e) => setVersao(e.target.value)}
                    placeholder="Ex.: 0.271.0"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resposta-lote" className="text-xs">
                  A resposta
                </Label>
                <textarea
                  id="resposta-lote"
                  value={resposta}
                  onChange={(e) => setResposta(e.target.value)}
                  rows={5}
                  className={CAIXA}
                  placeholder="O que foi feito, em português de quem opera."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setResponder(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={enviando || resposta.trim().length === 0}
                  onClick={enviar}
                >
                  {enviando ? "Enviando…" : `Responder os ${selecionados.length}`}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ⚠️ O QUE NÃO FOI FEITO VOLTA DITO, item por item. Um lote que responde
          só "pronto" esconde justamente o caso que precisava de gente — a
          lição que o §0 do CLAUDE.md registra em sangue. */}
      {resultado && (
        <Dialog open onOpenChange={() => setResultado(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {resultado.feitas} relato{resultado.feitas === 1 ? "" : "s"} respondido
                {resultado.feitas === 1 ? "" : "s"}
              </DialogTitle>
            </DialogHeader>
            {resultado.pulados.length > 0 ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">Estes ficaram de fora:</p>
                <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                  {resultado.pulados.map((p) => (
                    <li key={p.codigo} className="flex justify-between gap-3">
                      <span className="font-mono text-xs">{p.codigo}</span>
                      <span className="text-muted-foreground">{p.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Todos os escolhidos receberam a resposta.
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setResultado(null)}>
                Entendi
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
