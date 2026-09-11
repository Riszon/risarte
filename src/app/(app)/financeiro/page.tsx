import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Lock,
  Network,
  Receipt,
  Settings2,
  Target,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canViewFinance, isFinanceFranchisor } from "@/lib/finance/access";
import { formatBrDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  montarResumoDoMes,
  montarPendenciasFinanceiras,
  montarResumoDaRede,
  reais,
  type PendenciaFinanceira,
} from "./painel-dados";

export const metadata: Metadata = { title: "Financeiro" };

/**
 * A PORTA DO FINANCEIRO.
 *
 * ⚠️ ATÉ 10/09/2026 ESTA ROTA ERA UM `redirect` PARA A CONFIGURAÇÃO. O dono:
 * *"quando entra no financeiro já abre uma tela de configuração e nada
 * bonito"*. Configuração é o que se faz uma vez; o módulo existe para responder
 * perguntas todo dia. As duas perguntas estão no topo da tela, e são as mesmas
 * que o módulo inteiro separa de propósito: **deu lucro?** (competência) e
 * **tenho dinheiro?** (caixa).
 *
 * A conta de cada número mora em `painel-dados.ts` e é a MESMA da tela para
 * onde o número leva. Nada aqui recalcula o razão.
 */

/** Um dos números grandes do topo. */
function Numero({
  rotulo,
  valor,
  detalhe,
  tomDetalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string | null;
  /** Verde = melhorou o RESULTADO. Ver o comentário em `Variacao`. */
  tomDetalhe?: "bom" | "ruim" | "neutro";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {valor}
      </p>
      {detalhe && (
        <p
          className={cn(
            "mt-1 text-xs",
            tomDetalhe === "bom" && "text-emerald-600 dark:text-emerald-400",
            tomDetalhe === "ruim" && "text-destructive",
            (!tomDetalhe || tomDetalhe === "neutro") && "text-muted-foreground"
          )}
        >
          {detalhe}
        </p>
      )}
    </div>
  );
}

function CartaoDePendencia({ p }: { p: PendenciaFinanceira }) {
  const atencao = p.tom === "atencao";
  return (
    <Link
      href={p.href}
      className={cn(
        "group flex flex-col rounded-xl border p-4 transition hover:shadow-sm",
        atencao
          ? "border-gold/40 bg-gold/5 hover:border-gold"
          : "bg-card hover:border-primary/40"
      )}
    >
      <span
        className={cn(
          "text-xl font-semibold tabular-nums leading-none",
          atencao ? "text-gold-tinta" : "text-primary"
        )}
      >
        {p.valor}
      </span>
      <span className="mt-1.5 text-sm font-semibold leading-snug">
        {p.titulo}
      </span>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {p.linha}
      </p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
        Abrir
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/**
 * OS CAMINHOS, AGRUPADOS PELA PERGUNTA QUE RESPONDEM.
 *
 * A barra de abas do módulo tem dezoito entradas de peso igual — a mesma
 * "longa lista" que o dono apontou na tela de início. Aqui elas aparecem
 * separadas pelo que a pessoa quer saber, que é como ela procura.
 */
type Caminho = { href: string; label: string; icon: LucideIcon; linha: string };

const GRUPOS: { titulo: string; itens: Caminho[]; soRede?: boolean }[] = [
  {
    titulo: "O mês deu lucro?",
    itens: [
      {
        href: "/financeiro/dre",
        label: "DRE",
        icon: BarChart3,
        linha: "O resultado por competência, linha a linha até o documento.",
      },
      {
        href: "/financeiro/ponto-de-equilibrio",
        label: "Ponto de equilíbrio",
        icon: Target,
        linha: "Quanto precisa faturar para não dar prejuízo.",
      },
      {
        href: "/financeiro/orcamento",
        label: "Orçamento",
        icon: ClipboardList,
        linha: "O que deveria ter acontecido, ao lado do que aconteceu.",
      },
      {
        href: "/financeiro/fechamento",
        label: "Fechamento",
        icon: Lock,
        linha: "Mês conferido é mês que não muda mais sozinho.",
      },
    ],
  },
  {
    titulo: "Tenho dinheiro?",
    itens: [
      {
        href: "/financeiro/fluxo-de-caixa",
        label: "Fluxo de caixa",
        icon: Wallet,
        linha: "O que já entrou e o que ainda vai entrar, dia a dia.",
      },
      {
        href: "/financeiro/recebiveis",
        label: "Recebíveis",
        icon: HandCoins,
        linha: "O que a unidade tem a receber, o que venceu e a inadimplência.",
      },
      {
        href: "/financeiro/contas-a-pagar",
        label: "Contas a pagar",
        icon: Receipt,
        linha: "O que a unidade deve, com alçada e autorização.",
      },
      {
        href: "/financeiro/conciliacao",
        label: "Conciliação",
        icon: Landmark,
        linha: "O extrato do banco ao lado do que o sistema registrou.",
      },
      {
        href: "/financeiro/repasses",
        label: "Repasses",
        icon: HandCoins,
        linha: "O que cada dentista tem a receber pela produção do mês.",
      },
    ],
  },
  {
    titulo: "A rede",
    soRede: true,
    itens: [
      {
        href: "/financeiro/painel-da-rede",
        label: "Painel da rede",
        icon: LayoutDashboard,
        linha: "Em qual unidade entrar primeiro.",
      },
      {
        href: "/financeiro/recebiveis-da-rede",
        label: "Recebíveis da rede",
        icon: HandCoins,
        linha: "Atrás de qual unidade ir primeiro para cobrar.",
      },
      {
        href: "/financeiro/consolidado",
        label: "Consolidado",
        icon: Building2,
        linha: "O resultado do grupo e o faturamento da rede, lado a lado.",
      },
      {
        href: "/financeiro/taxas-da-rede",
        label: "Taxas da rede",
        icon: Network,
        linha: "Royalty, fundo e as demais taxas — e quem já pagou.",
      },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      {
        href: "/financeiro/plano-de-contas",
        label: "Plano de contas",
        icon: BookOpen,
        linha: "As contas, o comportamento do custo e a alçada de cada uma.",
      },
      {
        href: "/financeiro/centros-de-custo",
        label: "Centros de custo",
        icon: Network,
        linha: "Por área — Clínico, Comercial, Administrativo…",
      },
      {
        href: "/financeiro/fornecedores",
        label: "Fornecedores",
        icon: Truck,
        linha: "Quem emite as notas que viram conta a pagar.",
      },
      {
        href: "/financeiro/adquirentes",
        label: "Adquirentes",
        icon: CreditCard,
        linha: "Taxa e prazo de cada meio de pagamento, com vigência.",
      },
      {
        href: "/financeiro/bens",
        label: "Bens",
        icon: Building2,
        linha: "Comprar um bem não é gastar: ele vira despesa aos poucos.",
      },
      {
        href: "/financeiro/configuracao",
        label: "Configuração",
        icon: Settings2,
        linha: "Multa, juros, arredondamento e os limites dos alertas.",
      },
    ],
  },
];

export default async function FinanceHomePage() {
  const session = await getSessionContext();
  if (!canViewFinance(session)) redirect("/");

  const clinica = session.activeClinic;
  if (!clinica) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Selecione uma unidade no menu lateral.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const veRede =
    clinica.type === "franchisor" &&
    (session.isAdminMaster || isFinanceFranchisor(session));

  const [resumo, pendencias, rede] = await Promise.all([
    veRede ? null : montarResumoDoMes(supabase, clinica.id),
    montarPendenciasFinanceiras(supabase, clinica.id),
    veRede ? montarResumoDaRede(supabase) : null,
  ]);

  const mesLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${(resumo?.de ?? "2026-01-01")}T12:00:00`));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-sm text-muted-foreground">
          {veRede
            ? "A rede num relance: onde entrar primeiro, e o que já está cobrado."
            : `${clinica.name} · ${mesLabel}`}
        </p>
      </div>

      {/* ------------------------------------------------ os números do mês */}
      {resumo && (
        <section className="grid gap-3 sm:grid-cols-3">
          {/* ⚠️ O VALOR APARECE SEMPRE, INCLUSIVE ZERO — e a explicação vai na
              linha de baixo. A primeira versão mostrava "—" sem movimento, e a
              conferência contra a DRE flagrou: ela mostra "R$ 0,00" no mesmo
              mês. Duas telas dizendo coisas diferentes sobre o mesmo período é
              exatamente o que este painel promete não fazer, e "zero" com a
              frase "ainda não há lançamento" logo abaixo não engana ninguém. */}
          <Numero
            rotulo="Resultado do mês"
            valor={reais(resumo.lucroLiquidoCents)}
            detalhe={
              !resumo.temMovimento
                ? // ⚠️ SEM LANÇAMENTO NÃO É RESULTADO ZERO. "R$ 0,00 de lucro"
                  // lê-se como "trabalhou e não sobrou"; a verdade é que ainda
                  // não há nada lançado, e as duas pedem decisões opostas.
                  "Ainda não há lançamento de competência neste mês."
                : resumo.lucroDeltaPercent === null
                  ? "Sem mês anterior para comparar."
                  : `${resumo.lucroDeltaCents >= 0 ? "+" : ""}${reais(
                      resumo.lucroDeltaCents
                    )} contra o mês anterior`
            }
            // Verde = melhorou o RESULTADO, sempre. Como o sinal já vem da
            // direção do lançamento, não existe "linha boa quando sobe":
            // despesa caindo dá delta positivo igual a receita subindo.
            tomDetalhe={
              !resumo.temMovimento || resumo.lucroDeltaPercent === null
                ? "neutro"
                : resumo.lucroDeltaCents >= 0
                  ? "bom"
                  : "ruim"
            }
          />
          <Numero
            rotulo="Receita líquida"
            valor={reais(resumo.receitaLiquidaCents)}
            detalhe={
              resumo.margemPercent === null
                ? "Sem receita no período."
                : `Margem líquida de ${resumo.margemPercent.toLocaleString("pt-BR")}%`
            }
          />
          <Numero
            rotulo="Saldo em caixa hoje"
            valor={reais(resumo.saldoEmCaixaCents)}
            detalhe="Tudo o que já virou dinheiro, das contas cadastradas."
          />
        </section>
      )}

      {/* ------------------------------------------------- o resumo da rede */}
      {rede && (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Numero rotulo="Unidades" valor={String(rede.totais.units)} />
            <Numero
              rotulo="No vermelho"
              valor={String(rede.totais.red)}
              detalhe="Caixa negativo previsto ou taxa vencida."
              tomDetalhe={rede.totais.red > 0 ? "ruim" : "neutro"}
            />
            <Numero
              rotulo="No amarelo"
              valor={String(rede.totais.yellow)}
              detalhe="Ainda dá para resolver."
            />
            <Numero
              rotulo="Taxas em aberto"
              valor={reais(rede.totais.feesOpenCents)}
              detalhe={
                rede.totais.feesOverdueCents > 0
                  ? `${reais(rede.totais.feesOverdueCents)} já vencidos`
                  : "Nada vencido."
              }
              tomDetalhe={rede.totais.feesOverdueCents > 0 ? "ruim" : "neutro"}
            />
          </div>

          {rede.piores.length > 0 ? (
            <div className="rounded-xl border bg-card">
              <p className="border-b px-4 py-2.5 text-sm font-semibold">
                Onde entrar primeiro
              </p>
              <ul className="divide-y">
                {rede.piores.map((u) => (
                  <li
                    key={u.clinicId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="text-sm font-medium">{u.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.motivos.join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="border-t px-4 py-2.5">
                <Link
                  href="/financeiro/painel-da-rede"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                >
                  Ver o painel completo
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
              <p className="text-sm">
                Nenhuma unidade pedindo atenção na última apuração.
              </p>
            </div>
          )}

          {/* ⚠️ O PAINEL MOSTRA O RETRATO DA ÚLTIMA APURAÇÃO, e diz isso. Ele
              lê o que o motor de alertas apurou em vez de recalcular: um número
              recalculado aqui poderia DISCORDAR do aviso que a unidade
              recebeu, e painel que discorda do aviso é confusão. */}
          <p className="text-xs text-muted-foreground">
            {rede.apuradoEm
              ? `Retrato da última apuração dos alertas (${formatBrDateTime(
                  rede.apuradoEm
                )}). O painel completo tem o botão para apurar agora.`
              : "Os alertas ainda não foram apurados nesta rede."}
          </p>
        </section>
      )}

      {/* --------------------------------------------- o que precisa de você */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">O que precisa de você</h2>
        {pendencias.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pendencias.map((p) => (
              <CartaoDePendencia key={p.chave} p={p} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border bg-card p-5">
            <CheckCircle2 className="size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">
                Nada vencido, nada esperando autorização.
              </p>
              <p className="text-xs text-muted-foreground">
                Cartão só aparece quando há algo a resolver — em vez de um
                &ldquo;0&rdquo; em cada assunto.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ os caminhos */}
      <section className="space-y-5">
        {GRUPOS.filter((g) => !g.soRede || veRede).map((grupo) => (
          <div key={grupo.titulo}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {grupo.titulo}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {grupo.itens.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-lg border bg-card p-3 transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.linha}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
