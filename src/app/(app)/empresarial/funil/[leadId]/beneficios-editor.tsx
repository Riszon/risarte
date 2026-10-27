"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BENEFIT_TYPES,
  BENEFIT_TYPE_LABELS,
  type BenefitType,
} from "@/lib/empresarial/constants";
import {
  CATEGORIAS_DE_BENEFICIO,
  CATEGORIA_ROTULO,
  TIPO_DA_CATEGORIA,
  aplicarGrupo,
  categoriaDoBeneficio,
  contarPorCategoria,
  paraQuemVale,
  problemasDoBeneficio,
  resumoDoBeneficio,
  rotuloDasUnidades,
  type BeneficioDaProposta,
  type CategoriaDeBeneficio,
} from "@/lib/empresarial/beneficios-da-proposta";
import { selectClass } from "./campos";
import {
  aplicarVantagensDoGrupo,
  textoDaVantagem,
  type Vantagem,
  type VantagemEscolhida,
} from "@/lib/empresarial/vantagens";
import { VantagensEscolhidas } from "../../vantagens-escolhidas";
import { saveAsBenefitGroup, saveLeadBenefits } from "./actions";

export type Procedimento = { id: string; name: string };
export type GrupoDeBeneficios = {
  id: string;
  name: string;
  description: string | null;
  itens: BeneficioDaProposta[];
  /** 1033: as outras vantagens que o grupo traz. */
  vantagens?: VantagemEscolhida[];
};

/** "3 sem custo · 5 com desconto · 1 não coberto" — só o que existe. */
function rotuloDasContagens(c: Record<CategoriaDeBeneficio, number>): string {
  const partes = CATEGORIAS_DE_BENEFICIO.filter((k) => c[k] > 0).map(
    (k) => `${c[k]} ${CATEGORIA_ROTULO[k].toLowerCase()}`
  );
  return partes.length > 0 ? partes.join(" · ") : "vazio";
}

/** Número digitado → inteiro, ou nulo quando em branco. */
const inteiroOuNulo = (v: string): number | null => {
  const n = Number.parseInt(v.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * OS BENEFÍCIOS DA PROPOSTA (OC-00083, H2).
 *
 * Pedido do dono: configurar procedimento a procedimento aqui, marcando se
 * cada um vale para o titular, para o dependente ou para os dois; e aplicar
 * um GRUPO pronto em vez de repetir tudo a cada negociação.
 *
 * ⚠️ AS DUAS CAIXAS NASCEM MARCADAS. É o padrão que ele pediu, e é o que já
 * acontecia antes de as marcas existirem: benefício valia para todo mundo.
 * Quem quiser restringir desmarca de propósito — o contrário faria um
 * benefício nascer sem alcançar ninguém.
 *
 * 26/10/2026 (dono): *"vai ficando uma lista muito longa… conforme vai
 * lançando os procedimentos e configurando vai ficando aberto"*. A lista
 * passou a ter TRÊS SEÇÕES (sem custo, com desconto, não coberto) e cada
 * procedimento fica RECOLHIDO em uma linha até alguém pedir para editar. Os
 * grupos prontos subiram para o topo, mostrando o que cada um traz.
 *
 * ⚠️ RECOLHIDO NÃO É REMOVIDO: os campos continuam no formulário (escondidos),
 * senão salvar com um procedimento fechado apagaria a configuração dele.
 */
export function BeneficiosDaProposta({
  leadId,
  procedimentos,
  grupos,
  iniciais,
  vieramDaRede,
  daRede,
  podeCriarGrupo,
  unidadesDaParceria,
  vantagens,
  vantagensIniciais,
}: {
  leadId: string;
  procedimentos: Procedimento[];
  grupos: GrupoDeBeneficios[];
  iniciais: BeneficioDaProposta[];
  /** A lista acima é o padrão da rede, ainda não salvo nesta proposta. */
  vieramDaRede: boolean;
  /** O padrão da rede, para poder ser reaplicado. */
  daRede: BeneficioDaProposta[];
  /** Só o gestor do programa cria grupo — ele vale para a rede inteira. */
  podeCriarGrupo: boolean;
  /** As unidades da parceria — as únicas que podem restringir um benefício. */
  unidadesDaParceria: { id: string; name: string }[];
  /** 1033: o catálogo das outras vantagens da rede. */
  vantagens: Vantagem[];
  /** 1033: as outras vantagens já escolhidas nesta proposta. */
  vantagensIniciais: VantagemEscolhida[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lista, setLista] = useState<BeneficioDaProposta[]>(iniciais);
  // Quais procedimentos estão ABERTOS para edição. Começa vazio: a lista
  // aparece arrumada, uma linha por procedimento.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [secoesFechadas, setSecoesFechadas] = useState<Set<CategoriaDeBeneficio>>(new Set());
  const [salvandoGrupo, setSalvandoGrupo] = useState(false);
  // Houve mudança desde o último salvar — a tela lembra de salvar.
  const [mexeu, setMexeu] = useState(false);
  const [escolhidas, setEscolhidas] = useState<VantagemEscolhida[]>(vantagensIniciais);
  const nomeDaVantagem = new Map(vantagens.map((v) => [v.id, v.name]));

  const nomeDoProcedimento = new Map(procedimentos.map((p) => [p.id, p.name]));
  const semBeneficio = procedimentos.filter(
    (p) => !lista.some((b) => b.procedureId === p.id)
  );
  const contagem = contarPorCategoria(lista);

  // O padrão da rede é oferecido como se fosse um grupo: é a mesma pergunta
  // ("aplique esta combinação pronta"), e quem usa não precisa saber que uma
  // vem de tabela diferente da outra.
  const prontos: GrupoDeBeneficios[] = [
    ...(daRede.length > 0
      ? [
          {
            id: "__rede__",
            name: "Padrão da rede",
            description: "O que está em Configurações → Benefícios.",
            itens: daRede,
          },
        ]
      : []),
    ...grupos,
  ];

  function mudar(nova: (atual: BeneficioDaProposta[]) => BeneficioDaProposta[]) {
    setLista(nova);
    setMexeu(true);
  }

  function trocar(procedureId: string, campo: Partial<BeneficioDaProposta>) {
    mudar((atual) =>
      atual.map((b) => (b.procedureId === procedureId ? { ...b, ...campo } : b))
    );
  }

  function alternar(procedureId: string) {
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(procedureId)) n.delete(procedureId);
      else n.add(procedureId);
      return n;
    });
  }

  function inserirGrupo(grupo: GrupoDeBeneficios) {
    const r = aplicarGrupo(lista, grupo.itens);
    mudar(() => r.lista);
    // As outras vantagens do grupo entram pela mesma regra (1033).
    const rv = aplicarVantagensDoGrupo(escolhidas, grupo.vantagens ?? []);
    setEscolhidas(rv.lista);
    // A tela diz o que o grupo fez. "Aplicado" sozinho esconderia que ele
    // trocou um desconto que o consultor tinha acabado de negociar.
    const trocou = r.trocados
      .map((id) => nomeDoProcedimento.get(id) ?? "procedimento")
      .join(", ");
    toast.success(`Grupo "${grupo.name}" inserido.`, {
      description:
        r.trocados.length > 0
          ? `${r.incluidos} incluído(s); trocou o que já havia em: ${trocou}.${rv.incluidas + rv.trocadas > 0 ? ` ${rv.incluidas + rv.trocadas} outra(s) vantagem(ns).` : ""} Nada foi salvo ainda.`
          : `${r.incluidos} benefício(s)${rv.incluidas + rv.trocadas > 0 ? ` e ${rv.incluidas + rv.trocadas} outra(s) vantagem(ns)` : ""} incluído(s). Nada foi salvo ainda.`,
    });
  }

  function incluir(procedureId: string, categoria: CategoriaDeBeneficio) {
    mudar((a) => [
      ...a,
      {
        procedureId,
        benefitType: TIPO_DA_CATEGORIA[categoria],
        benefitValue: null,
        usageLimitCount: null,
        usagePeriodMonths: null,
        gracePeriodMonths: 0,
        maxInstallments: null,
        forHolder: true,
        forDependent: true,
        clinicIds: [],
      },
    ]);
    // O que acabou de entrar abre para ser configurado; o resto continua
    // recolhido.
    setAbertos((a) => new Set(a).add(procedureId));
    setSecoesFechadas((s) => {
      const n = new Set(s);
      n.delete(categoria);
      return n;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveLeadBenefits(leadId, formData);
      if (r.ok) {
        toast.success("Benefícios da proposta salvos.");
        setMexeu(false);
        setAbertos(new Set());
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  function guardarComoGrupo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveAsBenefitGroup(leadId, formData);
      if (r.ok) {
        toast.success("Grupo criado para a rede.");
        setSalvandoGrupo(false);
        router.refresh();
      } else toast.error(r.error ?? "Erro.");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium">Vantagens e benefícios</p>
          <p className="text-xs text-muted-foreground">
            O que esta empresa ganha, procedimento a procedimento — é isto que
            aparece na proposta e passa a valer no orçamento quando o negócio
            fechar.
          </p>
        </div>

        {/* ⚠️ A PROPOSTA COMEÇA COM O PADRÃO DA REDE (relato do dono,
            24/09/2026). A tela DIZ que ainda não está salvo — senão a pessoa
            fecharia a proposta achando que já estava. */}
        {vieramDaRede && (
          <p className="rounded-md border border-gold/40 bg-gold/5 p-2 text-xs">
            Estes vieram do <strong>padrão da rede</strong> (Configurações →
            Benefícios). Confira, ajuste o que esta empresa negociou e{" "}
            <strong>salve</strong> — só então eles passam a valer nesta
            proposta.
          </p>
        )}

        {/* ---- os grupos prontos, no topo e à vista ---- */}
        {prontos.length > 0 && (
          <GruposProntos
            grupos={prontos}
            nomeDoProcedimento={nomeDoProcedimento}
            nomeDaVantagem={nomeDaVantagem}
            aoInserir={inserirGrupo}
            desabilitado={isPending}
          />
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          {lista.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum benefício configurado. Insira um grupo pronto acima ou
              inclua procedimento por procedimento nas seções abaixo.
            </p>
          )}

          {CATEGORIAS_DE_BENEFICIO.map((categoria) => {
            const daSecao = lista
              .map((b, i) => ({ b, i }))
              .filter(({ b }) => categoriaDoBeneficio(b.benefitType) === categoria)
              .sort((x, y) =>
                (nomeDoProcedimento.get(x.b.procedureId) ?? "").localeCompare(
                  nomeDoProcedimento.get(y.b.procedureId) ?? "",
                  "pt-BR"
                )
              );
            const fechada = secoesFechadas.has(categoria);
            const comProblema = daSecao.filter(({ b }) => problemasDoBeneficio(b).length > 0).length;
            return (
              <div key={categoria} className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  aria-expanded={!fechada}
                  onClick={() =>
                    setSecoesFechadas((s) => {
                      const n = new Set(s);
                      if (n.has(categoria)) n.delete(categoria);
                      else n.add(categoria);
                      return n;
                    })
                  }
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {fechada ? (
                      <ChevronRight className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    {CATEGORIA_ROTULO[categoria]}
                    <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">
                      {daSecao.length}
                    </span>
                  </span>
                  {comProblema > 0 && (
                    <span className="text-xs text-destructive">
                      {comProblema} para corrigir
                    </span>
                  )}
                </button>

                {/* Fechada continua no formulário: só some da vista. */}
                <div hidden={fechada} className="space-y-1 border-t p-2">
                  {daSecao.length === 0 && (
                    <p className="px-1 text-xs text-muted-foreground">
                      Nenhum procedimento nesta categoria.
                    </p>
                  )}
                  {daSecao.map(({ b, i }) => (
                    <LinhaDoBeneficio
                      key={b.procedureId}
                      i={i}
                      b={b}
                      nome={nomeDoProcedimento.get(b.procedureId) ?? "(procedimento)"}
                      aberto={abertos.has(b.procedureId)}
                      aoAlternar={() => alternar(b.procedureId)}
                      aoTrocar={(campo) => trocar(b.procedureId, campo)}
                      aoTirar={() =>
                        mudar((a) => a.filter((x) => x.procedureId !== b.procedureId))
                      }
                      unidadesDaParceria={unidadesDaParceria}
                    />
                  ))}

                  <select
                    aria-label={`Incluir procedimento em ${CATEGORIA_ROTULO[categoria]}`}
                    value=""
                    onChange={(e) => e.target.value && incluir(e.target.value, categoria)}
                    className={`${selectClass} mt-1 h-8 text-xs`}
                    disabled={semBeneficio.length === 0}
                  >
                    <option value="">
                      {semBeneficio.length === 0
                        ? "— todos os procedimentos já estão na lista —"
                        : `+ Incluir procedimento ${CATEGORIA_ROTULO[categoria].toLowerCase()}`}
                    </option>
                    {semBeneficio.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}

          {/* ---- 1033: as outras vantagens (além dos procedimentos) ---- */}
          <div className="space-y-2 rounded-md border p-2">
            <div className="px-1">
              <p className="text-sm font-medium">
                Outras vantagens{" "}
                <span className="rounded-full bg-muted px-2 text-xs font-normal text-muted-foreground">
                  {escolhidas.length}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Além dos procedimentos: desconto em parceiros, palestras,
                publicidade nas TVs da unidade, unidade exclusiva… Escreva o
                detalhe desta empresa. Depois do fechamento, cada uma vira um
                compromisso acompanhado na ficha da empresa.
              </p>
            </div>
            <VantagensEscolhidas
              catalogo={vantagens}
              lista={escolhidas}
              aoMudar={(nova) => {
                setEscolhidas(nova);
                setMexeu(true);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <span className={`text-xs ${mexeu ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
              {lista.length} benefício{lista.length === 1 ? "" : "s"} —{" "}
              {rotuloDasContagens(contagem)}
              {escolhidas.length > 0 &&
                ` · ${escolhidas.length} outra${escolhidas.length === 1 ? "" : "s"} vantage${escolhidas.length === 1 ? "m" : "ns"}`}
              {mexeu && " · há mudanças não salvas"}
            </span>
            <Button type="submit" size="sm" disabled={isPending}>
              Salvar os benefícios
            </Button>
          </div>
        </form>

        {/* Guardar como grupo: formulário próprio, fora do de cima. */}
        {podeCriarGrupo && lista.length > 0 && (
          <div className="border-t pt-3">
            {!salvandoGrupo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSalvandoGrupo(true)}
              >
                Guardar esta combinação como grupo da rede
              </Button>
            ) : (
              <form onSubmit={guardarComoGrupo} className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  O grupo passa a valer para <strong>todas as propostas</strong> da
                  rede. Guarde o que já estiver <strong>salvo</strong> — o grupo
                  copia o que está no banco, não o que está na tela.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="group_name">Nome do grupo</Label>
                    <Input id="group_name" name="group_name" required />
                  </div>
                  <div>
                    <Label htmlFor="group_description">Para que serve</Label>
                    <Input id="group_description" name="group_description" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={isPending}>
                    Criar grupo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSalvandoGrupo(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * OS GRUPOS PRONTOS, cada um com o que traz.
 *
 * Antes era uma caixa de seleção no meio da tela, com o nome e um número — e
 * o dono não a encontrou. Agora cada grupo é uma linha com as contagens por
 * categoria, a descrição, o "ver o que tem" e o botão Inserir.
 */
function GruposProntos({
  grupos,
  nomeDoProcedimento,
  nomeDaVantagem,
  aoInserir,
  desabilitado,
}: {
  grupos: GrupoDeBeneficios[];
  nomeDoProcedimento: Map<string, string>;
  nomeDaVantagem: Map<string, string>;
  aoInserir: (g: GrupoDeBeneficios) => void;
  desabilitado: boolean;
}) {
  const [vendo, setVendo] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <div>
        <p className="text-sm font-medium">Inserir um grupo de benefícios</p>
        <p className="text-xs text-muted-foreground">
          O grupo <strong>substitui</strong> o que já houver do mesmo
          procedimento e mantém o resto. Nada é salvo até você clicar em Salvar.
        </p>
      </div>
      <ul className="space-y-1">
        {grupos.map((g) => (
          <li key={g.id} className="rounded-md border bg-background p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {g.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({g.itens.length})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {rotuloDasContagens(contarPorCategoria(g.itens))}
                  {(g.vantagens?.length ?? 0) > 0 &&
                    ` · ${g.vantagens!.length} outra${g.vantagens!.length === 1 ? "" : "s"} vantage${g.vantagens!.length === 1 ? "m" : "ns"}`}
                  {g.description ? ` — ${g.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  aria-expanded={vendo === g.id}
                  onClick={() => setVendo((v) => (v === g.id ? null : g.id))}
                >
                  {vendo === g.id ? "Esconder" : "Ver o que tem"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={desabilitado || (g.itens.length === 0 && (g.vantagens?.length ?? 0) === 0)}
                  onClick={() => aoInserir(g)}
                >
                  <Plus className="mr-1 size-3.5" />
                  Inserir
                </Button>
              </div>
            </div>
            {vendo === g.id && (
              <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs">
                {g.itens.map((b) => (
                  <li key={b.procedureId}>
                    <span className="font-medium">
                      {nomeDoProcedimento.get(b.procedureId) ?? "(procedimento)"}
                    </span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {CATEGORIA_ROTULO[categoriaDoBeneficio(b.benefitType)]}
                      {" · "}
                      {resumoDoBeneficio(b)}
                    </span>
                  </li>
                ))}
                {(g.vantagens ?? []).map((v) => (
                  <li key={v.perkId}>
                    <span className="font-medium">
                      {textoDaVantagem(nomeDaVantagem.get(v.perkId) ?? "(vantagem)", v.detail)}
                    </span>
                    <span className="text-muted-foreground"> — outra vantagem</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * UM PROCEDIMENTO: uma linha recolhida, ou os campos abertos.
 *
 * Os campos ficam SEMPRE no formulário (com `hidden` quando recolhido) e são
 * controlados pelo estado: o procedimento troca de seção ao trocar o tipo, e
 * campo não controlado perderia o que foi digitado na mudança.
 */
function LinhaDoBeneficio({
  i,
  b,
  nome,
  aberto,
  aoAlternar,
  aoTrocar,
  aoTirar,
  unidadesDaParceria,
}: {
  i: number;
  b: BeneficioDaProposta;
  nome: string;
  aberto: boolean;
  aoAlternar: () => void;
  aoTrocar: (campo: Partial<BeneficioDaProposta>) => void;
  aoTirar: () => void;
  unidadesDaParceria: { id: string; name: string }[];
}) {
  const problemas = problemasDoBeneficio(b);
  const naoCoberto = b.benefitType === "NOT_COVERED";
  return (
    <div className={`rounded-md border ${aberto ? "border-primary/40" : ""}`}>
      <input type="hidden" name={`proc_${i}`} value={b.procedureId} />

      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={aoAlternar}
          aria-expanded={aberto}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium">{nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {resumoDoBeneficio(b)}
            {(b.clinicIds?.length ?? 0) > 0 && ` · ${b.clinicIds!.length} unidade(s)`}
          </p>
          {problemas.length > 0 && (
            <p className="text-xs text-destructive">{problemas.join("; ")}</p>
          )}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={aoAlternar}
          aria-label={aberto ? `Fechar ${nome}` : `Editar ${nome}`}
        >
          {aberto ? <ChevronDown className="size-3.5" /> : <Pencil className="size-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          aria-label={`Tirar ${nome}`}
          onClick={aoTirar}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div hidden={!aberto} className="space-y-2 border-t p-2">
        <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-4">
          <div>
            <Label htmlFor={`tipo_${i}`}>Benefício</Label>
            <select
              id={`tipo_${i}`}
              name={`tipo_${i}`}
              value={b.benefitType}
              onChange={(e) => aoTrocar({ benefitType: e.target.value as BenefitType })}
              className={selectClass}
            >
              {BENEFIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BENEFIT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* O valor só existe onde significa algo. */}
          {(b.benefitType === "DISCOUNT_PERCENT" || b.benefitType === "DISCOUNT_AMOUNT") && (
            <div>
              <Label htmlFor={`valor_${i}`}>
                {b.benefitType === "DISCOUNT_PERCENT" ? "Quanto (%)" : "Quanto (R$)"}
              </Label>
              <Input
                id={`valor_${i}`}
                name={`valor_${i}`}
                value={
                  b.benefitValue == null
                    ? ""
                    : b.benefitType === "DISCOUNT_PERCENT"
                      ? String(b.benefitValue)
                      : (b.benefitValue / 100).toFixed(2).replace(".", ",")
                }
                onChange={(e) => {
                  const v = e.target.value;
                  aoTrocar({
                    benefitValue:
                      b.benefitType === "DISCOUNT_PERCENT"
                        ? Number.parseInt(v.replace(/\D/g, ""), 10) || null
                        : Math.round(
                            (Number.parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0) *
                              100
                          ) || null,
                  });
                }}
                placeholder={b.benefitType === "DISCOUNT_PERCENT" ? "30" : "0,00"}
              />
            </div>
          )}

          {/* "Não coberto" não tem regra de uso nem carência: não há o que
              usar. Os campos somem e o servidor grava vazio. */}
          {!naoCoberto && (
            <>
              <div>
                <Label htmlFor={`limite_${i}`}>Quantas vezes</Label>
                <Input
                  id={`limite_${i}`}
                  name={`limite_${i}`}
                  type="number"
                  min={0}
                  value={b.usageLimitCount ?? ""}
                  onChange={(e) => aoTrocar({ usageLimitCount: inteiroOuNulo(e.target.value) })}
                  placeholder="sem limite"
                />
              </div>
              <div>
                <Label htmlFor={`janela_${i}`}>A cada (meses)</Label>
                <Input
                  id={`janela_${i}`}
                  name={`janela_${i}`}
                  type="number"
                  min={0}
                  value={b.usagePeriodMonths ?? ""}
                  onChange={(e) => aoTrocar({ usagePeriodMonths: inteiroOuNulo(e.target.value) })}
                  placeholder="—"
                />
              </div>
              <div>
                <Label htmlFor={`carencia_${i}`}>Carência (meses)</Label>
                <Input
                  id={`carencia_${i}`}
                  name={`carencia_${i}`}
                  type="number"
                  min={0}
                  value={b.gracePeriodMonths || ""}
                  onChange={(e) =>
                    aoTrocar({ gracePeriodMonths: inteiroOuNulo(e.target.value) ?? 0 })
                  }
                  placeholder="0"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t pt-2">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name={`titular_${i}`}
              checked={b.forHolder}
              onChange={(e) => aoTrocar({ forHolder: e.target.checked })}
              className="size-4"
            />
            Vale para o titular
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name={`dependente_${i}`}
              checked={b.forDependent}
              onChange={(e) => aoTrocar({ forDependent: e.target.checked })}
              className="size-4"
            />
            Vale para o dependente
          </label>
          <span
            className={`text-xs ${
              b.forHolder || b.forDependent ? "text-muted-foreground" : "text-destructive"
            }`}
          >
            {paraQuemVale(b)}
          </span>
        </div>

        {/* ⚠️ EM QUAIS UNIDADES ESTE BENEFÍCIO VALE (I3). Só aparece quando a
            parceria tem mais de uma unidade. Nenhuma marcada = todas. */}
        {unidadesDaParceria.length > 1 && (
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs font-medium">Vale nestas unidades</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {unidadesDaParceria.map((u) => (
                <label key={u.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name={`unidade_${i}`}
                    value={u.id}
                    checked={(b.clinicIds ?? []).includes(u.id)}
                    onChange={(e) =>
                      aoTrocar({
                        clinicIds: e.target.checked
                          ? [...(b.clinicIds ?? []), u.id]
                          : (b.clinicIds ?? []).filter((x) => x !== u.id),
                      })
                    }
                    className="size-4"
                  />
                  {u.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {rotuloDasUnidades(
                b.clinicIds,
                new Map(unidadesDaParceria.map((u) => [u.id, u.name]))
              )}
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={aoAlternar}>
            Pronto
          </Button>
        </div>
      </div>
    </div>
  );
}
