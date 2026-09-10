import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";
import {
  PHASE_SLA_KEY,
  isSlaExceeded,
  slaAppliesTo,
  slaPrefilter,
  type JourneyPhase,
  type JourneyStatus,
} from "@/lib/journey";
import { resolveSla, type SlaSettingRow } from "@/lib/sla";
import { contarEtapasDaCompra } from "./compras/trilha-dados";
import { startOfTodayInBrazil } from "@/lib/dates";

/**
 * O QUE ESPERA POR VOCÊ — o miolo da tela de início.
 *
 * ⚠️ A PERGUNTA QUE A HOME RESPONDE É "O QUE ESPERA POR MIM AGORA?", não "quem
 * sou eu". Até 10/09/2026 ela mostrava clínicas, funções e unidades sob
 * responsabilidade: informação de CADASTRO, que não muda e que ninguém precisa
 * reler todo dia — e que já estava na barra lateral e no Perfil. O dono
 * resumiu: *"está confuso e virou uma longa lista"*. Uma lista é o que sobra
 * quando três blocos de informação parada ficam um embaixo do outro sem
 * nenhuma hierarquia entre eles.
 *
 * TRÊS REGRAS, e nenhuma é de estilo:
 *
 * 1. **ZERO NÃO APARECE.** Pendência sem nada esperando não vira cartão. Mesma
 *    regra da trilha de Compras: um "0" pendurado em todo cartão vira ruído, e
 *    em duas semanas ninguém olha mais para os que NÃO são zero.
 *
 * 2. **O NÚMERO DA HOME É O MESMO DA TELA PARA ONDE ELE LEVA.** Cada contagem
 *    aqui usa a régua que a tela de destino já usa — `isSlaExceeded` do kanban,
 *    `contarEtapasDaCompra` das cinco telas de compra, `replenishment_list` do
 *    Estoque. Régua própria da home seria uma segunda conta para o mesmo
 *    número, e duas contas para um número é exatamente como elas passam a
 *    divergir. A pessoa clica em "3 esperando" e encontra dois.
 *
 * 3. **A HOME É A PRIMEIRA TELA DO DIA DE TODA A EQUIPE.** Todas as consultas
 *    saem JUNTAS (um `Promise.all`), e as que dá para contar no banco usam
 *    `head: true` — o Postgres devolve só o número, sem trazer uma linha. O dia
 *    08/09/2026 inteiro foi gasto tirando lentidão daqui; não é lugar de somar
 *    dez idas em fila.
 *
 * E o que a pessoa NÃO pode resolver não entra: relatos e avisos já têm
 * indicador próprio na barra de cima, e repeti-los aqui seria ensinar que
 * número na tela é decoração.
 */

export type Tom = "atencao" | "normal";

export type Pendencia = {
  /** Identificador estável — a chave da lista e o que os testes prendem. */
  chave: string;
  numero: number;
  titulo: string;
  /** Uma linha dizendo o que fazer com aquele número. */
  linha: string;
  href: string;
  /** `atencao` = prazo estourado ou alguém esperando de pé. */
  tom: Tom;
};

export type Atalho = { rotulo: string; href: string };

type ClienteDaJornada = {
  journey_phase: JourneyPhase;
  journey_status: JourneyStatus | null;
  phase_entered_at: string;
};

/** Os papéis da pessoa NA CLÍNICA ATIVA, mais o Admin Master como coringa. */
function papeisAqui(session: SessionContext): Set<UserRole> {
  const id = session.activeClinic?.id;
  return new Set(id ? (session.rolesByClinic[id] ?? []) : []);
}

/**
 * Quantos casos estão com o prazo estourado nesta unidade.
 *
 * ⚠️ A CONTA NÃO PODE SER FEITA NO BANCO, e isso é uma escolha, não uma
 * limitação. O prazo é configurável em cascata (rede → unidade) e a regra de
 * quando ele PARA de correr (`slaAppliesTo`) mora em TypeScript, com teste.
 * Reescrevê-la em SQL só para a home daria o número mais rápido e daria também
 * uma segunda régua para o mesmo indicador — o defeito que o custo de material
 * (0216) e o painel da rede (FIN8.3) já ensinaram a não repetir.
 *
 * ⚠️ MAS A LEITURA É PODADA ANTES, e essa poda é o que impede a home de ficar
 * lenta sozinha com o tempo. A primeira versão trazia TODO cliente ativo da
 * unidade — hoje são dezenas, em três anos são milhares, e o custo cresceria
 * sem nada na tela denunciando. Duas condições fazem a triagem no banco, e as
 * duas são **necessárias** para o prazo estar estourado, nunca suficientes:
 *
 *   1. estar numa fase que TEM prazo (a Aquisição e o Acompanhamento não têm,
 *      e é onde mora a maior parte da base com o tempo);
 *   2. ter entrado na fase há mais tempo que o MENOR prazo configurado — quem
 *      entrou depois disso não pode ter estourado prazo nenhum.
 *
 * O menor, não o maior: usar o maior descartaria caso estourado de verdade numa
 * fase de prazo curto. Poda que erra para menos é pior que poda nenhuma.
 *
 * O que volta são candidatos; quem decide continua sendo a regra em TypeScript.
 */
async function contarPrazoEstourado(
  supabase: SupabaseClient,
  clinicId: string
): Promise<number> {
  const { data: slaRows } = await supabase
    .from("sla_settings")
    .select("id, clinic_id, sla_key, hours, amount, unit, total_minutes")
    .returns<SlaSettingRow[]>();

  const sla = resolveSla(slaRows ?? [], clinicId);

  const peneira = slaPrefilter(sla);
  if (!peneira) return 0;

  const corte = new Date(
    Date.now() - peneira.olderThanMinutes * 60 * 1000
  ).toISOString();

  const { data: clientes } = await supabase
    .from("clients")
    .select("journey_phase, journey_status, phase_entered_at")
    .eq("clinic_id", clinicId)
    .eq("status", "active")
    .in("journey_phase", peneira.phases)
    .lt("phase_entered_at", corte)
    .returns<ClienteDaJornada[]>();

  return (clientes ?? []).filter((c) => {
    const chave = PHASE_SLA_KEY[c.journey_phase];
    if (!chave) return false;
    return (
      slaAppliesTo(c.journey_phase, c.journey_status) &&
      isSlaExceeded(c.phase_entered_at, sla[chave])
    );
  }).length;
}

/** A janela de hoje, no relógio de parede brasileiro (nunca no do servidor). */
function janelaDeHoje(): { inicio: string; fim: string } {
  const inicio = startOfTodayInBrazil();
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

export async function montarPendencias(
  supabase: SupabaseClient,
  session: SessionContext
): Promise<Pendencia[]> {
  const clinica = session.activeClinic;
  if (!clinica) return [];

  const papeis = papeisAqui(session);
  const admin = session.isAdminMaster;
  const tem = (...lista: UserRole[]) => lista.some((r) => papeis.has(r));

  // Na Franqueadora não há balcão, cadeira nem estoque de consumo: os cartões
  // de unidade não fazem sentido lá, e mostrá-los zerados seria pior que não
  // mostrá-los. O que a Franqueadora tem de próprio é a mesa de negociação.
  const naUnidade = clinica.type !== "franchisor";

  const recepcao = naUnidade && (admin || tem("receptionist", "unit_manager"));
  const balcao =
    naUnidade &&
    (admin || tem("receptionist", "unit_manager", "clinical_coordinator"));
  const dentista = naUnidade && tem("dentist");
  const coordenador = naUnidade && (admin || tem("clinical_coordinator"));
  const planner = admin || tem("planner_dentist");
  const gestao = naUnidade && (admin || tem("unit_manager", "franchisee"));
  const consultor = naUnidade && tem("commercial_consultant");
  const comprador = !naUnidade && (admin || tem("purchaser"));

  const { inicio, fim } = janelaDeHoje();

  const [
    agendaHoje,
    esperando,
    minhasDeHoje,
    aguardandoAprovacao,
    filaPlanejamento,
    prazoEstourado,
    compras,
    reposicao,
    followupsVencidos,
    rodadasAbertas,
    requisicoesEsperando,
  ] = await Promise.all([
    recepcao
      ? supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinica.id)
          .in("status", ["scheduled", "confirmed"])
          .gte("starts_at", inicio)
          .lt("starts_at", fim)
      : null,
    balcao
      ? supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinica.id)
          .not("checked_in_at", "is", null)
          .is("done_at", null)
          .gte("starts_at", inicio)
          .lt("starts_at", fim)
      : null,
    dentista
      ? supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinica.id)
          .eq("provider_user_id", session.userId)
          .in("status", ["scheduled", "confirmed"])
          .gte("starts_at", inicio)
          .lt("starts_at", fim)
      : null,
    coordenador
      ? supabase
          .from("treatment_plans")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", clinica.id)
          .eq("status", "submitted")
      : null,
    // O Planner da Franqueadora atende a REDE inteira; o Admin Master dentro de
    // uma unidade quer a fila daquela unidade. Sem essa distinção, o número da
    // home mostraria a rede a quem a tela de destino mostra uma unidade só.
    planner
      ? (naUnidade
          ? supabase
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("clinic_id", clinica.id)
          : supabase.from("clients").select("id", { count: "exact", head: true })
        )
          .eq("journey_phase", "planning_center")
          .eq("status", "active")
      : null,
    gestao || coordenador ? contarPrazoEstourado(supabase, clinica.id) : null,
    gestao ? contarEtapasDaCompra(supabase, clinica.id) : null,
    gestao ? supabase.rpc("replenishment_list", { p_clinic_id: clinica.id }) : null,
    // ⚠️ QUEM LIMITA AOS CLIENTES DELE É A RLS, não um filtro meu. O consultor
    // só enxerga os seus (regra da matriz), então a contagem já nasce no
    // escopo certo — e um filtro por `outcome_by`/dono aqui seria uma segunda
    // régua de posse, que divergiria da RLS no dia em que uma mudasse.
    // O estágio importa: cartão cancelado ou perdido pode ter ficado com uma
    // data de retorno velha, e contá-lo cobraria um retorno que não existe.
    consultor
      ? supabase
          .from("commercial_cards")
          .select("client_id", { count: "exact", head: true })
          .eq("clinic_id", clinica.id)
          .in("stage", ["follow_up", "follow_up_clinica"])
          .lt("next_attempt_at", new Date().toISOString())
      : null,
    comprador
      ? supabase
          .from("purchase_rounds")
          .select("id", { count: "exact", head: true })
          .eq("status", "aberta")
      : null,
    comprador
      ? supabase
          .from("purchase_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "enviada")
      : null,
  ]);

  const lista: Pendencia[] = [];
  const juntar = (p: Pendencia) => {
    if (p.numero > 0) lista.push(p);
  };

  // A ordem aqui é a ordem na tela, e ela é deliberada: primeiro quem está
  // ESPERANDO DE PÉ, depois o que tem prazo correndo, por último o que espera
  // em fila. Alfabética ou por módulo diria que tudo pesa igual.
  juntar({
    chave: "esperando",
    numero: esperando?.count ?? 0,
    titulo: "Esperando na unidade",
    linha: "Fizeram check-in e ainda não foram concluídos.",
    href: "/atendimento",
    tom: "atencao",
  });

  juntar({
    chave: "prazo",
    numero: typeof prazoEstourado === "number" ? prazoEstourado : 0,
    titulo: "Com prazo estourado",
    linha: "Casos que passaram do prazo combinado para a fase em que estão.",
    href: "/jornada",
    tom: "atencao",
  });

  juntar({
    chave: "aprovacao",
    numero: aguardandoAprovacao?.count ?? 0,
    titulo: "Planos aguardando sua aprovação",
    linha: "O Planner enviou e o caso não anda até você decidir.",
    href: "/planejamento?situacao=aguardando_aprovacao",
    tom: "atencao",
  });

  juntar({
    chave: "followups",
    numero: followupsVencidos?.count ?? 0,
    titulo: "Follow-ups vencidos",
    linha: "Passou da data de retorno que você combinou com o cliente.",
    href: "/comercial",
    tom: "atencao",
  });

  juntar({
    chave: "minhas-de-hoje",
    numero: minhasDeHoje?.count ?? 0,
    titulo: "Seus atendimentos de hoje",
    linha: "O que está na sua cadeira hoje, na ordem do dia.",
    href: "/meu-dia",
    tom: "normal",
  });

  juntar({
    chave: "agenda-hoje",
    numero: agendaHoje?.count ?? 0,
    titulo: "Agendamentos de hoje",
    linha: "Ainda por atender nesta unidade.",
    href: "/agenda",
    tom: "normal",
  });

  juntar({
    chave: "planejamento",
    numero: filaPlanejamento?.count ?? 0,
    titulo: "Casos no Centro de Planejamento",
    linha: "A fila do núcleo do sistema, na ordem de prioridade.",
    href: "/planejamento",
    tom: "normal",
  });

  juntar({
    chave: "compras-aprovar",
    numero: compras?.aguardandoAprovacao ?? 0,
    titulo: "Compras aguardando sua aprovação",
    linha: "Sem a sua aprovação o pedido não nasce — e quem paga é a unidade.",
    href: "/compras/aprovar",
    tom: "atencao",
  });

  juntar({
    chave: "compras-receber",
    numero: compras?.entregasAbertas ?? 0,
    titulo: "Entregas a receber",
    linha: "Pedidos em aberto esperando a conferência da nota.",
    href: "/compras/receber",
    tom: "normal",
  });

  juntar({
    chave: "reposicao",
    numero: Array.isArray(reposicao?.data) ? reposicao.data.length : 0,
    titulo: "Itens abaixo do mínimo",
    linha: "O Estoque já montou a lista de reposição para você.",
    href: "/estoque",
    tom: "normal",
  });

  juntar({
    chave: "requisicoes",
    numero: requisicoesEsperando?.count ?? 0,
    titulo: "Listas das unidades esperando",
    linha: "Requisições enviadas que ainda não entraram numa rodada.",
    href: "/compras/rodadas",
    tom: "atencao",
  });

  juntar({
    chave: "rodadas",
    numero: rodadasAbertas?.count ?? 0,
    titulo: "Rodadas de negociação abertas",
    linha: "Cotações em andamento na mesa da Franqueadora.",
    href: "/compras/rodadas",
    tom: "normal",
  });

  return lista;
}

/**
 * OS ATALHOS DO DIA — o que aquela pessoa mais FAZ, não por onde ela navega.
 *
 * A barra lateral já leva a todos os módulos; repetir os módulos aqui seria um
 * segundo menu, pior que o primeiro. Estes são atos: abrir um cadastro, marcar
 * uma hora. Por isso são poucos e mudam com o papel.
 */
export function atalhosPara(session: SessionContext): Atalho[] {
  const clinica = session.activeClinic;
  if (!clinica) return [];

  const papeis = papeisAqui(session);
  const admin = session.isAdminMaster;
  const tem = (...lista: UserRole[]) => lista.some((r) => papeis.has(r));
  const naUnidade = clinica.type !== "franchisor";

  const atalhos: Atalho[] = [];

  if (naUnidade && (admin || tem("receptionist", "sdr", "unit_manager"))) {
    atalhos.push({ rotulo: "Cadastrar cliente", href: "/prontuarios/novo" });
    atalhos.push({ rotulo: "Abrir a agenda", href: "/agenda" });
  }
  if (naUnidade && tem("dentist")) {
    atalhos.push({ rotulo: "Meu Dia", href: "/meu-dia" });
    atalhos.push({ rotulo: "Minha Agenda", href: "/minha-agenda" });
  }
  if (naUnidade && tem("clinical_coordinator")) {
    atalhos.push({ rotulo: "Painel de atendimento", href: "/atendimento" });
  }
  if (admin || tem("planner_dentist")) {
    atalhos.push({ rotulo: "Centro de Planejamento", href: "/planejamento" });
  }
  if (naUnidade && tem("commercial_consultant")) {
    atalhos.push({ rotulo: "Meus clientes", href: "/comercial" });
  }
  if (!naUnidade && (admin || tem("purchaser"))) {
    atalhos.push({ rotulo: "Mesa de negociação", href: "/compras/rodadas" });
  }

  // Três é o limite de propósito: a partir do quarto, a fileira vira menu — e
  // um segundo menu ao lado do primeiro não ajuda ninguém a começar o dia.
  return atalhos.slice(0, 3);
}
