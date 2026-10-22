import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/pricing";
import {
  distanciaDaMedia,
  farolCaixa,
  farolDre,
  farolPagar,
  farolReceber,
  fmtMargem,
  fmtParticipacao,
  fmtPp,
  margem,
  participacao,
  porAtencaoCaixa,
  porAtencaoDre,
  porAtencaoPagar,
  porAtencaoReceber,
  totaisCaixa,
  totaisDre,
  totaisPagar,
  totaisReceber,
  type ContagemDeFarol,
  type Farol,
  type NetworkTab,
  type UnidadeCaixa,
  type UnidadeDre,
  type UnidadePagar,
  type UnidadeReceber,
} from "@/lib/finance/network-areas";
import { BotaoAbrirNaUnidade } from "../abrir-na-unidade";

/**
 * OC-00121 — as quatro abas por área do Painel da rede. A conta mora em
 * `network-areas.ts`; aqui só se desenha.
 *
 * OC-00122 (decisões do dono, 22/10/2026): cada aba é uma TABELA, com a linha
 * "Rede" no topo nas MESMAS colunas das unidades — o número da unidade fica
 * logo abaixo do número da rede, e comparar vira olhar para baixo. A coluna
 * principal traz quanto a unidade representa da rede. No celular a tabela rola
 * de lado, com o nome da unidade fixo à esquerda.
 */

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

type Contexto = {
  de: string;
  ate: string;
  /** As unidades que quem olha pode abrir (o seletor dele). */
  podeAbrir: Set<string>;
};

type Base = { clinicId: string; nome: string; ownership: "own" | "franchised" };

type Coluna<U> = {
  rotulo: string;
  /** O valor da unidade (já formatado). */
  unidade: (u: U) => ReactNode;
  /** O valor da linha "Rede" (já formatado). */
  rede: ReactNode;
  /** Pinta o valor da unidade de vermelho. */
  alerta?: (u: U) => boolean;
  /** A linha "Rede" também em vermelho. */
  redeAlerta?: boolean;
};

function Farois({ c }: { c: ContagemDeFarol }) {
  return (
    <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
      <span className={cn("size-2 rounded-full", DOT.vermelho)} />
      {c.vermelho}
      <span className={cn("ml-1 size-2 rounded-full", DOT.amarelo)} />
      {c.amarelo}
      <span className={cn("ml-1 size-2 rounded-full", DOT.verde)} />
      {c.verde}
      <span className={cn("ml-1 size-2 rounded-full", DOT.sem_dado)} />
      {c.sem_dado}
    </span>
  );
}

/** Valor em R$ com o "% da rede" embaixo (só na coluna principal). */
function ComParte({ cents, totalCents }: { cents: number; totalCents: number }) {
  const p = fmtParticipacao(participacao(cents, totalCents));
  return (
    <>
      {formatBRL(cents)}
      {p && <span className="block text-[11px] text-muted-foreground">{p}</span>}
    </>
  );
}

function TabelaDaArea<U extends Base>({
  unidades,
  colunas,
  farol,
  farois,
  redeNota,
  aba,
  ctx,
}: {
  unidades: U[];
  colunas: Coluna<U>[];
  farol: (u: U) => { farol: Farol; motivo: string };
  farois: ContagemDeFarol;
  /** Uma frase sob "Rede" (ex.: quantas ficam negativas). */
  redeNota?: string;
  aba: NetworkTab;
  ctx: Contexto;
}) {
  // ⚠️ A primeira coluna é FIXA ao rolar de lado (celular), e por isso tem
  // fundo próprio: sem ele, os números passariam por baixo do nome.
  const fixa = "sticky left-0 z-10 min-w-[10.5rem] max-w-[18rem] px-3 text-left sm:min-w-[13rem]";
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={cn(fixa, "bg-card py-2 font-medium")}>Unidade</th>
              {colunas.map((c) => (
                <th key={c.rotulo} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {c.rotulo}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-muted font-semibold">
              <td className={cn(fixa, "bg-muted py-2.5")}>
                <span className="block">Rede ({unidades.length})</span>
                <Farois c={farois} />
                {redeNota && (
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {redeNota}
                  </span>
                )}
              </td>
              {colunas.map((c) => (
                <td
                  key={c.rotulo}
                  className={cn(
                    "px-3 py-2.5 text-right align-top tabular-nums whitespace-nowrap",
                    c.redeAlerta && "text-destructive"
                  )}
                >
                  {c.rede}
                </td>
              ))}
              <td className="px-3" />
            </tr>
            {unidades.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 2} className="p-4 text-muted-foreground">
                  Nenhuma unidade ativa na rede.
                </td>
              </tr>
            )}
            {unidades.map((u) => {
              const f = farol(u);
              return (
                <tr key={u.clinicId} className="border-b last:border-0">
                  <td className={cn(fixa, "bg-card py-2.5 align-top")}>
                    <span className="flex items-center gap-2 font-medium">
                      <span className={cn("size-2.5 shrink-0 rounded-full", DOT[f.farol])} />
                      {u.nome}
                      {u.ownership === "own" && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          própria
                        </span>
                      )}
                    </span>
                    <span className={cn("mt-0.5 block text-xs", TEXTO[f.farol])}>{f.motivo}</span>
                  </td>
                  {colunas.map((c) => (
                    <td
                      key={c.rotulo}
                      className={cn(
                        "px-3 py-2.5 text-right align-top tabular-nums whitespace-nowrap",
                        c.alerta?.(u) && "text-destructive"
                      )}
                    >
                      {c.unidade(u)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right align-top">
                    {ctx.podeAbrir.has(u.clinicId) && (
                      <BotaoAbrirNaUnidade
                        clinicId={u.clinicId}
                        nome={u.nome}
                        aba={aba}
                        de={ctx.de}
                        ate={ctx.ate}
                        origem="painel"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function AvisoDeLeitura({ erro }: { erro: string }) {
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {erro} Nada foi somado: um total com uma parte faltando pareceria inteiro.
      Tente de novo em instantes.
    </p>
  );
}

function Explica({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------

export function AbaPagar({ unidades, ctx }: { unidades: UnidadePagar[]; ctx: Contexto }) {
  const t = totaisPagar(unidades);
  return (
    <div className="space-y-4">
      <Explica>
        O que cada unidade deve aos fornecedores <strong>hoje</strong>, e o que
        pagou no mês escolhido. Vermelho é conta vencida; amarelo, conta
        esperando autorização.
      </Explica>
      <TabelaDaArea
        unidades={[...unidades].sort(porAtencaoPagar)}
        farol={farolPagar}
        farois={t.farois}
        aba="pagar"
        ctx={ctx}
        colunas={[
          {
            rotulo: "A pagar",
            unidade: (u) => <ComParte cents={u.aPagarCents} totalCents={t.aPagarCents} />,
            rede: formatBRL(t.aPagarCents),
          },
          {
            rotulo: "Vencido",
            unidade: (u) => formatBRL(u.vencidoCents),
            rede: formatBRL(t.vencidoCents),
            alerta: (u) => u.vencidoCents > 0,
            redeAlerta: t.vencidoCents > 0,
          },
          {
            rotulo: "A autorizar",
            unidade: (u) => formatBRL(u.aAutorizarCents),
            rede: formatBRL(t.aAutorizarCents),
          },
          {
            rotulo: "Vence no mês",
            unidade: (u) => formatBRL(u.venceNoMesCents),
            rede: formatBRL(t.venceNoMesCents),
          },
          {
            rotulo: "Pago no mês",
            unidade: (u) => formatBRL(u.pagoNoMesCents),
            rede: formatBRL(t.pagoNoMesCents),
          },
        ]}
      />
    </div>
  );
}

function fmtTaxa(v: number | null): string {
  return v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function AbaReceber({ unidades, ctx }: { unidades: UnidadeReceber[]; ctx: Contexto }) {
  const t = totaisReceber(unidades);
  return (
    <div className="space-y-4">
      <Explica>
        O que os pacientes devem a cada unidade <strong>hoje</strong>, e o que
        ela recebeu no mês escolhido. Vermelho é inadimplência acima do limite
        da unidade; amarelo, vencido dentro dele. O detalhe por prazo está em{" "}
        <em>Recebíveis da rede</em>.
      </Explica>
      <TabelaDaArea
        unidades={[...unidades].sort(porAtencaoReceber)}
        farol={farolReceber}
        farois={t.farois}
        aba="receber"
        ctx={ctx}
        colunas={[
          {
            rotulo: "A receber",
            unidade: (u) => <ComParte cents={u.abertoCents} totalCents={t.abertoCents} />,
            rede: formatBRL(t.abertoCents),
          },
          {
            rotulo: "Vencido",
            unidade: (u) => formatBRL(u.vencidoCents),
            rede: formatBRL(t.vencidoCents),
            alerta: (u) => u.vencidoCents > 0,
            redeAlerta: t.vencidoCents > 0,
          },
          {
            rotulo: "Inadimplência",
            unidade: (u) => fmtTaxa(u.taxaPercent),
            rede: fmtTaxa(t.taxaPercent),
            alerta: (u) => farolReceber(u).farol === "vermelho",
          },
          {
            rotulo: "Limite",
            unidade: (u) => fmtTaxa(u.limitePercent),
            // Cada unidade tem o seu teto (cascata rede → unidade): não há um
            // limite "da rede" para pôr aqui.
            rede: "—",
          },
          {
            rotulo: "Recebido no mês",
            unidade: (u) => formatBRL(u.recebidoNoMesCents),
            rede: formatBRL(t.recebidoNoMesCents),
          },
        ]}
      />
    </div>
  );
}

export function AbaCaixa({ unidades, ctx }: { unidades: UnidadeCaixa[]; ctx: Contexto }) {
  const t = totaisCaixa(unidades);
  // ⚠️ SALDO DA REDE NÃO EXISTE: o dinheiro de uma unidade não cobre a conta
  // da outra. A linha "Rede" mostra entradas e saídas; nos saldos, um traço.
  const semSaldo = (
    <span className="font-normal text-muted-foreground" title="O dinheiro de uma unidade não cobre a conta da outra.">
      —
    </span>
  );
  const se = (u: UnidadeCaixa, v: number) => (u.falhou ? "—" : formatBRL(v));
  return (
    <div className="space-y-4">
      <Explica>
        O caixa de cada unidade no mês escolhido — o que já entrou e saiu, e o
        que está previsto (o vencido não entra na previsão, como no Fluxo de
        caixa da unidade). Vermelho é o saldo ficar negativo em algum dia do
        mês; amarelo, sair mais do que entra com o saldo aguentando. Não existe
        saldo da rede: o dinheiro de uma unidade não cobre a conta da outra.
      </Explica>
      <TabelaDaArea
        unidades={[...unidades].sort(porAtencaoCaixa)}
        farol={farolCaixa}
        farois={t.farois}
        redeNota={
          t.negativas === 0
            ? "Nenhuma fica negativa no mês"
            : `${t.negativas} ${t.negativas === 1 ? "fica negativa" : "ficam negativas"} no mês`
        }
        aba="caixa"
        ctx={ctx}
        colunas={[
          {
            rotulo: "Saldo no início",
            unidade: (u) => se(u, u.saldoInicialCents),
            rede: semSaldo,
          },
          {
            rotulo: "Entradas",
            unidade: (u) =>
              u.falhou ? "—" : <ComParte cents={u.entradasCents} totalCents={t.entradasCents} />,
            rede: formatBRL(t.entradasCents),
          },
          {
            rotulo: "Saídas",
            unidade: (u) => se(u, u.saidasCents),
            rede: formatBRL(t.saidasCents),
          },
          {
            rotulo: "Saldo no fim",
            unidade: (u) => se(u, u.saldoFinalCents),
            rede: semSaldo,
            alerta: (u) => !u.falhou && u.saldoFinalCents < 0,
          },
        ]}
      />
    </div>
  );
}

export function AbaDre({ unidades, ctx }: { unidades: UnidadeDre[]; ctx: Contexto }) {
  const t = totaisDre(unidades);
  return (
    <div className="space-y-4">
      <Explica>
        O resultado de cada unidade no mês escolhido, por competência (a mesma
        DRE da unidade). A cor compara a <strong>margem</strong> de cada uma com
        a margem da rede: assim unidade grande e pequena se comparam igual.
      </Explica>
      <TabelaDaArea
        unidades={[...unidades].sort(porAtencaoDre(t.margem))}
        farol={(u) => farolDre(u, t.margem)}
        farois={t.farois}
        aba="dre"
        ctx={ctx}
        colunas={[
          {
            rotulo: "Receita líquida",
            unidade: (u) => (
              <ComParte cents={u.receitaLiquidaCents} totalCents={t.receitaLiquidaCents} />
            ),
            rede: formatBRL(t.receitaLiquidaCents),
          },
          {
            rotulo: "Resultado",
            unidade: (u) => formatBRL(u.resultadoCents),
            rede: formatBRL(t.resultadoCents),
            alerta: (u) => u.resultadoCents < 0,
            redeAlerta: t.resultadoCents < 0,
          },
          {
            rotulo: "Margem",
            unidade: (u) => fmtMargem(margem(u)),
            rede: fmtMargem(t.margem),
          },
          {
            rotulo: "vs margem da rede",
            unidade: (u) => fmtPp(distanciaDaMedia(u, t.margem)),
            rede: "—",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        ⚠️ A linha <strong>Rede</strong> é <strong>comparação</strong>, não o
        resultado da Franqueadora: a Franqueadora ganha as taxas das franqueadas,
        não o faturamento delas. O resultado do grupo está no{" "}
        <em>Consolidado</em>.
      </p>
    </div>
  );
}
