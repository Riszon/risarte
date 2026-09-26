import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  MonitorPlay,
  Sparkles,
} from "lucide-react";
import { cartoesDoInicio, nomeDaAba } from "@/lib/ambientes";
import { ambienteAtual, carregarEnderecos } from "@/lib/ambientes-db";
import { RisarteMark } from "@/components/risarte-logo";
import { getSessionContext, hasRoleInClinic } from "@/lib/auth";
import { NOVIDADES_NO_INICIO, novidadesPara } from "@/lib/changelog";
import { Novidades } from "@/components/novidades";
import { BoasVindas } from "@/components/boas-vindas";
import { ComoUsarOTreino } from "@/components/como-usar-o-treino";
import { isTreino } from "@/lib/environment";
import { isoDateIn, todayInBrazil } from "@/lib/dates";
import { deveMostrarBoasVindas } from "@/lib/textos-automaticos";
import { createClient } from "@/lib/supabase/server";
import { BirthdayNotifier } from "./birthday-notifier";
import { montarPendencias, atalhosPara, missaoAberta, type Pendencia } from "./inicio-dados";
import { MissaoDeCertificacao } from "@/components/missao-de-certificacao";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/roles";
import { ROTULO_DO_MOTIVO } from "@/lib/acesso-por-unidade";

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

  // 0259: OS OUTROS AMBIENTES. O Início é o ponto de partida dos três — daqui
  // se vai para o treino e para o Academy, com o mesmo login.
  const portal = !session.ambientes.sistema;
  const cartoes = cartoesDoInicio({
    permissoes: session.ambientes,
    urls: await carregarEnderecos(supabase),
    atual: ambienteAtual(),
    isAdminMaster: session.isAdminMaster,
  });

  // No modo portal ninguém tem função em unidade nenhuma: procurar pendências
  // seria varrer o banco para devolver zero.
  const pendencias = portal ? [] : await montarPendencias(supabase, session);
  const atalhos = portal ? [] : atalhosPara(session);

  // BOAS-VINDAS (0263 + 0265): só no sistema real, nos 3 PRIMEIROS ACESSOS e
  // no máximo uma vez por dia — contar cada abertura do Início gastaria as três
  // em dez minutos do primeiro dia. Banco sem a migração (erro na consulta) =
  // não mostra: melhor faltar a mensagem do que ela voltar a cada entrada.
  const treino = isTreino();
  const { data: perfilDeBoasVindas, error: erroBoasVindas } = treino
    ? { data: null, error: null }
    : await supabase
        .from("profiles")
        .select("welcomed_at, welcome_count")
        .eq("id", session.userId)
        .maybeSingle<{ welcomed_at: string | null; welcome_count: number | null }>();
  const mostrarBoasVindas = deveMostrarBoasVindas({
    vezes: perfilDeBoasVindas?.welcome_count ?? 0,
    ultimaVezEm: perfilDeBoasVindas?.welcomed_at ?? null,
    hoje: todayInBrazil(),
    diaDe: (iso) => isoDateIn(new Date(iso)),
    noTreino: treino,
    erroAoLer: Boolean(erroBoasVindas),
  });

  // ⚠️ A CONVOCAÇÃO APARECE SÓ NO SISTEMA REAL (0273).
  //
  // A missão é CUMPRIDA no treino, mas quem manda na certificação é este banco
  // — é aqui que mora a tranca do ambiente `sistema` (0259) e é aqui que o
  // certificado fica guardado. Mostrar o cartão nos dois lados criaria duas
  // matrículas e dois marcos de início, em bancos diferentes, e nenhum dos
  // dois seria a verdade.
  const minhaMissao = treino
    ? null
    : await missaoAberta(supabase, session.userId, session.email);

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
      {mostrarBoasVindas && (
        <BoasVindas primeiroNome={firstName} soInicio={portal} />
      )}

      {shouldNotifyBirthdays && homeClinic && (
        <BirthdayNotifier clinicId={homeClinic.id} />
      )}

      {minhaMissao && <MissaoDeCertificacao missao={minhaMissao} />}

      {/* 0276: AS UNIDADES AINDA FECHADAS, e por quê. Sem isto a unidade
          simplesmente some da lista, e a pessoa conclui que perdeu o acesso
          por defeito — e abre chamado. */}
      {session.acessoNaoConferido && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          Não foi possível conferir agora em quais unidades o sistema real está
          liberado para você. Por segurança, ele ficou fechado — recarregue a
          página em instantes.
        </p>
      )}
      {session.unidadesFechadas.length > 0 && (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="font-semibold">
            {session.unidadesFechadas.length === 1
              ? "Unidade ainda fechada no sistema real"
              : "Unidades ainda fechadas no sistema real"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            O sistema real abre em cada unidade pela função que você tem nela.
            Cumprida a missão de uma função, ela vale em todas as unidades onde
            você tem essa função.
          </p>
          <ul className="mt-3 space-y-1.5">
            {session.unidadesFechadas.map((u) => (
              <li
                key={u.clinicId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
              >
                <span>
                  <span className="font-medium">{u.clinicName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {ROLE_LABELS[u.role]}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {ROTULO_DO_MOTIVO[u.motivo]}
                </span>
              </li>
            ))}
          </ul>
        </section>
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

      {/* No treino, o recado de como usar o ambiente vem logo depois da saudação
          (pedido do dono, 19/09/2026): fique à vontade, e ele é para sempre. */}
      {treino && <ComoUsarOTreino />}

      {/* ------------------------------------------- 1b. os outros ambientes */}
      {(cartoes.length > 0 || portal) && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">
            {portal ? "Por onde começar" : "Outros ambientes"}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {portal
              ? "O sistema do dia a dia ainda não foi liberado para você. Enquanto isso, o treinamento já está aqui — é o mesmo login."
              : "O mesmo login vale nos três. Abre em outra aba."}
          </p>
          {cartoes.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {cartoes.map((c) => (
                // A aba tem NOME (e por isso não leva `noopener`: ele faria o
                // navegador ignorar o nome e abrir uma aba nova a cada clique,
                // que é justamente o que o dono relatou). O destino é sistema
                // nosso, nos dois casos.
                <a
                  key={c.ambiente}
                  href={c.url}
                  target={nomeDaAba(c.ambiente)}
                  className="group flex items-start gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold-tinta">
                    {c.ambiente === "academy" ? (
                      <GraduationCap className="size-5" />
                    ) : (
                      <MonitorPlay className="size-5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-semibold">
                      {c.rotulo}
                      <ExternalLink className="size-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {c.descricao}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            // Régua vazia grita: sem atalho nenhum, a tela diz POR QUE — e a
            // quem pedir — em vez de deixar um título solto.
            <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
              Nenhum ambiente liberado para você ainda. Fale com a Franqueadora
              para liberarem o treino ou o Risarte Academy.
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------ 2. o que espera por você */}
      {!portal && (
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
      )}

      {/* AS NOVIDADES MORAM AQUI (decisão do dono, 08/09/2026).
          Antes ficavam numa aba da tela Sistema, e uma novidade que exige dois
          cliques para ser encontrada não é lida por ninguém. Aqui ela está no
          caminho: é a primeira tela do dia de toda a equipe.
          Continua filtrada por papel — ver `novidadesPara`. */}
      {/* No modo portal esta seção sai: quem ainda não usa o sistema não tem o
          que fazer com o que mudou nele — e a lista é longa, então ela viraria
          a tela inteira de quem veio só encontrar o caminho do treino. */}
      {!portal && (
        <section>
          {/* SÓ AS ÚLTIMAS AQUI (pedido do dono, 19/09/2026): as 57 entregas
              inteiras faziam do Início "uma lista muito extensa". A lista
              completa, com busca e filtros, mora em /novidades. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="size-5 text-gold-tinta" />
              O que mudou no sistema
            </h2>
            <Link
              href="/novidades"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Ver todas as novidades
              <ArrowRight className="size-4" />
            </Link>
          </div>
          <Novidades
            versoes={novidadesPara(papeisDaPessoa, session.isAdminMaster).slice(
              0,
              NOVIDADES_NO_INICIO
            )}
          />
        </section>
      )}
    </div>
  );
}
