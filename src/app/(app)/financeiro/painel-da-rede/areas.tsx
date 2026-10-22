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
  fmtPp,
  margem,
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
 * OC-00121 — as quatro abas por área do Painel da rede. Cada uma: o total da
 * rede no alto e uma linha por unidade, na ordem de atenção, com a cor e a
 * frase que explica a cor. A conta mora em `network-areas.ts`; aqui só se
 * desenha.
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

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: ReactNode; destaque?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className={cn("text-lg font-semibold tabular-nums", destaque && "text-destructive")}>
        {valor}
      </p>
    </div>
  );
}

function Farois({ c }: { c: ContagemDeFarol }) {
  return (
    <span className="flex items-center gap-1 text-xs font-normal">
      <span className={cn("size-2 rounded-full", DOT.vermelho)} />
      {c.vermelho}
      <span className={cn("ml-1 size-2 rounded-full", DOT.amarelo)} />
      {c.amarelo}
      <span className={cn("ml-1 size-2 rounded-full", DOT.verde)} />
      {c.verde}
    </span>
  );
}

function Linha({
  nome,
  ownership,
  farol,
  motivo,
  numeros,
  abrir,
}: {
  nome: string;
  ownership: "own" | "franchised";
  farol: Farol;
  motivo: string;
  numeros: ReactNode;
  abrir: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[farol])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {nome}
          {ownership === "own" && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              própria
            </span>
          )}
        </p>
        <p className={cn("text-xs", TEXTO[farol])}>{motivo}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
          {numeros}
        </div>
      </div>
      {abrir}
    </li>
  );
}

function Abrir({ ctx, aba, clinicId, nome }: { ctx: Contexto; aba: NetworkTab; clinicId: string; nome: string }) {
  if (!ctx.podeAbrir.has(clinicId)) return null;
  return (
    <BotaoAbrirNaUnidade
      clinicId={clinicId}
      nome={nome}
      aba={aba}
      de={ctx.de}
      ate={ctx.ate}
      origem="painel"
    />
  );
}

function Lista({ vazia, children }: { vazia: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        {vazia ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhuma unidade ativa na rede.</p>
        ) : (
          <ul className="divide-y">{children}</ul>
        )}
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

// ---------------------------------------------------------------------------

export function AbaPagar({ unidades, ctx }: { unidades: UnidadePagar[]; ctx: Contexto }) {
  const t = totaisPagar(unidades);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O que cada unidade deve aos fornecedores <strong>hoje</strong>, e o que
        pagou no mês escolhido. Vermelho é conta vencida; amarelo, conta
        esperando autorização.
      </p>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Numero rotulo="Unidades" valor={<span className="flex items-center gap-2">{t.unidades}<Farois c={t.farois} /></span>} />
          <Numero rotulo="A pagar (rede)" valor={formatBRL(t.aPagarCents)} />
          <Numero rotulo={`Vencido (${t.vencidoQuantidade})`} valor={formatBRL(t.vencidoCents)} destaque={t.vencidoCents > 0} />
          <Numero rotulo="Pago no mês" valor={formatBRL(t.pagoNoMesCents)} />
        </CardContent>
      </Card>
      <Lista vazia={!unidades.length}>
        {[...unidades].sort(porAtencaoPagar).map((u) => {
          const f = farolPagar(u);
          return (
            <Linha
              key={u.clinicId}
              nome={u.nome}
              ownership={u.ownership}
              farol={f.farol}
              motivo={f.motivo}
              numeros={
                <>
                  <span>A pagar {formatBRL(u.aPagarCents)}</span>
                  <span>Vence no mês {formatBRL(u.venceNoMesCents)}</span>
                  <span>Pago no mês {formatBRL(u.pagoNoMesCents)}</span>
                </>
              }
              abrir={<Abrir ctx={ctx} aba="pagar" clinicId={u.clinicId} nome={u.nome} />}
            />
          );
        })}
      </Lista>
    </div>
  );
}

export function AbaReceber({ unidades, ctx }: { unidades: UnidadeReceber[]; ctx: Contexto }) {
  const t = totaisReceber(unidades);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O que os pacientes devem a cada unidade <strong>hoje</strong>, e o que
        ela recebeu no mês escolhido. Vermelho é inadimplência acima do limite
        da unidade; amarelo, vencido dentro dele. O detalhe por prazo está em{" "}
        <em>Recebíveis da rede</em>.
      </p>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Numero rotulo="Unidades" valor={<span className="flex items-center gap-2">{t.unidades}<Farois c={t.farois} /></span>} />
          <Numero rotulo="A receber (rede)" valor={formatBRL(t.abertoCents)} />
          <Numero
            rotulo={`Vencido${t.taxaPercent === null ? "" : ` (${t.taxaPercent.toLocaleString("pt-BR")}%)`}`}
            valor={formatBRL(t.vencidoCents)}
            destaque={t.vencidoCents > 0}
          />
          <Numero rotulo="Recebido no mês" valor={formatBRL(t.recebidoNoMesCents)} />
        </CardContent>
      </Card>
      <Lista vazia={!unidades.length}>
        {[...unidades].sort(porAtencaoReceber).map((u) => {
          const f = farolReceber(u);
          return (
            <Linha
              key={u.clinicId}
              nome={u.nome}
              ownership={u.ownership}
              farol={f.farol}
              motivo={f.motivo}
              numeros={
                <>
                  <span>A receber {formatBRL(u.abertoCents)}</span>
                  <span>Recebido no mês {formatBRL(u.recebidoNoMesCents)}</span>
                </>
              }
              abrir={<Abrir ctx={ctx} aba="receber" clinicId={u.clinicId} nome={u.nome} />}
            />
          );
        })}
      </Lista>
    </div>
  );
}

export function AbaCaixa({ unidades, ctx }: { unidades: UnidadeCaixa[]; ctx: Contexto }) {
  const t = totaisCaixa(unidades);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O caixa de cada unidade no mês escolhido — o que já entrou e saiu, e o
        que está previsto (o vencido não entra na previsão, como no Fluxo de
        caixa da unidade). Vermelho é o saldo ficar negativo em algum dia do
        mês; amarelo, sair mais do que entra com o saldo aguentando.
      </p>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Numero rotulo="Unidades" valor={<span className="flex items-center gap-2">{t.unidades}<Farois c={t.farois} /></span>} />
          <Numero rotulo="Ficam negativas no mês" valor={t.negativas} destaque={t.negativas > 0} />
          <Numero rotulo="Entradas (rede)" valor={formatBRL(t.entradasCents)} />
          <Numero rotulo="Saídas (rede)" valor={formatBRL(t.saidasCents)} />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Não existe saldo da rede: o dinheiro de uma unidade não cobre a conta
        da outra. Por isso o total conta quantas ficam negativas.
      </p>
      <Lista vazia={!unidades.length}>
        {[...unidades].sort(porAtencaoCaixa).map((u) => {
          const f = farolCaixa(u);
          return (
            <Linha
              key={u.clinicId}
              nome={u.nome}
              ownership={u.ownership}
              farol={f.farol}
              motivo={f.motivo}
              numeros={
                u.falhou ? null : (
                  <>
                    <span>Saldo no início {formatBRL(u.saldoInicialCents)}</span>
                    <span>Entradas {formatBRL(u.entradasCents)}</span>
                    <span>Saídas {formatBRL(u.saidasCents)}</span>
                    <span>Saldo no fim {formatBRL(u.saldoFinalCents)}</span>
                  </>
                )
              }
              abrir={<Abrir ctx={ctx} aba="caixa" clinicId={u.clinicId} nome={u.nome} />}
            />
          );
        })}
      </Lista>
    </div>
  );
}

export function AbaDre({ unidades, ctx }: { unidades: UnidadeDre[]; ctx: Contexto }) {
  const t = totaisDre(unidades);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O resultado de cada unidade no mês escolhido, por competência (a mesma
        DRE da unidade). A cor compara a <strong>margem</strong> de cada uma com
        a margem da rede: assim unidade grande e pequena se comparam igual. O
        valor em R$ aparece ao lado.
      </p>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Numero rotulo="Unidades" valor={<span className="flex items-center gap-2">{t.unidades}<Farois c={t.farois} /></span>} />
          <Numero rotulo="Receita líquida (soma)" valor={formatBRL(t.receitaLiquidaCents)} />
          <Numero rotulo="Resultado (soma)" valor={formatBRL(t.resultadoCents)} destaque={t.resultadoCents < 0} />
          <Numero rotulo="Margem da rede" valor={fmtMargem(t.margem)} />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        ⚠️ Esta soma é <strong>comparação</strong>, não o resultado da
        Franqueadora: a Franqueadora ganha as taxas das franqueadas, não o
        faturamento delas. O resultado do grupo está no <em>Consolidado</em>.
      </p>
      <Lista vazia={!unidades.length}>
        {[...unidades].sort(porAtencaoDre(t.margem)).map((u) => {
          const f = farolDre(u, t.margem);
          const d = distanciaDaMedia(u, t.margem);
          return (
            <Linha
              key={u.clinicId}
              nome={u.nome}
              ownership={u.ownership}
              farol={f.farol}
              motivo={f.motivo}
              numeros={
                <>
                  <span>Receita líquida {formatBRL(u.receitaLiquidaCents)}</span>
                  <span>Resultado {formatBRL(u.resultadoCents)}</span>
                  <span>Margem {fmtMargem(margem(u))}</span>
                  {d !== null && <span>{fmtPp(d)} da média</span>}
                </>
              }
              abrir={<Abrir ctx={ctx} aba="dre" clinicId={u.clinicId} nome={u.nome} />}
            />
          );
        })}
      </Lista>
    </div>
  );
}
