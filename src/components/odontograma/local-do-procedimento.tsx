"use client";

// ONDE O PROCEDIMENTO ACONTECE (OD3). Aparece no "Novo procedimento" do plano,
// depois de escolher o procedimento, e muda conforme a regra dele:
//   - por dente / face: o desenho para tocar nos dentes (vários = um item por
//     dente, F4) e, se for de face, as faces;
//   - por região / arcada: a lista de regiões que servem;
//   - sem marcação: nada (como sempre).
// A conta (forma e situação) é de `src/lib/odontograma/plano.ts`, a mesma
// régua do banco (0311). Situação que não combina pede MOTIVO (F1).

import { useMemo, useState } from "react";
import { ListaComBusca } from "@/components/ui/lista-com-busca";
import { Odontograma } from "@/components/odontograma/odontograma";
import { cn } from "@/lib/utils";
import type { DadosDoOdontograma } from "@/lib/odontograma/carregar";
import { marcasAtuais, marcasDoDesenho } from "@/lib/odontograma/diagnostico";
import {
  conflitosDeSituacao,
  ehPorDente,
  ehPorRegiao,
  itensPorDente,
  previstosNoDente,
  regioesDoProcedimento,
  textoDoConflito,
  type RegraDoPlano,
} from "@/lib/odontograma/plano";

const ORDEM_DAS_FACES = ["V", "M", "D", "O", "I", "P", "L"];

export type LocalEscolhido = {
  teeth: { tooth: string; faces: string[] }[];
  regionCode: string | null;
  motivo: string | null;
  /** Pode gravar? (forma ok, lugar escolhido, motivo quando preciso) */
  valido: boolean;
  /** Quantos itens vão nascer (um por dente). */
  quantos: number;
};

export const LOCAL_VAZIO: LocalEscolhido = { teeth: [], regionCode: null, motivo: null, valido: true, quantos: 1 };

export function LocalDoProcedimento({
  regra,
  regras,
  dados,
  itensDaOpcao,
  onChange,
}: {
  regra: RegraDoPlano | null;
  /** Todas as regras: o que a opção já planeja no dente (efeito) conta. */
  regras: Record<string, RegraDoPlano>;
  dados: DadosDoOdontograma;
  itensDaOpcao: { id: string; procedureId: string | null; toothCode: string | null }[];
  onChange: (l: LocalEscolhido) => void;
}) {
  const [dentes, setDentes] = useState<string[]>([]);
  const [faces, setFaces] = useState<string[]>([]);
  const [regiao, setRegiao] = useState("");
  const [motivo, setMotivo] = useState("");

  const atuaisPorDente = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of marcasAtuais(dados.achados ?? [])) m.set(a.dente, [...(m.get(a.dente) ?? []), a.situacao]);
    return m;
  }, [dados.achados]);
  const nomeDaSituacao = (c: string) => dados.situacoes.find((s) => s.code === c)?.name ?? c;

  if (!regra || (!ehPorDente(regra) && !ehPorRegiao(regra))) return null;

  const porDente = ehPorDente(regra);
  const montagem = porDente ? itensPorDente(regra, dentes, faces, dados.dentes, dados.faces) : null;
  const conflitos = porDente
    ? (montagem?.itens ?? [])
        .map((i) => {
          const c = conflitosDeSituacao(regra, atuaisPorDente.get(i.tooth) ?? [], previstosNoDente(itensDaOpcao, regras, i.tooth));
          return textoDoConflito(i.tooth, c, nomeDaSituacao);
        })
        .filter((t): t is string => t !== null)
    : [];

  function avisar(next: { dentes?: string[]; faces?: string[]; regiao?: string; motivo?: string }) {
    const d = next.dentes ?? dentes;
    const f = next.faces ?? faces;
    const r = next.regiao ?? regiao;
    const mo = next.motivo ?? motivo;
    if (!regra) return;
    if (porDente) {
      const m = itensPorDente(regra, d, f, dados.dentes, dados.faces);
      const temConflito = m.itens.some((i) => {
        const c = conflitosDeSituacao(regra, atuaisPorDente.get(i.tooth) ?? [], previstosNoDente(itensDaOpcao, regras, i.tooth));
        return c.impede.length > 0 || c.falta.length > 0;
      });
      onChange({
        teeth: m.itens,
        regionCode: null,
        motivo: mo.trim() || null,
        valido: m.itens.length > 0 && m.problemas.length === 0 && (!temConflito || mo.trim().length >= 5),
        quantos: Math.max(1, m.itens.length),
      });
    } else {
      onChange({ teeth: [], regionCode: r || null, motivo: null, valido: Boolean(r), quantos: 1 });
    }
  }

  const facesDaSelecao = ORDEM_DAS_FACES.filter((f) => dentes.some((d) => (dados.faces[d] ?? []).includes(f)));

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
      {porDente ? (
        <>
          <p className="text-xs font-medium">
            Onde: toque no(s) dente(s){regra.nivel === "face" ? " e escolha as faces" : ""}. Cada dente vira um item.
          </p>
          <Odontograma
            modo="diagnostico"
            denticaoInicial={dados.denticao}
            nomes={dados.nomes}
            faces={dados.faces}
            marcas={marcasDoDesenho(dados.achados ?? [], dados.situacoes, "definidos", dados.feitos)}
            selecionados={dentes}
            onDente={(d) => {
              const nd = dentes.includes(d) ? dentes.filter((x) => x !== d) : [...dentes, d];
              setDentes(nd);
              avisar({ dentes: nd });
            }}
          />
          {regra.nivel === "face" && dentes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {facesDaSelecao.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={faces.includes(f)}
                  onClick={() => {
                    const nf = faces.includes(f) ? faces.filter((x) => x !== f) : [...faces, f];
                    setFaces(nf);
                    avisar({ faces: nf });
                  }}
                  className={cn(
                    "h-11 min-w-11 rounded-md border px-3 text-sm font-medium",
                    faces.includes(f) ? "border-primary bg-primary text-primary-foreground" : "bg-card"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {dentes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Dentes: {dentes.join(", ")} → {montagem?.itens.length ?? 0} {montagem?.itens.length === 1 ? "item" : "itens"}
            </p>
          )}
          {montagem && dentes.length > 0 && montagem.problemas.length > 0 && (
            <ul className="text-xs text-destructive">
              {[...new Set(montagem.problemas)].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {conflitos.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              {conflitos.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <input
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  avisar({ motivo: e.target.value });
                }}
                placeholder="Para lançar mesmo assim, escreva o motivo"
                className="h-10 w-full rounded-md border border-amber-300 bg-white px-2 text-sm text-foreground dark:bg-transparent"
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs font-medium">
            Onde: {regra.nivel === "arch" ? "escolha a arcada" : "escolha a região"}.
          </p>
          <ListaComBusca
            aria-label={regra.nivel === "arch" ? "Arcada" : "Região"}
            value={regiao}
            onValueChange={(v) => {
              setRegiao(v);
              avisar({ regiao: v });
            }}
            options={regioesDoProcedimento(regra, dados.regioes).map((r) => ({ value: r.code, label: r.name }))}
            placeholder={regra.nivel === "arch" ? "Arcada…" : "Região…"}
          />
        </>
      )}
    </div>
  );
}
