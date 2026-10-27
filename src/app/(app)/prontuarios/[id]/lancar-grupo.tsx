"use client";

// LANÇAR UM GRUPO DE PROCEDIMENTOS no plano (0324; GRUPOS-PLANO.md). O dente
// se escolhe UMA vez e vale para todos os procedimentos de dente do grupo; o
// de face pede as faces, o de região pede a região, o que não se marca no
// dente entra sem lugar. A conta é de `src/lib/procedimentos/grupos.ts`; a
// régua do dente é a mesma do lançamento à mão (`odontograma/plano.ts`).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { Odontograma } from "@/components/odontograma/odontograma";
import { cn } from "@/lib/utils";
import { formatBRL, type PricedProcedure, type ProtocolRef } from "@/lib/pricing";
import { marcasAtuais, marcasDoDesenho } from "@/lib/odontograma/diagnostico";
import { ehPorDente, ehPorRegiao, regioesDoProcedimento, rotuloDoLocal } from "@/lib/odontograma/plano";
import {
  baseDaLinha,
  montarLancamento,
  oQueEntra,
  ajusteDoItem,
  precoNoPacote,
  temDistribuicaoPropria,
  textoDoAjuste,
  totalDoLancamento,
  type GrupoDeProcedimentos,
} from "@/lib/procedimentos/grupos";
import type { OdontoDoPlano } from "./planning-section";
import { addProcedureGroup } from "./planning-actions";

const ORDEM_DAS_FACES = ["V", "M", "D", "O", "I", "P", "L"];

export function LancarGrupo({
  optionId,
  grupos,
  catalog,
  protocols,
  odonto,
  itensDaOpcao,
  etapas,
  onFechar,
}: {
  optionId: string;
  /** Só os ATIVOS. */
  grupos: GrupoDeProcedimentos[];
  catalog: PricedProcedure[];
  protocols: Record<string, ProtocolRef>;
  odonto?: OdontoDoPlano;
  itensDaOpcao: { id: string; procedureId: string | null; toothCode: string | null }[];
  etapas: { id: string; name: string }[];
  onFechar: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [grupoId, setGrupoId] = useState("");
  const [dentes, setDentes] = useState<string[]>([]);
  const [faces, setFaces] = useState<Record<string, string[]>>({});
  const [regioes, setRegioes] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [etapa, setEtapa] = useState("");

  const grupo = grupos.find((g) => g.id === grupoId) ?? null;
  const regras = odonto?.regras ?? null;
  const dados = odonto?.dados ?? null;

  const atuaisPorDente = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of marcasAtuais(dados?.achados ?? [])) m[a.dente] = [...(m[a.dente] ?? []), a.situacao];
    return m;
  }, [dados?.achados]);

  const { entram, ficamDeFora } = grupo ? oQueEntra(grupo, catalog) : { entram: [], ficamDeFora: [] };
  const precoDe = (id: string) => catalog.find((p) => p.id === id)?.effectivePriceCents ?? 0;
  const nomeDe = (id: string) => entram.find((e) => e.procedureId === id)?.procedimento.name ?? "Procedimento";
  const nomeDaSituacao = (c: string) => dados?.situacoes.find((s) => s.code === c)?.name ?? c;
  const nomeDaRegiao = (c: string) => dados?.regioes.find((r) => r.code === c)?.name;

  const montagem = montarLancamento({
    itens: entram.map((e) => ({ procedureId: e.procedureId, quantidade: e.quantidade, nome: e.procedimento.name })),
    regras,
    lugar: { dentes, facesPorProcedimento: faces, regiaoPorProcedimento: regioes },
    referencia: dados?.dentes ?? {},
    facesPorDente: dados?.faces ?? {},
    atuaisPorDente,
    itensDaOpcao,
    nomeDaSituacao,
  });
  const deFace = regras ? entram.filter((e) => regras[e.procedureId]?.nivel === "face") : [];
  const deRegiao = regras ? entram.filter((e) => ehPorRegiao(regras[e.procedureId])) : [];
  const facesDaSelecao = ORDEM_DAS_FACES.filter((f) => dentes.some((d) => (dados?.faces[d] ?? []).includes(f)));
  // 0325/0328: o ajuste do pacote — o do procedimento, senão o do grupo —
  // item a item como o banco grava.
  const ajusteDoGrupo = grupo?.ajustePercent ?? 0;
  const ajusteDe = (procedureId: string) =>
    ajusteDoItem(grupo?.itens.find((i) => i.procedureId === procedureId) ?? {}, ajusteDoGrupo);
  const comPacote = Boolean(grupo) && (ajusteDoGrupo !== 0 || temDistribuicaoPropria(grupo?.itens ?? []));
  const tabela = totalDoLancamento(montagem.linhas, precoDe);
  const total = totalDoLancamento(montagem.linhas, precoDe, ajusteDe);
  const pedeMotivo = montagem.conflitos.length > 0;
  const pronto =
    Boolean(grupo) &&
    montagem.linhas.length > 0 &&
    montagem.problemas.length === 0 &&
    (!pedeMotivo || motivo.trim().length >= 5);

  function escolherGrupo(id: string) {
    setGrupoId(id);
    setDentes([]);
    setFaces({});
    setRegioes({});
    setMotivo("");
  }

  function lancar() {
    if (!grupo) return;
    startTransition(async () => {
      const r = await addProcedureGroup(optionId, {
        groupId: grupo.id,
        stageId: etapa || null,
        motivo: pedeMotivo ? motivo.trim() : null,
        linhas: montagem.linhas.map((l) => {
          const ref = protocols[l.procedureId];
          const base = baseDaLinha(l, ref?.unit ?? ref?.network ?? null);
          return {
            procedureId: l.procedureId,
            quantity: l.quantidade,
            tooth: l.tooth,
            faces: l.faces,
            regionCode: l.regionCode,
            plannedSessions: base.sessoes,
            plannedMinutes: base.minutos,
          };
        }),
      });
      if (r.ok) {
        toast.success(`Grupo lançado: ${r.quantos} ${r.quantos === 1 ? "item" : "itens"}.`);
        onFechar();
        router.refresh();
      } else {
        toast.error(r.error ?? "Não foi possível lançar o grupo.");
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Layers className="size-3.5" />
          Lançar um grupo de procedimentos
        </p>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onFechar}>
          Fechar
        </Button>
      </div>

      <ListaComBusca
        aria-label="Grupo de procedimentos"
        value={grupoId}
        onValueChange={escolherGrupo}
        className="h-9 w-full sm:w-80"
        options={[
          { value: "", label: "— escolha o grupo —" },
          ...grupos.map((g) => ({ value: g.id, label: g.nome })),
        ]}
      />

      {grupo && (
        <>
          {ficamDeFora.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Fica de fora (não está no catálogo desta unidade ou foi desativado):{" "}
              {ficamDeFora.join(", ")}.
            </p>
          )}

          {!odonto && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              O odontograma não carregou: os procedimentos entram sem o dente, e o envio para aprovação vai pedir o lugar.
            </p>
          )}

          {odonto && dados && montagem.pedeDente && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="text-xs font-medium">
                Onde: toque no(s) dente(s). Vale para{" "}
                {entram.filter((e) => ehPorDente(regras?.[e.procedureId])).map((e) => e.procedimento.name).join(" + ")} —
                cada dente recebe todos.
              </p>
              <Odontograma
                modo="diagnostico"
                denticaoInicial={dados.denticao}
                nomes={dados.nomes}
                faces={dados.faces}
                marcas={marcasDoDesenho(dados.achados ?? [], dados.situacoes, "definidos", dados.feitos)}
                selecionados={dentes}
                onDente={(d) => setDentes(dentes.includes(d) ? dentes.filter((x) => x !== d) : [...dentes, d])}
              />
              {dentes.length > 0 &&
                deFace.map((e) => (
                  <div key={e.procedureId} className="space-y-1">
                    <p className="text-xs">Faces de {e.procedimento.name}:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {facesDaSelecao.map((f) => {
                        const atual = faces[e.procedureId] ?? [];
                        const marcada = atual.includes(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            aria-pressed={marcada}
                            aria-label={`Face ${f} de ${e.procedimento.name}`}
                            onClick={() =>
                              setFaces({
                                ...faces,
                                [e.procedureId]: marcada ? atual.filter((x) => x !== f) : [...atual, f],
                              })
                            }
                            className={cn(
                              "h-11 min-w-11 rounded-md border px-3 text-sm font-medium",
                              marcada ? "border-primary bg-primary text-primary-foreground" : "bg-card"
                            )}
                          >
                            {f}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {odonto && dados &&
            deRegiao.map((e) => (
              <div key={e.procedureId} className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2">
                <p className="text-xs font-medium">
                  {e.procedimento.name}: {regras?.[e.procedureId]?.nivel === "arch" ? "escolha a arcada" : "escolha a região"}.
                </p>
                <ListaComBusca
                  aria-label={`Região de ${e.procedimento.name}`}
                  value={regioes[e.procedureId] ?? ""}
                  onValueChange={(v) => setRegioes({ ...regioes, [e.procedureId]: v })}
                  options={regioesDoProcedimento(regras![e.procedureId], dados.regioes).map((r) => ({ value: r.code, label: r.name }))}
                  placeholder={regras?.[e.procedureId]?.nivel === "arch" ? "Arcada…" : "Região…"}
                />
              </div>
            ))}

          {montagem.problemas.length > 0 && (dentes.length > 0 || !montagem.pedeDente) && (
            <ul className="text-xs text-destructive">
              {[...new Set(montagem.problemas)].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {pedeMotivo && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {montagem.conflitos.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <input
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                placeholder="Para lançar mesmo assim, escreva o motivo"
                className="h-10 w-full rounded-md border border-amber-300 bg-white px-2 text-sm text-foreground dark:bg-transparent"
              />
            </div>
          )}

          {montagem.linhas.length > 0 && (
            <div className="rounded-md bg-muted/40 p-2 text-xs">
              <p className="mb-1 font-medium">Vai entrar no plano:</p>
              <ol className="space-y-0.5">
                {montagem.linhas.map((l, i) => {
                  const lugar = rotuloDoLocal({ toothCode: l.tooth, faceCodes: l.faces, regionCode: l.regionCode }, nomeDaRegiao);
                  return (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {nomeDe(l.procedureId)}
                        {lugar ? ` · ${lugar}` : ""}
                        {l.quantidade > 1 ? ` × ${l.quantidade}` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatBRL(precoNoPacote(precoDe(l.procedureId), ajusteDe(l.procedureId)) * l.quantidade)}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-1 flex justify-between border-t pt-1 font-medium">
                <span>
                  {montagem.linhas.length} {montagem.linhas.length === 1 ? "item" : "itens"}
                </span>
                <span className="tabular-nums">
                  {total !== tabela && (
                    <span className="mr-1 font-normal text-muted-foreground line-through">{formatBRL(tabela)}</span>
                  )}
                  {formatBRL(total)}
                </span>
              </p>
              {comPacote && grupo && (
                <p className="mt-1 font-medium">
                  {temDistribuicaoPropria(grupo.itens)
                    ? `Preço de pacote: ${grupo.itens
                        .filter((i) => ajusteDe(i.procedureId) !== 0)
                        .map((i) => `${i.nome} ${textoDoAjuste(ajusteDe(i.procedureId))}`)
                        .join(" · ")}.`
                    : `Preço de pacote: ${textoDoAjuste(ajusteDoGrupo)} em cada item do grupo.`}
                </p>
              )}
              <p className="mt-1 text-muted-foreground">
                Preço do catálogo da unidade, item por item{comPacote ? ", com o ajuste do pacote" : ""}; sessões e tempo vêm do protocolo e podem ser ajustados depois em cada item.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {etapas.length > 0 && (
              <>
                <span>Etapa</span>
                <select
                  value={etapa}
                  onChange={(ev) => setEtapa(ev.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-1 text-sm"
                  aria-label="Etapa dos itens do grupo"
                >
                  <option value="">Sem etapa</option>
                  {etapas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button size="sm" disabled={!pronto || isPending} onClick={lancar}>
              <Layers className="mr-1 size-4" />
              {montagem.linhas.length > 0
                ? `Lançar ${montagem.linhas.length} ${montagem.linhas.length === 1 ? "item" : "itens"}`
                : "Lançar o grupo"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
