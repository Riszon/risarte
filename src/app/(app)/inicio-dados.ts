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
import { resumoDaMissao, type MetaDoTreino, type Medicao } from "@/lib/certificacao";
import { guardarProgresso, medirMatricula, registrarSeCumprida } from "@/lib/certificacao-servidor";
import type { MissaoNaTela } from "@/components/missao-de-certificacao";
import { selosDeCertificacao, type SeloDeCertificacao } from "@/lib/conquistas";
import {
  agruparMissoes,
  lerColegas,
  listaDeNomes,
  porUnidade,
  type ColegaDoGrupo,
  type GrupoDaUnidade,
} from "@/lib/certificacao-equipe";

/**
 * A EQUIPE DA PESSOA NA CERTIFICAÇÃO COLETIVA (0303, relato OC-00003).
 *
 * Vazio quando a liberação é individual ou a pessoa não está numa turma de
 * novatos aberta — o banco decide (`my_training_group`). Falha ao ler devolve
 * nulo, como o cartão da missão: o quadro some, o Início abre.
 */
export async function equipeDaMissao(
  supabase: SupabaseClient
): Promise<GrupoDaUnidade<ColegaDoGrupo>[] | null> {
  const { data, error } = await supabase.rpc("my_training_group");
  if (error) {
    console.error("equipeDaMissao:", error.message);
    return null;
  }
  return porUnidade(lerColegas((data ?? []) as Record<string, unknown>[]));
}

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

/**
 * ORTO8 (0334, R4): quantos casos de ortodontia da unidade aguardam início
 * SEM horário de instalação (início/sessão de tratamento futuro, agendado ou
 * confirmado). A mesma régua da tela Atenção. Banco sem a 0329 → zero.
 */
async function contarOrtodontiaSemInstalacao(
  supabase: SupabaseClient,
  clinicId: string
): Promise<number> {
  const { data: casos, error } = await supabase
    .from("ortho_cases")
    .select("client_id")
    .eq("clinic_id", clinicId)
    .eq("status", "aguardando_inicio")
    .limit(500);
  if (error || !casos || casos.length === 0) return 0;
  const ids = [...new Set(casos.map((c) => c.client_id as string))];
  const { data: agendados } = await supabase
    .from("appointments")
    .select("client_id")
    .in("client_id", ids)
    .in("type", ["treatment_start", "treatment_session"])
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .limit(1000);
  const comHorario = new Set((agendados ?? []).map((a) => a.client_id as string));
  return ids.filter((id) => !comHorario.has(id)).length;
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
  // OC-00102 (0294): a compra da PRÓPRIA Franqueadora é aprovada e recebida
  // pelo Financeiro da Franqueadora — sem isto, ela esperava sem ninguém ver.
  const comprasDaFranqueadora = !naUnidade && (admin || tem("finance_franchisor"));

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
    ortodontiaSemInstalacao,
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
    gestao || comprasDaFranqueadora ? contarEtapasDaCompra(supabase, clinica.id) : null,
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
    // ORTO8 (0334, R4): casos de ortodontia aguardando início SEM horário de
    // instalação — para quem agenda e quem gere. A mesma régua da tela Atenção
    // (`loadStartAppointments`): início/sessão de tratamento futuro, agendado
    // ou confirmado. Leitura tolerante: sem a 0329, zero.
    balcao || gestao
      ? contarOrtodontiaSemInstalacao(supabase, clinica.id)
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
    // AP25 (OC-00092): apontava para `/planejamento`, que é só do Planner — o
    // Coordenador clicava e era devolvido ao Início. `/planos` é a tela que
    // ele tem; a unidade vai junto para o número do cartão bater com a lista
    // (o Admin, sem ela, veria a rede inteira).
    href: `/planos?situacao=aguardando_aprovacao&unidade=${clinica.id}`,
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

  juntar({
    chave: "ortodontia-instalar",
    numero: typeof ortodontiaSemInstalacao === "number" ? ortodontiaSemInstalacao : 0,
    titulo: "Ortodontia: aguardando instalação sem horário",
    linha: "Fecharam o tratamento ortodôntico e ainda não têm a instalação do aparelho agendada.",
    href: "/ortodontia/atencao?motivo=aguardando_inicio",
    tom: "atencao",
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

/**
 * A MISSÃO ABERTA DA PESSOA (0273), para o cartão da tela de Início.
 *
 * ⚠️ Devolve `null` em silêncio quando algo dá errado — inclusive quando a
 * migração ainda não rodou naquele banco. É a mesma escolha do resto do
 * Início: o cartão que não aparece é um problema pequeno; a tela de Início que
 * não abre trava a pessoa inteira. (Mesma janela tratada em
 * `permission_matrix`, §0b do CLAUDE.md.)
 */
export async function missoesAbertas(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<MissaoNaTela[]> {
  // ⚠️ TODAS AS MISSÕES, NÃO A MAIS RECENTE (relato OC-00111). Quem tem duas
  // funções em turmas abertas (TSB em Cambé, ASB em Londrina) tem duas
  // missões — e com `.limit(1)` a outra ficava invisível, sem ter como aceitar.
  const { data, error } = await supabase
    .from("training_enrollments")
    .select(
      "id, role, status, started_at, access_suspended_at, approval_status, clinic_id, training_campaigns!inner(status, access_policy, deadline, kind)"
    )
    .eq("user_id", userId)
    // 0281: a concluída também aparece enquanto a turma está aberta — é o
    // cartão que diz "aguardando aprovação" ou "certificado". Sem ele, a
    // missão cumprida simplesmente sumiria da tela.
    .in("status", ["convocado", "em_andamento", "concluido"])
    .eq("training_campaigns.status", "aberta")
    .order("invited_at", { ascending: false });

  if (error || !data || data.length === 0) return [];

  // O NOME DA UNIDADE de cada missão: é ele que separa duas missões na tela.
  // A pessoa no portal não "tem" a unidade (a tranca a esconde, 0277), mas o
  // nome das unidades é leitura livre para quem está logado.
  const idsDasUnidades = [...new Set(data.map((d) => d.clinic_id).filter(Boolean))] as string[];
  const { data: unidades } = idsDasUnidades.length
    ? await supabase.from("clinics").select("id, name").in("id", idsDasUnidades)
    : { data: [] as { id: string; name: string }[] };
  const nomeDaUnidade = new Map((unidades ?? []).map((u) => [String(u.id), String(u.name)]));

  // O resumo vem das metas DE AGORA. A pessoa precisa ver o que vai cumprir
  // antes de aceitar — um cartão que diz "você foi convocado" sem dizer para
  // quê pede um clique no escuro.
  const papeis = [...new Set(data.map((d) => d.role as UserRole))];
  const { data: metas } = await supabase
    .from("training_requirements")
    .select("role, indicator, minimum_count")
    .in("role", papeis)
    .returns<MetaDoTreino[]>();

  // AP52: a mesma função em duas unidades é UMA missão — um quadro só, medido
  // e registrado pela matrícula mais adiantada; o banco leva as irmãs junto
  // (0305). As unidades vão todas para o título.
  const turmaDe = (d: (typeof data)[number]) =>
    (Array.isArray(d.training_campaigns) ? d.training_campaigns[0] : d.training_campaigns) as
      | { access_policy?: string; deadline?: string | null; kind?: string }
      | undefined;
  const grupos = agruparMissoes(
    data.map((d) => ({
      linha: d,
      role: String(d.role),
      kind: String(turmaDe(d)?.kind ?? ""),
      status: String(d.status),
      started_at: d.started_at ? String(d.started_at) : null,
    }))
  );

  const missoes: MissaoNaTela[] = [];
  for (const grupo of grupos) {
    const d = grupo.representante.linha;
    const unidadesDaMissao = grupo.todas
      .map((g) => (g.linha.clinic_id ? nomeDaUnidade.get(String(g.linha.clinic_id)) : undefined))
      .filter((n): n is string => Boolean(n));
    const papel = d.role as UserRole;
    const metasDoPapel = (metas ?? []).filter((m) => m.role === papel);
    // O Supabase devolve o embutido como objeto ou lista conforme a relação.
    const turma = turmaDe(d);
    const startedAt = d.started_at ? String(d.started_at) : null;

    // ⚠️ SÓ MEDE QUEM JÁ COMEÇOU. Antes do clique não existe janela de contagem
    // (lei do marco, 0273) — e medir mesmo assim iria ao banco de treino a cada
    // abertura do Início para devolver uma resposta que já se sabe qual é.
    const medicao: Medicao | null =
      d.status === "em_andamento" && startedAt
        ? await medirMatricula({ email, role: papel, started_at: startedAt, metas: metasDoPapel })
        : null;

    // ⚠️ 0281: MEDIU E CUMPRIU → REGISTRA. É aqui que a missão vira certificado
    // para quem simplesmente abre o Início. O registro é do SERVIDOR (chave de
    // serviço), depois desta medição — nunca de um valor vindo do navegador.
    let status = d.status as MissaoNaTela["status"];
    let conclusao: MissaoNaTela["conclusao"] =
      status === "concluido"
        ? d.approval_status === "pendente"
          ? "aguardando_aprovacao"
          : "certificado"
        : null;
    if (status === "em_andamento") {
      // 0303: a última medição fica na matrícula para a equipe e o painel.
      await guardarProgresso(String(d.id), medicao);
      const registrado = await registrarSeCumprida(String(d.id), medicao);
      if (registrado) {
        status = "concluido";
        conclusao =
          registrado === "aguardando_aprovacao"
            ? "aguardando_aprovacao"
            : registrado === "porta_fechada"
              ? "porta_fechada"
              : "certificado";
      }
    }

    missoes.push({
      id: String(d.id),
      role: papel,
      status,
      conclusao,
      started_at: startedAt,
      resumo: resumoDaMissao(metasDoPapel, papel),
      medicao,
      prazo: turma?.deadline ? String(turma.deadline) : null,
      suspenso: Boolean(d.access_suspended_at),
      unidade: unidadesDaMissao.length ? listaDeNomes(unidadesDaMissao) : null,
      variasUnidades: new Set(unidadesDaMissao).size > 1,
    });
  }
  return missoes;
}

/**
 * OC-00133: as medalhas da própria pessoa no Início. A regra de leitura do
 * banco já deixa cada um ler os seus certificados (0273). Leitura que falha
 * não mostra nada — é enfeite do Início, não conta que alguém confere.
 */
export async function minhasCertificacoes(
  supabase: SupabaseClient,
  session: SessionContext
): Promise<SeloDeCertificacao[]> {
  const { data, error } = await supabase
    .from("training_certifications")
    .select("role, certified_at, approved_by")
    .eq("user_id", session.userId)
    .returns<{ role: UserRole; certified_at: string; approved_by: string | null }[]>();
  if (error) {
    console.error("inicio — certificações:", error.message);
    return [];
  }
  // As funções de hoje, inclusive nas unidades ainda fechadas (elas somem de
  // `rolesByClinic`, mas a pessoa continua tendo a função).
  const funcoes = [
    ...Object.values(session.rolesByClinic).flat(),
    ...session.unidadesFechadas.map((u) => u.role),
  ];
  return selosDeCertificacao(
    (data ?? []).map((r) => ({
      role: r.role,
      certifiedAt: r.certified_at,
      aprovadoPeloAdmin: r.approved_by !== null,
    })),
    funcoes
  );
}
