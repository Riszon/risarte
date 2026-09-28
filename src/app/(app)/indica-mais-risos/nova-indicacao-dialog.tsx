"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatCpf, formatPhone } from "@/lib/masks";
import { CANAIS_DA_RECEPCAO, CANAL_LABEL } from "@/lib/indica/status";
import {
  buscarIndicador,
  conferirIndicacao,
  registrarIndicacao,
  tornarEmbaixador,
  type Conferencia,
  type Indicador,
} from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

/**
 * NOVA INDICAÇÃO — o registro que aposenta a planilha.
 *
 * Dois blocos, na ordem em que a conversa acontece no balcão: QUEM indicou
 * (um Embaixador; se o cliente ainda não é, vira aqui mesmo, com o aceite do
 * regulamento) e QUEM foi indicado. A conferência de duplicidade roda enquanto
 * se digita, pela MESMA regra do banco: a tela nunca diz "livre" para algo que
 * o registro vai recusar.
 */
export function NovaIndicacaoDialog({
  unidades,
  regulamento,
  indicadorInicial,
  abrirAoGravar = true,
  gatilho,
}: {
  unidades: { id: string; name: string }[];
  /** Versão do regulamento vigente (vem do banco); nula = não foi possível ler. */
  regulamento: string | null;
  /** Aberto a partir da ficha: o cliente da ficha é quem indica. */
  indicadorInicial?: Indicador;
  /** Ir para o detalhe depois de gravar (a ficha fica onde está). */
  abrirAoGravar?: boolean;
  gatilho?: React.ReactElement;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [indicador, setIndicador] = useState<Indicador | null>(indicadorInicial ?? null);
  const [unidadeId, setUnidadeId] = useState(unidades.length === 1 ? unidades[0].id : "");
  const [telefone, setTelefone] = useState("");
  const [cpf, setCpf] = useState("");
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [gravando, gravar] = useTransition();

  // Conferência em tempo real: 400ms depois da última tecla; a resposta velha
  // é descartada (mesma lógica da busca rápida).
  const pedido = useRef(0);
  const [, conferir] = useTransition();
  useEffect(() => {
    if (!aberto || !unidadeId) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      conferir(async () => {
        const r = await conferirIndicacao({
          unidadeId,
          embaixadorId: indicador?.embaixadorId ?? null,
          telefone,
          cpf,
        });
        if (meu === pedido.current) setConferencia(r);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [aberto, unidadeId, indicador?.embaixadorId, telefone, cpf]);

  const bloqueada =
    conferencia?.situacao === "duplicada" ||
    conferencia?.situacao === "ja_e_cliente" ||
    conferencia?.situacao === "autoindicacao" ||
    conferencia?.situacao === "sem_permissao";

  function limpar() {
    setIndicador(indicadorInicial ?? null);
    setTelefone("");
    setCpf("");
    setConferencia(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    gravar(async () => {
      const r = await registrarIndicacao(formData);
      if (r.ok) {
        toast.success(`Indicação ${r.codigo} registrada. Os pontos do Embaixador ficam pendentes até o comparecimento.`);
        setAberto(false);
        limpar();
        if (abrirAoGravar) router.push(`/indica-mais-risos/indicacoes/${r.id}`);
        else router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) limpar();
      }}
    >
      <DialogTrigger
        render={
          gatilho ?? (
            <Button size="sm">
              <Plus className="mr-1 size-4" />
              Nova indicação
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova indicação</DialogTitle>
          <DialogDescription>
            Quem indicou ganha Riso Coins a cada etapa do indicado. Nada de dado clínico aqui.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Quem indicou</p>
            {indicador ? (
              <IndicadorEscolhido
                indicador={indicador}
                regulamento={regulamento}
                fixo={Boolean(indicadorInicial)}
                onTrocar={() => setIndicador(null)}
                onVirouEmbaixador={(embaixadorId, codigo) =>
                  setIndicador({ ...indicador, embaixadorId, embaixadorCodigo: codigo, embaixadorAtivo: true })
                }
              />
            ) : (
              <BuscaDeIndicador onEscolher={setIndicador} />
            )}
            <input type="hidden" name="embaixador_id" value={indicador?.embaixadorId ?? ""} />
          </section>

          <section className="space-y-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Quem foi indicado</p>
            <div>
              <Label htmlFor="indicado_nome">Nome *</Label>
              <Input id="indicado_nome" name="indicado_nome" required autoComplete="off" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="indicado_telefone">WhatsApp *</Label>
                <Input
                  id="indicado_telefone"
                  name="indicado_telefone"
                  inputMode="tel"
                  required
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhone(e.target.value))}
                  placeholder="(43) 99999-8888"
                />
              </div>
              <div>
                <Label htmlFor="indicado_cpf">CPF (se já souber)</Label>
                <Input
                  id="indicado_cpf"
                  name="indicado_cpf"
                  inputMode="numeric"
                  value={cpf}
                  onChange={(e) => setCpf(formatCpf(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="indicado_email">E-mail (opcional)</Label>
              <Input id="indicado_email" name="indicado_email" type="email" autoComplete="off" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="unidade_id">Unidade que vai atender *</Label>
                <select
                  id="unidade_id"
                  name="unidade_id"
                  value={unidadeId}
                  onChange={(e) => setUnidadeId(e.target.value)}
                  className={selectClass}
                  required
                >
                  {unidades.length !== 1 && <option value="">Escolha a unidade</option>}
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="canal">Como chegou *</Label>
                <select id="canal" name="canal" defaultValue="agendamento" className={selectClass}>
                  {CANAIS_DA_RECEPCAO.map((c) => (
                    <option key={c} value={c}>
                      {CANAL_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="space-y-1.5 rounded-lg border px-3 py-2">
              <legend className="px-1 text-sm font-medium">O indicado autorizou o contato? (LGPD) *</legend>
              {[
                ["presencial", "Sim, pessoalmente (está aqui)"],
                ["telefone", "Sim, por telefone"],
                ["", "Ainda não — gerar convite para ele aceitar pelo WhatsApp"],
              ].map(([valor, rotulo]) => (
                <label key={valor || "convite"} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="consentimento" value={valor} required defaultChecked={false} />
                  {rotulo}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                O aceite fica gravado com a data e quem registrou. Sem aceite, o convite vai para a fila de
                mensagens; se o indicado não aceitar em 7 dias, os dados dele são apagados.
              </p>
            </fieldset>
            <AvisoDeConferencia conferencia={conferencia} />
          </section>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={gravando || bloqueada || !indicador?.embaixadorId || !unidadeId}
            >
              {gravando ? "Registrando…" : "Registrar indicação"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AvisoDeConferencia({ conferencia }: { conferencia: Conferencia | null }) {
  if (!conferencia || conferencia.situacao === "incompleto") return null;
  const linha = (tom: "ok" | "alerta" | "erro", texto: string) => (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tom === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        tom === "alerta" && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tom === "erro" && "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      {tom === "ok" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{texto}</span>
    </p>
  );
  switch (conferencia.situacao) {
    case "livre":
      return linha(
        "ok",
        (conferencia.cadastroEncontrado
          ? "Livre para indicar — o indicado já tem cadastro, e a indicação será ligada a ele."
          : "Livre para indicar.") +
          (conferencia.expiraAoRegistrar
            ? " Uma indicação antiga desta pessoa, com a trava vencida, será expirada."
            : "")
      );
    case "duplicada":
      return linha("erro", `Esta pessoa já foi indicada (${conferencia.codigo}). Vale o primeiro registro.`);
    case "ja_e_cliente":
      return linha(
        "erro",
        `Esta pessoa já teve atendimento na rede nos últimos ${conferencia.janelaMeses ?? ""} meses — não pode ser indicada.`
      );
    case "autoindicacao":
      return linha("erro", "O Embaixador não pode indicar a si mesmo (mesmo telefone, CPF ou cadastro).");
    case "sem_permissao":
      return linha("erro", "Você não pode registrar indicação nesta unidade.");
    default:
      return linha("alerta", "Não foi possível conferir agora. O registro confere de novo ao gravar.");
  }
}

function BuscaDeIndicador({ onEscolher }: { onEscolher: (i: Indicador) => void }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<Indicador[]>([]);
  const [buscando, buscar] = useTransition();
  const pedido = useRef(0);

  useEffect(() => {
    const texto = termo.trim();
    if (texto.length < 2) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      buscar(async () => {
        const r = await buscarIndicador(texto);
        if (meu === pedido.current) setAchados(r);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  const visiveis = termo.trim().length >= 2 ? achados : [];

  return (
    <div className="space-y-1.5">
      <Input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Nome, código pessoal (ex.: JOAO27), CPF ou telefone"
        aria-label="Procurar quem indicou"
      />
      {termo.trim().length >= 2 && (
        <ul className="max-h-56 overflow-y-auto rounded-lg border p-1">
          {visiveis.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">
              {buscando ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> Procurando…
                </span>
              ) : (
                "Ninguém encontrado. Quem indica precisa ter cadastro no riSZon."
              )}
            </li>
          ) : (
            visiveis.map((c) => (
              <li key={`${c.clienteId ?? ""}-${c.embaixadorId ?? ""}`}>
                <button
                  type="button"
                  onClick={() => onEscolher(c)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.codigoCliente, c.unidade].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {c.embaixadorCodigo ? (
                    <span className="shrink-0 rounded-full bg-gold px-2 py-0.5 font-mono text-[10px] text-gold-foreground">
                      {c.embaixadorCodigo}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted-foreground">ainda não é Embaixador</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function IndicadorEscolhido({
  indicador,
  regulamento,
  fixo,
  onTrocar,
  onVirouEmbaixador,
}: {
  indicador: Indicador;
  regulamento: string | null;
  fixo: boolean;
  onTrocar: () => void;
  onVirouEmbaixador: (embaixadorId: string, codigo: string) => void;
}) {
  const [aceitou, setAceitou] = useState(false);
  const [criando, criar] = useTransition();

  function virar() {
    if (!indicador.clienteId || !regulamento) return;
    criar(async () => {
      const r = await tornarEmbaixador(indicador.clienteId!, regulamento, aceitou);
      if (r.ok) {
        toast.success(`${indicador.nome} agora é Embaixador(a) — código ${r.codigo}.`);
        onVirouEmbaixador(r.embaixadorId, r.codigo);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{indicador.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {indicador.embaixadorCodigo
              ? `Embaixador(a) ${indicador.embaixadorCodigo}${indicador.nivel ? ` · ${indicador.nivel}` : ""}`
              : "Ainda não é Embaixador(a)"}
          </p>
        </div>
        {!fixo && (
          <Button type="button" variant="ghost" size="sm" onClick={onTrocar}>
            Trocar
          </Button>
        )}
      </div>

      {indicador.embaixadorId && !indicador.embaixadorAtivo && (
        <p className="text-xs text-destructive">
          Este Embaixador está suspenso ou encerrado no programa e não pode indicar.
        </p>
      )}

      {!indicador.embaixadorId && (
        <div className="space-y-2 border-t pt-2">
          {regulamento ? (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={aceitou}
                  onChange={(e) => setAceitou(e.target.checked)}
                />
                <span>
                  O cliente aceitou o regulamento do programa (versão {regulamento}). O sistema
                  grava a data e quem registrou o aceite.
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={virar}
                disabled={!aceitou || criando || !indicador.clienteId}
              >
                <UserPlus className="mr-1 size-4" />
                {criando ? "Criando…" : "Tornar Embaixador(a)"}
              </Button>
            </>
          ) : (
            <p className="text-xs text-destructive">
              Não foi possível ler a versão do regulamento. Avise o administrador.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
