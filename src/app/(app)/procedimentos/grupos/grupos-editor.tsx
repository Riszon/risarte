"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { formatBRL } from "@/lib/pricing";
import {
  MAXIMO_NO_GRUPO,
  QUANTIDADE_MAXIMA,
  validarGrupo,
  type GrupoDeProcedimentos,
} from "@/lib/procedimentos/grupos";
import { ativarGrupo, excluirGrupo, salvarGrupo } from "./actions";

export type ProcedimentoParaGrupo = {
  id: string;
  nome: string;
  codigo: string | null;
  especialidade: string | null;
  /** Preço padrão da rede — só para o total de referência. */
  precoCents: number;
};

type Linha = { procedureId: string; quantidade: string };
type Rascunho = { id: string | null; nome: string; descricao: string; linhas: Linha[] };

const NOVO: Rascunho = {
  id: null,
  nome: "",
  descricao: "",
  linhas: [
    { procedureId: "", quantidade: "1" },
    { procedureId: "", quantidade: "1" },
  ],
};

export function GruposEditor({
  grupos,
  procedimentos,
}: {
  grupos: GrupoDeProcedimentos[];
  procedimentos: ProcedimentoParaGrupo[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const precoDe = new Map(procedimentos.map((p) => [p.id, p.precoCents]));

  function rodar(fn: () => Promise<{ ok: boolean; error?: string }>, sucesso: string, depois?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(sucesso);
        depois?.();
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function editar(g: GrupoDeProcedimentos) {
    // Procedimento que saiu do catálogo não volta para o formulário: o banco
    // recusaria salvar com ele. O cartão já avisou qual era.
    setRascunho({
      id: g.id,
      nome: g.nome,
      descricao: g.descricao ?? "",
      linhas: g.itens.filter((i) => i.ativo).map((i) => ({ procedureId: i.procedureId, quantidade: String(i.quantidade) })),
    });
  }

  const ativos = grupos.filter((g) => g.ativo);
  const inativos = grupos.filter((g) => !g.ativo);

  return (
    <div className="space-y-4">
      {rascunho ? (
        <FormularioDoGrupo
          rascunho={rascunho}
          onChange={setRascunho}
          procedimentos={procedimentos}
          precoDe={precoDe}
          salvando={isPending}
          onCancelar={() => setRascunho(null)}
          onSalvar={() => {
            const itens = rascunho.linhas
              .filter((l) => l.procedureId)
              .map((l) => ({ procedureId: l.procedureId, quantidade: Number(l.quantidade) }));
            const problema = validarGrupo(rascunho.nome, itens);
            if (problema) {
              toast.error(problema);
              return;
            }
            rodar(
              () => salvarGrupo({ id: rascunho.id, nome: rascunho.nome, descricao: rascunho.descricao, itens }),
              rascunho.id ? "Grupo salvo." : "Grupo criado.",
              () => setRascunho(null)
            );
          }}
        />
      ) : (
        <Button onClick={() => setRascunho(NOVO)}>
          <Plus className="mr-1 size-4" />
          Novo grupo
        </Button>
      )}

      {ativos.length === 0 && !rascunho && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nenhum grupo ainda. Crie o primeiro — por exemplo, &quot;Implante +
          prótese sobre implante&quot;.
        </p>
      )}

      <ul className="space-y-2">
        {ativos.map((g) => (
          <CartaoDoGrupo
            key={g.id}
            grupo={g}
            precoDe={precoDe}
            ocupado={isPending}
            onEditar={() => editar(g)}
            onAtivar={() => rodar(() => ativarGrupo(g.id, false), "Grupo inativado: não aparece mais no plano.")}
            onExcluir={() => {
              if (!window.confirm(`Excluir o grupo "${g.nome}"? Os planos já montados não mudam.`)) return;
              rodar(() => excluirGrupo(g.id), "Grupo excluído.");
            }}
          />
        ))}
      </ul>

      {inativos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Inativos ({inativos.length})</h2>
          <ul className="space-y-2">
            {inativos.map((g) => (
              <CartaoDoGrupo
                key={g.id}
                grupo={g}
                precoDe={precoDe}
                ocupado={isPending}
                onEditar={() => editar(g)}
                onAtivar={() => rodar(() => ativarGrupo(g.id, true), "Grupo reativado.")}
                onExcluir={() => {
                  if (!window.confirm(`Excluir o grupo "${g.nome}"?`)) return;
                  rodar(() => excluirGrupo(g.id), "Grupo excluído.");
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CartaoDoGrupo({
  grupo,
  precoDe,
  ocupado,
  onEditar,
  onAtivar,
  onExcluir,
}: {
  grupo: GrupoDeProcedimentos;
  precoDe: Map<string, number>;
  ocupado: boolean;
  onEditar: () => void;
  onAtivar: () => void;
  onExcluir: () => void;
}) {
  const foraDoCatalogo = grupo.itens.filter((i) => !i.ativo);
  const total = grupo.itens
    .filter((i) => i.ativo)
    .reduce((s, i) => s + (precoDe.get(i.procedureId) ?? 0) * i.quantidade, 0);
  return (
    <li className={`rounded-xl border bg-card p-3 ${grupo.ativo ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium">
            <Layers className="size-4 shrink-0 text-gold-tinta" />
            {grupo.nome}
            {!grupo.ativo && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">Inativo</span>
            )}
          </p>
          {grupo.descricao && <p className="text-sm text-muted-foreground">{grupo.descricao}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={onEditar} disabled={ocupado}>
            <Pencil className="mr-1 size-3.5" />
            Editar
          </Button>
          <Button size="sm" variant="outline" onClick={onAtivar} disabled={ocupado}>
            {grupo.ativo ? "Inativar" : "Reativar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onExcluir} disabled={ocupado} aria-label={`Excluir o grupo ${grupo.nome}`}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <ol className="mt-2 space-y-0.5 text-sm">
        {grupo.itens.map((i, n) => (
          <li key={i.procedureId} className={i.ativo ? "" : "text-muted-foreground line-through"}>
            {n + 1}. {i.nome}
            {i.quantidade > 1 && ` × ${i.quantidade}`}
          </li>
        ))}
      </ol>
      {foraDoCatalogo.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {foraDoCatalogo.map((i) => i.nome).join(", ")}{" "}
          {foraDoCatalogo.length === 1 ? "saiu" : "saíram"} do catálogo (inativo) e não{" "}
          {foraDoCatalogo.length === 1 ? "entra" : "entram"} no plano. Edite o grupo para tirar.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Total de referência (preço padrão da rede, um de cada): {formatBRL(total)}. No plano vale o
        preço do catálogo da unidade, item por item.
      </p>
    </li>
  );
}

function FormularioDoGrupo({
  rascunho,
  onChange,
  procedimentos,
  precoDe,
  salvando,
  onCancelar,
  onSalvar,
}: {
  rascunho: Rascunho;
  onChange: (r: Rascunho) => void;
  procedimentos: ProcedimentoParaGrupo[];
  precoDe: Map<string, number>;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: () => void;
}) {
  const linhas = rascunho.linhas;
  const mudarLinha = (i: number, l: Partial<Linha>) =>
    onChange({ ...rascunho, linhas: linhas.map((x, k) => (k === i ? { ...x, ...l } : x)) });
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= linhas.length) return;
    const nova = [...linhas];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    onChange({ ...rascunho, linhas: nova });
  };
  const total = linhas.reduce(
    (s, l) => s + (precoDe.get(l.procedureId) ?? 0) * Math.max(1, Number(l.quantidade) || 1),
    0
  );
  const opcoes = [
    { value: "", label: "— escolha o procedimento —" },
    ...procedimentos.map((p) => ({
      value: p.id,
      label: `${p.nome}${p.especialidade ? ` · ${p.especialidade}` : ""}`,
      busca: p.codigo ?? "",
    })),
  ];

  return (
    <section className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
      <h2 className="text-sm font-semibold">{rascunho.id ? "Editar grupo" : "Novo grupo"}</h2>
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Nome</span>
        <Input
          value={rascunho.nome}
          onChange={(e) => onChange({ ...rascunho, nome: e.target.value })}
          placeholder="Ex.: Implante + prótese sobre implante"
          maxLength={120}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Descrição (opcional)</span>
        <Input
          value={rascunho.descricao}
          onChange={(e) => onChange({ ...rascunho, descricao: e.target.value })}
          placeholder="Quando usar este grupo"
          maxLength={500}
        />
      </label>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Procedimentos, na ordem em que entram no plano
        </p>
        <ol className="space-y-1.5">
          {linhas.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
              <ListaComBusca
                aria-label={`Procedimento ${i + 1}`}
                value={l.procedureId}
                onValueChange={(v) => mudarLinha(i, { procedureId: v })}
                // No celular a lista ocupa a linha (o nome do procedimento é
                // longo); quantidade e setas descem para a linha de baixo.
                className="h-9 min-w-0 flex-1 basis-[calc(100%-2rem)] sm:w-80 sm:flex-none sm:basis-auto"
                options={opcoes}
              />
              <span className="text-xs text-muted-foreground">×</span>
              <Input
                value={l.quantidade}
                onChange={(e) => mudarLinha(i, { quantidade: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                inputMode="numeric"
                className="w-14"
                aria-label={`Quantidade do procedimento ${i + 1}`}
              />
              <Button size="sm" variant="ghost" className="px-1.5" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">
                <ArrowUp className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" className="px-1.5" onClick={() => mover(i, 1)} disabled={i === linhas.length - 1} aria-label="Descer">
                <ArrowDown className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="px-1.5"
                onClick={() => onChange({ ...rascunho, linhas: linhas.filter((_, k) => k !== i) })}
                aria-label="Tirar do grupo"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
        {linhas.length < MAXIMO_NO_GRUPO && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...rascunho, linhas: [...linhas, { procedureId: "", quantidade: "1" }] })}
          >
            <Plus className="mr-1 size-4" />
            Procedimento
          </Button>
        )}
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>
            A ordem importa: o que prepara o dente vem antes (o implante antes da
            prótese sobre implante).
          </li>
          <li>
            Procedimento de dente entra uma vez por dente escolhido no plano; a
            quantidade (até {QUANTIDADE_MAXIMA}) vale para os outros.
          </li>
        </ul>
      </div>

      <p className="text-sm">
        Total de referência: <strong>{formatBRL(total)}</strong>{" "}
        <span className="text-xs text-muted-foreground">(preço padrão da rede; no plano vale o da unidade)</span>
      </p>

      <div className="flex gap-2">
        <Button onClick={onSalvar} disabled={salvando}>
          {rascunho.id ? "Salvar grupo" : "Criar grupo"}
        </Button>
        <Button variant="ghost" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </section>
  );
}
