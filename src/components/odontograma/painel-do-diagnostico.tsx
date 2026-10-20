"use client";

// O DIAGNÓSTICO NO DESENHO (OD2). Um painel só, em três modos:
//   - `sugerir` (Coordenador, na avaliação): marca tracejada, desfaz a própria;
//   - `definir` (Planner): aceita / ajusta / rejeita, marca direto, finaliza;
//   - `leitura` (a aba da ficha): só olha, com o filtro.
// A conta (o que vale, o que cabe) é de `src/lib/odontograma/diagnostico.ts`;
// quem pode, quem decide é o banco (0310). Aqui é só a tela.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Odontograma } from "@/components/odontograma/odontograma";
import { cn } from "@/lib/utils";
import { BRAZIL_TIME_ZONE } from "@/lib/dates";
import type { DadosDoOdontograma } from "@/lib/odontograma/carregar";
import type { MarcaNoDente } from "@/lib/odontograma/desenho";
import {
  ROTULO_DO_FILTRO,
  ROTULO_DO_STATUS,
  descricaoDoAchado,
  marcasAtuais,
  marcasDoDesenho,
  montarItens,
  pendentes,
  podeFinalizar,
  situacoesQueCabem,
  type Achado,
  type FiltroDoDesenho,
} from "@/lib/odontograma/diagnostico";
import {
  decidirSugestoes,
  desfazerSugestao,
  finalizarDiagnostico,
  guardarDenticao,
  marcarNoOdontograma,
  sugerirNoOdontograma,
} from "@/app/(app)/prontuarios/[id]/odontograma-actions";

const ORDEM_DAS_FACES = ["V", "M", "D", "O", "I", "P", "L"];
const NOME_DA_FACE: Record<string, string> = {
  V: "Vestibular",
  M: "Mesial",
  D: "Distal",
  O: "Oclusal",
  I: "Incisal",
  P: "Palatina",
  L: "Lingual",
};

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: BRAZIL_TIME_ZONE,
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export function PainelDoDiagnostico({
  clientId,
  modo,
  clinicId,
  dados,
  euId,
  podeMudarDenticao,
  marcasDoPlano = [],
}: {
  /** OD3: o vermelho do plano que vale (a ficha). Vazio = sem o filtro "Só o plano". */
  marcasDoPlano?: MarcaNoDente[];
  clientId: string;
  modo: "sugerir" | "definir" | "leitura";
  /** A unidade da rodada em que o Coordenador sugere. */
  clinicId?: string;
  dados: DadosDoOdontograma;
  euId: string;
  podeMudarDenticao: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filtro, setFiltro] = useState<FiltroDoDesenho>("todos");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [faces, setFaces] = useState<string[]>([]);
  const [situacao, setSituacao] = useState("");
  const [observacao, setObservacao] = useState("");
  const [motivoDoAdendo, setMotivoDoAdendo] = useState("");
  const [ajuste, setAjuste] = useState<{ id: string; faces: string[]; situacao: string } | null>(null);
  const [rejeitando, setRejeitando] = useState<{ id: string; motivo: string } | null>(null);

  const achados = useMemo(() => dados.achados ?? [], [dados.achados]);
  const nomeDaSituacao = useMemo(
    () => new Map(dados.situacoes.map((s) => [s.code, s.name])),
    [dados.situacoes]
  );
  // O plano (vermelho) vem primeiro: na mesma face aparece por cima do diagnóstico.
  const marcas = useMemo(
    () => [
      ...(filtro === "todos" || filtro === "plano" ? marcasDoPlano : []),
      ...marcasDoDesenho(achados, dados.situacoes, filtro),
    ],
    [achados, dados.situacoes, filtro, marcasDoPlano]
  );
  const filtros = (Object.keys(ROTULO_DO_FILTRO) as FiltroDoDesenho[]).filter(
    (f) => f !== "plano" || marcasDoPlano.length > 0
  );
  const atuais = useMemo(() => marcasAtuais(achados), [achados]);
  const aDecidir = useMemo(() => pendentes(achados), [achados]);
  const minhas = aDecidir.filter((a) => a.criadoPor === euId);
  const rodadaMaisRecente = dados.rodadas[0] ?? null;
  const ehAdendo = modo === "definir" && rodadaMaisRecente?.finalizadoEm != null;
  const rotuloDaRodada = new Map(dados.rodadas.map((r) => [r.id, r.rotulo]));
  const quem = (id: string | null) => (id ? (dados.pessoas[id] ?? "alguém") : "alguém");

  if (dados.achados === null) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        O diagnóstico por dente ainda não está disponível neste ambiente (falta a atualização do
        banco). O desenho abaixo é só de referência.
      </p>
    );
  }

  const facesDaSelecao = ORDEM_DAS_FACES.filter((f) => selecionados.some((d) => (dados.faces[d] ?? []).includes(f)));
  const cabem = situacoesQueCabem(dados.situacoes, faces.length > 0);
  const situacaoEscolhida = cabem.find((s) => s.code === situacao) ?? null;
  const montagem = situacaoEscolhida
    ? montarItens(selecionados, faces, situacaoEscolhida, dados.faces, observacao)
    : null;
  const atuaisDaSelecao = atuais.filter((a) => selecionados.includes(a.dente));

  function tocarDente(d: string) {
    setSelecionados((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  }
  function limpar() {
    setSelecionados([]);
    setFaces([]);
    setSituacao("");
    setObservacao("");
  }

  function rodar(acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string, depois?: () => void) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(sucesso);
        depois?.();
        router.refresh();
      } else {
        toast.error(r.error ?? "Algo deu errado.");
      }
    });
  }

  function gravar() {
    if (!montagem || montagem.itens.length === 0) return;
    if (montagem.problemas.length > 0) {
      toast.error(montagem.problemas[0]);
      return;
    }
    if (modo === "sugerir") {
      if (!clinicId) return;
      rodar(() => sugerirNoOdontograma(clientId, clinicId, montagem.itens), "Sugestão registrada.", limpar);
    } else {
      rodar(
        () => marcarNoOdontograma(clientId, montagem.itens, ehAdendo ? motivoDoAdendo : undefined),
        ehAdendo ? "Adendo registrado." : "Marcado como definido.",
        () => {
          limpar();
          setMotivoDoAdendo("");
        }
      );
    }
  }

  function retirar(a: Achado) {
    const item = [{ action: "remove" as const, removes: a.id }];
    if (modo === "sugerir") {
      if (!clinicId) return;
      rodar(() => sugerirNoOdontograma(clientId, clinicId, item), "Retirada sugerida.");
    } else {
      if (ehAdendo && motivoDoAdendo.trim().length < 5) {
        toast.error("O diagnóstico já foi finalizado: escreva o motivo do adendo antes de retirar.");
        return;
      }
      rodar(() => marcarNoOdontograma(clientId, item, ehAdendo ? motivoDoAdendo : undefined), "Marca retirada.");
    }
  }

  const desenho = (
    <Odontograma
      modo={modo === "leitura" ? "leitura" : "diagnostico"}
      denticaoInicial={dados.denticao}
      motivoDaDenticao={dados.motivoDaDenticao}
      nomes={dados.nomes}
      faces={dados.faces}
      marcas={marcas}
      selecionados={selecionados}
      onDente={tocarDente}
      onDenticao={
        podeMudarDenticao
          ? (d) => rodar(() => guardarDenticao(clientId, d), "Dentição registrada no odontograma.")
          : undefined
      }
      extra={
        <div role="radiogroup" aria-label="O que mostrar" className="inline-flex rounded-md border p-0.5">
          {filtros.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filtro === f}
              onClick={() => setFiltro(f)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                filtro === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ROTULO_DO_FILTRO[f]}
            </button>
          ))}
        </div>
      }
    />
  );

  return (
    <div className="space-y-4">
      {desenho}

      {modo !== "leitura" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {selecionados.length === 0
                ? "Toque nos dentes (ou escolha uma região) para marcar."
                : `Selecionados: ${selecionados.join(", ")}`}
            </span>
            {selecionados.length > 0 && (
              <Button size="sm" variant="ghost" onClick={limpar}>
                Limpar
              </Button>
            )}
            <div className="ml-auto w-full sm:w-64">
              <ListaComBusca
                options={dados.regioes
                  .filter((r) => r.dentes.length > 0)
                  .map((r) => ({ value: r.code, label: `${r.name} (${r.dentes.length})` }))}
                value=""
                onValueChange={(code) => {
                  const r = dados.regioes.find((x) => x.code === code);
                  if (r) setSelecionados(r.dentes);
                }}
                placeholder="Selecionar uma região…"
              />
            </div>
          </div>

          {selecionados.length > 0 && (
            <>
              {atuaisDaSelecao.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Já definido nestes dentes</p>
                  <ul className="space-y-1">
                    {atuaisDaSelecao.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        <span>{descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}</span>
                        <Button size="sm" variant="outline" disabled={isPending} onClick={() => retirar(a)}>
                          {modo === "sugerir" ? "Sugerir retirar" : "Retirar"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Faces (deixe sem face para marcar o dente inteiro, a coroa ou a raiz)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {facesDaSelecao.map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={faces.includes(f)}
                      onClick={() => {
                        setFaces((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]));
                        setSituacao("");
                      }}
                      className={cn(
                        "h-11 min-w-11 rounded-md border px-3 text-sm font-medium",
                        faces.includes(f) ? "border-primary bg-primary text-primary-foreground" : "bg-card"
                      )}
                      title={NOME_DA_FACE[f]}
                    >
                      {f} <span className="hidden text-xs font-normal sm:inline">· {NOME_DA_FACE[f]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <ListaComBusca
                  options={cabem.map((s) => ({ value: s.code, label: `${s.symbol} · ${s.name}`, busca: s.code }))}
                  value={situacao}
                  onValueChange={setSituacao}
                  placeholder={faces.length > 0 ? "Situação da face…" : "Situação do dente…"}
                />
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Observação (opcional)"
                  className="h-11 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </div>

              {ehAdendo && (
                <input
                  value={motivoDoAdendo}
                  onChange={(e) => setMotivoDoAdendo(e.target.value)}
                  placeholder="Motivo do adendo (o diagnóstico já foi finalizado)"
                  className="h-11 w-full rounded-md border border-amber-300 bg-transparent px-3 text-sm"
                />
              )}

              {montagem && montagem.problemas.length > 0 && (
                <ul className="text-xs text-destructive">
                  {montagem.problemas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              <Button
                className="h-11"
                disabled={
                  isPending ||
                  !montagem ||
                  montagem.itens.length === 0 ||
                  montagem.problemas.length > 0 ||
                  (ehAdendo && motivoDoAdendo.trim().length < 5)
                }
                onClick={gravar}
              >
                {modo === "sugerir"
                  ? `Sugerir${montagem && montagem.itens.length > 1 ? ` (${montagem.itens.length} dentes)` : ""}`
                  : ehAdendo
                    ? "Registrar adendo"
                    : `Marcar como definido${montagem && montagem.itens.length > 1 ? ` (${montagem.itens.length} dentes)` : ""}`}
              </Button>
            </>
          )}
        </div>
      )}

      {modo === "sugerir" && minhas.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Minhas sugestões esperando o Planner ({minhas.length})</h3>
          <ul className="space-y-1">
            {minhas.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm">
                <span>{descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={isPending}
                  onClick={() => rodar(() => desfazerSugestao(clientId, a.id), "Sugestão desfeita.")}
                >
                  <Undo2 className="mr-1 size-4" /> Desfazer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {modo === "definir" && aDecidir.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Sugestões a definir ({aDecidir.length})</h3>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={isPending}
              onClick={() =>
                rodar(
                  () => decidirSugestoes(clientId, aDecidir.map((a) => ({ id: a.id, decision: "accept" as const }))),
                  "Sugestões aceitas."
                )
              }
            >
              Aceitar todas
            </Button>
          </div>
          <ul className="space-y-1.5">
            {aDecidir.map((a) => (
              <li key={a.id} className="space-y-2 rounded-md border border-dashed p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}</span>
                  <span className="text-xs text-muted-foreground">
                    sugerido por {quem(a.criadoPor)} em {quando(a.criadoEm)}
                    {a.evaluationId ? ` · ${rotuloDaRodada.get(a.evaluationId) ?? ""}` : ""}
                  </span>
                  {a.observacao && <span className="text-xs italic">“{a.observacao}”</span>}
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        rodar(() => decidirSugestoes(clientId, [{ id: a.id, decision: "accept" }]), "Sugestão aceita.")
                      }
                    >
                      <Check className="mr-1 size-4" /> Aceitar
                    </Button>
                    {a.acao === "mark" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => setAjuste({ id: a.id, faces: a.faces, situacao: a.situacao })}
                      >
                        <Pencil className="mr-1 size-4" /> Ajustar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => setRejeitando({ id: a.id, motivo: "" })}
                    >
                      <X className="mr-1 size-4" /> Rejeitar
                    </Button>
                  </div>
                </div>

                {ajuste?.id === a.id && (
                  <EditorDoAjuste
                    faces={dados.faces[a.dente] ?? []}
                    situacoes={dados.situacoes}
                    valor={ajuste}
                    onChange={setAjuste}
                    onCancelar={() => setAjuste(null)}
                    onSalvar={() => {
                      const s = dados.situacoes.find((x) => x.code === ajuste.situacao);
                      rodar(
                        () =>
                          decidirSugestoes(clientId, [
                            {
                              id: a.id,
                              decision: "adjust",
                              faces: s?.appliesTo === "face" ? ajuste.faces : [],
                              condition: ajuste.situacao,
                            },
                          ]),
                        "Sugestão ajustada (a original fica guardada).",
                        () => setAjuste(null)
                      );
                    }}
                    isPending={isPending}
                  />
                )}

                {rejeitando?.id === a.id && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={rejeitando.motivo}
                      onChange={(e) => setRejeitando({ id: a.id, motivo: e.target.value })}
                      placeholder="Motivo (recomendado: quem sugeriu vai ver)"
                      className="h-10 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() =>
                        rodar(
                          () =>
                            decidirSugestoes(clientId, [{ id: a.id, decision: "reject", reason: rejeitando.motivo }]),
                          "Sugestão rejeitada.",
                          () => setRejeitando(null)
                        )
                      }
                    >
                      Rejeitar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejeitando(null)}>
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados.rodadas.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Diagnóstico por rodada</h3>
          <ul className="space-y-1.5">
            {dados.rodadas.map((r) => {
              // Conta o que vale ou espera decisão — a sugestão ajustada já
              // virou a marca do ajuste, e a desfeita/rejeitada não marca nada.
              const daRodada = achados.filter(
                (a) => a.evaluationId === r.id && (a.status === "defined" || a.status === "suggested")
              );
              const pend = daRodada.filter((a) => a.status === "suggested").length;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="font-medium">{r.rotulo}</span>
                  {r.clinicName && <span className="text-xs text-muted-foreground">{r.clinicName}</span>}
                  <span className="text-xs text-muted-foreground">
                    {daRodada.length} {daRodada.length === 1 ? "marca" : "marcas"}
                    {pend > 0 ? ` · ${pend} a definir` : ""}
                  </span>
                  {r.finalizadoEm ? (
                    <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Finalizado em {quando(r.finalizadoEm)}
                      {r.finalizadoPor ? ` por ${r.finalizadoPor}` : ""}
                    </span>
                  ) : modo === "definir" ? (
                    <span className="ml-auto">
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" disabled={isPending || !podeFinalizar(achados, r)}>
                            Finalizar diagnóstico
                          </Button>
                        }
                        title={`Finalizar o diagnóstico — ${r.rotulo}`}
                        description="Depois de finalizado, nada desta rodada muda: as marcas, as considerações e as fotos e exames ficam trancados. Correção só por adendo, com motivo. Quem sugeriu recebe um aviso com o resumo."
                        confirmLabel="Finalizar"
                        successMessage="Diagnóstico finalizado."
                        onConfirm={() => finalizarDiagnostico(clientId, r.id)}
                      />
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-muted-foreground">diagnóstico em aberto</span>
                  )}
                  {modo === "definir" && !r.finalizadoEm && pend > 0 && (
                    <span className="w-full text-xs text-muted-foreground">
                      Para finalizar, decida as {pend} sugestões pendentes desta rodada.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Histórico das marcas ({achados.length})</summary>
        {achados.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nenhuma marca registrada ainda.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {[...achados].reverse().map((a) => (
              <li key={a.id} className="text-xs">
                <span className="font-medium">{descricaoDoAchado(a, nomeDaSituacao.get(a.situacao) ?? a.situacao)}</span>
                {" — "}
                {ROTULO_DO_STATUS[a.status]}
                {a.origem === "suggestion" ? ` · sugerido por ${quem(a.criadoPor)} em ${quando(a.criadoEm)}` : ""}
                {a.origem === "direct" ? ` · marcado por ${quem(a.criadoPor)} em ${quando(a.criadoEm)}` : ""}
                {a.origem === "adjustment" ? ` · ajuste de ${quem(a.criadoPor)} em ${quando(a.criadoEm)}` : ""}
                {a.decididoEm && a.origem === "suggestion" ? ` · decidido por ${quem(a.decididoPor)} em ${quando(a.decididoEm)}` : ""}
                {a.motivoDaDecisao ? ` · motivo: ${a.motivoDaDecisao}` : ""}
                {a.adendo ? ` · ADENDO: ${a.motivoDoAdendo ?? ""}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function EditorDoAjuste({
  faces,
  situacoes,
  valor,
  onChange,
  onCancelar,
  onSalvar,
  isPending,
}: {
  faces: string[];
  situacoes: DadosDoOdontograma["situacoes"];
  valor: { id: string; faces: string[]; situacao: string };
  onChange: (v: { id: string; faces: string[]; situacao: string }) => void;
  onCancelar: () => void;
  onSalvar: () => void;
  isPending: boolean;
}) {
  const atual = situacoes.find((s) => s.code === valor.situacao);
  const comFaces = atual?.appliesTo === "face";
  const cabem = situacoesQueCabem(situacoes, comFaces);
  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-2">
      {comFaces && (
        <div className="flex flex-wrap gap-1.5">
          {ORDEM_DAS_FACES.filter((f) => faces.includes(f)).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={valor.faces.includes(f)}
              onClick={() =>
                onChange({
                  ...valor,
                  faces: valor.faces.includes(f) ? valor.faces.filter((x) => x !== f) : [...valor.faces, f],
                })
              }
              className={cn(
                "h-11 min-w-11 rounded-md border px-3 text-sm font-medium",
                valor.faces.includes(f) ? "border-primary bg-primary text-primary-foreground" : "bg-card"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <ListaComBusca
        options={cabem.map((s) => ({ value: s.code, label: `${s.symbol} · ${s.name}`, busca: s.code }))}
        value={valor.situacao}
        onValueChange={(v) => onChange({ ...valor, situacao: v })}
        placeholder="Situação"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={isPending || (comFaces && valor.faces.length === 0)} onClick={onSalvar}>
          Salvar ajuste
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
