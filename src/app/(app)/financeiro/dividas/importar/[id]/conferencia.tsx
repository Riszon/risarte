"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleX, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import { formatIsoDateBr } from "@/lib/dates";
import {
  CAMPOS_DIVIDAS,
  CAMPOS_PROTESTOS,
  ROTULO_DA_DECISAO,
  decisaoEfetiva,
  type Ajustes,
  type DadosDaDivida,
  type DadosDoProtesto,
  type Decisao,
  type LinhaConferida,
  type TotalPorDevedor,
} from "@/lib/finance/dividas-importacao";
import { SELECT_CLASS } from "../../formulario-da-divida";
import { corrigirLinha, decidirVarias, desfazerLote, descartarLote, gravarLote, reconferirLote } from "../actions";
import type { Lote } from "../dados";

export type LinhaDaTela = LinhaConferida & { id: string; debtId: string | null };

type Props = {
  lote: Lote;
  linhas: LinhaDaTela[];
  credoresNovos: { chave: string; nome: string; documento: string | null; linhas: number }[];
  categoriasNovas: string[];
  totais: TotalPorDevedor[];
  importado: Record<string, { quantidade: number; valorCents: number }> | null;
  podeImportar: boolean;
  devedores: { id: string; nome: string }[];
  credores: { id: string; nome: string; documento: string | null }[];
  titulos: { id: string; clinicId: string; fornecedorId: string | null; credor: string | null; descricao: string; valorCents: number; vencimento: string; documento: string | null }[];
  dividas: { id: string; code: string; clinicId: string; credor: string; valorCents: number }[];
};

const DECISOES: Record<"dividas" | "protestos", Decisao[]> = {
  dividas: ["importar", "vincular", "ignorar"],
  protestos: ["vincular", "nova", "ignorar"],
};

type Filtro = "todas" | "pendentes" | "avisos" | "ignoradas";

const brl = (c: number | null | undefined) => (c === null || c === undefined ? "—" : formatBRL(c));

/** A conferência linha a linha (3.4): o que vai entrar, o que segura, e gravar. */
export function ConferenciaDoLote(p: Props) {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const [aba, setAba] = useState<"dividas" | "protestos">("dividas");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [corrigindo, setCorrigindo] = useState<LinhaDaTela | null>(null);
  const [gravando, setGravando] = useState(false);
  const [gerarTitulos, setGerarTitulos] = useState(true);
  const [desfazendo, setDesfazendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const emConferencia = p.lote.status === "conferencia";
  const editavel = emConferencia && p.podeImportar;

  const daAba = p.linhas.filter((l) => l.aba === aba);
  const visiveis = daAba.filter((l) => {
    const ign = decisaoEfetiva(l) === "ignorar";
    if (filtro === "pendentes") return l.bloqueia;
    if (filtro === "avisos") return !ign && !l.bloqueia && l.avisos.length > 0;
    if (filtro === "ignoradas") return ign;
    return true;
  });
  const contar = (f: Filtro) =>
    daAba.filter((l) =>
      f === "pendentes" ? l.bloqueia : f === "avisos" ? decisaoEfetiva(l) !== "ignorar" && !l.bloqueia && l.avisos.length > 0 : f === "ignoradas" ? decisaoEfetiva(l) === "ignorar" : true
    ).length;

  const bloqueadas = p.linhas.filter((l) => l.bloqueia);
  const vaoEntrar = p.linhas.filter((l) => decisaoEfetiva(l) !== "ignorar");
  const impacto = useMemo(() => {
    let a = 0, b = 0, c = 0, protestos = 0, novas = 0;
    for (const l of vaoEntrar) {
      if (l.aba === "dividas") {
        const o = (l.dados as DadosDaDivida | null)?.debt.origin;
        if (decisaoEfetiva(l) === "vincular" || o === "C") c += 1;
        else if (o === "B") b += 1;
        else a += 1;
      } else if (decisaoEfetiva(l) === "nova") {
        novas += 1;
        a += 1;
      } else protestos += 1;
    }
    return { a, b, c, protestos, novas };
  }, [vaoEntrar]);

  const agir = (fn: () => Promise<{ ok: boolean; error?: string }>, sucesso?: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        if (sucesso) toast.success(sucesso);
        router.refresh();
      }
    });

  const gravar = () =>
    startTransition(async () => {
      const r = await gravarLote(p.lote.id, gerarTitulos);
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      setGravando(false);
      toast.success(`${r.resultado?.debts ?? 0} dívidas importadas.`);
      router.refresh();
    });

  return (
    <div className="space-y-5">
      {p.lote.avisos.map((a, i) => (
        <p key={i} className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {a.texto}
        </p>
      ))}

      {p.lote.resultado && <Resultado lote={p.lote} />}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">Linhas</p>
            <p>
              {p.linhas.filter((l) => l.aba === "dividas").length} na aba Dívidas · {p.linhas.filter((l) => l.aba === "protestos").length} na aba Protestos
            </p>
            <p>
              {vaoEntrar.length} {emConferencia ? "para gravar" : "gravadas"} · {p.linhas.length - vaoEntrar.length} ignoradas
            </p>
            <p className={bloqueadas.length ? "font-semibold text-destructive" : "text-emerald-700 dark:text-emerald-400"}>
              {bloqueadas.length ? `${bloqueadas.length} com erro ou decisão pendente` : "Nenhuma linha segura a gravação"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">No Contas a Pagar e na DRE</p>
            <p>{impacto.a} de origem A: título de saldo de implantação, fora da DRE</p>
            <p>{impacto.b} de origem B: despesa na competência (entra na DRE)</p>
            <p>{impacto.c} de origem C: só vinculam títulos que já existem</p>
            <p className="text-muted-foreground">
              {impacto.protestos} protestos ligados a dívidas · {impacto.novas} protestos viram dívida nova
            </p>
          </CardContent>
        </Card>
        {emConferencia && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">Cadastros que serão criados</p>
            {p.credoresNovos.length === 0 && p.categoriasNovas.length === 0 && <p className="text-muted-foreground">Nenhum.</p>}
            {p.credoresNovos.length > 0 && (
              <details>
                <summary className="cursor-pointer">{p.credoresNovos.length} credores (Fornecedores)</summary>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {p.credoresNovos.map((c) => (
                    <li key={c.chave}>
                      {c.nome} {c.documento ? `(${c.documento.length === 8 ? `raiz ${c.documento}` : c.documento})` : "(sem CNPJ)"} · {c.linhas} linha(s)
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {p.categoriasNovas.length > 0 && (
              <details>
                <summary className="cursor-pointer">{p.categoriasNovas.length} categorias/subcategorias</summary>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {p.categoriasNovas.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <Totais totais={p.totais} importado={p.importado} />

      {editavel && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={ocupado || bloqueadas.length > 0 || vaoEntrar.length === 0} onClick={() => setGravando(true)}>
            Gravar a importação
          </Button>
          {bloqueadas.some((l) => l.temErro) && (
            <Button
              variant="outline"
              disabled={ocupado}
              onClick={() => agir(() => decidirVarias(p.lote.id, bloqueadas.filter((l) => l.temErro).map((l) => l.id), "ignorar"), "Linhas com erro marcadas para ignorar.")}
            >
              {bloqueadas.filter((l) => l.temErro).length === 1 ? "Ignorar a linha com erro" : `Ignorar as ${bloqueadas.filter((l) => l.temErro).length} linhas com erro`}
            </Button>
          )}
          <Button variant="outline" disabled={ocupado} onClick={() => agir(() => reconferirLote(p.lote.id), "Conferência refeita com o cadastro de agora.")}>
            <RefreshCw className="size-4" />
            Conferir de novo
          </Button>
          <Button variant="ghost" disabled={ocupado} onClick={() => agir(() => descartarLote(p.lote.id), "Lote descartado.")}>
            Descartar o lote
          </Button>
          {bloqueadas.length > 0 && (
            <span className="text-sm text-destructive">Corrija ou marque “Ignorar” nas linhas pendentes para poder gravar.</span>
          )}
        </div>
      )}
      {p.lote.status === "importado" && p.podeImportar && (
        <Button variant="outline" disabled={ocupado} onClick={() => setDesfazendo(true)}>
          <Undo2 className="size-4" />
          Desfazer a importação
        </Button>
      )}

      <div className="space-y-2">
        <nav className="flex flex-wrap gap-1 border-b text-sm">
          {(["dividas", "protestos"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={cn("-mb-px border-b-2 px-3 py-2", aba === a ? "border-gold font-semibold" : "border-transparent text-muted-foreground")}
            >
              {a === "dividas" ? "Aba Dívidas" : "Aba Protestos"}
            </button>
          ))}
          <span className="flex-1" />
          {(["todas", "pendentes", "avisos", "ignoradas"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={cn("rounded px-2 py-1 text-xs", filtro === f ? "bg-muted font-semibold" : "text-muted-foreground")}
            >
              {{ todas: "Todas", pendentes: "Com erro ou pendentes", avisos: "Com aviso", ignoradas: "Ignoradas" }[f]} ({contar(f)})
            </button>
          ))}
        </nav>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2" />
                <th className="p-2">Linha</th>
                {aba === "dividas" && <th className="p-2">#</th>}
                <th className="p-2">Devedor</th>
                <th className="p-2">Credor</th>
                <th className="p-2">{aba === "dividas" ? "Vencimento" : "Protesto"}</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2">O que a conferência diz</th>
                <th className="p-2">Decisão</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const ign = decisaoEfetiva(l) === "ignorar";
                return (
                  <tr key={l.id} className={cn("border-t align-top", ign && "opacity-60")}>
                    <td className="p-2">
                      {l.bloqueia ? (
                        <CircleX className="size-4 text-destructive" aria-label="Erro ou pendente" />
                      ) : l.avisos.length > 0 && !ign ? (
                        <AlertTriangle className="size-4 text-amber-600" aria-label="Aviso" />
                      ) : (
                        <CheckCircle2 className="size-4 text-emerald-600" aria-label="Certo" />
                      )}
                    </td>
                    <td className="p-2">{l.numero}</td>
                    {aba === "dividas" && <td className="p-2">{l.chave ?? "—"}</td>}
                    <td className="p-2">{l.devedorNome ?? "—"}</td>
                    <td className="p-2">{l.credorNome ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{l.vencimento ? formatIsoDateBr(l.vencimento) : "—"}</td>
                    <td className="p-2 text-right whitespace-nowrap">{brl(l.valorCents)}</td>
                    <td className="p-2">
                      <ul className="space-y-0.5 text-xs">
                        {l.avisos.map((a, i) => (
                          <li key={i} className={a.nivel === "erro" ? "text-destructive" : "text-amber-800 dark:text-amber-300"}>
                            {a.texto}
                          </li>
                        ))}
                        {l.debtId && (
                          <li>
                            <Link href={`/financeiro/dividas/${l.debtId}`} className="underline">
                              Abrir a dívida
                            </Link>
                          </li>
                        )}
                      </ul>
                    </td>
                    <td className="p-2">
                      {editavel ? (
                        <div className="flex flex-col gap-1">
                          <select
                            className={SELECT_CLASS}
                            value={l.decisao ?? ""}
                            disabled={ocupado}
                            onChange={(e) =>
                              agir(() => corrigirLinha(p.lote.id, l.id, { decisao: (e.target.value || null) as Decisao | null }))
                            }
                          >
                            <option value="">Sugerida: {ROTULO_DA_DECISAO[l.sugerida]}</option>
                            {DECISOES[l.aba].map((d) => (
                              <option key={d} value={d}>
                                {ROTULO_DA_DECISAO[d]}
                              </option>
                            ))}
                          </select>
                          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setCorrigindo(l)}>
                            Corrigir
                          </Button>
                        </div>
                      ) : (
                        ROTULO_DA_DECISAO[decisaoEfetiva(l)]
                      )}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    Nenhuma linha neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {corrigindo && (
        <Correcao
          linha={corrigindo}
          props={p}
          ocupado={ocupado}
          fechar={() => setCorrigindo(null)}
          salvar={(ajustes) =>
            startTransition(async () => {
              const r = await corrigirLinha(p.lote.id, corrigindo.id, { ajustes });
              if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
              else {
                setCorrigindo(null);
                router.refresh();
              }
            })
          }
        />
      )}

      <Dialog open={gravando} onOpenChange={(o) => !ocupado && setGravando(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gravar a importação</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Vão entrar <strong>{vaoEntrar.length}</strong> linhas, num lote só: se uma for recusada pelo banco, nada é
              gravado e a tela diz qual linha. As dívidas ganham a etiqueta da importação de hoje.
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={gerarTitulos} onChange={(e) => setGerarTitulos(e.target.checked)} className="mt-1" />
              <span>
                Gerar já os títulos no Contas a Pagar das unidades (origens A e B). A que não puder gerar fica listada, e
                dá para gerar depois pela lista de dívidas.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setGravando(false)}>
              Voltar
            </Button>
            <Button disabled={ocupado} onClick={gravar}>
              {ocupado ? "Gravando…" : "Gravar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={desfazendo} onOpenChange={(o) => !ocupado && setDesfazendo(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Desfazer a importação {p.lote.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Todas as dívidas deste lote são excluídas (com o motivo no histórico), os títulos gerados no Contas a
              Pagar são cancelados e os que já existiam voltam a ser só do Contas a Pagar. Só é possível enquanto
              nenhum título do lote tem pagamento. Credores e categorias criados continuam no cadastro.
            </p>
            <Label htmlFor="motivo">Motivo</Label>
            <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={ocupado} onClick={() => setDesfazendo(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={ocupado || motivo.trim().length < 5}
              onClick={() =>
                startTransition(async () => {
                  const r = await desfazerLote(p.lote.id, motivo);
                  if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
                  else {
                    setDesfazendo(false);
                    toast.success("Importação desfeita.");
                    router.refresh();
                  }
                })
              }
            >
              Desfazer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Resultado({ lote }: { lote: Lote }) {
  const r = lote.resultado!;
  return (
    <Card className={lote.status === "desfeito" ? "opacity-70" : ""}>
      <CardContent className="space-y-1 p-4 text-sm">
        <p className="font-medium">{lote.status === "desfeito" ? "Esta importação foi desfeita" : "Importação gravada"}</p>
        <p>
          {r.debts} dívidas · {r.protests} protestos da aba Protestos · {r.suppliers_created} credores e {r.categories_created} categorias
          cadastrados · {r.titles} títulos gerados no Contas a Pagar · etiqueta “{r.tag}”
        </p>
        {r.title_failures.length > 0 && (
          <div className="rounded border border-amber-500/50 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">Sem título no Contas a Pagar (gere depois pela dívida):</p>
            <ul className="mt-1 space-y-0.5">
              {r.title_failures.map((f) => (
                <li key={f.id}>
                  <Link href={`/financeiro/dividas/${f.id}?aba=financeiro`} className="underline">
                    {f.code}
                  </Link>
                  : {f.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link href="/financeiro/dividas" className="inline-block underline">
          Ver na lista de dívidas
        </Link>
      </CardContent>
    </Card>
  );
}

/** Totais por CNPJ: o arquivo × o que vai entrar × o que fica de fora — e, depois de gravar, o que entrou. */
function Totais({ totais, importado }: { totais: TotalPorDevedor[]; importado: Props["importado"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Devedor</th>
            <th className="p-2 text-right">Linhas</th>
            <th className="p-2 text-right">Total no arquivo</th>
            <th className="p-2 text-right">Ignorado</th>
            <th className="p-2 text-right">A importar</th>
            {importado && <th className="p-2 text-right">Entrou no sistema</th>}
            {importado && <th className="p-2">Confere?</th>}
          </tr>
        </thead>
        <tbody>
          {totais.map((t) => {
            const e = t.clinicId ? importado?.[t.clinicId] : undefined;
            const bate = importado ? (e?.valorCents ?? 0) === t.importarCents : null;
            return (
              <tr key={t.clinicId ?? "sem"} className="border-t">
                <td className="p-2">{t.nome}</td>
                <td className="p-2 text-right">{t.linhas}</td>
                <td className="p-2 text-right">{brl(t.arquivoCents)}</td>
                <td className="p-2 text-right">{brl(t.ignoradoCents)}</td>
                <td className="p-2 text-right font-medium">{brl(t.importarCents)}</td>
                {importado && <td className="p-2 text-right">{brl(e?.valorCents ?? 0)}</td>}
                {importado && (
                  <td className={cn("p-2", bate ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                    {bate ? "Bate" : `Diferença de ${brl(t.importarCents - (e?.valorCents ?? 0))}`}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t p-2 text-xs text-muted-foreground">
        Total no arquivo = a soma da aba Dívidas (valor atualizado; sem ele, o original). “A importar” inclui os protestos
        que viram dívida nova. Compare com os totais da aba “Resumo por CNPJ” da planilha.
      </p>
    </div>
  );
}

/** Corrigir uma linha: células, devedor, credor, títulos (origem C) ou a dívida do protesto. */
function Correcao({
  linha,
  props: p,
  ocupado,
  fechar,
  salvar,
}: {
  linha: LinhaDaTela;
  props: Props;
  ocupado: boolean;
  fechar: () => void;
  salvar: (a: Ajustes) => void;
}) {
  const campos = linha.aba === "dividas" ? CAMPOS_DIVIDAS : CAMPOS_PROTESTOS;
  const editaveis = linha.aba === "dividas"
    ? ["credor", "credor_cnpj", "categoria", "subcategoria", "vencimento", "valor_original", "valor_atualizado", "contrato", "origem", "quantidade"]
    : ["credor", "valor", "data", "cartorio", "custas", "quantidade"];
  const [celulas, setCelulas] = useState<Record<string, string>>(() =>
    Object.fromEntries(editaveis.map((c) => [c, String(linha.ajustes.celulas?.[c] ?? linha.celulas[c] ?? "")]))
  );
  const [clinicId, setClinicId] = useState(linha.ajustes.clinicId ?? linha.devedorId ?? "");
  const [supplierId, setSupplierId] = useState(linha.ajustes.supplierId ?? "");
  const [payableIds, setPayableIds] = useState<string[]>(
    linha.ajustes.payableIds ?? ((linha.dados as DadosDaDivida | null)?.link_payable_ids ?? linha.titulosParecidos)
  );
  const [vinculada, setVinculada] = useState(linha.ajustes.vinculada ?? (linha.celulas.vinculada ? String(linha.celulas.vinculada) : ""));
  const [debtId, setDebtId] = useState(linha.ajustes.debtId ?? ((linha.dados as DadosDoProtesto | null)?.link && "debt_id" in (linha.dados as DadosDoProtesto).link! ? ((linha.dados as DadosDoProtesto).link as { debt_id: string }).debt_id : ""));
  const rotulo = (c: string) => campos.find((x) => x.campo === c)?.rotulo ?? c;
  const titulosDaUnidade = p.titulos.filter((t) => t.clinicId === clinicId);
  const chaves = p.linhas.filter((l) => l.aba === "dividas" && l.chave).map((l) => ({ chave: l.chave!, credor: l.credorNome, devedorId: l.devedorId }));

  const montar = (): Ajustes => {
    const mudadas: Record<string, string | null> = {};
    for (const c of editaveis) {
      const original = linha.celulas[c] === null || linha.celulas[c] === undefined ? "" : String(linha.celulas[c]);
      if (celulas[c] !== original) mudadas[c] = celulas[c].trim() === "" ? null : celulas[c].trim();
    }
    const a: Ajustes = { celulas: mudadas };
    if (clinicId && clinicId !== linha.devedorId) a.clinicId = clinicId;
    else if (linha.ajustes.clinicId) a.clinicId = clinicId || null;
    if (supplierId) a.supplierId = supplierId;
    if (linha.aba === "dividas" && payableIds.length) a.payableIds = payableIds;
    if (linha.aba === "protestos") {
      if (debtId) a.debtId = debtId;
      else if (vinculada !== (linha.celulas.vinculada ? String(linha.celulas.vinculada) : "")) a.vinculada = vinculada || null;
    }
    return a;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Corrigir a linha {linha.numero} da aba {linha.aba === "dividas" ? "Dívidas" : "Protestos"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            A correção vale só para esta importação (a planilha não muda). A conferência roda de novo ao salvar.
          </p>
          <label className="block">
            <span className="text-xs text-muted-foreground">Devedor</span>
            <select className={SELECT_CLASS} value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">— pela planilha —</option>
              {p.devedores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Credor do cadastro (ou deixe pela planilha)</span>
            <select className={SELECT_CLASS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— pela planilha (nome e CNPJ abaixo) —</option>
              {p.credores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.documento ? ` · ${c.documento}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {editaveis.map((c) => (
              <label key={c} className="block">
                <span className="text-xs text-muted-foreground">{rotulo(c)}</span>
                <Input value={celulas[c]} onChange={(e) => setCelulas((x) => ({ ...x, [c]: e.target.value }))} />
              </label>
            ))}
          </div>

          {linha.aba === "dividas" && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Títulos em aberto deste devedor no Contas a Pagar (para a origem C — vincular em vez de lançar de novo):
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2">
                {titulosDaUnidade.length === 0 && <p className="text-xs text-muted-foreground">Nenhum título livre.</p>}
                {titulosDaUnidade.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={payableIds.includes(t.id)}
                      onChange={(e) => setPayableIds((x) => (e.target.checked ? [...x, t.id] : x.filter((y) => y !== t.id)))}
                    />
                    <span>
                      {formatIsoDateBr(t.vencimento)} · {brl(t.valorCents)} · {t.credor ?? "—"} · {t.descricao}
                      {linha.titulosParecidos.includes(t.id) ? " (parecido)" : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {linha.aba === "protestos" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-muted-foreground">Ligar à dívida nº (#) da aba Dívidas</span>
                <select className={SELECT_CLASS} value={vinculada} onChange={(e) => { setVinculada(e.target.value); setDebtId(""); }}>
                  <option value="">—</option>
                  {chaves
                    .filter((k) => !clinicId || !k.devedorId || k.devedorId === clinicId)
                    .map((k) => (
                      <option key={k.chave} value={k.chave}>
                        #{k.chave} · {k.credor ?? "—"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">… ou a uma dívida já cadastrada</span>
                <select className={SELECT_CLASS} value={debtId} onChange={(e) => { setDebtId(e.target.value); if (e.target.value) setVinculada(""); }}>
                  <option value="">—</option>
                  {p.dividas
                    .filter((d) => !clinicId || d.clinicId === clinicId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} · {d.credor} · {brl(d.valorCents)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={ocupado} onClick={fechar}>
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={() => salvar(montar())}>
            {ocupado ? "Conferindo…" : "Salvar e conferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
