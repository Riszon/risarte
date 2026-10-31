"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Flag, Loader2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { GutBadge, TIER_CLASS } from "@/components/gut-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GUT_DIMENSION_LABELS,
  GUT_TIER_LABELS,
  aplicarPrioridade,
  gutScore,
  gutTierOf,
  notasDaFaixa,
  type GutInput,
  type GutTier,
} from "@/lib/gut";
import type { BudgetItem } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { definirPrioridadeDoItem } from "./planning-actions";

type Notas = { gutGravity: number; gutUrgency: number; gutTendency: number };

const FAIXAS: GutTier[] = ["high", "medium", "low"];
const DIMENSOES = [
  { campo: "gutGravity", rotulo: GUT_DIMENSION_LABELS.gravity, curto: "G" },
  { campo: "gutUrgency", rotulo: GUT_DIMENSION_LABELS.urgency, curto: "U" },
  { campo: "gutTendency", rotulo: GUT_DIMENSION_LABELS.tendency, curto: "T" },
] as const;

/**
 * Um clique na faixa, ou as três notas em "Ajustar". Só avisa quando as três
 * existem: nota pela metade fica aqui, e o banco nunca recebe prioridade incompleta.
 */
export function PrioridadeRapida({
  notas,
  onChange,
}: {
  notas: GutInput;
  onChange: (notas: Notas) => void;
}) {
  const [ajustando, setAjustando] = useState(false);
  const [rascunho, setRascunho] = useState<GutInput | null>(null);
  const atual = rascunho ?? notas;
  const faixaAtual = gutTierOf(atual);

  function escolher(faixa: GutTier) {
    setRascunho(null);
    onChange(notasDaFaixa(atual, faixa));
  }

  function darNota(campo: (typeof DIMENSOES)[number]["campo"], nota: number) {
    const proximo = { ...atual, [campo]: nota };
    if (gutScore(proximo) == null) {
      setRascunho(proximo);
      return;
    }
    setRascunho(null);
    onChange(proximo as Notas);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {FAIXAS.map((faixa) => (
          <button
            key={faixa}
            type="button"
            aria-pressed={faixaAtual === faixa}
            onClick={() => escolher(faixa)}
            className={cn(
              "min-h-8 rounded-md border px-3 text-xs font-medium",
              faixaAtual === faixa ? TIER_CLASS[faixa] : "border-input bg-background hover:bg-muted"
            )}
          >
            {GUT_TIER_LABELS[faixa]}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={ajustando}
          onClick={() => setAjustando((a) => !a)}
          className="inline-flex min-h-8 items-center gap-0.5 px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Ajustar notas
          <ChevronDown className={cn("size-3.5 transition-transform", ajustando && "rotate-180")} aria-hidden />
        </button>
        <GutBadge item={atual} />
      </div>
      {ajustando && (
        <div className="space-y-1">
          {DIMENSOES.map((d) => (
            <div key={d.campo} className="flex items-center gap-1" role="group" aria-label={d.rotulo}>
              <span className="w-20 text-xs text-muted-foreground">{d.rotulo}</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={atual[d.campo] === n}
                  aria-label={`${d.rotulo} ${n}`}
                  onClick={() => darNota(d.campo, n)}
                  className={cn(
                    "size-8 rounded-md border text-xs tabular-nums",
                    atual[d.campo] === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-muted"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type OpcaoDasPrioridades = { id: string; title: string; items: BudgetItem[] };

type Situacao = "salvo" | "salvando" | "erro";

/**
 * Dono do estado da lista. Fica FORA da janela: ela desmonta ao fechar. O clique
 * aparece na hora, e a gravação corre por trás, uma de cada vez; a tela só recarrega
 * ao fechar, para a ordem dos cartões não mudar enquanto o Planner trabalha.
 */
export function PrioridadesDoPlano({
  opcoes,
  opcaoAberta,
  onTrocarOpcao,
  localDoItem,
}: {
  opcoes: OpcaoDasPrioridades[];
  /** A opção à mostra; null = janela fechada. */
  opcaoAberta: string | null;
  onTrocarOpcao: (opcaoId: string | null) => void;
  localDoItem: (item: BudgetItem) => string | null;
}) {
  const router = useRouter();
  const [itens, setItens] = useState<BudgetItem[]>(() => opcoes.flatMap((o) => o.items));
  const [situacao, setSituacao] = useState<Situacao>("salvo");
  const [fechando, startFechar] = useTransition();

  const pendentes = useRef(new Map<string, Notas>());
  const corrida = useRef<Promise<void> | null>(null);

  const gravar = useCallback(() => {
    corrida.current ??= (async () => {
      try {
        while (pendentes.current.size > 0) {
          const [id, notas] = [...pendentes.current.entries()][0];
          pendentes.current.delete(id);
          setSituacao("salvando");
          const r = await definirPrioridadeDoItem(id, {
            gravity: notas.gutGravity,
            urgency: notas.gutUrgency,
            tendency: notas.gutTendency,
          });
          if (!r.ok) {
            // Devolve para a fila: a tela não finge que gravou.
            if (!pendentes.current.has(id)) pendentes.current.set(id, notas);
            setSituacao("erro");
            toast.error(r.error ?? "Não foi possível definir a prioridade.");
            return;
          }
        }
        setSituacao("salvo");
      } finally {
        corrida.current = null;
      }
    })();
    return corrida.current;
  }, []);

  function mudar(itemId: string, notas: Notas) {
    setItens((atuais) => aplicarPrioridade(atuais, itemId, notas));
    pendentes.current.set(itemId, notas);
    setSituacao("salvando");
    void gravar();
  }

  // Fechar a aba com gravação na fila pede confirmação.
  useEffect(() => {
    const fila = pendentes.current;
    const avisar = (e: BeforeUnloadEvent) => {
      if (fila.size > 0 || corrida.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, []);

  function fechar() {
    startFechar(async () => {
      await corrida.current;
      if (pendentes.current.size > 0) await gravar();
      // O que não gravou sai da fila: a tela recarrega com o que está no banco.
      if (pendentes.current.size > 0) {
        pendentes.current.clear();
        toast.error("Parte das prioridades não foi salva. Confira a lista.");
      }
      onTrocarOpcao(null);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={opcaoAberta != null}
      onOpenChange={(aberta) => {
        if (!aberta) fechar();
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {opcaoAberta != null && (
          <ListaDePrioridades
            opcoes={opcoes}
            itens={itens}
            opcaoAberta={opcaoAberta}
            onTrocarOpcao={onTrocarOpcao}
            localDoItem={localDoItem}
            mudar={mudar}
            situacao={situacao}
            fechando={fechando}
            fechar={fechar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListaDePrioridades({
  opcoes,
  itens,
  opcaoAberta,
  onTrocarOpcao,
  localDoItem,
  mudar,
  situacao,
  fechando,
  fechar,
}: {
  opcoes: OpcaoDasPrioridades[];
  itens: BudgetItem[];
  opcaoAberta: string;
  onTrocarOpcao: (opcaoId: string) => void;
  localDoItem: (item: BudgetItem) => string | null;
  mudar: (itemId: string, notas: Notas) => void;
  situacao: Situacao;
  fechando: boolean;
  fechar: () => void;
}) {
  const semNota = (lista: BudgetItem[]) => lista.filter((i) => gutScore(i) == null);
  // O filtro olha o retrato de quando foi ligado: o item avaliado não some da
  // lista debaixo do clique.
  const [filtrados, setFiltrados] = useState<Set<string> | null>(() => {
    const faltando = semNota(itens);
    return faltando.length > 0 ? new Set(faltando.map((i) => i.id)) : null;
  });

  const porId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens]);
  const atualDe = (o: OpcaoDasPrioridades) =>
    o.items.map((i) => porId.get(i.id)).filter((i): i is BudgetItem => i != null);
  const faltamNoPlano = semNota(itens).length;
  const opcao = opcoes.find((o) => o.id === opcaoAberta) ?? opcoes[0];
  const daOpcao = opcao ? atualDe(opcao) : [];
  const visiveis = filtrados ? daOpcao.filter((i) => filtrados.has(i.id)) : daOpcao;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-1.5">
          <Flag className="size-4 text-gold-tinta" aria-hidden />
          Prioridades
        </DialogTitle>
        <DialogDescription>
          Um clique define a prioridade. Os procedimentos iguais ainda sem nota recebem a mesma, e
          você pode trocar. Salva sozinho.
        </DialogDescription>
      </DialogHeader>

      {opcoes.length > 1 && (
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {opcoes.map((o) => {
            const faltam = semNota(atualDe(o)).length;
            return (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === opcao?.id}
                onClick={() => onTrocarOpcao(o.id)}
                className={cn(
                  "min-h-8 rounded-md border px-2.5 text-xs font-medium",
                  o.id === opcao?.id ? "border-primary bg-primary/10" : "border-input hover:bg-muted"
                )}
              >
                {o.title}
                {faltam > 0 && (
                  <span className="ml-1 text-amber-700 dark:text-amber-300">· faltam {faltam}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filtrados != null}
            onChange={(e) =>
              setFiltrados(e.target.checked ? new Set(semNota(itens).map((i) => i.id)) : null)
            }
          />
          Só os sem prioridade
        </label>
        <span className={cn("font-medium", faltamNoPlano > 0 && "text-amber-700 dark:text-amber-300")}>
          {faltamNoPlano > 0
            ? `Faltam ${faltamNoPlano} de ${itens.length} no plano`
            : `Todos os ${itens.length} definidos`}
        </span>
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
          Nada faltando nesta opção.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {visiveis.map((it) => (
            <li key={it.id} className="space-y-1.5 p-2.5">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                <span className="font-medium">{it.description}</span>
                {localDoItem(it) && (
                  <span className="rounded bg-primary/10 px-1 text-xs font-medium text-primary">
                    {localDoItem(it)}
                  </span>
                )}
                {it.gutRepeated && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-xs text-muted-foreground">
                    <Repeat className="size-3" aria-hidden />
                    Repetida
                  </span>
                )}
              </p>
              <PrioridadeRapida notas={it} onChange={(n) => mudar(it.id, n)} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {situacao === "salvando" && (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Salvando…
            </>
          )}
          {situacao === "salvo" && (
            <>
              <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
              Tudo salvo
            </>
          )}
          {situacao === "erro" && <span className="text-destructive">Não salvou. Tentaremos ao concluir.</span>}
        </span>
        <Button size="sm" disabled={fechando} onClick={fechar}>
          Concluir
        </Button>
      </div>
    </>
  );
}
