"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBrDate, formatBrDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/pricing";
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from "@/lib/appointments";
import {
  INDICACAO_STATUS_LABEL,
  ROTULO_DA_ACAO,
  SO_GESTOR,
  TRANSICOES,
  tipoDaAcao,
  type IndicacaoStatus,
} from "@/lib/indica/status";
import { buscarProntuarios, type ClienteEncontrado } from "@/app/(app)/busca-actions";
import {
  avaliacoesDoCliente,
  avancarStatus,
  vendasDoCliente,
  type OpcaoDeAvaliacao,
  type OpcaoDeVenda,
} from "./actions";

export type IndicacaoParaAcao = {
  id: string;
  codigo: string;
  status: IndicacaoStatus;
  clienteIndicadoId: string | null;
  indicadoNome: string;
};

/** O que cada botão explica antes de confirmar (a regra, em uma frase). */
const EXPLICACAO: Partial<Record<IndicacaoStatus, string>> = {
  validada: "Confirma que o contato com o indicado foi feito e a indicação é boa.",
  compareceu:
    "Só funciona depois que a recepção registrou a chegada (check-in) na avaliação. Libera os pontos pendentes do Embaixador.",
  faltou: "O indicado não veio. Dá para ligar outra avaliação enquanto a trava de atribuição valer.",
  convertida:
    "Libera os pontos da carência. O sistema confere se a 1ª parcela foi paga ou se o prazo de carência terminou.",
  expirada: "A trava de atribuição venceu: a indicação encerra e os pontos pendentes são estornados.",
  recusada: "Encerra a indicação (ex.: contato inválido, pessoa não quis). Os pontos pendentes são estornados.",
  nao_fechou: "O indicado avaliou e não fechou. A indicação segue em nutrição até o fim da trava.",
  cancelada:
    "O tratamento foi cancelado durante a carência: os pontos em carência são estornados. Só o gestor.",
};

export function AcoesIndicacao({
  indicacao,
  podeCancelar,
  compacto = false,
}: {
  indicacao: IndicacaoParaAcao;
  podeCancelar: boolean;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [acao, setAcao] = useState<IndicacaoStatus | null>(null);
  const [pendente, iniciar] = useTransition();

  const opcoes = TRANSICOES[indicacao.status].filter(
    (s) => podeCancelar || !SO_GESTOR.includes(s)
  );
  if (opcoes.length === 0) return null;

  const rotulo = (s: IndicacaoStatus) =>
    s === "agendada" && indicacao.status === "agendada"
      ? "Trocar a avaliação"
      : ROTULO_DA_ACAO[s];

  function executar(
    para: IndicacaoStatus,
    motivo: string | null,
    dados: { agendamentoId?: string; vendaId?: string } = {}
  ) {
    iniciar(async () => {
      const r = await avancarStatus(indicacao.id, para, motivo, dados);
      if (r.ok) {
        toast.success(`${indicacao.codigo}: ${INDICACAO_STATUS_LABEL[para]}.`);
        setAcao(null);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      {compacto ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" disabled={pendente} className="h-7 w-full text-xs">
                <ArrowRight className="mr-1 size-3" />
                Avançar…
              </Button>
            }
          />
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Próxima etapa</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {opcoes.map((s) => (
                <DropdownMenuItem key={s} onClick={() => setAcao(s)}>
                  {rotulo(s)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex flex-wrap gap-2">
          {opcoes.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={SO_GESTOR.includes(s) || tipoDaAcao(s) === "motivo" || s === "expirada" ? "outline" : "default"}
              disabled={pendente}
              onClick={() => setAcao(s)}
            >
              {rotulo(s)}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={acao !== null} onOpenChange={(aberto) => !aberto && setAcao(null)}>
        <DialogContent className="sm:max-w-lg">
          {acao && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {indicacao.codigo} · {rotulo(acao)}
                </DialogTitle>
                <DialogDescription>
                  {indicacao.indicadoNome}
                  {EXPLICACAO[acao] ? ` — ${EXPLICACAO[acao]}` : ""}
                </DialogDescription>
              </DialogHeader>
              {tipoDaAcao(acao) === "simples" && (
                <ConfirmarSimples pendente={pendente} onConfirmar={() => executar(acao, null)} />
              )}
              {tipoDaAcao(acao) === "motivo" && (
                <ComMotivo pendente={pendente} onConfirmar={(m) => executar(acao, m)} />
              )}
              {tipoDaAcao(acao) === "agendamento" && (
                <EscolherAvaliacao
                  clienteInicial={indicacao.clienteIndicadoId}
                  pendente={pendente}
                  onConfirmar={(agendamentoId) => executar(acao, null, { agendamentoId })}
                />
              )}
              {tipoDaAcao(acao) === "venda" && indicacao.clienteIndicadoId && (
                <EscolherVenda
                  clienteId={indicacao.clienteIndicadoId}
                  pendente={pendente}
                  onConfirmar={(vendaId) => executar(acao, null, { vendaId })}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfirmarSimples({ pendente, onConfirmar }: { pendente: boolean; onConfirmar: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onConfirmar} disabled={pendente}>
        {pendente ? "Gravando…" : "Confirmar"}
      </Button>
    </div>
  );
}

function ComMotivo({ pendente, onConfirmar }: { pendente: boolean; onConfirmar: (m: string) => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="motivo">Motivo *</Label>
        <textarea
          id="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
          placeholder="Fica na linha do tempo da indicação."
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => onConfirmar(motivo)} disabled={pendente || motivo.trim() === ""}>
          {pendente ? "Gravando…" : "Confirmar"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Ligar a indicação à AVALIAÇÃO do indicado. Se ela ainda não tem cadastro
 * ligado, primeiro se escolhe o cliente (a busca rápida dos prontuários).
 */
function EscolherAvaliacao({
  clienteInicial,
  pendente,
  onConfirmar,
}: {
  clienteInicial: string | null;
  pendente: boolean;
  onConfirmar: (agendamentoId: string) => void;
}) {
  const [cliente, setCliente] = useState<string | null>(clienteInicial);
  const [avaliacoes, setAvaliacoes] = useState<OpcaoDeAvaliacao[] | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [, carregar] = useTransition();

  useEffect(() => {
    if (!cliente) return;
    carregar(async () => {
      setAvaliacoes(await avaliacoesDoCliente(cliente));
    });
  }, [cliente]);

  if (!cliente) {
    return <EscolherCliente onEscolher={(id) => setCliente(id)} />;
  }

  return (
    <div className="space-y-3">
      {avaliacoes === null ? (
        <p className="text-sm text-muted-foreground">Procurando as avaliações…</p>
      ) : avaliacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma avaliação agendada para este cliente.{" "}
          <Link href={`/prontuarios/${cliente}`} className="font-medium text-primary hover:underline">
            Abrir a ficha e agendar
          </Link>
          , depois volte aqui.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {avaliacoes.map((a) => (
            <li key={a.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  escolhida === a.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                )}
              >
                <input
                  type="radio"
                  name="avaliacao"
                  checked={escolhida === a.id}
                  onChange={() => setEscolhida(a.id)}
                />
                <span className="font-medium">{formatBrDateTime(a.startsAt)}</span>
                <span className="text-muted-foreground">
                  · {APPOINTMENT_STATUS_LABELS[a.status as AppointmentStatus] ?? a.status}
                  {a.checkedIn ? " · chegou" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        {!clienteInicial && (
          <Button variant="ghost" size="sm" onClick={() => setCliente(null)}>
            Trocar o cliente
          </Button>
        )}
        <Button
          className="ml-auto"
          onClick={() => escolhida && onConfirmar(escolhida)}
          disabled={pendente || !escolhida}
        >
          {pendente ? "Gravando…" : "Ligar à avaliação"}
        </Button>
      </div>
    </div>
  );
}

function EscolherCliente({ onEscolher }: { onEscolher: (id: string) => void }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<ClienteEncontrado[]>([]);
  const [buscando, buscar] = useTransition();
  const pedido = useRef(0);

  useEffect(() => {
    const texto = termo.trim();
    if (texto.length < 2) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      buscar(async () => {
        const r = await buscarProntuarios(texto);
        if (meu === pedido.current) setAchados(r);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  const visiveis = termo.trim().length >= 2 ? achados : [];

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        A indicação ainda não está ligada a um cadastro. Procure o indicado (ele precisa estar
        cadastrado e com a avaliação agendada).
      </p>
      <Input
        autoFocus
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Nome, código ou CPF do indicado"
      />
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {visiveis.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onEscolher(c.id)}
              className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
            >
              <span className="text-sm font-medium">
                {c.fullName}{" "}
                {c.code && <span className="font-mono text-[10px] text-muted-foreground">{c.code}</span>}
              </span>
              <span className="text-xs text-muted-foreground">{c.clinicName}</span>
            </button>
          </li>
        ))}
        {termo.trim().length >= 2 && visiveis.length === 0 && (
          <li className="px-2.5 py-2 text-sm text-muted-foreground">
            {buscando ? "Procurando…" : "Nenhum cadastro encontrado."}
          </li>
        )}
      </ul>
    </div>
  );
}

function EscolherVenda({
  clienteId,
  pendente,
  onConfirmar,
}: {
  clienteId: string;
  pendente: boolean;
  onConfirmar: (vendaId: string) => void;
}) {
  const [vendas, setVendas] = useState<OpcaoDeVenda[] | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [, carregar] = useTransition();

  useEffect(() => {
    carregar(async () => {
      setVendas(await vendasDoCliente(clienteId));
    });
  }, [clienteId]);

  return (
    <div className="space-y-3">
      {vendas === null ? (
        <p className="text-sm text-muted-foreground">Procurando as vendas…</p>
      ) : vendas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma venda fechada para este cliente. Só conta como fechamento a venda com contrato
          assinado e pagamento confirmado (no Comercial).
        </p>
      ) : (
        <ul className="space-y-1.5">
          {vendas.map((v) => (
            <li key={v.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  escolhida === v.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                )}
              >
                <input
                  type="radio"
                  name="venda"
                  checked={escolhida === v.id}
                  onChange={() => setEscolhida(v.id)}
                />
                <span className="font-medium">{formatBRL(v.valorCentavos)}</span>
                <span className="text-muted-foreground">
                  · fechada em {formatBrDate(v.fechadaEm)}
                  {v.codigoNegociacao ? ` · ${v.codigoNegociacao}` : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={() => escolhida && onConfirmar(escolhida)} disabled={pendente || !escolhida}>
          {pendente ? "Gravando…" : "Confirmar o fechamento"}
        </Button>
      </div>
    </div>
  );
}
