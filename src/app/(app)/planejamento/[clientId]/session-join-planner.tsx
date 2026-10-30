"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  GripVertical,
  Link2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { GutBadge } from "@/components/gut-badge";
import { PopupCard } from "@/components/popup-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rotuloDoLocal } from "@/lib/odontograma/plano";
import type { ProjectedSession, TreatmentPlan } from "@/lib/planning";
import { formatMinutes, type BudgetItem } from "@/lib/pricing";
import {
  chaveDaSessao,
  juntarSessoes,
  linhasParaGravar,
  montarAtendimentos,
  moverAtendimento,
  opcaoConfigurada,
  ordenarPorPrioridade,
  planoEditavel,
  repartirTempoDoAtendimento,
  separarSessao,
} from "@/lib/sequencia-do-plano";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import {
  confirmarSequenciaDaOpcao,
  salvarSequenciaDaOpcao,
} from "../../prontuarios/[id]/planning-actions";
import { usePlanoSelecionado } from "../../prontuarios/[id]/plano-selecionado";

export type OpcaoDaSequencia = {
  id: string;
  title: string;
  isPrimary: boolean;
  items: BudgetItem[];
  sessions: ProjectedSession[];
  confirmadaEm: string | null;
};

export type SequenciasPorPlano = Record<string, OpcaoDaSequencia[]>;

type Profissional = { id: string; name: string };
type Regiao = { code: string; name: string };

function localDoItem(item: BudgetItem | undefined, regioes: Regiao[]): string | null {
  if (!item) return null;
  return rotuloDoLocal(
    {
      toothCode: item.toothCode ?? null,
      faceCodes: item.faceCodes ?? [],
      regionCode: item.regionCode ?? null,
    },
    (c) => regioes.find((r) => r.code === c)?.name
  );
}

function SeloDaSituacao({ configurada }: { configurada: boolean }) {
  return configurada ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      <CheckCircle2 className="size-3" aria-hidden />
      Configurado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <CircleDashed className="size-3" aria-hidden />
      Pendente
    </span>
  );
}

/**
 * O cartão do cockpit: segue o plano selecionado na tela (OC-00009), e o selo
 * diz se ele já está configurado.
 */
export function CartaoDaSequencia({
  plans,
  sequencias,
  podeDefinir,
  providerOptions,
  regioes,
}: {
  plans: TreatmentPlan[];
  sequencias: SequenciasPorPlano;
  podeDefinir: boolean;
  providerOptions: Profissional[];
  regioes: Regiao[];
}) {
  const planoId = usePlanoSelecionado()?.planoId ?? null;
  const plano = plans.find((p) => p.id === planoId);
  const opcoes = planoId ? sequencias[planoId] : undefined;
  if (!plano || !opcoes || opcoes.length === 0) return null;
  return (
    <SequenciaDoPlano
      // Trocar de plano ou mudar os procedimentos refaz o estado: a lista da tela
      // nunca fica velha nem grava por cima de outra.
      key={`${plano.id}|${opcoes.map((o) => o.sessions.map(chaveDaSessao).sort().join()).join("|")}`}
      opcoes={opcoes}
      editavel={planoEditavel(plano)}
      podeDefinir={podeDefinir}
      providerOptions={providerOptions}
      regioes={regioes}
    />
  );
}

type Situacao = "salvo" | "salvando" | "erro";

/**
 * Dono do estado da janela. Fica FORA dela: a janela desmonta ao fechar, e o que
 * acabou de ser movido não pode sumir ao abrir de novo.
 */
function SequenciaDoPlano({
  opcoes,
  editavel,
  podeDefinir,
  providerOptions,
  regioes,
}: {
  opcoes: OpcaoDaSequencia[];
  editavel: boolean;
  podeDefinir: boolean;
  providerOptions: Profissional[];
  regioes: Regiao[];
}) {
  const router = useRouter();
  const canEdit = podeDefinir && editavel;
  const [ativa, setAtiva] = useState(opcoes[0]?.id ?? "");
  const [estado, setEstado] = useState<Record<string, ProjectedSession[]>>(() =>
    Object.fromEntries(opcoes.map((o) => [o.id, o.sessions]))
  );
  const [confirmadasAgora, setConfirmadasAgora] = useState<Record<string, string>>({});
  const confirmadaEm = (o: OpcaoDaSequencia) => o.confirmadaEm ?? confirmadasAgora[o.id] ?? null;
  const [situacao, setSituacao] = useState<Situacao>("salvo");
  const [confirmando, startConfirmar] = useTransition();

  // Gravação por trás: o último retrato de cada opção espera 500 ms; enquanto uma
  // gravação corre, a próxima aguarda. Assim, dez cliques seguidos são uma ida só.
  const pendentes = useRef(new Map<string, ProjectedSession[]>());
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gravando = useRef(false);

  const gravarPendentes = useCallback(async () => {
    if (gravando.current) return;
    gravando.current = true;
    try {
      while (pendentes.current.size > 0) {
        const [id, sessions] = [...pendentes.current.entries()][0];
        pendentes.current.delete(id);
        setSituacao("salvando");
        const r = await salvarSequenciaDaOpcao(id, linhasParaGravar(sessions));
        if (!r.ok) {
          // Devolve para a fila: a tela não finge que gravou.
          if (!pendentes.current.has(id)) pendentes.current.set(id, sessions);
          setSituacao("erro");
          toast.error(r.error ?? "Não foi possível salvar a sequência.");
          return;
        }
      }
      setSituacao("salvo");
    } finally {
      gravando.current = false;
    }
  }, []);

  const mudar = useCallback(
    (opcaoId: string, novo: ProjectedSession[]) => {
      setEstado((e) => ({ ...e, [opcaoId]: novo }));
      pendentes.current.set(opcaoId, novo);
      setSituacao("salvando");
      if (relogio.current) clearTimeout(relogio.current);
      relogio.current = setTimeout(() => void gravarPendentes(), 500);
    },
    [gravarPendentes]
  );

  // Fechar a aba com gravação na fila pede confirmação; sair do plano grava.
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (pendentes.current.size > 0 || gravando.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    const fila = pendentes.current;
    return () => {
      window.removeEventListener("beforeunload", avisar);
      if (relogio.current) clearTimeout(relogio.current);
      if (fila.size > 0) void gravarPendentes();
    };
  }, [gravarPendentes]);

  function confirmar(opcaoId: string) {
    startConfirmar(async () => {
      if (relogio.current) clearTimeout(relogio.current);
      pendentes.current.delete(opcaoId);
      const r = await confirmarSequenciaDaOpcao(
        opcaoId,
        linhasParaGravar(estado[opcaoId] ?? [])
      );
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível confirmar a sequência.");
        return;
      }
      setConfirmadasAgora((c) => ({ ...c, [opcaoId]: new Date().toISOString() }));
      toast.success("Sequência confirmada.");
      router.refresh();
    });
  }

  const situacoes = opcoes.map((o) =>
    opcaoConfigurada(
      { confirmadaEm: confirmadaEm(o), sessions: estado[o.id] ?? o.sessions },
      editavel
    )
  );
  const tudoConfigurado = situacoes.every(Boolean);
  const opcao = opcoes.find((o) => o.id === ativa) ?? opcoes[0];
  const configuradaAtiva = situacoes[opcoes.indexOf(opcao)];

  return (
    <PopupCard
      label="Atendimentos e sequência"
      icon={<Link2 className="size-4" />}
      badge={<SeloDaSituacao configurada={tudoConfigurado} />}
      wide
    >
      <div className="space-y-3">
        {opcoes.length > 1 && (
          <div className="space-y-1.5">
            <div role="tablist" className="flex flex-wrap gap-1.5">
              {opcoes.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={o.id === opcao.id}
                  onClick={() => setAtiva(o.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    o.id === opcao.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {situacoes[i] ? (
                    <CheckCircle2 className="size-3" aria-label="Configurada" />
                  ) : (
                    <CircleDashed className="size-3" aria-label="Pendente" />
                  )}
                  {o.title}
                  {o.isPrimary ? " · principal" : ""}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Cada opção tem os seus atendimentos e a sua sequência, e todas precisam
              estar confirmadas para enviar ao Coordenador. Vira sessão a da opção que
              o cliente <strong>comprar</strong>.
            </p>
          </div>
        )}

        <ListaDeAtendimentos
          // A chave zera a marcação e o arrasto ao trocar de opção.
          key={opcao.id}
          sessions={estado[opcao.id] ?? opcao.sessions}
          items={opcao.items}
          canEdit={canEdit}
          providerOptions={providerOptions}
          regioes={regioes}
          onChange={(novo) => mudar(opcao.id, novo)}
        />

        {canEdit ? (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t bg-popover pt-3">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {situacao === "salvando" && "Salvando…"}
              {situacao === "salvo" && "Tudo salvo."}
              {situacao === "erro" && (
                <button
                  type="button"
                  className="font-medium text-destructive underline"
                  onClick={() => void gravarPendentes()}
                >
                  Não salvou. Tentar de novo
                </button>
              )}
            </span>
            {configuradaAtiva ? (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Sequência confirmada
                {confirmadaEm(opcao)
                  ? ` em ${new Date(confirmadaEm(opcao)!).toLocaleDateString("pt-BR", { timeZone: BRAZIL_TIME_ZONE })}`
                  : ""}
              </span>
            ) : (
              <Button size="sm" disabled={confirmando} onClick={() => confirmar(opcao.id)}>
                <CheckCircle2 className="mr-1 size-4" />
                Confirmar sequência
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {podeDefinir
              ? "Este plano já foi enviado ou substituído: para mudar a sequência, crie uma nova versão (ela leva a configuração junto)."
              : "Só o Planner altera a sequência."}
          </p>
        )}
      </div>
    </PopupCard>
  );
}

/** A lista em si: mostra, marca, arrasta. Quem guarda o estado é quem chama. */
function ListaDeAtendimentos({
  sessions,
  items,
  canEdit,
  providerOptions,
  regioes,
  onChange,
}: {
  sessions: ProjectedSession[];
  items: BudgetItem[];
  canEdit: boolean;
  providerOptions: Profissional[];
  regioes: Regiao[];
  onChange: (novo: ProjectedSession[]) => void;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [destino, setDestino] = useState<number | null>(null);

  const itemPorId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const atendimentos = useMemo(() => montarAtendimentos(sessions), [sessions]);
  const temPrioridade = items.some((i) => i.gutGravity && i.gutUrgency && i.gutTendency);
  const nomeDoProfissional = (id: string | null) =>
    id ? (providerOptions.find((p) => p.id === id)?.name ?? null) : null;

  function marcar(chave: string, ligada: boolean) {
    setMarcadas((m) => {
      const novo = new Set(m);
      if (ligada) novo.add(chave);
      else novo.delete(chave);
      return novo;
    });
  }

  function aoSoltar() {
    if (arrastando !== null && destino !== null) {
      // `destino` é a linha ENTRE atendimentos; tirar o de cima desloca em um.
      const para = destino > arrastando ? destino - 1 : destino;
      if (para !== arrastando) onChange(moverAtendimento(sessions, arrastando, para));
    }
    setArrastando(null);
    setDestino(null);
  }

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Arraste, use as setas ou digite a posição. Para fazer no mesmo horário,
            marque as sessões e clique em <strong>Juntar</strong>.
          </p>
          {temPrioridade && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange(ordenarPorPrioridade(sessions, itemPorId))}
            >
              <ArrowDownWideNarrow className="mr-1 size-4" />
              Ordenar por prioridade
            </Button>
          )}
        </div>
      )}

      {canEdit && marcadas.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs">
          <span className="font-medium">
            {marcadas.size} {marcadas.size === 1 ? "sessão marcada" : "sessões marcadas"}
          </span>
          <Button
            size="sm"
            disabled={marcadas.size < 2}
            onClick={() => {
              onChange(juntarSessoes(sessions, marcadas));
              setMarcadas(new Set());
            }}
          >
            <Link2 className="mr-1 size-4" />
            Juntar no mesmo atendimento
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMarcadas(new Set())}>
            Limpar
          </Button>
        </div>
      )}

      <ol
        className="max-h-[58vh] space-y-2 overflow-y-auto pr-1"
        onDragOver={(e) => {
          if (!canEdit || arrastando === null) return;
          e.preventDefault();
          // Rola sozinha perto das bordas: lista longa não cabe na janela.
          const caixa = e.currentTarget.getBoundingClientRect();
          if (e.clientY < caixa.top + 48) e.currentTarget.scrollTop -= 14;
          else if (e.clientY > caixa.bottom - 48) e.currentTarget.scrollTop += 14;
        }}
        onDrop={(e) => {
          e.preventDefault();
          aoSoltar();
        }}
      >
        {atendimentos.map((a, i) => {
          const profissionais = new Set(
            a.sessions.map((s) => s.providerId).filter((p): p is string => Boolean(p))
          );
          const conflito = profissionais.size > 1;
          return (
            <li
              key={a.key}
              draggable={canEdit}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setArrastando(i);
              }}
              onDragEnd={() => {
                setArrastando(null);
                setDestino(null);
              }}
              onDragOver={(e) => {
                if (!canEdit || arrastando === null) return;
                const caixa = e.currentTarget.getBoundingClientRect();
                setDestino(e.clientY < caixa.top + caixa.height / 2 ? i : i + 1);
              }}
              className={`rounded-md border p-2 ${arrastando === i ? "opacity-40" : ""} ${
                conflito ? "border-destructive/50" : ""
              } ${destino === i && arrastando !== null ? "border-t-4 border-t-primary" : ""} ${
                destino === i + 1 && i === atendimentos.length - 1 && arrastando !== null
                  ? "border-b-4 border-b-primary"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {canEdit && (
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-muted-foreground"
                    aria-hidden
                  />
                )}
                {canEdit ? (
                  <Input
                    // Refaz o campo quando a posição muda por outro caminho.
                    key={`pos-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={atendimentos.length}
                    defaultValue={i + 1}
                    aria-label="Posição do atendimento na sequência"
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n !== i + 1) {
                        onChange(moverAtendimento(sessions, i, n - 1));
                      } else {
                        e.target.value = String(i + 1);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="h-7 w-14 px-1 text-center text-xs font-semibold"
                  />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                )}
                <span className="text-sm font-medium">Atendimento {i + 1}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {i === 0 ? "Início · " : i === atendimentos.length - 1 ? "Fim · " : ""}
                  {a.sessions.length} {a.sessions.length === 1 ? "sessão" : "sessões"}
                  {a.minutes > 0 ? ` · ${formatMinutes(a.minutes)}` : ""}
                </span>
                {canEdit && (
                  <span className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Subir na sequência"
                      disabled={i === 0}
                      onClick={() => onChange(moverAtendimento(sessions, i, i - 1))}
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Descer na sequência"
                      disabled={i === atendimentos.length - 1}
                      onClick={() => onChange(moverAtendimento(sessions, i, i + 1))}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </span>
                )}
              </div>

              {conflito && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                  <AlertTriangle className="size-3" aria-hidden />
                  Profissionais diferentes neste atendimento. Ajuste abaixo.
                </p>
              )}

              {/* OC-00087: dez sessões no mesmo horário não levam a soma dos
                  tempos; o Planner digita o total e o sistema reparte. */}
              {canEdit && a.sessions.length > 1 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                  <label htmlFor={`tempo-${a.key}`} className="font-medium">
                    Tempo do atendimento
                  </label>
                  <Input
                    key={`${a.key}-${a.minutes}`}
                    id={`tempo-${a.key}`}
                    type="number"
                    inputMode="numeric"
                    min={a.sessions.length}
                    defaultValue={a.minutes > 0 ? a.minutes : ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v === "" || Number(v) === a.minutes) return;
                      const novo = repartirTempoDoAtendimento(sessions, a, Number(v));
                      if (novo) {
                        onChange(novo);
                      } else {
                        toast.error(
                          `Informe pelo menos ${a.sessions.length} minutos (1 por sessão).`
                        );
                        e.target.value = a.minutes > 0 ? String(a.minutes) : "";
                      }
                    }}
                    className="h-7 w-20"
                  />
                  <span className="text-muted-foreground">
                    min, repartidos entre as {a.sessions.length} sessões abaixo.
                  </span>
                </div>
              )}

              <ul className="mt-1.5 space-y-1.5">
                {a.sessions.map((s) => {
                  const chave = chaveDaSessao(s);
                  const item = itemPorId.get(s.itemId);
                  const local = localDoItem(item, regioes);
                  return (
                    <li
                      key={chave}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                    >
                      {canEdit && (
                        <input
                          type="checkbox"
                          checked={marcadas.has(chave)}
                          onChange={(e) => marcar(chave, e.target.checked)}
                          aria-label={`Marcar ${s.procedureName}`}
                          className="size-4 shrink-0"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <span className="font-medium">{s.procedureName}</span>
                        <span className="text-xs text-muted-foreground">{s.name}</span>
                        {local && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                            {local}
                          </span>
                        )}
                        <GutBadge item={item ?? {}} />
                      </span>
                      {canEdit ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Input
                              key={s.plannedMinutes ?? "vazio"}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              defaultValue={s.plannedMinutes ?? ""}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const n = v === "" ? null : Number(v);
                                if ((s.plannedMinutes ?? null) !== (n ?? null)) {
                                  onChange(
                                    sessions.map((x) =>
                                      chaveDaSessao(x) === chave
                                        ? { ...x, plannedMinutes: n }
                                        : x
                                    )
                                  );
                                }
                              }}
                              className="h-7 w-16"
                              aria-label="Tempo da sessão (min)"
                            />
                            min
                          </span>
                          <select
                            value={s.providerId ?? ""}
                            onChange={(e) =>
                              onChange(
                                sessions.map((x) =>
                                  chaveDaSessao(x) === chave
                                    ? { ...x, providerId: e.target.value || null }
                                    : x
                                )
                              )
                            }
                            className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
                            aria-label="Profissional da sessão"
                          >
                            <option value="">Profissional: automático</option>
                            {providerOptions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          {a.sessions.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onChange(separarSessao(sessions, chave))}
                            >
                              <Unlink className="mr-1 size-3.5" />
                              Separar
                            </Button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {s.plannedMinutes ? `${s.plannedMinutes} min` : ""}
                          {nomeDoProfissional(s.providerId)
                            ? ` · ${nomeDoProfissional(s.providerId)}`
                            : ""}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * O que o Coordenador e o Consultor veem (SQ3): a sequência que o Planner sugere,
 * sem editar. Para pedir mudança, o Coordenador devolve o plano com a observação.
 */
export function SequenciaSomenteLeitura({
  opcoes,
  editavel,
  providerOptions = [],
  regioes = [],
}: {
  opcoes: OpcaoDaSequencia[];
  editavel: boolean;
  providerOptions?: Profissional[];
  regioes?: Regiao[];
}) {
  const [ativa, setAtiva] = useState(opcoes[0]?.id ?? "");
  if (opcoes.length === 0) return null;
  const opcao = opcoes.find((o) => o.id === ativa) ?? opcoes[0];
  const configurada = opcoes.every((o) => opcaoConfigurada(o, editavel));
  return (
    <details className="rounded-lg border bg-card p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
        <Link2 className="size-4 text-gold-tinta" aria-hidden />
        Atendimentos e sequência sugeridos pelo Planner
        <SeloDaSituacao configurada={configurada} />
      </summary>
      <div className="mt-3 space-y-2">
        {opcoes.length > 1 && (
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === opcao.id}
                onClick={() => setAtiva(o.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  o.id === opcao.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {o.title}
              </button>
            ))}
          </div>
        )}
        <ListaDeAtendimentos
          key={opcao.id}
          sessions={opcao.sessions}
          items={opcao.items}
          canEdit={false}
          providerOptions={providerOptions}
          regioes={regioes}
          onChange={() => {}}
        />
      </div>
    </details>
  );
}
