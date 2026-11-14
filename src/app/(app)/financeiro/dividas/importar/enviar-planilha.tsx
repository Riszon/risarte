"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  CAMPOS_DIVIDAS,
  CAMPOS_PROTESTOS,
  COLUNAS_CALCULADAS,
  casarColunas,
  celulasDaLinha,
  linhaVazia,
  mapeamentoPadrao,
  normalizar,
  type LinhaDaPlanilha,
  type Mapeamento,
} from "@/lib/finance/dividas-importacao";
import { SELECT_CLASS } from "../formulario-da-divida";
import { conferirArquivo, salvarModelo } from "./actions";
import type { Modelo } from "./dados";

type Aba = { nome: string; cabecalhos: string[]; linhas: { numero: number; valores: Record<string, unknown> }[] };
type Lido = { nomeArquivo: string; hash: string; abas: Aba[] };

/** Lê a aba: a 1ª linha com 3+ células cheias é o cabeçalho. */
function lerAba(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet, nome: string): Aba {
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const h = matriz.findIndex((r) => (r ?? []).filter((c) => c !== null && String(c).trim() !== "").length >= 3);
  if (h < 0) return { nome, cabecalhos: [], linhas: [] };
  const cabecalhos = (matriz[h] ?? []).map((c) => (c === null ? "" : String(c).trim()));
  const linhas = matriz
    .slice(h + 1)
    .map((r, i) => ({
      numero: h + 2 + i,
      valores: Object.fromEntries(cabecalhos.map((c, k) => [c, (r ?? [])[k] ?? null]).filter(([c]) => c !== "")),
    }))
    // Linha toda vazia (a planilha-modelo vem formatada até a linha 1000) não conta.
    .filter((l) => Object.values(l.valores).some((v) => v !== null && String(v).trim() !== ""));
  return { nome, cabecalhos: cabecalhos.filter(Boolean), linhas };
}

/**
 * Importar planilha (0407), passo 1: o arquivo é lido AQUI, no navegador
 * (nada sobe antes de a pessoa mandar conferir), o modelo diz qual coluna é
 * qual, e a conferência abre no servidor.
 */
export function EnviarPlanilha({ modelos }: { modelos: Modelo[] }) {
  const router = useRouter();
  const [ocupado, startTransition] = useTransition();
  const [lido, setLido] = useState<Lido | null>(null);
  const [lendo, setLendo] = useState(false);
  const [modeloId, setModeloId] = useState<string>(modelos.find((m) => m.padrao)?.id ?? "");
  const modelo = modelos.find((m) => m.id === modeloId)?.mapeamento ?? mapeamentoPadrao();
  const [abaDividas, setAbaDividas] = useState<string>("");
  const [abaProtestos, setAbaProtestos] = useState<string>("");
  const [colunas, setColunas] = useState<{ dividas: Record<string, string>; protestos: Record<string, string> }>({ dividas: {}, protestos: {} });
  const [nomeDoModelo, setNomeDoModelo] = useState("");

  const aba = (nome: string) => lido?.abas.find((a) => a.nome === nome) ?? null;

  function aplicarModelo(l: Lido, m: Mapeamento) {
    const achar = (alvo: string | null, campos: typeof CAMPOS_DIVIDAS) =>
      l.abas.find((a) => alvo && normalizar(a.nome) === normalizar(alvo))?.nome ??
      l.abas.find((a) => casarColunas(a.cabecalhos, campos).faltando.length === 0 && a.cabecalhos.length > 0)?.nome ??
      "";
    const d = achar(m.abas.dividas, CAMPOS_DIVIDAS);
    const p = achar(m.abas.protestos, CAMPOS_PROTESTOS);
    setAbaDividas(d);
    setAbaProtestos(p && p !== d ? p : "");
    setColunas({
      dividas: casarColunas(l.abas.find((a) => a.nome === d)?.cabecalhos ?? [], CAMPOS_DIVIDAS, m.colunas.dividas).colunas,
      protestos: casarColunas(l.abas.find((a) => a.nome === p)?.cabecalhos ?? [], CAMPOS_PROTESTOS, m.colunas.protestos ?? {}).colunas,
    });
  }

  async function lerArquivo(arquivo: File) {
    setLendo(true);
    try {
      const buf = await arquivo.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { cellDates: true });
      const abas = wb.SheetNames.map((n) => lerAba(XLSX, wb.Sheets[n], n)).filter((a) => a.cabecalhos.length > 0);
      if (abas.length === 0) {
        toast.error("Não achei nenhuma aba com cabeçalho nesta planilha.");
        return;
      }
      const l = { nomeArquivo: arquivo.name, hash, abas };
      setLido(l);
      aplicarModelo(l, modelo);
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível ler o arquivo. Ele é uma planilha (.xlsx, .xls ou .csv)?");
    } finally {
      setLendo(false);
    }
  }

  const faltando = useMemo(() => {
    const d = CAMPOS_DIVIDAS.filter((c) => c.obrigatorio && !colunas.dividas[c.campo]).map((c) => `Dívidas: ${c.rotulo}`);
    const p = abaProtestos ? CAMPOS_PROTESTOS.filter((c) => c.obrigatorio && !colunas.protestos[c.campo]).map((c) => `Protestos: ${c.rotulo}`) : [];
    return [...(abaDividas ? [] : ["a aba das dívidas"]), ...d, ...p];
  }, [colunas, abaDividas, abaProtestos]);

  const entrada = useMemo((): LinhaDaPlanilha[] => {
    if (!lido) return [];
    const out: LinhaDaPlanilha[] = [];
    for (const [nome, tipo, cols] of [[abaDividas, "dividas", colunas.dividas], [abaProtestos, "protestos", colunas.protestos]] as const) {
      const a = lido.abas.find((x) => x.nome === nome);
      if (!a) continue;
      for (const l of a.linhas) {
        const celulas = celulasDaLinha(l.valores, cols);
        if (!linhaVazia(celulas)) out.push({ aba: tipo, numero: l.numero, celulas });
      }
    }
    return out;
  }, [lido, abaDividas, abaProtestos, colunas]);

  const mapeamento = (): Mapeamento => ({
    abas: { dividas: abaDividas, protestos: abaProtestos || null },
    colunas,
  });

  const conferir = () =>
    startTransition(async () => {
      const r = await conferirArquivo({ nomeArquivo: lido!.nomeArquivo, hash: lido!.hash, modeloId: modeloId || null, mapeamento: mapeamento(), linhas: entrada });
      if (!r.ok) {
        toast.error(r.error ?? "Algo deu errado.");
        return;
      }
      router.push(`/financeiro/dividas/importar/${r.id}`);
    });

  const guardarModelo = () =>
    startTransition(async () => {
      const r = await salvarModelo(nomeDoModelo, mapeamento());
      if (!r.ok) toast.error(r.error ?? "Algo deu errado.");
      else {
        toast.success("Modelo salvo: na próxima importação, escolha-o na lista.");
        setNomeDoModelo("");
        router.refresh();
      }
    });

  const mapa = (tipo: "dividas" | "protestos", campos: typeof CAMPOS_DIVIDAS, nome: string) => {
    const cab = aba(nome)?.cabecalhos ?? [];
    const usadas = new Set(Object.values(colunas[tipo]));
    const sobrando = cab.filter((c) => !usadas.has(c));
    return (
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {campos.map((c) => (
            <label key={c.campo} className="block text-xs">
              <span className={c.obrigatorio && !colunas[tipo][c.campo] ? "font-semibold text-destructive" : "text-muted-foreground"}>
                {c.rotulo}
                {c.obrigatorio ? " *" : ""}
              </span>
              <select
                className={SELECT_CLASS}
                value={colunas[tipo][c.campo] ?? ""}
                onChange={(e) =>
                  setColunas((x) => {
                    const novo = { ...x[tipo] };
                    if (e.target.value) novo[c.campo] = e.target.value;
                    else delete novo[c.campo];
                    return { ...x, [tipo]: novo };
                  })
                }
              >
                <option value="">— não importar —</option>
                {cab.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {sobrando.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Colunas que não entram:{" "}
            {sobrando.map((c) => (COLUNAS_CALCULADAS.some((x) => normalizar(x) === normalizar(c)) ? `${c} (o sistema calcula)` : c)).join(" · ")}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="arquivo">Planilha (.xlsx, .xls ou .csv)</Label>
            <Input
              id="arquivo"
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={lendo || ocupado}
              onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="modelo">Modelo de mapeamento</Label>
            <select
              id="modelo"
              className={SELECT_CLASS}
              value={modeloId}
              onChange={(e) => {
                setModeloId(e.target.value);
                const m = modelos.find((x) => x.id === e.target.value)?.mapeamento ?? mapeamentoPadrao();
                if (lido) aplicarModelo(lido, m);
              }}
            >
              {modelos.length === 0 && <option value="">Padrão</option>}
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.padrao ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </div>
          {lendo && <span className="text-sm text-muted-foreground">Lendo a planilha…</span>}
        </div>

        {lido && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4" />
              <strong>{lido.nomeArquivo}</strong> — abas: {lido.abas.map((a) => `${a.nome} (${a.linhas.length} linhas)`).join(" · ")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-muted-foreground">Aba das dívidas</span>
                <select
                  className={SELECT_CLASS}
                  value={abaDividas}
                  onChange={(e) => {
                    setAbaDividas(e.target.value);
                    setColunas((x) => ({ ...x, dividas: casarColunas(aba(e.target.value)?.cabecalhos ?? [], CAMPOS_DIVIDAS, modelo.colunas.dividas).colunas }));
                  }}
                >
                  <option value="">— escolha —</option>
                  {lido.abas.map((a) => (
                    <option key={a.nome} value={a.nome}>
                      {a.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">Aba dos protestos (opcional)</span>
                <select
                  className={SELECT_CLASS}
                  value={abaProtestos}
                  onChange={(e) => {
                    setAbaProtestos(e.target.value);
                    setColunas((x) => ({ ...x, protestos: casarColunas(aba(e.target.value)?.cabecalhos ?? [], CAMPOS_PROTESTOS, modelo.colunas.protestos ?? {}).colunas }));
                  }}
                >
                  <option value="">— sem aba de protestos —</option>
                  {lido.abas.map((a) => (
                    <option key={a.nome} value={a.nome}>
                      {a.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {abaDividas && (
              <details open={faltando.length > 0} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Colunas da aba {abaDividas}</summary>
                <div className="mt-3">
                  {mapa("dividas", CAMPOS_DIVIDAS, abaDividas)}
                </div>
              </details>
            )}
            {abaProtestos && (
              <details open={faltando.some((f) => f.startsWith("Protestos"))} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Colunas da aba {abaProtestos}</summary>
                <div className="mt-3">
                  {mapa("protestos", CAMPOS_PROTESTOS, abaProtestos)}
                </div>
              </details>
            )}

            {faltando.length > 0 && (
              <p className="rounded border border-destructive/40 p-2 text-sm text-destructive">Falta escolher: {faltando.join(", ")}.</p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <Button disabled={ocupado || faltando.length > 0 || entrada.length === 0} onClick={conferir}>
                <Upload className="size-4" />
                {ocupado ? "Conferindo…" : `Conferir ${entrada.length} ${entrada.length === 1 ? "linha" : "linhas"}`}
              </Button>
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="nome-modelo" className="text-xs text-muted-foreground">
                    Guardar este mapeamento como modelo
                  </Label>
                  <Input id="nome-modelo" value={nomeDoModelo} onChange={(e) => setNomeDoModelo(e.target.value)} placeholder="Nome do modelo" />
                </div>
                <Button variant="outline" disabled={ocupado || nomeDoModelo.trim().length < 3 || faltando.length > 0} onClick={guardarModelo}>
                  Salvar modelo
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Conferir não grava nenhuma dívida: abre a conferência linha a linha, que fica guardada até você gravar ou
              descartar.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
