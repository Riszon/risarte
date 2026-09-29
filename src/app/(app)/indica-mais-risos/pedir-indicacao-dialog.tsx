"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, HandHeart, Loader2, Plus, Trash2 } from "lucide-react";
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
import { formatPhone } from "@/lib/masks";
import { CANAIS_DA_RECEPCAO, CANAL_LABEL } from "@/lib/indica/status";
import { PEDIDO_MOMENTOS, PEDIDO_RESULTADOS } from "@/lib/indica/rotulos";
import {
  ACEITES,
  ACEITE_LABEL,
  MAX_POR_LOTE,
  errosDoLote,
  linhasPreenchidas,
  type Aceite,
  type LinhaLote,
} from "@/lib/indica/lote";
import { conferirIndicacao, registrarPedidoEIndicacoes, type Conferencia } from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

type Linha = LinhaLote & { chave: number; erroDoBanco?: string };

// Só gera chaves únicas para as linhas da tela (nenhum dado de pessoa aqui).
let ultimaChave = 0;
const novaLinha = (aceite: Aceite): Linha => ({ chave: ++ultimaChave, nome: "", telefone: "", aceite });

/**
 * PEDIR INDICAÇÃO — um botão só na ficha do cliente.
 *
 * O pedido e as indicações na MESMA janela: se o cliente indicou, a recepção
 * inclui as pessoas ali mesmo, quantas forem (Enter no WhatsApp abre a
 * próxima linha), e salva UMA vez. Cada pessoa é conferida enquanto se digita,
 * pela mesma regra do banco. Uma pessoa recusada não derruba as outras: a
 * janela fica aberta só com quem precisa de correção.
 */
export function PedirIndicacaoDialog({
  cliente,
  embaixador,
  unidades,
  unidadePadrao,
  regulamento,
}: {
  cliente: { id: string; nome: string };
  embaixador: { id: string; codigo: string; nivel: string | null; ativo: boolean } | null;
  unidades: { id: string; name: string }[];
  unidadePadrao: string;
  regulamento: string | null;
}) {
  const router = useRouter();
  const primeiroNome = cliente.nome.split(" ")[0];
  const unidadeInicial = unidades.some((u) => u.id === unidadePadrao) ? unidadePadrao : unidades[0]?.id ?? "";

  const [aberto, setAberto] = useState(false);
  const [momento, setMomento] = useState("fechamento");
  const [resultado, setResultado] = useState("indicou");
  const [observacao, setObservacao] = useState("");
  const [unidadeId, setUnidadeId] = useState(unidadeInicial);
  const [canal, setCanal] = useState<string>(CANAIS_DA_RECEPCAO[0]);
  const [aceitePadrao, setAceitePadrao] = useState<Aceite>("");
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha("")]);
  const [aceitouRegulamento, setAceitouRegulamento] = useState(false);
  const [emb, setEmb] = useState(embaixador);
  const [pedidoFeito, setPedidoFeito] = useState(false);
  const [registradas, setRegistradas] = useState<string[]>([]);
  const [gravando, gravar] = useTransition();
  const [focarChave, setFocarChave] = useState<number | null>(null);

  const indicou = resultado === "indicou";
  const preenchidas = linhasPreenchidas(linhas);
  const erros = errosDoLote(linhas);
  const precisaRegulamento = indicou && preenchidas.length > 0 && !emb;
  const podeSalvar =
    !gravando &&
    unidadeId !== "" &&
    (!indicou || preenchidas.length > 0) &&
    erros.size === 0 &&
    preenchidas.length <= MAX_POR_LOTE &&
    (!precisaRegulamento || (aceitouRegulamento && Boolean(regulamento))) &&
    !(emb && !emb.ativo && indicou);

  function reiniciar() {
    setMomento("fechamento");
    setResultado("indicou");
    setObservacao("");
    setAceitePadrao("");
    setLinhas([novaLinha("")]);
    setAceitouRegulamento(false);
    setPedidoFeito(false);
    setRegistradas([]);
  }

  function mudarLinha(chave: number, mudanca: Partial<Linha>) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...mudanca, erroDoBanco: undefined } : l)));
  }

  function adicionar() {
    const n = novaLinha(aceitePadrao);
    setFocarChave(n.chave);
    setLinhas((ls) => [...ls, n]);
  }

  function salvar() {
    gravar(async () => {
      const enviar = linhasPreenchidas(linhas) as Linha[];
      const r = await registrarPedidoEIndicacoes({
        clienteId: cliente.id,
        unidadeId,
        momento,
        resultado,
        observacao,
        pularPedido: pedidoFeito,
        embaixadorId: emb?.id ?? null,
        versaoRegulamento: regulamento,
        aceitouRegulamento,
        canal,
        linhas: enviar.map(({ nome, telefone, aceite }) => ({ nome, telefone, aceite })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setPedidoFeito(true);
      if (r.embaixadorId && !emb) {
        setEmb({ id: r.embaixadorId, codigo: r.codigoEmbaixador ?? "", nivel: null, ativo: true });
      }
      const ok = r.linhas.flatMap((x) => (x.ok ? [x.codigo] : []));
      const falhas = enviar.flatMap((l, i) => {
        const res = r.linhas[i];
        return res && !res.ok ? [{ ...l, erroDoBanco: res.error }] : [];
      });
      setRegistradas((antes) => [...antes, ...ok]);
      if (falhas.length === 0) {
        toast.success(
          ok.length === 0
            ? "Pedido de indicação registrado."
            : `Pedido registrado e ${ok.length} indicação(ões) criada(s). Os pontos ficam pendentes até o comparecimento.`
        );
        setAberto(false);
        reiniciar();
        router.refresh();
      } else {
        toast.warning(`${ok.length} registrada(s); ${falhas.length} precisa(m) de atenção — veja abaixo.`);
        setLinhas(falhas);
        router.refresh();
      }
    });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) reiniciar();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <HandHeart className="mr-1 size-4" />
            Pedir indicação
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pedir indicação a {primeiroNome}</DialogTitle>
          <DialogDescription>
            Registre o pedido e, se {primeiroNome} indicou, inclua aqui todas as pessoas de uma vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="momento">Quando você pediu</Label>
              <select id="momento" value={momento} disabled={pedidoFeito} onChange={(e) => setMomento(e.target.value)} className={selectClass}>
                {PEDIDO_MOMENTOS.map((m) => (
                  <option key={m.valor} value={m.valor}>{m.rotulo}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="resultado">O que respondeu</Label>
              <select id="resultado" value={resultado} disabled={pedidoFeito} onChange={(e) => setResultado(e.target.value)} className={selectClass}>
                {PEDIDO_RESULTADOS.map((m) => (
                  <option key={m.valor} value={m.valor}>{m.rotulo}</option>
                ))}
              </select>
            </div>
          </div>

          {indicou && (
            <section className="space-y-3 rounded-xl border p-3">
              <div className="text-sm">
                {emb ? (
                  <p>
                    <strong>{cliente.nome}</strong> é Embaixador(a) <span className="font-mono">{emb.codigo}</span>
                    {emb.nivel ? ` · ${emb.nivel}` : ""}.
                    {!emb.ativo && <span className="block text-destructive">Está suspenso ou encerrado no programa e não pode indicar.</span>}
                  </p>
                ) : regulamento ? (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={aceitouRegulamento} onChange={(e) => setAceitouRegulamento(e.target.checked)} />
                    <span>
                      {primeiroNome} ainda não é Embaixador(a). <strong>Aceitou o regulamento do programa</strong> (versão{" "}
                      {regulamento}) — vira Embaixador(a) ao salvar, com a data e quem registrou.
                    </span>
                  </label>
                ) : (
                  <p className="text-destructive">Não foi possível ler a versão do regulamento. Avise o administrador.</p>
                )}
              </div>

              <div className={cn("grid gap-3", unidades.length > 1 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                {unidades.length > 1 && (
                  <div>
                    <Label htmlFor="unidade">Unidade que vai atender</Label>
                    <select id="unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className={selectClass}>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <Label htmlFor="canal">Como chegou</Label>
                  <select id="canal" value={canal} onChange={(e) => setCanal(e.target.value)} className={selectClass}>
                    {CANAIS_DA_RECEPCAO.map((c) => (
                      <option key={c} value={c}>{CANAL_LABEL[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="aceite-todos">Autorizaram o contato? (LGPD — vale para todos)</Label>
                  <select
                    id="aceite-todos"
                    value={aceitePadrao}
                    onChange={(e) => {
                      const v = e.target.value as Aceite;
                      setAceitePadrao(v);
                      setLinhas((ls) => ls.map((l) => ({ ...l, aceite: v })));
                    }}
                    className={selectClass}
                  >
                    {ACEITES.map((a) => (
                      <option key={a || "convite"} value={a}>{ACEITE_LABEL[a]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Pessoas indicadas ({preenchidas.length}) — Enter no WhatsApp abre a próxima linha
                </p>
                {linhas.map((l, i) => (
                  <LinhaDaPessoa
                    key={l.chave}
                    indice={i}
                    linha={l}
                    erro={erros.get(i) ?? l.erroDoBanco}
                    unidadeId={unidadeId}
                    embaixadorId={emb?.id ?? null}
                    focar={focarChave === l.chave}
                    podeTirar={linhas.length > 1}
                    onMudar={(m) => mudarLinha(l.chave, m)}
                    onTirar={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                    onEnter={() => (i === linhas.length - 1 ? adicionar() : undefined)}
                  />
                ))}
                <Button type="button" size="sm" variant="outline" onClick={adicionar} disabled={linhas.length >= MAX_POR_LOTE}>
                  <Plus className="mr-1 size-4" /> Adicionar outra pessoa
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sem autorização, cada pessoa recebe o convite pela fila de Mensagens; quem não aceitar no prazo tem os dados
                  anonimizados.
                </p>
              </div>
            </section>
          )}

          <div>
            <Label htmlFor="observacao">Observação (opcional)</Label>
            <textarea
              id="observacao"
              value={observacao}
              disabled={pedidoFeito}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
              placeholder="Sem dado clínico."
            />
          </div>

          {registradas.length > 0 && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              Já registradas: {registradas.join(", ")}. Corrija as de baixo e salve de novo — o pedido não é duplicado.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>Fechar</Button>
            <Button onClick={salvar} disabled={!podeSalvar}>
              {gravando
                ? "Registrando…"
                : !indicou
                  ? "Registrar pedido"
                  : `Registrar ${pedidoFeito ? "" : "pedido e "}${preenchidas.length} indicação(ões)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinhaDaPessoa({
  indice,
  linha,
  erro,
  unidadeId,
  embaixadorId,
  focar,
  podeTirar,
  onMudar,
  onTirar,
  onEnter,
}: {
  indice: number;
  linha: Linha;
  erro?: string;
  unidadeId: string;
  embaixadorId: string | null;
  focar: boolean;
  podeTirar: boolean;
  onMudar: (m: Partial<Linha>) => void;
  onTirar: () => void;
  onEnter: () => void;
}) {
  const nomeRef = useRef<HTMLInputElement>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [conferindo, conferir] = useTransition();
  const pedido = useRef(0);

  useEffect(() => {
    if (focar) nomeRef.current?.focus();
  }, [focar]);

  // Conferência da pessoa enquanto se digita (mesma regra do banco).
  const digitos = linha.telefone.replace(/\D/g, "");
  useEffect(() => {
    if (!unidadeId || digitos.length < 10) return;
    const meu = ++pedido.current;
    const t = setTimeout(() => {
      conferir(async () => {
        const r = await conferirIndicacao({ unidadeId, embaixadorId, telefone: linha.telefone, cpf: "" });
        if (meu === pedido.current) setConferencia(r);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [unidadeId, embaixadorId, digitos, linha.telefone]);

  const aviso =
    erro ??
    (digitos.length >= 10 && conferencia
      ? conferencia.situacao === "duplicada"
        ? `Já foi indicada (${conferencia.codigo}). Vale o primeiro registro.`
        : conferencia.situacao === "ja_e_cliente"
          ? `Já é paciente (atendida nos últimos ${conferencia.janelaMeses ?? ""} meses).`
          : conferencia.situacao === "autoindicacao"
            ? "É o próprio Embaixador."
            : null
      : null);
  const livre = !aviso && digitos.length >= 10 && conferencia?.situacao === "livre";

  return (
    <div className={cn("rounded-lg border p-2", aviso && "border-destructive/50 bg-destructive/5")}>
      <div className="grid items-center gap-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_10rem_10.5rem_2rem]">
        <span className="text-xs text-muted-foreground">{indice + 1}.</span>
        <Input
          ref={nomeRef}
          aria-label={`Nome da pessoa ${indice + 1}`}
          placeholder="Nome"
          value={linha.nome}
          autoComplete="off"
          onChange={(e) => onMudar({ nome: e.target.value })}
        />
        <Input
          aria-label={`WhatsApp da pessoa ${indice + 1}`}
          placeholder="(43) 99999-8888"
          inputMode="tel"
          value={linha.telefone}
          onChange={(e) => onMudar({ telefone: formatPhone(e.target.value) })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
        />
        <select
          aria-label={`Autorização da pessoa ${indice + 1}`}
          value={linha.aceite}
          onChange={(e) => onMudar({ aceite: e.target.value as Aceite })}
          className={selectClass}
        >
          {ACEITES.map((a) => (
            <option key={a || "convite"} value={a}>{ACEITE_LABEL[a]}</option>
          ))}
        </select>
        <Button type="button" size="icon" variant="ghost" aria-label={`Tirar a pessoa ${indice + 1}`} disabled={!podeTirar} onClick={onTirar}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {(aviso || livre || conferindo) && (
        <p className={cn("mt-1 flex items-center gap-1 pl-7 text-xs", aviso ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
          {conferindo && !aviso ? (
            <><Loader2 className="size-3 animate-spin" /> conferindo…</>
          ) : aviso ? (
            <><AlertTriangle className="size-3" /> {aviso}</>
          ) : (
            <><CheckCircle2 className="size-3" /> Livre para indicar{conferencia?.cadastroEncontrado ? " (já tem cadastro — será ligada a ele)" : ""}</>
          )}
        </p>
      )}
    </div>
  );
}
