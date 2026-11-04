"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatInBrazil } from "@/lib/dates";
import { MODULOS, MODULO_ROTULO, type ModuloDoSistema } from "@/lib/system-reports";
import {
  FILTRO_INICIAL,
  PRIORIDADES,
  PRIORIDADE_EXPLICA,
  PRIORIDADE_ROTULO,
  SITUACOES,
  SITUACAO_ROTULO,
  contar,
  estaFechado,
  filtrar,
  ordenar,
  type Aba,
  type CategoriaDoBacklog,
  type Filtro,
  type ItemDoBacklog,
  type Prioridade,
  type SituacaoDoItem,
} from "@/lib/backlog";
import { Escolha, SeloDePrioridade, SeloDeSituacao } from "./pecas";
import { JanelaDasCategorias } from "./categorias";
import { NovoItem } from "./novo-item";
import { BarraDoLote } from "./barra-do-lote";

const TODAS = "__todas";

const ABAS: { value: Aba; label: string }[] = [
  { value: "abertos", label: "Abertos" },
  { value: "resolvidos", label: "Resolvidos" },
  { value: "todos", label: "Todos" },
];

/** Dias entre duas datas "AAAA-MM-DD" (calendário, sem fuso). */
function diasEntre(de: string, ate: string): number {
  const [a, b] = [de, ate].map((s) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Instante → "dd/mm/aa" no horário de Brasília (nunca o recorte do texto UTC). */
function dataCurta(iso: string): string {
  return formatInBrazil(iso, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function TelaDoBacklog({
  itens,
  categorias,
  hoje,
  noTreino,
}: {
  itens: ItemDoBacklog[];
  categorias: CategoriaDoBacklog[];
  /** Hoje no Brasil, "AAAA-MM-DD" — vem do servidor. */
  hoje: string;
  noTreino: boolean;
}) {
  const [f, setF] = useState<Filtro>(FILTRO_INICIAL);
  // BK3: a escolha é por código e sobrevive aos filtros — filtrar depois de
  // escolher não pode tirar ninguém do lote em silêncio.
  const [escolhidos, setEscolhidos] = useState<Set<string>>(() => new Set());
  const alternar = (code: string) =>
    setEscolhidos((antes) => {
      const proximo = new Set(antes);
      if (proximo.has(code)) proximo.delete(code);
      else proximo.add(code);
      return proximo;
    });
  const mudar = (parte: Partial<Filtro>) => setF((antes) => ({ ...antes, ...parte }));

  const contagem = useMemo(() => contar(itens), [itens]);
  const lista = useMemo(() => ordenar(filtrar(itens, f)), [itens, f]);
  // As abas contam com os OUTROS filtros aplicados — o número diz o que a aba vai mostrar.
  const porAba = useMemo(() => {
    const semAba = filtrar(itens, { ...f, aba: "todos" });
    const fechados = semAba.filter((i) => estaFechado(i.status)).length;
    return { abertos: semAba.length - fechados, resolvidos: fechados, todos: semAba.length };
  }, [itens, f]);

  const filtrando =
    f.categoria !== null || f.prioridade !== null || f.modulo !== null || f.situacao !== null || f.busca.trim() !== "";

  const itensCategoria = [
    { value: TODAS, label: "Todas as categorias" },
    ...categorias.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (desativada)` })),
  ];
  const itensPrioridade = [
    { value: TODAS, label: "Todas as prioridades" },
    ...PRIORIDADES.map((p) => ({ value: p, label: PRIORIDADE_ROTULO[p] })),
  ];
  const itensModulo = [
    { value: TODAS, label: "Todos os módulos" },
    ...MODULOS.map((m) => ({ value: m.value, label: m.label })),
  ];
  const itensSituacao = [
    { value: TODAS, label: "Todas as situações" },
    ...SITUACOES.map((s) => ({ value: s, label: SITUACAO_ROTULO[s] })),
  ];

  // Abertos agrupados por prioridade; resolvidos numa lista só.
  const grupos: { titulo: string | null; itens: ItemDoBacklog[] }[] = [];
  const abertos = lista.filter((i) => !estaFechado(i.status));
  const fechados = lista.filter((i) => estaFechado(i.status));
  for (const p of PRIORIDADES) {
    const doGrupo = abertos.filter((i) => i.priority === p);
    if (doGrupo.length) grupos.push({ titulo: `${PRIORIDADE_ROTULO[p]} · ${doGrupo.length}`, itens: doGrupo });
  }
  if (fechados.length) grupos.push({ titulo: f.aba === "resolvidos" ? null : `Resolvidos · ${fechados.length}`, itens: fechados });

  return (
    <div className="space-y-5">
      {noTreino && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          Você está no <strong>treino</strong>: esta lista é uma cópia de ensaio. A lista de verdade é a da
          produção — é lá que as sessões registram.
        </p>
      )}

      {/* Os números do topo — sempre sobre a lista inteira. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Numero
          rotulo="Em aberto"
          valor={contagem.abertos}
          ativo={f.aba === "abertos" && !filtrando}
          aoClicar={() => setF({ ...FILTRO_INICIAL, aba: "abertos" })}
        />
        <Numero
          rotulo="Resolvidos"
          valor={contagem.resolvidos}
          ativo={f.aba === "resolvidos" && !filtrando}
          aoClicar={() => setF({ ...FILTRO_INICIAL, aba: "resolvidos" })}
        />
        <Numero
          rotulo="Aguardando você"
          valor={contagem.aguardandoDono}
          destaque={contagem.aguardandoDono > 0}
          ativo={f.situacao === "aguardando_dono"}
          aoClicar={() => setF({ ...FILTRO_INICIAL, aba: "abertos", situacao: "aguardando_dono" })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {PRIORIDADES.map((p) => (
          <button
            key={p}
            type="button"
            title={PRIORIDADE_EXPLICA[p]}
            onClick={() => mudar({ aba: "abertos", prioridade: f.prioridade === p ? null : p })}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
              f.prioridade === p ? "border-primary bg-primary/5" : "hover:bg-muted"
            )}
          >
            <SeloDePrioridade prioridade={p} />
            <span className="tabular-nums font-medium">{contagem.porPrioridade[p]}</span>
            <span className="text-muted-foreground">em aberto</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
          {ABAS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => mudar({ aba: a.value })}
              aria-current={f.aba === a.value ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5",
                f.aba === a.value ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {a.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  f.aba === a.value ? "bg-primary-foreground/20" : "bg-muted"
                )}
              >
                {porAba[a.value]}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <JanelaDasCategorias categorias={categorias} itens={itens} />
          <NovoItem categorias={categorias.filter((c) => c.active)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={f.busca}
            onChange={(e) => mudar({ busca: e.target.value })}
            placeholder="Buscar por código (AP56) ou texto do título"
            className="pl-8"
            aria-label="Buscar no backlog"
          />
        </div>
        <Escolha
          rotulo="Categoria"
          itens={itensCategoria}
          valor={f.categoria ?? TODAS}
          aoMudar={(v) => mudar({ categoria: v === TODAS ? null : v })}
        />
        <Escolha
          rotulo="Prioridade"
          itens={itensPrioridade}
          valor={f.prioridade ?? TODAS}
          aoMudar={(v) => mudar({ prioridade: v === TODAS ? null : (v as Prioridade) })}
        />
        <Escolha
          rotulo="Módulo"
          itens={itensModulo}
          valor={f.modulo ?? TODAS}
          aoMudar={(v) => mudar({ modulo: v === TODAS ? null : v })}
        />
        <Escolha
          rotulo="Situação"
          itens={itensSituacao}
          valor={f.situacao ?? TODAS}
          aoMudar={(v) => mudar({ situacao: v === TODAS ? null : (v as SituacaoDoItem) })}
        />
        {filtrando && (
          <Button variant="ghost" size="sm" onClick={() => setF({ ...FILTRO_INICIAL, aba: f.aba })}>
            Limpar
          </Button>
        )}
      </div>

      {lista.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setEscolhidos((antes) => new Set([...antes, ...lista.map((i) => i.code)]))}
          >
            Escolher os {lista.length} da lista
          </button>
          {escolhidos.size > 0 && (
            <span className="text-muted-foreground">
              {escolhidos.size} escolhido{escolhidos.size > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {lista.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {filtrando ? "Nenhum item com esses filtros." : f.aba === "abertos" ? "Nada em aberto." : "Nenhum item aqui."}
        </p>
      ) : (
        <div className="space-y-5">
          {grupos.map((g, gi) => (
            <section key={gi} className="space-y-2">
              {g.titulo && (
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.titulo}</h2>
              )}
              <ul className="divide-y rounded-lg border">
                {g.itens.map((i) => (
                  <li key={i.code} className={cn("flex items-start gap-1", escolhidos.has(i.code) && "bg-primary/5")}>
                    <label className="flex shrink-0 cursor-pointer items-center self-stretch py-2.5 pl-3">
                      <input
                        type="checkbox"
                        checked={escolhidos.has(i.code)}
                        onChange={() => alternar(i.code)}
                        aria-label={`Escolher ${i.code}`}
                        className="size-4"
                      />
                    </label>
                    <Link
                      href={`/admin/backlog/${i.code}`}
                      className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-2.5 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{i.code}</span>
                      <span className="min-w-0 flex-1 text-sm">{i.title}</span>
                      <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{i.category}</span>
                        {i.module && <span>· {MODULO_ROTULO[i.module as ModuloDoSistema] ?? i.module}</span>}
                        {estaFechado(i.status) ? (
                          <span>
                            · {i.resolvedAt ? dataCurta(i.resolvedAt) : ""}
                            {i.resolvedVersion ? ` (${i.resolvedVersion})` : ""}
                          </span>
                        ) : (
                          <span>· há {diasEntre(i.foundOn, hoje)} dias</span>
                        )}
                        {!estaFechado(i.status) && <SeloDePrioridade prioridade={i.priority} />}
                        <SeloDeSituacao situacao={i.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BarraDoLote
        escolhidos={itens.filter((i) => escolhidos.has(i.code))}
        categorias={categorias}
        aoLimpar={() => setEscolhidos(new Set())}
      />
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  ativo,
  destaque,
  aoClicar,
}: {
  rotulo: string;
  valor: number;
  ativo: boolean;
  destaque?: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 sm:p-4",
        ativo && "border-primary bg-primary/5",
        destaque && !ativo && "border-violet-300 dark:border-violet-800"
      )}
    >
      <p className="text-xs text-muted-foreground sm:text-sm">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">{valor}</p>
    </button>
  );
}
