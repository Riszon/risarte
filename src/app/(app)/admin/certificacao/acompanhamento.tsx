"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { formatBrDateTime } from "@/lib/dates";
import {
  ROTULO_DA_SITUACAO,
  porUnidade,
  situacaoDaMatricula,
  type BaseDaSituacao,
  type Situacao,
} from "@/lib/certificacao-equipe";
import { cn } from "@/lib/utils";
import { medirUnidadeDaTurma } from "./actions";

export type MatriculaNoPainel = BaseDaSituacao & {
  campaignId: string;
  turma: string;
  clinicId: string;
  clinicName: string;
  nome: string;
  role: UserRole;
  startedAt: string | null;
  percentual: number | null;
  medidoEm: string | null;
  suspenso: boolean;
};

const TOM: Record<Situacao, string> = {
  certificado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  aguardando_aprovacao: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  cumpriu: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  em_andamento: "border-primary/40 bg-primary/10 text-primary",
  nao_aceitou: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  dispensado: "border-border bg-muted text-muted-foreground",
};

const SITUACOES: Situacao[] = [
  "nao_aceitou",
  "em_andamento",
  "cumpriu",
  "aguardando_aprovacao",
  "certificado",
  "dispensado",
];

/**
 * O ACOMPANHAMENTO DA CERTIFICAÇÃO (0303, relato OC-00003) — todas as turmas
 * abertas, por equipe (unidade) e por pessoa, numa tela só.
 *
 * ⚠️ O PROGRESSO É A ÚLTIMA MEDIÇÃO GUARDADA, com a data dela. Medir a rede
 * inteira ao abrir a tela seriam milhares de consultas ao treino; por isso
 * cada unidade tem "Medir agora", e toda medição que o sistema já faz (o
 * Início da pessoa, o "Conferir minha missão", abrir a unidade em Turmas)
 * deixa o retrato que aparece aqui.
 */
export function Acompanhamento({
  matriculas,
  coletiva,
}: {
  matriculas: MatriculaNoPainel[];
  coletiva: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [medindo, setMedindo] = useState<string | null>(null);
  const [turma, setTurma] = useState("");
  const [unidade, setUnidade] = useState("");
  const [funcao, setFuncao] = useState("");
  const [situacao, setSituacao] = useState("");

  const opcoes = useMemo(() => {
    const turmas = new Map<string, string>();
    const unidades = new Map<string, string>();
    const funcoes = new Set<UserRole>();
    for (const m of matriculas) {
      turmas.set(m.campaignId, m.turma);
      unidades.set(m.clinicId, m.clinicName);
      funcoes.add(m.role);
    }
    return {
      turmas: [...turmas.entries()],
      unidades: [...unidades.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")),
      funcoes: [...funcoes].sort((a, b) => (ROLE_LABELS[a] ?? a).localeCompare(ROLE_LABELS[b] ?? b, "pt-BR")),
    };
  }, [matriculas]);

  const visiveis = useMemo(
    () =>
      matriculas.filter(
        (m) =>
          (!turma || m.campaignId === turma) &&
          (!unidade || m.clinicId === unidade) &&
          (!funcao || m.role === funcao) &&
          (!situacao || situacaoDaMatricula(m) === situacao)
      ),
    [matriculas, turma, unidade, funcao, situacao]
  );

  const contagem = useMemo(() => {
    const c = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<Situacao, number>;
    for (const m of visiveis) c[situacaoDaMatricula(m)] += 1;
    return c;
  }, [visiveis]);

  // Por turma, depois por unidade (a equipe).
  const blocos = useMemo(() => {
    const porTurma = new Map<string, { turma: string; pessoas: MatriculaNoPainel[] }>();
    for (const m of visiveis) {
      const b = porTurma.get(m.campaignId) ?? { turma: m.turma, pessoas: [] };
      b.pessoas.push(m);
      porTurma.set(m.campaignId, b);
    }
    return [...porTurma.entries()].map(([campaignId, b]) => ({
      campaignId,
      turma: b.turma,
      unidades: porUnidade(b.pessoas),
    }));
  }, [visiveis]);

  function medir(campaignId: string, clinicId: string) {
    setMedindo(`${campaignId}:${clinicId}`);
    startTransition(async () => {
      const r = await medirUnidadeDaTurma(campaignId, clinicId);
      setMedindo(null);
      if (!r.ok) {
        toast.error(r.error ?? "Não foi possível medir agora.");
        return;
      }
      toast.success("Unidade medida no treino.");
      router.refresh();
    });
  }

  if (matriculas.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        Nenhuma pessoa convocada em turma aberta.
      </p>
    );
  }

  const selecao = "h-8 rounded-lg border border-input bg-background px-2 text-xs";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={turma} onChange={(e) => setTurma(e.target.value)} className={selecao}>
          <option value="">Todas as turmas</option>
          {opcoes.turmas.map(([id, nome]) => (
            <option key={id} value={id}>{nome}</option>
          ))}
        </select>
        <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={selecao}>
          <option value="">Todas as unidades</option>
          {opcoes.unidades.map(([id, nome]) => (
            <option key={id} value={id}>{nome}</option>
          ))}
        </select>
        <select value={funcao} onChange={(e) => setFuncao(e.target.value)} className={selecao}>
          <option value="">Todas as funções</option>
          {opcoes.funcoes.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
          ))}
        </select>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className={selecao}>
          <option value="">Todas as situações</option>
          {SITUACOES.map((s) => (
            <option key={s} value={s}>{ROTULO_DA_SITUACAO[s]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SITUACOES.filter((s) => contagem[s] > 0).map((s) => (
          <span key={s} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", TOM[s])}>
            {ROTULO_DA_SITUACAO[s]}: {contagem[s]}
          </span>
        ))}
      </div>

      {blocos.map((b) => (
        <div key={b.campaignId} className="space-y-2">
          <p className="text-sm font-semibold">{b.turma}</p>
          {b.unidades.map((u) => {
            const chave = `${b.campaignId}:${u.clinicId}`;
            const pct = u.total === 0 ? 0 : Math.round((u.cumpriram / u.total) * 100);
            return (
              <div key={chave} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{u.clinicName}</span>
                  <span className="text-xs text-muted-foreground">
                    Equipe: <strong>{u.cumpriram} de {u.total}</strong> cumpriram ({pct}%)
                    {coletiva && u.cumpriram < u.total && " · a unidade espera o grupo"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={isPending}
                    onClick={() => medir(b.campaignId, u.clinicId)}
                  >
                    {medindo === chave ? "Medindo no treino…" : "Medir agora"}
                  </Button>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <ul className="mt-2 divide-y text-sm">
                  {u.pessoas.map((p) => {
                    const s = situacaoDaMatricula(p);
                    return (
                      <li key={`${p.nome}:${p.role}:${p.campaignId}`} className="flex flex-wrap items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1">
                          {p.nome}
                          <span className="ml-1 text-xs text-muted-foreground">{ROLE_LABELS[p.role] ?? p.role}</span>
                          {p.suspenso && (
                            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">· acesso ao real suspenso</span>
                          )}
                        </span>
                        {s === "em_andamento" && (
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            {p.percentual === null || !p.medidoEm ? (
                              "ainda não medido"
                            ) : (
                              <>
                                <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                  <span className="block h-full bg-primary" style={{ width: `${p.percentual}%` }} />
                                </span>
                                {p.percentual}% · {formatBrDateTime(p.medidoEm)}
                              </>
                            )}
                          </span>
                        )}
                        {s === "nao_aceitou" && (
                          <span className="text-xs text-muted-foreground">convocado, não clicou em “Aceitar”</span>
                        )}
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TOM[s])}>
                          {ROTULO_DA_SITUACAO[s]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
