import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/roles";
import type { Farol } from "@/lib/finance/network-areas";
import {
  FORA_DO_HORARIO_DIAS,
  REVISAO_VERMELHA_DIAS,
  SEM_TITULAR_ALERTA_DIAS,
  farolDaCobertura,
  fraseDosMotivos,
  frasesDoMesPorFuncao,
  horasPorDia,
  percentualEmAcumulo,
  porAtencaoDeCobertura,
  sinaisDeSobrecarga,
  textoDoDesde,
  type PessoaEmCobertura,
  type UnidadeDeCobertura,
} from "@/lib/coberturas-painel";

// Funções de apoio, F4 — o painel "Equipe e coberturas" (plano, seção 10.2).
// A MESMA tela no Painel da rede e em /risartanos/coberturas: quem vê quais
// unidades é o banco (D12).

const DOT: Record<Farol, string> = {
  vermelho: "bg-destructive",
  amarelo: "bg-amber-500",
  verde: "bg-emerald-600",
  sem_dado: "bg-muted-foreground/40",
};

const TEXTO: Record<Farol, string> = {
  vermelho: "text-destructive",
  amarelo: "text-amber-700 dark:text-amber-400",
  verde: "text-emerald-700 dark:text-emerald-400",
  sem_dado: "text-muted-foreground",
};

export function EquipeECoberturas({
  unidades,
  pessoas,
  linkDaPessoa,
}: {
  unidades: UnidadeDeCobertura[];
  pessoas: PessoaEmCobertura[];
  /** Ficha da pessoa (só quando quem olha pode abrir). */
  linkDaPessoa?: (userId: string) => string;
}) {
  const ordem = [...unidades].sort(porAtencaoDeCobertura);
  const total = {
    ativas: unidades.reduce((s, u) => s + u.ativas, 0),
    diasPessoa: unidades.reduce((s, u) => s + u.diasPessoa, 0),
    semTitular: unidades.reduce((s, u) => s + u.semTitular.length, 0),
    vermelhas: ordem.filter((u) => farolDaCobertura(u).farol === "vermelho").length,
  };
  const porUnidade = new Map<string, PessoaEmCobertura[]>();
  for (const p of pessoas) porUnidade.set(p.clinicId, [...(porUnidade.get(p.clinicId) ?? []), p]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Quem está cobrindo quem, e por quanto tempo. Serve para ver a unidade que
        está trabalhando com a equipe <em>enxuta demais</em> e a pessoa que pode
        estar <em>sobrecarregada</em>. ⚠️ O tempo no sistema e o horário de acesso
        indicam carga, mas <strong>não são ponto eletrônico</strong>: hora extra
        se confere na folha. O painel diz para onde olhar; a conclusão é uma
        conversa com a unidade.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numero rotulo="Coberturas agora" valor={total.ativas} />
        <Numero rotulo="Dias-pessoa no mês" valor={total.diasPessoa} />
        <Numero rotulo="Funções sem titular" valor={total.semTitular} alerta={total.semTitular > 0} />
        <Numero rotulo="Unidades em vermelho" valor={total.vermelhas} alerta={total.vermelhas > 0} />
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Unidade</th>
                <th className="px-3 py-2 text-right font-medium">Agora</th>
                <th className="px-3 py-2 text-right font-medium">Equipe em acúmulo</th>
                <th className="px-3 py-2 text-right font-medium">Dias-pessoa</th>
                <th className="px-3 py-2 text-right font-medium">Por pessoa</th>
                <th className="px-3 py-2 text-left font-medium">Motivos</th>
              </tr>
            </thead>
            <tbody>
              {ordem.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-muted-foreground">
                    Nenhuma unidade para mostrar.
                  </td>
                </tr>
              )}
              {ordem.map((u) => {
                const f = farolDaCobertura(u);
                const pct = percentualEmAcumulo(u);
                return (
                  <tr key={u.clinicId} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={cn("size-2.5 shrink-0 rounded-full", DOT[f.farol])} />
                        {u.nome}
                      </span>
                      <span className={cn("mt-0.5 block text-xs", TEXTO[f.farol])}>{f.motivo}</span>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", u.ativas > u.maxSimultaneas && "text-destructive")}>
                      {u.ativas}
                      <span className="block text-[11px] text-muted-foreground">limite {u.maxSimultaneas}</span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        pct !== null && pct > u.maxPercentualEquipe && "text-destructive"
                      )}
                    >
                      {u.pessoasEmApoio} de {u.equipe}
                      <span className="block text-[11px] text-muted-foreground">
                        {pct === null ? "—" : `${pct}%`} · limite {u.maxPercentualEquipe}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{u.diasPessoa}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {u.equipe > 0 ? (u.diasPessoa / u.equipe).toFixed(1).replace(".", ",") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{fraseDosMotivos(u.motivos)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Os limites só avisam por enquanto (D13): passar deles não trava a
        cobertura. <strong>Dias-pessoa</strong> = a soma dos dias de todas as
        coberturas no mês; <strong>por pessoa</strong> = dividido pela equipe com
        função principal, para comparar unidades de tamanhos diferentes.
      </p>

      {ordem
        .filter((u) => u.ativas > 0 || u.diasPessoa > 0 || u.agendadas > 0 || (porUnidade.get(u.clinicId)?.length ?? 0) > 0)
        .map((u) => (
          <Card key={u.clinicId}>
            <CardContent className="space-y-3 p-4">
              <h3 className="flex items-center gap-2 font-medium">
                <span className={cn("size-2.5 rounded-full", DOT[farolDaCobertura(u).farol])} />
                {u.nome}
              </h3>
              <ul className="space-y-1 text-sm">
                {u.semTitular.map((s) => (
                  <li key={s.role} className={s.days > SEM_TITULAR_ALERTA_DIAS ? "text-destructive" : undefined}>
                    <strong>{ROLE_LABELS[s.role] ?? s.role}</strong> sem titular: feita só por apoio há {s.days} dia(s).
                  </li>
                ))}
                {frasesDoMesPorFuncao(u).map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {u.emendasAcima > 0 && (
                  <li className="text-destructive">
                    Cobertura temporária emendada há {u.maiorEmenda} dias seguidos. Pode ser uma vaga fixa disfarçada.
                  </li>
                )}
                {u.revisoesVencidas > 0 && (
                  <li className={u.maiorAtrasoDeRevisao > REVISAO_VERMELHA_DIAS ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
                    {u.revisoesVencidas} acúmulo(s) fixo(s) com a revisão vencida (há até {u.maiorAtrasoDeRevisao} dias).
                  </li>
                )}
                {u.previsoesVencidas > 0 && (
                  <li className="text-destructive">
                    {u.previsoesVencidas} vaga(s) aberta(s) com a previsão de contratação vencida.
                  </li>
                )}
                {u.agendadas > 0 && <li className="text-muted-foreground">{u.agendadas} cobertura(s) agendada(s).</li>}
              </ul>

              {(porUnidade.get(u.clinicId) ?? []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-3 text-left font-medium">Quem cobre</th>
                        <th className="px-3 py-1.5 text-right font-medium">Antes</th>
                        <th className="px-3 py-1.5 text-right font-medium">Na cobertura</th>
                        <th className="px-3 py-1.5 text-right font-medium">Fora do horário</th>
                        <th className="py-1.5 pl-3 text-left font-medium">Sinais</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(porUnidade.get(u.clinicId) ?? []).map((p) => {
                        const s = sinaisDeSobrecarga(p);
                        return (
                          <tr key={p.userId} className="border-b last:border-0 align-top">
                            <td className="py-2 pr-3">
                              {linkDaPessoa ? (
                                <Link href={linkDaPessoa(p.userId)} className="font-medium hover:underline">
                                  {p.nome}
                                </Link>
                              ) : (
                                <span className="font-medium">{p.nome}</span>
                              )}
                              <span className="block text-xs text-muted-foreground">
                                {p.funcoes.map((r) => ROLE_LABELS[r] ?? r).join(" + ")} · {textoDoDesde(p)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{horasPorDia(p.antesSegundos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {horasPorDia(p.duranteSegundos)}
                              <span className="block text-[11px] text-muted-foreground">{p.diasDurante} dia(s) com acesso</span>
                            </td>
                            <td className={cn("px-3 py-2 text-right tabular-nums", p.diasForaDoHorario >= FORA_DO_HORARIO_DIAS && "text-destructive")}>
                              {p.diasForaDoHorario} dia(s)
                            </td>
                            <td className={cn("py-2 pl-3 text-xs", s.sobrecarga ? "text-destructive" : "text-muted-foreground")}>
                              {s.frases.length ? s.frases.join(" · ") : "Nada fora do comum"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Tempo por dia no sistema: os 30 dias antes da cobertura × os dias de
                    cobertura no mês. Quem trabalha em duas unidades soma o tempo das duas.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</span>
        <span className={cn("text-xl font-semibold tabular-nums", alerta && "text-destructive")}>{valor}</span>
      </CardContent>
    </Card>
  );
}
