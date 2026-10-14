"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  LayoutGrid,
  ListChecks,
  Pin,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import type { Capability, MatrizPermissoes } from "@/lib/permissions";
import { formatBrDateTime } from "@/lib/dates";
import {
  alternar,
  casaForaDoPadrao,
  filtrarPermissoes,
  foraDoPadrao,
  fraseDaMudanca,
  mesmoConjunto,
  mudancas,
  permissoesParaSalvar,
  quantasPorFuncao,
  quemTem,
  temAcesso,
  todasForaDoPadrao,
  voltarAoPadrao,
  type PadraoFixado,
} from "@/lib/matriz-de-permissoes";
import { salvarPermissoes, tornarPadrao, usarOriginalComoPadrao } from "./actions";

// A TELA DE PERMISSÕES (relato OC-00002, 14/10/2026).
//
// Três jeitos de olhar a MESMA matriz — por função, por permissão e a grade
// inteira — e uma barra só para salvar. Marcar não grava: tudo o que mudou fica
// na barra do rodapé até "Salvar" (decisão do dono). Um clique errado nunca
// tira o acesso de ninguém sozinho.
//
// "Fora do padrão" compara com o padrão EFETIVO: o que o dono fixou com
// "Tornar padrão" (0292) ou, sem isso, o original do sistema. A conta mora em
// `src/lib/matriz-de-permissoes.ts`; aqui só se desenha.

type Visao = "funcao" | "permissao" | "grade";

const VISOES: { id: Visao; rotulo: string; icone: React.ReactNode }[] = [
  { id: "funcao", rotulo: "Por função", icone: <Users className="size-4" /> },
  { id: "permissao", rotulo: "Por permissão", icone: <ListChecks className="size-4" /> },
  { id: "grade", rotulo: "Grade completa", icone: <LayoutGrid className="size-4" /> },
];

const SELECT =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function nomes(papeis: readonly UserRole[]): string {
  return papeis.length === 0 ? "nenhuma função (só o Admin Master)" : papeis.map((p) => ROLE_LABELS[p]).join(", ");
}

/** Liga/desliga, com o estado dito em voz alta para leitor de tela. */
function Chave({
  ligada,
  onClick,
  disabled,
  rotulo,
}: {
  ligada: boolean;
  onClick: () => void;
  disabled?: boolean;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      title={rotulo}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        ligada ? "border-primary bg-primary" : "border-muted-foreground/40 bg-muted-foreground/25"
      }`}
    >
      <span
        className={`inline-block size-3.5 rounded-full bg-background shadow transition-transform ${
          ligada ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

function SeloForaDoPadrao({ titulo }: { titulo?: string }) {
  return (
    <Badge
      variant="outline"
      className="border-amber-500/60 text-[10px] font-normal text-amber-700 dark:text-amber-400"
      title={titulo ?? "Diferente do padrão. Se for de propósito, use “Tornar padrão”."}
    >
      diferente do padrão
    </Badge>
  );
}

function SeloNaoSalvo() {
  return (
    <Badge variant="outline" className="border-primary/60 text-[10px] font-normal text-primary">
      não salvo
    </Badge>
  );
}

function SeloDoBanco() {
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[10px] font-normal"
      title="O banco de dados também decide: ligar aqui abre a tela, mas os dados podem vir vazios."
    >
      <Database className="size-3" />o banco também decide
    </Badge>
  );
}

export function PermissionsMatrix({
  capacidades,
  papeis,
  atual,
  padrao,
  fabrica,
  fixados,
  podeFixar,
  aindaSemTabela,
  somenteLeitura = false,
  aviso,
}: {
  capacidades: Capability[];
  papeis: UserRole[];
  /** O que está GRAVADO e valendo. */
  atual: MatrizPermissoes;
  /** O padrão efetivo: o fixado pelo dono ou, sem ele, o de fábrica. */
  padrao: MatrizPermissoes;
  /** O original do sistema (o do código). */
  fabrica: MatrizPermissoes;
  fixados: Record<string, PadraoFixado>;
  /** Os padrões fixados foram lidos (a 0292 existe neste banco). */
  podeFixar: boolean;
  aindaSemTabela: boolean;
  /** No treino a matriz é cópia da produção (0260): só consulta. */
  somenteLeitura?: boolean;
  aviso?: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rascunho, setRascunho] = useState<MatrizPermissoes>(atual);
  const [visao, setVisao] = useState<Visao>("funcao");
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState("");
  const [soFora, setSoFora] = useState(false);
  const [funcao, setFuncao] = useState<UserRole>(papeis[0]);
  const [permissao, setPermissao] = useState<string>(capacidades[0]?.id ?? "");
  const [verLista, setVerLista] = useState(false);
  const [confirmarTudo, setConfirmarTudo] = useState(false);
  const [confirmarOriginal, setConfirmarOriginal] = useState<string | null>(null);

  const travada = aindaSemTabela || somenteLeitura;
  const ocupada = travada || isPending;

  const grupos = useMemo(() => [...new Set(capacidades.map((c) => c.grupo))], [capacidades]);
  const alteracoes = useMemo(
    () => mudancas(atual, rascunho, capacidades, papeis),
    [atual, rascunho, capacidades, papeis]
  );
  const alteradas = useMemo(() => new Set(alteracoes.map((m) => m.capacidade)), [alteracoes]);
  const foraGravadas = useMemo(
    () => todasForaDoPadrao(atual, padrao, capacidades),
    [atual, padrao, capacidades]
  );
  const filtradas = useMemo(
    () => filtrarPermissoes(capacidades, { busca, grupo, soForaDoPadrao: soFora }, rascunho, padrao),
    [capacidades, busca, grupo, soFora, rascunho, padrao]
  );
  const contagem = useMemo(
    () => quantasPorFuncao(rascunho, capacidades, papeis),
    [rascunho, capacidades, papeis]
  );
  const porId = useMemo(() => new Map(capacidades.map((c) => [c.id, c])), [capacidades]);

  /** "Tornar padrão" vale para o que está GRAVADO: com alteração por salvar, não. */
  function podeTornarPadrao(cap: string): boolean {
    return podeFixar && !ocupada && !alteradas.has(cap) && foraDoPadrao(atual, padrao, cap);
  }

  function motivoSemTornarPadrao(cap: string): string {
    if (somenteLeitura) return "No treino as permissões são só consulta.";
    if (!podeFixar) return "O “Tornar padrão” aguarda a migração 0292 neste banco.";
    if (alteradas.has(cap)) return "Salve (ou descarte) as alterações desta permissão antes de torná-la padrão.";
    return "Tornar o que está valendo agora o padrão desta permissão.";
  }

  function salvarTudo() {
    const lista = permissoesParaSalvar(atual, rascunho, capacidades);
    if (lista.length === 0) return;
    startTransition(async () => {
      const r = await salvarPermissoes(lista);
      if (r.ok) {
        toast.success(
          lista.length === 1 ? `“${r.salvas[0]}” salvo.` : `${r.salvas.length} permissões salvas.`
        );
        setVerLista(false);
      } else {
        toast.error(r.error ?? "Não foi possível salvar.");
      }
      if (r.salvas.length > 0) router.refresh();
    });
  }

  function descartar() {
    setRascunho(atual);
    setVerLista(false);
  }

  function fixar(ids: string[]) {
    startTransition(async () => {
      const r = await tornarPadrao(ids);
      if (r.ok) {
        toast.success(
          ids.length === 1
            ? `“${porId.get(ids[0])?.rotulo ?? ids[0]}” virou o padrão.`
            : `${ids.length} permissões viraram o padrão.`
        );
        setConfirmarTudo(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível tornar padrão.");
      }
    });
  }

  function usarOriginal(cap: string) {
    startTransition(async () => {
      const r = await usarOriginalComoPadrao(cap);
      if (r.ok) {
        toast.success("O original do sistema voltou a ser o padrão desta permissão.");
        setConfirmarOriginal(null);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível mudar o padrão.");
      }
    });
  }

  /** As ações de uma permissão: voltar ao padrão (no rascunho) e tornar padrão. */
  function acoesDaPermissao(cap: Capability, compacto = false) {
    const diferenteNoRascunho = foraDoPadrao(rascunho, padrao, cap.id);
    const diferenteGravado = foraDoPadrao(atual, padrao, cap.id);
    if (!diferenteNoRascunho && !diferenteGravado) return null;
    return (
      <div className="flex shrink-0 items-center gap-1">
        {diferenteNoRascunho && (
          <Button
            variant="ghost"
            size={compacto ? "icon" : "sm"}
            title={`Voltar ao padrão: ${nomes(padrao[cap.id] ?? [])}. Fica na barra até você salvar.`}
            aria-label={`Voltar “${cap.rotulo}” ao padrão`}
            disabled={ocupada}
            onClick={() => setRascunho(voltarAoPadrao(rascunho, padrao, cap.id))}
          >
            <RotateCcw className="size-3.5" />
            {!compacto && "Voltar ao padrão"}
          </Button>
        )}
        {diferenteGravado && (
          <Button
            variant={compacto ? "ghost" : "outline"}
            size={compacto ? "icon" : "sm"}
            title={motivoSemTornarPadrao(cap.id)}
            aria-label={`Tornar “${cap.rotulo}” o padrão`}
            disabled={!podeTornarPadrao(cap.id)}
            onClick={() => fixar([cap.id])}
          >
            <Pin className="size-3.5" />
            {!compacto && "Tornar padrão"}
          </Button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Por função: uma função escolhida, todas as permissões com uma chave cada.
  // ---------------------------------------------------------------------------
  function verPorFuncao() {
    return (
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Funções" className="min-w-0 space-y-1 lg:sticky lg:top-4 lg:self-start">
          <p className="px-1 text-xs font-semibold uppercase text-muted-foreground">Funções</p>
          <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {papeis.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFuncao(p)}
                aria-current={p === funcao ? "true" : undefined}
                className={`flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  p === funcao ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                }`}
              >
                <span>{ROLE_LABELS[p]}</span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {contagem[p]}/{capacidades.length}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <section className="min-w-0 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{ROLE_LABELS[funcao]}</h2>
            <p className="text-sm text-muted-foreground">
              Tem {contagem[funcao]} de {capacidades.length} permissões. Ligue ou desligue e salve
              na barra do rodapé.
            </p>
          </div>
          {filtradas.length === 0 ? (
            semResultado()
          ) : (
            grupos
              .filter((g) => filtradas.some((c) => c.grupo === g))
              .map((g) => (
                <div key={g} className="overflow-hidden rounded-xl border">
                  <p className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    {g}
                  </p>
                  <ul className="divide-y">
                    {filtradas
                      .filter((c) => c.grupo === g)
                      .map((cap) => {
                        const ligada = temAcesso(rascunho, cap.id, funcao);
                        const mudou = ligada !== temAcesso(atual, cap.id, funcao);
                        return (
                          <li key={cap.id} className="flex items-start gap-3 px-4 py-3">
                            <Chave
                              ligada={ligada}
                              disabled={ocupada}
                              rotulo={`${ROLE_LABELS[funcao]} — ${cap.rotulo}: ${ligada ? "tem" : "não tem"}`}
                              onClick={() => setRascunho(alternar(rascunho, cap.id, funcao))}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{cap.rotulo}</span>
                                {cap.dependeDoBanco && <SeloDoBanco />}
                                {casaForaDoPadrao(rascunho, padrao, cap.id, funcao) && (
                                  <SeloForaDoPadrao
                                    titulo={`No padrão, ${ROLE_LABELS[funcao]} ${
                                      temAcesso(padrao, cap.id, funcao) ? "tem" : "não tem"
                                    } esta permissão.`}
                                  />
                                )}
                                {mudou && <SeloNaoSalvo />}
                              </div>
                              <p className="text-xs text-muted-foreground">{cap.descricao}</p>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              onClick={() => {
                                setPermissao(cap.id);
                                setVisao("permissao");
                              }}
                            >
                              ver quem tem
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))
          )}
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Por permissão: quem tem e quem não tem.
  // ---------------------------------------------------------------------------
  function verPorPermissao() {
    const cap = porId.get(permissao) ?? filtradas[0] ?? capacidades[0];
    if (!cap) return null;
    const { com, sem } = quemTem(rascunho, cap.id, papeis);
    const fixado = fixados[cap.id];
    const fixadoDiferenteDoOriginal = fixado && !mesmoConjunto(fixado.roles, fabrica[cap.id] ?? []);

    function coluna(titulo: string, lista: UserRole[], ligada: boolean) {
      return (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {titulo} ({lista.length})
          </p>
          {lista.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              {ligada ? "Ninguém além do Admin Master." : "Todas as funções têm."}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {lista.map((p) => {
                const mudou = temAcesso(rascunho, cap.id, p) !== temAcesso(atual, cap.id, p);
                return (
                  <li key={p} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Chave
                      ligada={ligada}
                      disabled={ocupada}
                      rotulo={`${ROLE_LABELS[p]} — ${cap.rotulo}: ${ligada ? "tem" : "não tem"}`}
                      onClick={() => setRascunho(alternar(rascunho, cap.id, p))}
                    />
                    <span className="flex-1">{ROLE_LABELS[p]}</span>
                    {casaForaDoPadrao(rascunho, padrao, cap.id, p) && <SeloForaDoPadrao />}
                    {mudou && <SeloNaoSalvo />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    }

    return (
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <nav aria-label="Permissões" className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:max-h-[75vh] lg:self-start lg:overflow-y-auto">
          {filtradas.length === 0 ? (
            semResultado()
          ) : (
            grupos
              .filter((g) => filtradas.some((c) => c.grupo === g))
              .map((g) => (
                <div key={g} className="space-y-1">
                  <p className="px-1 text-xs font-semibold uppercase text-muted-foreground">{g}</p>
                  {filtradas
                    .filter((c) => c.grupo === g)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPermissao(c.id)}
                        aria-current={c.id === cap.id ? "true" : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                          c.id === cap.id ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                        }`}
                      >
                        <span className="min-w-0 truncate">{c.rotulo}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {alteradas.has(c.id) && (
                            <span className="size-2 rounded-full bg-primary" title="Alteração não salva" />
                          )}
                          {foraDoPadrao(rascunho, padrao, c.id) && (
                            <span className="size-2 rounded-full bg-amber-500" title="Diferente do padrão" />
                          )}
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {(rascunho[c.id] ?? []).length}/{papeis.length}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
              ))
          )}
        </nav>

        <section className="min-w-0 space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs uppercase text-muted-foreground">{cap.grupo}</p>
              <h2 className="text-lg font-semibold">{cap.rotulo}</h2>
              <p className="text-sm text-muted-foreground">{cap.descricao}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {cap.dependeDoBanco && <SeloDoBanco />}
                {foraDoPadrao(rascunho, padrao, cap.id) && <SeloForaDoPadrao />}
                {alteradas.has(cap.id) && <SeloNaoSalvo />}
              </div>
            </div>
            {acoesDaPermissao(cap)}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {coluna("Têm acesso", com, true)}
            {coluna("Não têm acesso", sem, false)}
          </div>

          <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Padrão:</strong> {nomes(padrao[cap.id] ?? [])}.{" "}
              {fixado
                ? `Fixado por você${fixado.updatedAt ? ` em ${formatBrDateTime(fixado.updatedAt)}` : ""}${
                    fixadoDiferenteDoOriginal ? "" : " — igual ao original do sistema"
                  }.`
                : "É o original do sistema (ninguém fixou outro)."}
            </p>
            {fixadoDiferenteDoOriginal && (
              <p>
                <strong className="text-foreground">Original do sistema:</strong>{" "}
                {nomes(fabrica[cap.id] ?? [])}.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                  disabled={ocupada}
                  onClick={() => setConfirmarOriginal(cap.id)}
                >
                  Usar o original como padrão
                </button>
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Grade completa: tudo de uma vez, para quem quer comparar.
  // ---------------------------------------------------------------------------
  function verGrade() {
    if (filtradas.length === 0) return semResultado();
    return (
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="sticky left-0 z-10 min-w-[16rem] bg-muted p-3 text-left font-medium">
                Permissão
              </th>
              {papeis.map((p) => (
                <th key={p} className="p-1.5 text-center align-bottom font-medium">
                  {/* Vertical: 15 colunas de nome inteiro não caberiam, e abreviar viraria adivinhação. */}
                  <button
                    type="button"
                    title={`Ver só ${ROLE_LABELS[p]}`}
                    onClick={() => {
                      setFuncao(p);
                      setVisao("funcao");
                    }}
                    className="inline-block whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
                    style={{ writingMode: "vertical-rl", rotate: "180deg" }}
                  >
                    {ROLE_LABELS[p]}
                  </button>
                </th>
              ))}
              <th className="p-2" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {grupos
              .filter((g) => filtradas.some((c) => c.grupo === g))
              .flatMap((g) => [
                <tr key={`g-${g}`} className="border-b bg-muted/20">
                  <td
                    colSpan={papeis.length + 2}
                    className="sticky left-0 px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground"
                  >
                    {g}
                  </td>
                </tr>,
                ...filtradas
                  .filter((c) => c.grupo === g)
                  .map((cap) => (
                    <tr key={cap.id} className="group border-b last:border-0 hover:bg-muted/30">
                      <td className="sticky left-0 z-10 bg-background p-2.5 align-top group-hover:bg-muted">
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => {
                            setPermissao(cap.id);
                            setVisao("permissao");
                          }}
                        >
                          {cap.rotulo}
                        </button>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {cap.dependeDoBanco && <SeloDoBanco />}
                          {foraDoPadrao(rascunho, padrao, cap.id) && <SeloForaDoPadrao />}
                          {alteradas.has(cap.id) && <SeloNaoSalvo />}
                        </div>
                      </td>
                      {papeis.map((p) => {
                        const fora = casaForaDoPadrao(rascunho, padrao, cap.id, p);
                        return (
                          <td key={p} className="p-1.5 text-center align-middle">
                            <span
                              className={`inline-flex rounded-md p-1 ${fora ? "ring-2 ring-amber-500/70" : ""}`}
                              title={`${ROLE_LABELS[p]} — ${cap.rotulo}${fora ? " (diferente do padrão)" : ""}`}
                            >
                              <input
                                type="checkbox"
                                className="size-4 cursor-pointer"
                                checked={temAcesso(rascunho, cap.id, p)}
                                disabled={ocupada}
                                onChange={() => setRascunho(alternar(rascunho, cap.id, p))}
                                aria-label={`${ROLE_LABELS[p]} — ${cap.rotulo}`}
                              />
                            </span>
                          </td>
                        );
                      })}
                      <td className="p-1.5 align-middle">
                        {acoesDaPermissao(cap, true)}
                      </td>
                    </tr>
                  )),
              ])}
          </tbody>
        </table>
      </div>
    );
  }

  function semResultado() {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhuma permissão com esses filtros.{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            setBusca("");
            setGrupo("");
            setSoFora(false);
          }}
        >
          Limpar filtros
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-5 p-6 pb-32">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">Matriz de permissões</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Quem pode o quê, por função. Veja uma função por vez, uma permissão por vez ou a grade
          inteira. Marcar não grava: o que mudou fica na barra do rodapé até você clicar em{" "}
          <strong>Salvar</strong>. A mudança vale para toda a rede na próxima tela que a pessoa
          abrir.
        </p>
      </header>

      {aviso}

      {aindaSemTabela && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            A tabela de permissões ainda não existe neste banco — o que você vê abaixo é o{" "}
            <strong>padrão do sistema</strong>. Rode a <strong>migração 0246</strong> para poder
            salvar alterações.
          </p>
        </div>
      )}

      {/* Resumo -------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border px-3 py-1">
          {capacidades.length} permissões · {papeis.length} funções
        </span>
        <button
          type="button"
          onClick={() => setSoFora((v) => !v)}
          className={`rounded-full border px-3 py-1 ${
            soFora ? "border-amber-500 font-medium" : "hover:bg-muted"
          }`}
          title="Mostrar só as permissões diferentes do padrão"
        >
          <span className="mr-1.5 inline-block size-2 rounded-full bg-amber-500 align-middle" />
          {foraGravadas.length} diferente{foraGravadas.length === 1 ? "" : "s"} do padrão
        </button>
        {foraGravadas.length > 0 && !somenteLeitura && (
          <Button
            variant="outline"
            size="sm"
            disabled={!podeFixar || ocupada || alteracoes.length > 0}
            title={
              !podeFixar
                ? "O “Tornar padrão” aguarda a migração 0292 neste banco."
                : alteracoes.length > 0
                  ? "Salve ou descarte as alterações antes."
                  : "Fixar como padrão tudo o que está valendo agora."
            }
            onClick={() => setConfirmarTudo(true)}
          >
            <Pin className="size-3.5" />
            Tornar tudo padrão
          </Button>
        )}
        {!podeFixar && !somenteLeitura && (
          <span className="text-xs text-muted-foreground">
            O “Tornar padrão” aguarda a migração 0292.
          </span>
        )}
      </div>

      {/* Barra de ferramentas ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border p-0.5" role="tablist" aria-label="Como ver">
          {VISOES.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={visao === v.id}
              onClick={() => setVisao(v.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                visao === v.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {v.icone}
              {v.rotulo}
            </button>
          ))}
        </div>
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar permissão…"
            aria-label="Procurar permissão"
            className="pl-8"
          />
        </div>
        <select
          value={grupo}
          onChange={(e) => setGrupo(e.target.value)}
          className={SELECT}
          aria-label="Grupo"
        >
          <option value="">Todos os grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={soFora}
            onChange={(e) => setSoFora(e.target.checked)}
          />
          Só as diferentes do padrão
        </label>
      </div>

      {visao === "funcao" && verPorFuncao()}
      {visao === "permissao" && verPorPermissao()}
      {visao === "grade" && verGrade()}

      <details className="rounded-lg border p-3 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-primary" />
          Como esta tela funciona
        </summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong className="text-foreground">O Admin Master não aparece aqui.</strong> Ele passa
            por cima de todas as permissões, sempre — se pudesse perder acesso nesta tela, seria a
            porta trancada com a chave dentro.
          </p>
          <p>
            <strong className="text-foreground">“Diferente do padrão”</strong> não é erro: é o
            aviso de que a permissão está diferente do padrão. Se foi de propósito, use{" "}
            <strong className="text-foreground">Tornar padrão</strong> — o aviso some e o “Voltar
            ao padrão” passa a voltar para essa escolha. Enquanto ninguém fixa um padrão, vale o
            original do sistema.
          </p>
          <p>
            <strong className="text-foreground">Desligar</strong> uma permissão sempre funciona.{" "}
            <strong className="text-foreground">Ligar</strong> uma marcada com{" "}
            <Database className="inline size-3 align-[-2px]" /> abre a tela, mas os dados podem vir
            vazios — nessas, o banco também decide, e a regra dele continua a mesma até ser
            ajustada.
          </p>
          <p>
            Toda alteração fica registrada na Auditoria: quem mudou, quando e quais funções
            passaram a ter a permissão.
          </p>
        </div>
      </details>

      {/* Barra de alterações ---------------------------------------------- */}
      {alteracoes.length > 0 && (
        <div className="sticky bottom-4 z-20 rounded-xl border bg-background p-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-medium"
              onClick={() => setVerLista((v) => !v)}
              aria-expanded={verLista}
            >
              {verLista ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              {alteracoes.length} alteraç{alteracoes.length === 1 ? "ão" : "ões"} em{" "}
              {alteradas.size} permiss{alteradas.size === 1 ? "ão" : "ões"} — ainda não
              salva{alteracoes.length === 1 ? "" : "s"}
            </button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={isPending} onClick={descartar}>
                Descartar
              </Button>
              <Button size="sm" disabled={ocupada} onClick={salvarTudo}>
                <Check className="size-3.5" />
                {isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
          {verLista && (
            <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto border-t pt-2 text-sm">
              {alteracoes.map((m) => (
                <li key={`${m.capacidade}-${m.papel}`} className="flex items-center gap-2">
                  <span
                    className={`inline-block size-2 rounded-full ${
                      m.passa === "ganha" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  {fraseDaMudanca(m, capacidades)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Confirmações ------------------------------------------------------- */}
      <Dialog open={confirmarTudo} onOpenChange={setConfirmarTudo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tornar tudo padrão?</DialogTitle>
            <DialogDescription>
              O que está valendo agora nestas {foraGravadas.length} permissões vira o padrão. Ninguém
              ganha nem perde acesso — muda só a referência do aviso e do “Voltar ao padrão”.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto text-sm">
            {foraGravadas.map((id) => (
              <li key={id}>
                • {porId.get(id)?.rotulo ?? id}{" "}
                <span className="text-muted-foreground">({porId.get(id)?.grupo})</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarTudo(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={() => fixar(foraGravadas)} disabled={isPending}>
              <Pin className="size-3.5" />
              {isPending ? "Gravando…" : "Tornar padrão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmarOriginal !== null} onOpenChange={(v) => !v && setConfirmarOriginal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usar o original do sistema como padrão?</DialogTitle>
            <DialogDescription>
              O padrão de “{confirmarOriginal ? porId.get(confirmarOriginal)?.rotulo : ""}” volta a
              ser: {confirmarOriginal ? nomes(fabrica[confirmarOriginal] ?? []) : ""}. Ninguém ganha
              nem perde acesso agora — muda só a referência do aviso e do “Voltar ao padrão”.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarOriginal(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => confirmarOriginal && usarOriginal(confirmarOriginal)}
              disabled={isPending}
            >
              {isPending ? "Gravando…" : "Usar o original"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
