import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { RisarteMark } from "@/components/risarte-logo";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { novidadesPara } from "@/lib/changelog";
import { Novidades } from "@/components/novidades";
import { createClient } from "@/lib/supabase/server";
import { BirthdayNotifier } from "./birthday-notifier";
import { montarPendencias, atalhosPara, type Pendencia } from "./inicio-dados";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/roles";

/**
 * A TELA DE INÍCIO — "o que espera por mim agora?".
 *
 * Reformulada em 10/09/2026, a pedido do dono: *"está confuso e virou uma longa
 * lista"*. Estava mesmo, e a causa não era arrumação. A tela respondia à
 * pergunta errada: mostrava clínicas, funções e unidades sob responsabilidade —
 * três blocos de CADASTRO, que não mudam, que a barra lateral e o Perfil já
 * diziam, e que ninguém precisa reler todo dia. Três blocos de peso igual, um
 * embaixo do outro, é a definição de lista.
 *
 * Agora ela tem uma hierarquia de verdade, em três faixas:
 *
 *   1. **quem está falando e onde** — uma linha, não um bloco;
 *   2. **o que espera por você** — o miolo, montado pelo seu papel (ver
 *      `inicio-dados.ts`, onde moram as três regras dos números);
 *   3. **o que mudou no sistema** — embaixo, que é o lugar dele.
 *
 * A informação de cadastro foi para `/perfil`, que é onde se vai quando se quer
 * conferir função e unidade — e não onde se cai ao entrar no sistema.
 */

/** Saudação pela hora do dia (fuso de São Paulo) + data por extenso. */
function greetingAndDate(): { greeting: string; dateLabel: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(now)
  );
  const greeting =
    hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const raw = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const dateLabel = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { greeting, dateLabel };
}

/** Iniciais (até 2) para o monograma do usuário. */
function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * O CARTÃO DE UMA PENDÊNCIA.
 *
 * O número é o que se lê de longe, então ele é o maior elemento do cartão. O
 * título diz do que se trata e a linha diz o que fazer — nessa ordem, porque é
 * a ordem em que a pergunta aparece na cabeça de quem chega.
 *
 * `tom="atencao"` NÃO é "urgente": é "alguém ou algum prazo está esperando".
 * Se tudo fosse destacado, o destaque deixaria de ordenar prioridade — a mesma
 * razão pela qual o painel da rede (FIN8.3) reserva o vermelho para o que já
 * dói.
 */
function CartaoDePendencia({ p }: { p: Pendencia }) {
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
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-3xl font-semibold tabular-nums leading-none",
            atencao ? "text-gold-tinta" : "text-primary"
          )}
        >
          {p.numero}
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {p.titulo}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {p.linha}
      </p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
        Abrir
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  // P2: a Recepção da unidade recebe (uma vez por dia) o aviso dos
  // aniversariantes — antecipando fim de semana/feriado. Perf: em vez de
  // bloquear o render da home, o disparo vai para segundo plano
  // (<BirthdayNotifier/>), mantendo o mesmo gate de papel abaixo.
  const homeClinic = session.activeClinic;

  // As novidades saem filtradas por papel. Uso os papéis de TODAS as clínicas,
  // não só o da ativa: quem atende em duas unidades continua sendo consultor
  // comercial nas duas, e uma novidade do Comercial não deveria sumir só porque
  // a pessoa está com a outra unidade selecionada no momento.
  const papeisDaPessoa = [...new Set(Object.values(session.rolesByClinic).flat())];

  const shouldNotifyBirthdays =
    !!homeClinic &&
    homeClinic.type !== "franchisor" &&
    (session.isAdminMaster ||
      hasRoleInClinic(session, homeClinic.id, [
        "receptionist",
        "unit_manager",
        "clinical_coordinator",
      ]));

  const pendencias = await montarPendencias(supabase, session);
  const atalhos = atalhosPara(session);

  const { greeting, dateLabel } = greetingAndDate();
  const firstName = session.fullName.split(" ")[0] || "bem-vindo(a)";

  // A função NESTA unidade, em uma linha. A lista completa (todas as clínicas,
  // todos os papéis, as unidades sob responsabilidade) mora no Perfil.
  const papeisAqui = homeClinic
    ? (session.rolesByClinic[homeClinic.id] ?? [])
    : [];
  const funcaoAqui = session.isAdminMaster
    ? "Admin Master"
    : papeisAqui.map((r) => ROLE_LABELS[r]).join(", ");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {shouldNotifyBirthdays && homeClinic && (
        <BirthdayNotifier clinicId={homeClinic.id} />
      )}

      {/* ---------------------------------------------- 1. quem, onde, quando */}
      <section className="marca-dagua relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8">
        <div className="absolute inset-x-0 top-0 h-1 bg-gold" />
        <RisarteMark className="pointer-events-none absolute -bottom-6 right-6 hidden h-36 text-primary-foreground/10 sm:block" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gold text-lg font-bold text-gold-foreground">
            {initialsOf(session.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-primary-foreground/70">
              {dateLabel}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}, {firstName}!
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-primary-foreground/80">
              {homeClinic ? (
                <>
                  <span>{homeClinic.name}</span>
                  {funcaoAqui && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{funcaoAqui}</span>
                    </>
                  )}
                  <Link
                    href="/perfil"
                    className="underline underline-offset-2 opacity-90 hover:opacity-100"
                  >
                    ver minhas funções
                  </Link>
                </>
              ) : (
                "Nenhuma clínica cadastrada ainda."
              )}
              {session.isAdminMaster && !funcaoAqui && (
                <Badge className="bg-gold text-gold-foreground">
                  Admin Master
                </Badge>
              )}
            </p>
          </div>
        </div>

        {atalhos.length > 0 && (
          <div className="relative mt-5 flex flex-wrap gap-2">
            {atalhos.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-lg bg-primary-foreground/15 px-3 py-1.5 text-sm font-medium text-primary-foreground ring-1 ring-inset ring-primary-foreground/25 transition hover:bg-primary-foreground/25"
              >
                {a.rotulo}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------ 2. o que espera por você */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">O que espera por você</h2>
        {pendencias.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pendencias.map((p) => (
              <CartaoDePendencia key={p.chave} p={p} />
            ))}
          </div>
        ) : (
          // ⚠️ TELA VAZIA NÃO É RESPOSTA. Sem esta linha, quem não tem nada
          // pendente veria um título solto e concluiria que a tela quebrou.
          <div className="flex items-center gap-3 rounded-xl border bg-card p-5">
            <CheckCircle2 className="size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Nada esperando por você agora.</p>
              <p className="text-xs text-muted-foreground">
                Quando algo precisar da sua decisão, aparece aqui — com o número
                e o caminho.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* AS NOVIDADES MORAM AQUI (decisão do dono, 08/09/2026).
          Antes ficavam numa aba da tela Sistema, e uma novidade que exige dois
          cliques para ser encontrada não é lida por ninguém. Aqui ela está no
          caminho: é a primeira tela do dia de toda a equipe.
          Continua filtrada por papel — ver `novidadesPara`. */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-gold-tinta" />
          O que mudou no sistema
        </h2>
        <Novidades versoes={novidadesPara(papeisDaPessoa, session.isAdminMaster)} />
      </section>
    </div>
  );
}
