"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { atendeABusca } from "@/lib/busca";
import {
  DENTICOES,
  GRUPOS_DE_DENTE,
  NIVEIS,
  ONDE_SE_MARCA,
  ROTULO_DA_CONFIANCA,
  ROTULO_DA_DENTICAO,
  ROTULO_DO_GRUPO,
  ROTULO_DO_NIVEL,
  ROTULO_DO_ONDE,
  ROTULO_DO_USO,
  USOS,
  type Denticao,
  type GrupoDeDente,
  type Nivel,
  type RegraDoProcedimento,
} from "@/lib/odontograma/referencia";
import {
  salvarDentesDaRegiao,
  salvarFacesDoDente,
  salvarRegraDoProcedimento,
  salvarSituacao,
} from "./actions";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

export type SituacaoNaTela = {
  code: string;
  name: string;
  source: string;
  appliesTo: string;
  usage: string;
  symbol: string;
  isActive: boolean;
};
export type DenteNaTela = { code: string; name: string; dentition: string; arch: string; group: string; faces: string[] };
export type RegiaoNaTela = { code: string; name: string; teeth: string[] };
export type ProcedimentoNaTela = {
  id: string;
  code: string | null;
  tussCode: string | null;
  name: string;
  specialty: string | null;
  isActive: boolean;
  regra: RegraDoProcedimento | null;
  confianca: string | null;
};
type Face = { code: string; name: string };

function useGravar() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function gravar(acao: () => Promise<{ ok: boolean; error?: string }>, msg: string, depois?: () => void) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(msg);
        depois?.();
        router.refresh();
      } else toast.error(r.error ?? "Algo deu errado.");
    });
  }
  return { isPending, gravar };
}

function Marcador({ marcado, onChange, rotulo }: { marcado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
      <input type="checkbox" className="size-4" checked={marcado} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );
}

const alternar = <T,>(lista: T[], item: T, sim: boolean) => (sim ? [...new Set([...lista, item])] : lista.filter((x) => x !== item));

// =============================================================================
// SITUAÇÕES
// =============================================================================
export function AbaSituacoes({ situacoes }: { situacoes: SituacaoNaTela[] }) {
  const [editando, setEditando] = useState<SituacaoNaTela | null>(null);
  const [nova, setNova] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          As da <strong>TUSS</strong> têm código e nome oficiais (dá para mudar o símbolo e onde se marca).
          As da <strong>Risarte</strong> (código RZ-…) são da rede.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setNova(true);
            setEditando({ code: "RZ-", name: "", source: "risarte", appliesTo: "whole_tooth", usage: "finding", symbol: "", isActive: true });
          }}
        >
          <Plus className="mr-1 size-4" /> Nova situação
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Onde se marca</th>
              <th className="px-3 py-2">Usada como</th>
              <th className="px-3 py-2">Símbolo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {situacoes.map((s) => (
              <tr key={s.code} className={s.isActive ? "" : "bg-muted/40 text-muted-foreground"}>
                <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                <td className={`px-3 py-2 ${s.isActive ? "" : "line-through"}`}>
                  {s.name}
                  {!s.isActive && <Badge variant="outline" className="ml-2 text-[10px] no-underline">Inativa</Badge>}
                </td>
                <td className="px-3 py-2 text-xs">{s.source === "tuss" ? "TUSS (oficial)" : "Risarte"}</td>
                <td className="px-3 py-2 text-xs">{ROTULO_DO_ONDE[s.appliesTo as keyof typeof ROTULO_DO_ONDE] ?? s.appliesTo}</td>
                <td className="px-3 py-2 text-xs">{(ROTULO_DO_USO[s.usage as keyof typeof ROTULO_DO_USO] ?? s.usage).split(" (")[0]}</td>
                <td className="px-3 py-2 font-mono text-xs font-semibold">{s.symbol}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="icon" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => { setNova(false); setEditando(s); }}>
                    <Pencil className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <DialogoSituacao key={editando.code + String(nova)} inicial={editando} nova={nova} fechar={() => setEditando(null)} />}
    </div>
  );
}

function DialogoSituacao({ inicial, nova, fechar }: { inicial: SituacaoNaTela; nova: boolean; fechar: () => void }) {
  const [s, setS] = useState(inicial);
  const { isPending, gravar } = useGravar();
  const tuss = s.source === "tuss";
  return (
    <Dialog open onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{nova ? "Nova situação da Risarte" : `Situação ${s.code}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Código {nova && "(RZ- + letras/números; não muda depois)"}</span>
            <Input value={s.code} disabled={!nova} onChange={(e) => setS({ ...s, code: e.target.value.toUpperCase() })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Nome {tuss && "(oficial da TUSS — não muda)"}</span>
            <Input value={s.name} disabled={tuss} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Onde se marca</span>
              <select className={selectClass} value={s.appliesTo} onChange={(e) => setS({ ...s, appliesTo: e.target.value })}>
                {ONDE_SE_MARCA.map((o) => <option key={o} value={o}>{ROTULO_DO_ONDE[o]}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Usada como</span>
              <select className={selectClass} value={s.usage} onChange={(e) => setS({ ...s, usage: e.target.value })}>
                {USOS.map((u) => <option key={u} value={u}>{ROTULO_DO_USO[u]}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Símbolo no desenho (1 a 3 letras — a cor nunca é a única informação)</span>
            <Input value={s.symbol} maxLength={3} onChange={(e) => setS({ ...s, symbol: e.target.value.toUpperCase() })} className="w-24" />
          </label>
          {!nova && !tuss && (
            <Marcador marcado={s.isActive} onChange={(v) => setS({ ...s, isActive: v })} rotulo="Ativa (desmarcar desativa — situação não se apaga)" />
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button disabled={isPending} onClick={() => gravar(() => salvarSituacao(s, nova), nova ? "Situação criada." : "Situação salva.", fechar)}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// FACES DOS DENTES
// =============================================================================
export function AbaFaces({ dentes, faces }: { dentes: DenteNaTela[]; faces: Face[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Que faces podem ser marcadas em cada dente. Regra de partida: todo dente tem Vestibular, Mesial e Distal;
        anterior tem Incisal, posterior tem Oclusal; superior tem Palatina, inferior tem Lingual.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Dente</th>
              {faces.map((f) => <th key={f.code} className="px-2 py-2 text-center" title={f.name}>{f.code}</th>)}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {dentes.map((d) => <LinhaDoDente key={d.code} dente={d} faces={faces} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinhaDoDente({ dente, faces }: { dente: DenteNaTela; faces: Face[] }) {
  const [marcadas, setMarcadas] = useState(dente.faces);
  const { isPending, gravar } = useGravar();
  const mudou = [...marcadas].sort().join() !== [...dente.faces].sort().join();
  return (
    <tr className={mudou ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}>
      <td className="px-3 py-1.5">
        <span className="font-mono font-semibold">{dente.code}</span>{" "}
        <span className="text-xs text-muted-foreground">{dente.name}</span>
      </td>
      {faces.map((f) => (
        <td key={f.code} className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            className="size-4"
            aria-label={`${f.name} no dente ${dente.code}`}
            checked={marcadas.includes(f.code)}
            onChange={(e) => setMarcadas((m) => alternar(m, f.code, e.target.checked))}
          />
        </td>
      ))}
      <td className="px-3 py-1.5 text-right">
        {mudou && (
          <Button size="sm" disabled={isPending || marcadas.length === 0} onClick={() => gravar(() => salvarFacesDoDente(dente.code, marcadas), `Faces do ${dente.code} salvas.`)}>
            Salvar
          </Button>
        )}
      </td>
    </tr>
  );
}

// =============================================================================
// REGIÕES
// =============================================================================
const QUADRANTES = [[1, 2], [4, 3], [5, 6], [8, 7]];

export function AbaRegioes({ regioes, dentes }: { regioes: RegiaoNaTela[]; dentes: DenteNaTela[] }) {
  const [editando, setEditando] = useState<RegiaoNaTela | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Os dentes que cada região seleciona de uma vez (ex.: sextante, arco). Região <strong>sem dentes</strong> é
        tecido ou osso (língua, palato…): recebe achado, mas não seleciona dente.
      </p>
      <ul className="divide-y rounded-lg border">
        {regioes.map((r) => (
          <li key={r.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="font-mono text-xs font-semibold">{r.code}</span> <span className="text-sm">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                {r.teeth.length ? `${r.teeth.length} dentes: ${r.teeth.join(", ")}` : "Tecido / osso — não seleciona dente"}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={() => setEditando(r)}>
              <Pencil className="mr-1 size-3.5" /> Dentes
            </Button>
          </li>
        ))}
      </ul>
      {editando && <DialogoRegiao key={editando.code} regiao={editando} dentes={dentes} fechar={() => setEditando(null)} />}
    </div>
  );
}

function DialogoRegiao({ regiao, dentes, fechar }: { regiao: RegiaoNaTela; dentes: DenteNaTela[]; fechar: () => void }) {
  const [marcados, setMarcados] = useState(regiao.teeth);
  const { isPending, gravar } = useGravar();
  const doQuadrante = (q: number) => dentes.filter((d) => Math.floor(Number(d.code) / 10) === q);
  return (
    <Dialog open onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{regiao.code} — {regiao.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {QUADRANTES.map(([a, b]) => (
            <div key={a} className="flex flex-wrap gap-x-6 gap-y-1">
              {[a, b].map((q) => (
                <div key={q} className="flex flex-wrap gap-2">
                  {doQuadrante(q).map((d) => (
                    <Marcador key={d.code} rotulo={d.code} marcado={marcados.includes(d.code)} onChange={(v) => setMarcados((m) => alternar(m, d.code, v))} />
                  ))}
                </div>
              ))}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {marcados.length ? `${marcados.length} dente(s) marcado(s).` : "Nenhum dente: a região fica como tecido/osso."}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button disabled={isPending} onClick={() => gravar(() => salvarDentesDaRegiao(regiao.code, marcados), "Região salva.", fechar)}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// PROCEDIMENTOS
// =============================================================================
const REGRA_VAZIA: RegraDoProcedimento = {
  level: "none", faceCountMin: null, faceCountMax: null, fixedFaces: [], dentition: "both",
  toothGroups: [], blockedConditions: [], requiredConditions: [], effectCondition: null, effectWhenAbsent: null,
};

function resumoDaRegra(r: RegraDoProcedimento | null): string {
  if (!r) return "Sem regra";
  if (r.level === "face") {
    const n = r.faceCountMin === r.faceCountMax ? `${r.faceCountMin}` : `${r.faceCountMin} a ${r.faceCountMax}`;
    return `Face (${n}${r.fixedFaces.length ? `: ${r.fixedFaces.join(", ")}` : ""})`;
  }
  return ROTULO_DO_NIVEL[r.level];
}

export function AbaProcedimentos({
  procedimentos,
  situacoes,
  faces,
}: {
  procedimentos: ProcedimentoNaTela[];
  situacoes: SituacaoNaTela[];
  faces: Face[];
}) {
  const [busca, setBusca] = useState("");
  const [nivel, setNivel] = useState("");
  const [so, setSo] = useState("");
  const [editando, setEditando] = useState<ProcedimentoNaTela | null>(null);
  const visiveis = useMemo(
    () =>
      procedimentos.filter(
        (p) =>
          (!busca.trim() || atendeABusca(`${p.name} ${p.tussCode ?? ""} ${p.code ?? ""}`, busca)) &&
          (!nivel || (p.regra?.level ?? "") === nivel) &&
          (so !== "sem" || !p.regra) &&
          (so !== "baixa" || p.confianca === "low")
      ),
    [procedimentos, busca, nivel, so]
  );
  const semRegra = procedimentos.filter((p) => !p.regra).length;
  const nomeDa = (c: string | null) => (c ? `${c} — ${situacoes.find((s) => s.code === c)?.name ?? "?"}` : "—");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Onde cada procedimento é marcado no odontograma, com que situações combina e o que ele deixa no dente depois de
        realizado. {semRegra > 0 && <strong>{semRegra} procedimento(s) ainda sem regra.</strong>}
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_200px]">
        <Input placeholder="Buscar por nome, TUSS ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={selectClass} value={nivel} onChange={(e) => setNivel(e.target.value)} aria-label="Nível">
          <option value="">Todos os níveis</option>
          {NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_DO_NIVEL[n]}</option>)}
        </select>
        <select className={selectClass} value={so} onChange={(e) => setSo(e.target.value)} aria-label="Mostrar">
          <option value="">Todos</option>
          <option value="sem">Só os sem regra</option>
          <option value="baixa">Só confiança baixa</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">{visiveis.length} de {procedimentos.length}</p>
      <ul className="space-y-2">
        {visiveis.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${p.isActive ? "bg-card" : "border-dashed bg-muted/50 text-muted-foreground"}`}>
            <span className="min-w-0">
              <span className="font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[p.code, p.tussCode && `TUSS ${p.tussCode}`, p.specialty].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{resumoDaRegra(p.regra)}</Badge>
              {p.regra?.effectCondition && <span className="text-muted-foreground">efeito: {nomeDa(p.regra.effectCondition)}</span>}
              {p.confianca && <span className="text-muted-foreground">confiança {ROTULO_DA_CONFIANCA[p.confianca]?.toLowerCase()}</span>}
              <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
                <Pencil className="mr-1 size-3.5" /> Regra
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {editando && (
        <DialogoRegra key={editando.id} procedimento={editando} situacoes={situacoes} faces={faces} fechar={() => setEditando(null)} />
      )}
    </div>
  );
}

function DialogoRegra({
  procedimento,
  situacoes,
  faces,
  fechar,
}: {
  procedimento: ProcedimentoNaTela;
  situacoes: SituacaoNaTela[];
  faces: Face[];
  fechar: () => void;
}) {
  const [r, setR] = useState<RegraDoProcedimento>(procedimento.regra ?? REGRA_VAZIA);
  const { isPending, gravar } = useGravar();
  const ativas = situacoes.filter((s) => s.isActive);
  const efeitos = ativas.filter((s) => s.usage !== "finding");
  const numero = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Dialog open onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{procedimento.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Onde se marca</span>
              <select
                className={selectClass}
                value={r.level}
                onChange={(e) => {
                  const level = e.target.value as Nivel;
                  setR({ ...r, level, faceCountMin: level === "face" ? r.faceCountMin ?? 1 : null, faceCountMax: level === "face" ? r.faceCountMax ?? 1 : null });
                }}
              >
                {NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_DO_NIVEL[n]}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Dentição</span>
              <select className={selectClass} value={r.dentition} onChange={(e) => setR({ ...r, dentition: e.target.value as Denticao })}>
                {DENTICOES.map((d) => <option key={d} value={d}>{ROTULO_DA_DENTICAO[d]}</option>)}
              </select>
            </label>
          </div>

          {r.level === "face" && (
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-xs text-muted-foreground">Faces</legend>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1">de <Input className="h-8 w-16" inputMode="numeric" value={r.faceCountMin ?? ""} onChange={(e) => setR({ ...r, faceCountMin: numero(e.target.value) })} /></label>
                <label className="flex items-center gap-1">a <Input className="h-8 w-16" inputMode="numeric" value={r.faceCountMax ?? ""} onChange={(e) => setR({ ...r, faceCountMax: numero(e.target.value) })} /></label>
                <span className="text-xs text-muted-foreground">faces</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <span className="text-xs text-muted-foreground">Sempre nesta face:</span>
                {faces.map((f) => (
                  <Marcador key={f.code} rotulo={`${f.code} ${f.name}`} marcado={r.fixedFaces.includes(f.code)} onChange={(v) => setR({ ...r, fixedFaces: alternar(r.fixedFaces, f.code, v) })} />
                ))}
              </div>
            </fieldset>
          )}

          {r.level !== "none" && (
            <fieldset className="space-y-1 rounded-md border p-3">
              <legend className="px-1 text-xs text-muted-foreground">Dentes compatíveis (nenhum marcado = todos)</legend>
              <div className="flex flex-wrap gap-3">
                {GRUPOS_DE_DENTE.map((g) => (
                  <Marcador key={g} rotulo={ROTULO_DO_GRUPO[g]} marcado={r.toothGroups.includes(g)} onChange={(v) => setR({ ...r, toothGroups: alternar(r.toothGroups, g as GrupoDeDente, v) })} />
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-1 rounded-md border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Situações que IMPEDEM o procedimento no dente</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ativas.map((s) => (
                <Marcador key={s.code} rotulo={`${s.code} ${s.name}`} marcado={r.blockedConditions.includes(s.code)} onChange={(v) => setR({ ...r, blockedConditions: alternar(r.blockedConditions, s.code, v) })} />
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1 rounded-md border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Situação EXIGIDA (basta uma das marcadas; nenhuma = não exige)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ativas.map((s) => (
                <Marcador key={s.code} rotulo={`${s.code} ${s.name}`} marcado={r.requiredConditions.includes(s.code)} onChange={(v) => setR({ ...r, requiredConditions: alternar(r.requiredConditions, s.code, v) })} />
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Efeito depois de realizado</span>
              <select className={selectClass} value={r.effectCondition ?? ""} onChange={(e) => setR({ ...r, effectCondition: e.target.value || null })}>
                <option value="">— não muda a situação —</option>
                {efeitos.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Efeito se o dente estiver ausente (ex.: pôntico)</span>
              <select className={selectClass} value={r.effectWhenAbsent ?? ""} onChange={(e) => setR({ ...r, effectWhenAbsent: e.target.value || null })}>
                <option value="">— igual ao de cima —</option>
                {efeitos.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button disabled={isPending} onClick={() => gravar(() => salvarRegraDoProcedimento(procedimento.id, r), "Regra salva.", fechar)}>
            Salvar regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
