"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointments";
import {
  GRUPOS_DE_INDICADOR,
  INDICADORES_DE_META,
  ORIGENS_DA_VENDA,
  ORIGENS_DO_CLIENTE,
  indicadorDe,
  rotuloDaDirecao,
} from "@/lib/metas/indicadores";
import { MODO_LABEL, OBJETIVOS_ESTRATEGICOS, objetivoLabel, type ModoDoAlvo } from "@/lib/metas/regras";
import type { Modelo } from "@/lib/metas/modelos";
import { ativarModelo, salvarModelo, type DadosDoModelo } from "../actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-60";
const textareaClass = "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm";

type Form = {
  name: string;
  summary: string;
  indicator: string;
  direction: "increase" | "decrease";
  target_mode: ModoDoAlvo;
  duration: "mes" | "trimestre";
  specialties: string[];
  appointment_types: string[];
  client_origins: string[];
  sale_origin: string;
  how_text: string;
  resources_text: string;
  strategic_objective: string;
  relevance_text: string;
};

function formDe(m: Modelo | null): Form {
  return {
    name: m?.nome ?? "",
    summary: m?.resumo ?? "",
    indicator: m?.indicator ?? "",
    direction: m?.direction ?? "increase",
    target_mode: m?.target_mode ?? "collective",
    duration: m?.duracao ?? "mes",
    specialties: m?.filtros?.specialties ?? [],
    appointment_types: m?.filtros?.appointment_types ?? [],
    client_origins: m?.filtros?.client_origins ?? [],
    sale_origin: m?.filtros?.sale_origin ?? "",
    how_text: m?.how_text ?? "",
    resources_text: m?.resources_text ?? "",
    strategic_objective: m?.strategic_objective ?? "",
    relevance_text: m?.relevance_text ?? "",
  };
}

function alternar(lista: string[], v: string): string[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

function Marcaveis({
  opcoes,
  marcados,
  onChange,
}: {
  opcoes: { value: string; label: string }[];
  marcados: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = marcados.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(alternar(marcados, o.value))}
            aria-pressed={on}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition",
              on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary/40"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function EditorDeModelos({
  modelos,
  doBanco,
  especialidades,
}: {
  modelos: Modelo[];
  doBanco: boolean;
  especialidades: string[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<{ id: string | null; f: Form } | null>(null);
  const [pendente, startTransition] = useTransition();
  const ativos = modelos.filter((m) => m.ativo);
  const inativos = modelos.filter((m) => !m.ativo);

  const f = editando?.f;
  const ind = f ? indicadorDe(f.indicator) : undefined;
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setEditando((e) => (e ? { ...e, f: { ...e.f, [k]: v } } : e));

  function salvar() {
    if (!editando) return;
    const x = editando.f;
    if (!x.name.trim()) return toast.error("Dê um nome ao modelo.");
    if (!indicadorDe(x.indicator)) return toast.error("Escolha o indicador.");
    const dados: DadosDoModelo = {
      name: x.name,
      summary: x.summary,
      indicator: x.indicator,
      direction: x.direction,
      target_mode: x.target_mode,
      duration: x.duration,
      filters: {
        specialties: x.specialties,
        appointment_types: x.appointment_types,
        client_origins: x.client_origins,
        sale_origin: x.sale_origin,
      },
      how_text: x.how_text,
      resources_text: x.resources_text,
      strategic_objective: x.strategic_objective,
      relevance_text: x.relevance_text,
    };
    startTransition(async () => {
      const r = await salvarModelo(editando.id, dados);
      if (!r.ok) return void toast.error(r.error);
      toast.success(editando.id ? "Modelo atualizado." : "Modelo criado.");
      setEditando(null);
      router.refresh();
    });
  }

  function ativar(m: Modelo, ativo: boolean) {
    if (!m.id) return;
    const id = m.id;
    startTransition(async () => {
      const r = await ativarModelo(id, ativo);
      if (!r.ok) return void toast.error(r.error);
      toast.success(ativo ? "Modelo reativado: volta a aparecer na Nova meta." : "Modelo desativado: sai da Nova meta.");
      router.refresh();
    });
  }

  const cartao = (m: Modelo) => {
    const i = indicadorDe(m.indicator);
    return (
      <li key={m.chave} className={cn("flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm", !m.ativo && "opacity-70")}>
        <div className="min-w-0">
          <p className="truncate font-medium">{m.nome}</p>
          {m.resumo && <p className="text-xs text-muted-foreground">{m.resumo}</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          {i?.rotulo ?? m.indicator} · {rotuloDaDirecao(i ?? null, m.direction)} ·{" "}
          {m.duracao === "trimestre" ? "trimestre" : "mês"} · {objetivoLabel(m.strategic_objective || null)}
        </p>
        {doBanco && (
          <div className="mt-auto flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditando({ id: m.id, f: formDe(m) })}>
              <Pencil className="mr-1 size-3.5" /> Editar
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pendente} onClick={() => ativar(m, !m.ativo)}>
              <Power className="mr-1 size-3.5" /> {m.ativo ? "Desativar" : "Reativar"}
            </Button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {!doBanco && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          Os modelos ainda não podem ser editados neste banco (falta a migração 0322). A Nova meta continua oferecendo os 8
          modelos de sempre.
        </p>
      )}
      {doBanco && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setEditando({ id: null, f: formDe(null) })}>
            <Plus className="mr-1 size-4" /> Novo modelo
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Ativos ({ativos.length})</h2>
        {ativos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum modelo ativo: a Nova meta começa do zero.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">{ativos.map(cartao)}</ul>
        )}
      </section>
      {inativos.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Desativados ({inativos.length})</h2>
          <p className="text-xs text-muted-foreground">Não aparecem na Nova meta. Reative quando quiser.</p>
          <ul className="grid gap-3 sm:grid-cols-2">{inativos.map(cartao)}</ul>
        </section>
      )}

      <Dialog open={editando !== null} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {f && (
            <>
              <DialogHeader>
                <DialogTitle>{editando?.id ? "Editar modelo" : "Novo modelo"}</DialogTitle>
                <DialogDescription>
                  Mudar um modelo não muda as metas que já nasceram dele: a meta copia os campos ao ser criada.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="m-nome">Nome</Label>
                    <Input id="m-nome" value={f.name} maxLength={160} onChange={(e) => set("name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-resumo">Resumo (aparece na lista)</Label>
                    <Input id="m-resumo" value={f.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-indicador">Indicador</Label>
                  <select
                    id="m-indicador"
                    className={selectClass}
                    value={f.indicator}
                    onChange={(e) => {
                      const novo = indicadorDe(e.target.value);
                      setEditando((x) =>
                        x
                          ? {
                              ...x,
                              f: {
                                ...x.f,
                                indicator: e.target.value,
                                direction: novo?.direcoes[0] ?? "increase",
                                target_mode: novo && !novo.porPessoa ? "collective" : x.f.target_mode,
                              },
                            }
                          : x
                      );
                    }}
                  >
                    <option value="">Escolha…</option>
                    {GRUPOS_DE_INDICADOR.map((g) => (
                      <optgroup key={g} label={g}>
                        {INDICADORES_DE_META.filter((i) => i.grupo === g).map((i) => (
                          <option key={i.chave} value={i.chave}>
                            {i.rotulo}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {ind && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="m-direcao">Direção</Label>
                        <select
                          id="m-direcao"
                          className={selectClass}
                          value={f.direction}
                          disabled={ind.direcoes.length === 1}
                          onChange={(e) => set("direction", e.target.value as "increase" | "decrease")}
                        >
                          {ind.direcoes.map((d) => (
                            <option key={d} value={d}>
                              {rotuloDaDirecao(ind, d)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="m-modo">Tipo de meta</Label>
                        <select
                          id="m-modo"
                          className={selectClass}
                          value={f.target_mode}
                          disabled={!ind.porPessoa}
                          onChange={(e) => set("target_mode", e.target.value as ModoDoAlvo)}
                        >
                          {(Object.keys(MODO_LABEL) as ModoDoAlvo[]).map((m) => (
                            <option key={m} value={m}>
                              {MODO_LABEL[m]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="m-duracao">Período</Label>
                        <select
                          id="m-duracao"
                          className={selectClass}
                          value={f.duration}
                          onChange={(e) => set("duration", e.target.value as "mes" | "trimestre")}
                        >
                          <option value="mes">Até o fim do mês</option>
                          <option value="trimestre">Até o fim do 3º mês</option>
                        </select>
                      </div>
                    </div>
                    {ind.recortes.includes("specialties") && especialidades.length > 0 && (
                      <div className="space-y-1.5">
                        <Label>Especialidade (opcional)</Label>
                        <Marcaveis
                          opcoes={especialidades.map((e) => ({ value: e, label: e }))}
                          marcados={f.specialties}
                          onChange={(v) => set("specialties", v)}
                        />
                      </div>
                    )}
                    {ind.recortes.includes("appointment_types") && (
                      <div className="space-y-1.5">
                        <Label>Tipo de agendamento (opcional)</Label>
                        <Marcaveis
                          opcoes={Object.entries(APPOINTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                          marcados={f.appointment_types}
                          onChange={(v) => set("appointment_types", v)}
                        />
                      </div>
                    )}
                    {ind.recortes.includes("client_origins") && (
                      <div className="space-y-1.5">
                        <Label>Origem do cliente (opcional)</Label>
                        <Marcaveis
                          opcoes={ORIGENS_DO_CLIENTE.map((o) => ({ value: o.value, label: o.label }))}
                          marcados={f.client_origins}
                          onChange={(v) => set("client_origins", v)}
                        />
                      </div>
                    )}
                    {ind.recortes.includes("sale_origin") && (
                      <div className="space-y-1.5">
                        <Label htmlFor="m-origem">Origem da venda (opcional)</Label>
                        <select
                          id="m-origem"
                          className={selectClass}
                          value={f.sale_origin}
                          onChange={(e) => set("sale_origin", e.target.value)}
                        >
                          <option value="">Todas</option>
                          {ORIGENS_DA_VENDA.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="m-como">Como (passo S)</Label>
                  <textarea id="m-como" className={textareaClass} value={f.how_text} onChange={(e) => set("how_text", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-recursos">Recursos (passo A)</Label>
                  <textarea
                    id="m-recursos"
                    className={textareaClass}
                    value={f.resources_text}
                    onChange={(e) => set("resources_text", e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="m-objetivo">Objetivo estratégico (passo R)</Label>
                    <select
                      id="m-objetivo"
                      className={selectClass}
                      value={f.strategic_objective}
                      onChange={(e) => set("strategic_objective", e.target.value)}
                    >
                      <option value="">Escolha…</option>
                      {OBJETIVOS_ESTRATEGICOS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-porque">Por que importa (passo R)</Label>
                  <textarea
                    id="m-porque"
                    className={textareaClass}
                    value={f.relevance_text}
                    onChange={(e) => set("relevance_text", e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditando(null)}>
                  Fechar
                </Button>
                <Button type="button" disabled={pendente} onClick={salvar}>
                  Salvar modelo
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
