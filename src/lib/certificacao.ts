import type { UserRole } from "@/lib/roles";

/**
 * O PORTÃO DE CERTIFICAÇÃO — ninguém entra no riSZon real sem provar no treino.
 *
 * Decisão do dono (25/09/2026), do documento "Avaliação no riSZon teste":
 * *"Estamos definindo aqui o padrão único de entrada para o sistema real:
 * ninguém passa sem cumprir a missão."*
 *
 * ⚠️ A TRANCA JÁ EXISTIA (0259): o riSZon real nasce FECHADO para todo
 * Risartano novo. O que falta é a CHAVE que gira sozinha quando a missão é
 * cumprida — e é isso que este módulo define.
 *
 * ⚠️ POR QUE O CATÁLOGO ESTÁ AQUI E NÃO NUMA TABELA DO BANCO.
 *
 * Cada indicador precisa de uma CONSULTA PRÓPRIA ao banco de treino para ser
 * contado ("quantos clientes esta pessoa cadastrou lá"). Uma tabela de
 * indicadores deixaria o Admin cadastrar "atendimentos de urgência" e o número
 * ficaria eternamente em zero, sem nada na tela explicando por quê — a tela
 * prometeria uma medição que ninguém escreveu. Indicador é código; META é dado.
 *
 * ⚠️ NADA AQUI DEPENDE DE UNIDADE. Ordem do dono: padrão ÚNICO da rede.
 *
 * ⚠️ DE ONDE SAIU ESTA LISTA (25/09/2026). Não saiu de memória nem do
 * documento: saiu do BANCO. A consulta pediu toda coluna que aponta para
 * `profiles` — 155 tabelas, 224 colunas que registram QUEM fez. É a lei do §0
 * do CLAUDE.md, que já custou dados reais duas vezes.
 *
 * ⚠️ O QUE FICOU DE FORA DE PROPÓSITO, e não por esquecimento (o dono viu a
 * lista e concordou):
 *   * ACESSOS DA AUDITORIA — medem navegação, não competência. Quem abrisse 50
 *     telas "passaria" sem ter feito nada.
 *   * MENSAGENS DE CHAT — mediriam conversa, e treinariam a pessoa a escrever
 *     mensagem vazia para bater meta.
 *   * NOTIFICAÇÕES RECEBIDAS — não são ato dela; são coisa que aconteceu com
 *     ela.
 *   * CANCELAR VENDA E REABRIR SESSÃO — são retrabalho. Meta que premia
 *     cancelamento produz cancelamento. (O cancelamento de PLANO entrou, e é
 *     outra coisa: ali o que se treina é conduzir um processo de três passos
 *     sem pular etapa — está marcado como complementar.)
 */

/** Onde a ação acontece e quanto ela pesa na formação da pessoa. */
export type NivelDoIndicador = "essencial" | "complementar";

/**
 * O que o sistema consegue contar no treino. Cada chave = uma consulta.
 *
 * Os campos existem para o Admin conseguir CONFIGURAR sem adivinhar:
 *   * `ajuda`  — o que exatamente é contado (e o que NÃO é);
 *   * `onde`   — em que tela a pessoa faz aquilo, para ele julgar se dá para
 *                treinar;
 *   * `nivel`  — `essencial` é o trabalho do dia a dia daquela função;
 *                `complementar` acontece de vez em quando;
 *   * `dependeDeOutro` — ⚠️ a ação exige que ALGUÉM TENHA FEITO ALGO ANTES.
 *     Não dá para receber mercadoria sem pedido, nem aprovar plano sem plano.
 *     Meta assim pode travar a pessoa por culpa de terceiro, e a tela avisa.
 *
 * `origem` NÃO é comentário: é a consulta da Etapa 2 escrita por extenso,
 * decidida com o banco aberto na frente, e conferida por
 * `npm run check:indicadores`. Sem ela alguém escreveria a contagem "de
 * cabeça" e a tela mostraria "3 de 5" sem ninguém saber 3 do quê.
 */
export const INDICADORES = [
  // ===========================================================================
  // RECEPÇÃO E CAPTAÇÃO
  // ===========================================================================
  {
    chave: "cadastros",
    rotulo: "Cadastros de clientes",
    ajuda:
      "Pessoas que ela cadastrou do zero. Não conta ficha que ela apenas abriu ou editou.",
    onde: "Clientes → Novo cliente",
    nivel: "essencial",
    origem: "clients.created_by",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "primeiros_agendamentos",
    rotulo: "Primeiros agendamentos",
    ajuda:
      "Avaliações agendadas — é a passagem da Fase 1 para a Fase 2, o começo da jornada.",
    onde: "Agenda → Agendar (tipo Avaliação)",
    nivel: "essencial",
    origem: "appointments.created_by + type=evaluation",
    papeis: ["receptionist", "sdr"],
  },
  {
    chave: "agendamentos_reavaliacao",
    rotulo: "Agendamentos de reavaliação",
    ajuda: "Reavaliações agendadas (Fase 6), o controle de qualidade do tratamento.",
    onde: "Agenda → Agendar (tipo Reavaliação)",
    nivel: "complementar",
    origem: "appointments.created_by + type=reevaluation",
    papeis: ["receptionist"],
  },
  {
    chave: "agendamentos_inicio",
    rotulo: "Agendamentos de início de tratamento",
    ajuda:
      "O agendamento que a recepção faz depois que o comercial fecha a venda (Fase 5).",
    onde: "Agenda → Agendar (tipo Início de tratamento)",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "appointments.created_by + type=treatment_start",
    papeis: ["receptionist"],
  },
  {
    chave: "check_ins",
    rotulo: "Check-ins na recepção",
    ajuda: "Chegadas registradas: é o que põe o paciente na sala de espera.",
    onde: "Agenda → clicar no agendamento → Registrar chegada",
    nivel: "essencial",
    origem: "appointments.checked_in_by",
    papeis: ["receptionist", "tsb", "asb"],
  },
  {
    chave: "chamadas_paciente",
    rotulo: "Pacientes chamados",
    ajuda:
      "Quantas vezes ela chamou alguém da sala de espera para o atendimento. É o elo entre a recepção e o clínico.",
    onde: "Sala de espera → Chamar",
    nivel: "essencial",
    origem: "appointments.called_by",
    papeis: ["receptionist", "clinical_coordinator", "dentist", "tsb", "asb"],
  },
  {
    chave: "remarcacoes",
    rotulo: "Remarcações",
    ajuda: "Agendamentos que ela mudou de horário ou de profissional.",
    onde: "Agenda → abrir o agendamento → Remarcar",
    nivel: "complementar",
    origem: "appointment_changes.changed_by",
    papeis: ["receptionist"],
  },
  {
    chave: "anamneses",
    rotulo: "Fichas de anamnese preenchidas",
    ajuda: "Questionários de saúde respondidos com a ajuda dela.",
    onde: "Ficha do cliente → Anamnese",
    nivel: "essencial",
    origem: "anamnesis_fills.filled_by",
    papeis: ["receptionist", "tsb", "asb"],
  },
  {
    chave: "consentimentos",
    rotulo: "Consentimentos registrados",
    ajuda:
      "Autorizações de LGPD e de gravação. Sem elas o clínico não pode anexar foto nem gravar — é pré-requisito de tudo.",
    onde: "Ficha do cliente → Consentimento",
    nivel: "essencial",
    origem: "client_consents.recorded_by",
    papeis: ["receptionist", "clinical_coordinator"],
  },
  {
    chave: "edicoes_cliente",
    rotulo: "Fichas de cliente editadas",
    ajuda: "Alterações que ela fez no cadastro de alguém (telefone, endereço, nome).",
    onde: "Ficha do cliente → Editar",
    nivel: "complementar",
    origem: "client_changes.changed_by",
    papeis: ["sdr", "receptionist"],
  },
  {
    chave: "movimentacoes_jornada",
    rotulo: "Clientes movidos de fase",
    ajuda:
      "Passagens da jornada feitas por ela. É o coração do sistema: aprender a mover o cliente na hora certa.",
    onde: "Jornada do Cliente → arrastar o cartão",
    nivel: "essencial",
    origem: "journey_phase_history.moved_by",
    papeis: ["receptionist", "sdr", "clinical_coordinator", "commercial_consultant"],
  },
  {
    chave: "transferencias_unidade",
    rotulo: "Transferências entre unidades",
    ajuda: "Clientes que ela passou de uma unidade para outra, em definitivo.",
    onde: "Ficha do cliente → Transferir",
    nivel: "complementar",
    origem: "client_clinic_history.transferred_by",
    papeis: ["receptionist", "unit_manager"],
  },
  {
    chave: "compartilhamentos",
    rotulo: "Compartilhamentos entre unidades",
    ajuda:
      "Clientes que ela abriu para outra unidade atender — diferente de transferir: aqui as duas unidades enxergam.",
    onde: "Ficha do cliente → Compartilhar",
    nivel: "complementar",
    origem: "client_shares.shared_by",
    papeis: ["receptionist", "unit_manager"],
  },

  // ===========================================================================
  // CLÍNICO
  // ===========================================================================
  {
    chave: "avaliacoes",
    rotulo: "Avaliações concluídas",
    ajuda:
      "Avaliações que ela abriu E fechou (Fase 2). Avaliação deixada aberta não conta.",
    onde: "Ficha do cliente → Avaliação → Concluir",
    nivel: "essencial",
    origem: "clinical_evaluations.closed_by + kind=avaliacao",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "reavaliacoes",
    rotulo: "Reavaliações concluídas",
    ajuda: "Reavaliações fechadas por ela (Fase 6), depois do tratamento andar.",
    onde: "Ficha do cliente → Reavaliação → Concluir",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "clinical_evaluations.closed_by + kind=reavaliacao",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "midias_enviadas",
    rotulo: "Fotos e exames enviados",
    ajuda:
      "Arquivos clínicos anexados à ficha: foto, radiografia, escaneamento, exame, áudio, vídeo.",
    onde: "Ficha do cliente → Galeria → Enviar",
    nivel: "essencial",
    origem: "clinical_media.uploaded_by",
    papeis: ["clinical_coordinator", "tsb", "asb"],
  },
  {
    chave: "consideracoes_clinicas",
    rotulo: "Considerações clínicas escritas",
    ajuda:
      "As anotações que o Coordenador deixa para o Planner. É o que transforma a avaliação em informação útil.",
    onde: "Ficha do cliente → Considerações",
    nivel: "essencial",
    origem: "clinical_notes.created_by",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "anamnese_clinica",
    rotulo: "Anamneses clínicas preenchidas",
    ajuda:
      "A anamnese feita pelo clínico, mais completa que a da recepção (histórico, medicação, alergias).",
    onde: "Ficha do cliente → Anamnese clínica",
    nivel: "complementar",
    origem: "clinical_anamnesis.created_by",
    papeis: ["clinical_coordinator", "dentist"],
  },
  {
    chave: "aprovacoes_plano",
    rotulo: "Opções de plano avaliadas",
    ajuda:
      "Opções que ela aprovou ou devolveu ao Planner. Conta as duas coisas: devolver com orientação também é trabalho feito.",
    onde: "Planejamento → abrir o plano → Aprovar / Devolver",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "treatment_plan_options.reviewed_by",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "atendimentos_concluidos",
    rotulo: "Atendimentos concluídos",
    ajuda: "Consultas que ela encerrou. É o que libera a próxima etapa da jornada.",
    onde: "Painel de atendimento → Concluir",
    nivel: "essencial",
    origem: "appointments.done_by",
    papeis: ["clinical_coordinator", "dentist"],
  },
  {
    chave: "atendimentos_como_profissional",
    rotulo: "Atendimentos como profissional responsável",
    ajuda:
      "Consultas em que ela aparece como a profissional do horário — diferente de quem concluiu.",
    onde: "Agenda (ao ser escolhida no agendamento)",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "appointments.provider_user_id",
    papeis: ["dentist", "clinical_coordinator", "tsb", "asb"],
  },
  {
    chave: "desfechos_atendimento",
    rotulo: "Desfechos de atendimento registrados",
    ajuda: "O que aconteceu na consulta: compareceu, faltou, foi remarcado.",
    onde: "Painel de atendimento → Registrar desfecho",
    nivel: "complementar",
    origem: "attendance_session_outcomes.recorded_by",
    papeis: ["clinical_coordinator", "tsb", "asb"],
  },
  {
    chave: "solicitacoes_clinicas",
    rotulo: "Solicitações clínicas",
    ajuda: "Pedidos de exame, encaminhamento ou parecer feitos por ela.",
    onde: "Ficha do cliente → Solicitações",
    nivel: "complementar",
    origem: "clinical_requests.requested_by",
    papeis: ["clinical_coordinator", "dentist"],
  },
  {
    chave: "revisoes_qualidade",
    rotulo: "Revisões de qualidade",
    ajuda: "Conferências de plano executado que ela revisou.",
    onde: "Planejamento → Revisões de qualidade",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "plan_quality_reviews.reviewed_by",
    papeis: ["clinical_coordinator"],
  },
  {
    chave: "decisoes_jornada",
    rotulo: "Decisões da jornada resolvidas",
    ajuda:
      "Pendências que o sistema abriu para alguém decidir e ela resolveu (ex.: o que fazer com um caso parado).",
    onde: "Jornada do Cliente → Pendências",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "journey_decisions.resolved_by",
    papeis: ["clinical_coordinator", "unit_manager"],
  },

  // ===========================================================================
  // CENTRO DE PLANEJAMENTO
  // ===========================================================================
  {
    chave: "planos_criados",
    rotulo: "Planos de tratamento criados",
    ajuda:
      "Planos montados por ela: diagnóstico, opções e orçamento. É o núcleo do trabalho do Planner.",
    onde: "Planejamento → abrir o caso → montar o plano",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "treatment_plans.created_by",
    papeis: ["planner_dentist"],
  },
  {
    chave: "planos_enviados",
    rotulo: "Planos enviados para aprovação",
    ajuda:
      "Planos que ela submeteu ao Coordenador. Criar e não enviar deixa o caso parado — por isso os dois são medidos.",
    onde: "Planejamento → Enviar para aprovação",
    nivel: "essencial",
    origem: "treatment_plan_status_events.changed_by + status=submitted",
    papeis: ["planner_dentist"],
  },
  {
    chave: "complementos_planejamento",
    rotulo: "Complementos de planejamento",
    ajuda:
      "Pedidos de informação que faltava (uma foto, um exame) abertos por ela em vez de planejar no escuro.",
    onde: "Planejamento → Pedir complemento",
    nivel: "complementar",
    origem: "planning_supplements.created_by",
    papeis: ["planner_dentist"],
  },

  // ===========================================================================
  // EXECUÇÃO CLÍNICA
  // ===========================================================================
  {
    chave: "sessoes_concluidas",
    rotulo: "Sessões de tratamento concluídas",
    ajuda:
      "Sessões executadas e dadas por concluídas. É o que baixa material do estoque e gera o repasse.",
    onde: "Painel de atendimento → Concluir sessão",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "treatment_sessions.executed_by + status=done",
    papeis: ["dentist"],
  },
  {
    chave: "evolucoes",
    rotulo: "Evoluções escritas no prontuário",
    ajuda:
      "Anotações de evolução assinadas por ela. É o registro legal do que foi feito na cadeira.",
    onde: "Prontuário → Evolução",
    nivel: "essencial",
    origem: "clinical_progress_notes.author_id",
    papeis: ["dentist"],
  },
  {
    chave: "documentos_clinicos",
    rotulo: "Documentos clínicos emitidos",
    ajuda: "Atestado, receita, encaminhamento e declaração emitidos por ela.",
    onde: "Ficha do cliente → Documentos",
    nivel: "essencial",
    origem: "clinical_documents.author_id",
    papeis: ["dentist", "clinical_coordinator"],
  },
  {
    chave: "consumo_avulso",
    rotulo: "Lançamentos de consumo de material",
    ajuda:
      "Baixas de estoque feitas à mão, para quando o kit do procedimento não cobre o que foi usado.",
    onde: "Estoque → Registrar consumo",
    nivel: "complementar",
    origem: "stock_movements.created_by",
    papeis: ["tsb", "asb"],
  },

  // ===========================================================================
  // COMERCIAL
  // ===========================================================================
  {
    chave: "apresentacoes",
    rotulo: "Apresentações comerciais",
    ajuda: "Apresentações conduzidas por ela (Fase 4), com ou sem gravação.",
    onde: "Atendimento → Apresentação",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "commercial_presentations.consultant_id",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "negociacoes",
    rotulo: "Negociações montadas",
    ajuda:
      "Propostas de pagamento montadas por ela: valor, desconto, forma e número de parcelas.",
    onde: "Atendimento → Negociar",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "plan_negotiations.created_by",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "movimentacoes_funil",
    rotulo: "Cartões movimentados no funil",
    ajuda: "Vezes que ela moveu um cliente de coluna no funil comercial.",
    onde: "Comercial → Funil",
    nivel: "essencial",
    origem: "commercial_card_events.actor_id",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "desfechos_funil",
    rotulo: "Desfechos registrados no funil",
    ajuda:
      "Ganhou ou perdeu, com o motivo. Fechar o cartão é o que faz o funil valer alguma coisa.",
    onde: "Comercial → Funil → Registrar desfecho",
    nivel: "complementar",
    origem: "commercial_cards.outcome_by",
    papeis: ["commercial_consultant"],
  },
  {
    chave: "fechamentos",
    rotulo: "Contratos assinados",
    ajuda:
      "Vendas em que ela registrou a assinatura. Lembre: só é venda com documento assinado E pagamento confirmado.",
    onde: "Atendimento → Fechamento → Contrato",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "commercial_sales.contract_signed_by",
    papeis: ["commercial_consultant", "commercial_assistant"],
  },
  {
    chave: "followups",
    rotulo: "Tentativas de follow-up",
    ajuda: "Contatos de retomada com quem não fechou na hora.",
    onde: "Comercial → Follow-up",
    nivel: "essencial",
    origem: "commercial_followup_attempts.created_by",
    papeis: ["commercial_consultant", "commercial_assistant"],
  },
  {
    chave: "links_pagamento",
    rotulo: "Links de pagamento enviados",
    ajuda: "Cobranças emitidas por ela para o cliente pagar.",
    onde: "Atendimento → Fechamento → Enviar cobrança",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "commercial_sales.payment_issued_by",
    papeis: ["commercial_assistant"],
  },
  {
    chave: "pagamentos_confirmados",
    rotulo: "Pagamentos confirmados",
    ajuda: "Vendas em que ela confirmou que o dinheiro entrou — a outra metade da regra de ouro.",
    onde: "Atendimento → Fechamento → Confirmar pagamento",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "commercial_sales.payment_confirmed_by",
    papeis: ["commercial_assistant"],
  },
  {
    chave: "vendas_diretas",
    rotulo: "Vendas diretas lançadas",
    ajuda:
      "Vendas de balcão, sem passar pelo planejamento (limpeza, clareamento). Fluxo inteiro: criar, assinar e cobrar.",
    onde: "Comercial → Venda direta",
    nivel: "essencial",
    origem: "direct_sales.created_by",
    papeis: ["commercial_consultant", "receptionist"],
  },
  {
    chave: "adesoes_ppr",
    rotulo: "Adesões ao PPR+ vendidas",
    ajuda: "Clientes que ela colocou no programa de recorrência.",
    onde: "PPR+ → Nova adesão",
    nivel: "complementar",
    origem: "ppr_memberships.sold_by",
    papeis: ["commercial_consultant", "receptionist"],
  },
  {
    chave: "renegociacoes",
    rotulo: "Renegociações montadas",
    ajuda:
      "Dívidas renegociadas por ela. Treina a regra mais delicada do financeiro: a dívida nova nasce com tudo o que é devido hoje.",
    onde: "Financeiro → Renegociar",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "payment_renegotiations.created_by",
    papeis: ["commercial_consultant", "unit_manager", "finance_franchisor"],
  },

  // ===========================================================================
  // GESTÃO DA UNIDADE
  // ===========================================================================
  {
    chave: "contas_aprovadas",
    rotulo: "Contas a pagar aprovadas",
    ajuda: "Despesas que ela autorizou dentro da alçada.",
    onde: "Financeiro → Contas a pagar → Aprovar",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "payables.approved_by",
    papeis: ["unit_manager", "finance_franchisor"],
  },
  {
    chave: "contas_lancadas",
    rotulo: "Contas a pagar lançadas",
    ajuda: "Despesas que ela cadastrou — diferente de aprovar: quem lança não aprova a própria conta.",
    onde: "Financeiro → Contas a pagar → Nova",
    nivel: "essencial",
    origem: "payables.created_by",
    papeis: ["unit_manager", "finance_franchisor"],
  },
  {
    chave: "inventarios",
    rotulo: "Inventários aplicados",
    ajuda: "Contagens de estoque que ela fechou, virando ajuste com motivo.",
    onde: "Estoque → Inventário → Aplicar",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "stock_counts.applied_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "contagens_iniciadas",
    rotulo: "Contagens de estoque iniciadas",
    ajuda: "Folhas de contagem abertas por ela — o passo antes de aplicar o inventário.",
    onde: "Estoque → Inventário → Nova contagem",
    nivel: "essencial",
    origem: "stock_counts.created_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "requisicoes_compra",
    rotulo: "Requisições de compra enviadas",
    ajuda:
      "Pedidos de material que ela mandou para a franqueadora negociar. É o começo do ciclo de compras.",
    onde: "Compras → Nova requisição → Enviar",
    nivel: "essencial",
    origem: "purchase_requests.sent_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "recebimentos_mercadoria",
    rotulo: "Recebimentos de mercadoria",
    ajuda:
      "Entregas conferidas por ela contra o pedido. É o que põe o material na prateleira e gera a conta a pagar.",
    onde: "Compras → Pedidos → Receber",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "purchase_receipts.created_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "notas_de_compra",
    rotulo: "Notas de compra lançadas",
    ajuda: "Compras avulsas lançadas por ela, inclusive por leitura do XML da nota.",
    onde: "Estoque → Compras → Lançar nota",
    nivel: "complementar",
    origem: "stock_purchases.created_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "pedidos_decididos",
    rotulo: "Pedidos de compra decididos",
    ajuda: "Rateios da rodada que ela aprovou ou recusou — é dinheiro da unidade.",
    onde: "Compras → Aprovações",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "purchase_allocations.decided_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "autorizacoes_negociacao",
    rotulo: "Descontos autorizados",
    ajuda: "Negociações fora da regra comercial que ela liberou.",
    onde: "Comercial → Autorizações",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "plan_negotiations.authorized_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "orcamento_preenchido",
    rotulo: "Metas de orçamento preenchidas",
    ajuda: "Linhas de orçamento (receita ou despesa) que ela definiu para o ano.",
    onde: "Financeiro → Orçamento",
    nivel: "complementar",
    origem: "budget_lines.created_by",
    papeis: ["unit_manager", "finance_franchisor"],
  },
  {
    chave: "competencias_fechadas",
    rotulo: "Meses fechados",
    ajuda:
      "Competências que ela deu por encerradas. Depois de fechado, o resultado daquele mês não muda mais.",
    onde: "Financeiro → Fechamento",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "fiscal_periods.closed_by",
    papeis: ["unit_manager", "finance_franchisor"],
  },
  {
    chave: "cancelamentos_plano",
    rotulo: "Cancelamentos de plano conduzidos",
    ajuda:
      "⚠️ Não é para incentivar cancelamento: é para treinar o processo de três passos (apurar → assinar → efetivar) sem pular etapa.",
    onde: "Ficha do cliente → Plano → Cancelar",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "plan_cancellations.created_by",
    papeis: ["unit_manager"],
  },
  {
    chave: "agenda_configurada",
    rotulo: "Fechamentos e aberturas de agenda",
    ajuda: "Feriados, folgas e dias extras que ela configurou na agenda da unidade.",
    onde: "Administração → Config. Agenda",
    nivel: "complementar",
    origem: "agenda_closures.created_by",
    papeis: ["unit_manager"],
  },

  // ===========================================================================
  // FINANCEIRO DA FRANQUEADORA
  // ===========================================================================
  {
    chave: "recebimentos",
    rotulo: "Recebimentos lançados",
    ajuda: "Baixas de cobrança registradas por ela, com meio de pagamento e data.",
    onde: "Financeiro → Contas a receber → Baixar",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "payment_receipts.created_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "baixas_parcela",
    rotulo: "Parcelas baixadas",
    ajuda: "Parcelas marcadas como pagas por ela — o recebimento visto pela cobrança.",
    onde: "Ficha do cliente → Financeiro → Baixar parcela",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "payment_installments.paid_by",
    papeis: ["finance_franchisor", "receptionist"],
  },
  {
    chave: "pagamentos_efetuados",
    rotulo: "Pagamentos efetuados",
    ajuda: "Contas a pagar que ela quitou, com valor, data e desconto por pontualidade.",
    onde: "Financeiro → Contas a pagar → Pagar",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "payable_payments.created_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "conciliacoes",
    rotulo: "Lançamentos conciliados",
    ajuda: "Linhas do razão que ela bateu com o extrato do banco.",
    onde: "Financeiro → Conciliação",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "financial_entries.reconciled_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "transacoes_conciliadas",
    rotulo: "Transações do extrato casadas",
    ajuda:
      "Linhas do extrato do banco que ela ligou a um lançamento — a conciliação vista pelo lado do banco.",
    onde: "Financeiro → Conciliação → Casar",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "bank_transactions.matched_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "extratos_importados",
    rotulo: "Extratos importados",
    ajuda: "Arquivos OFX do banco que ela trouxe para o sistema.",
    onde: "Financeiro → Conciliação → Importar extrato",
    nivel: "complementar",
    origem: "bank_statement_imports.created_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "lancamentos_razao",
    rotulo: "Lançamentos no razão",
    ajuda: "Lançamentos contábeis criados à mão por ela.",
    onde: "Financeiro → Razão → Novo lançamento",
    nivel: "complementar",
    origem: "financial_entries.created_by",
    papeis: ["finance_franchisor"],
  },
  {
    chave: "contatos_cobranca",
    rotulo: "Contatos de cobrança",
    ajuda: "Tentativas de cobrança registradas por ela com quem está em atraso.",
    onde: "Financeiro → Cobrança",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "collection_contacts.author_id",
    papeis: ["finance_franchisor", "unit_manager"],
  },
  {
    chave: "fechamentos_repasse",
    rotulo: "Fechamentos de repasse",
    ajuda: "Fechamentos mensais de repasse ao dentista feitos por ela.",
    onde: "Financeiro → Repasses → Fechar mês",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "payout_closings.closed_by",
    papeis: ["finance_franchisor"],
  },

  // ===========================================================================
  // COMPRAS
  // ===========================================================================
  {
    chave: "rodadas_criadas",
    rotulo: "Rodadas de compra abertas",
    ajuda: "Mesas de negociação que ela montou juntando as requisições das unidades.",
    onde: "Compras → Rodadas → Nova",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "purchase_rounds.created_by",
    papeis: ["purchaser"],
  },
  {
    chave: "cotacoes",
    rotulo: "Cotações lançadas",
    ajuda: "Propostas de fornecedor registradas por ela. Em branco não é zero: quem não cotou não concorre.",
    onde: "Compras → Rodada → Lançar cotação",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "purchase_quotes.created_by",
    papeis: ["purchaser"],
  },
  {
    chave: "itens_escolhidos",
    rotulo: "Itens adjudicados",
    ajuda: "Itens em que ela escolheu o fornecedor vencedor da rodada.",
    onde: "Compras → Rodada → Escolher vencedor",
    nivel: "essencial",
    dependeDeOutro: true,
    origem: "purchase_round_items.awarded_by",
    papeis: ["purchaser"],
  },
  {
    chave: "pedidos_enviados",
    rotulo: "Pedidos enviados ao fornecedor",
    ajuda: "Pedidos gerados por ela depois de a unidade aprovar o rateio.",
    onde: "Compras → Pedidos",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "purchase_orders.created_by",
    papeis: ["purchaser"],
  },
  {
    chave: "vinculos_fornecedor",
    rotulo: "Vínculos de item do fornecedor confirmados",
    ajuda:
      "O de-para entre o nome do fornecedor e o nosso item. É este gesto que faz o sistema acertar mais a cada nota importada.",
    onde: "Estoque → Importar nota → Confirmar item",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "supplier_item_links.created_by",
    papeis: ["purchaser", "unit_manager"],
  },

  // ===========================================================================
  // RISARTE EMPRESARIAL
  // ===========================================================================
  {
    chave: "leads_empresariais",
    rotulo: "Empresas no funil",
    ajuda: "Empresas sob responsabilidade dela no funil do Empresarial.",
    onde: "Empresarial → Funil",
    nivel: "essencial",
    origem: "empresarial.commercial_leads.consultant_id",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "tentativas_contato",
    rotulo: "Tentativas de contato",
    ajuda: "Ligações e mensagens registradas por ela na prospecção.",
    onde: "Empresarial → Ficha da empresa → Contatos",
    nivel: "essencial",
    origem: "empresarial.lead_contact_attempts.author_id",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "atividades_lead",
    rotulo: "Atividades registradas na empresa",
    ajuda: "Anotações do que andou em cada empresa — é o histórico que o funil precisa.",
    onde: "Empresarial → Ficha da empresa → Atividades",
    nivel: "essencial",
    origem: "empresarial.commercial_lead_activities.author_id",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "movimentacoes_funil_empresarial",
    rotulo: "Empresas movidas de etapa",
    ajuda: "Passagens de etapa no funil do Empresarial feitas por ela.",
    onde: "Empresarial → Funil → arrastar o cartão",
    nivel: "essencial",
    origem: "empresarial.commercial_lead_stage_history.moved_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "reunioes_empresariais",
    rotulo: "Reuniões com empresas",
    ajuda: "Reuniões que ela marcou com a empresa.",
    onde: "Empresarial → Ficha da empresa → Reuniões",
    nivel: "complementar",
    origem: "empresarial.lead_meetings.created_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "propostas_enviadas",
    rotulo: "Propostas enviadas",
    ajuda: "Envios de proposta registrados por ela.",
    onde: "Empresarial → Funil → aba Envio",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "empresarial.lead_dispatches.sent_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "fechamentos_empresariais",
    rotulo: "Fechamentos de empresa",
    ajuda: "Conferências de fechamento confirmadas por ela.",
    onde: "Empresarial → Funil → aba Fechamento",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "empresarial.lead_closing_reviews.confirmed_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "passos_implantacao",
    rotulo: "Passos de implantação concluídos",
    ajuda: "Etapas da implantação da empresa que ela deu por feitas.",
    onde: "Empresarial → Implantação",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "empresarial.lead_implementation_steps.done_by",
    papeis: ["rislife_consultant"],
  },
  {
    chave: "contatos_boas_vindas",
    rotulo: "Contatos de boas-vindas",
    ajuda: "Colaboradores da empresa que ela recepcionou no programa.",
    onde: "Empresarial → Boas-vindas",
    nivel: "complementar",
    dependeDeOutro: true,
    origem: "empresarial.welcome_contacts.contacted_by",
    papeis: ["rislife_consultant"],
  },
] as const satisfies readonly {
  chave: string;
  rotulo: string;
  ajuda: string;
  onde: string;
  nivel: NivelDoIndicador;
  dependeDeOutro?: true;
  origem: string;
  papeis: readonly UserRole[];
}[];

export type Indicador = (typeof INDICADORES)[number];
export type ChaveDeIndicador = Indicador["chave"];

/**
 * A ação exige que alguém tenha feito algo antes?
 *
 * Existe como FUNÇÃO e não como leitura direta do campo porque o catálogo é
 * `as const`: quem não declara `dependeDeOutro` simplesmente não tem a
 * propriedade, e ler `i.dependeDeOutro` espalhado pelo código não compila.
 * Um leitor só também garante que a resposta seja a mesma em todo lugar — a
 * tela e a regra não podem discordar sobre o que depende de terceiro.
 */
export function dependeDeTerceiro(i: Indicador): boolean {
  return "dependeDeOutro" in i && i.dependeDeOutro === true;
}

/**
 * As funções que TÊM o que ser medido, na ordem da jornada do cliente.
 *
 * ⚠️ QUEM FICA DE FORA, E POR QUÊ. `franchisee` (Franqueado) e
 * `franchisor_staff` (Franqueadora/Rede) são papéis de LEITURA — pela matriz
 * da §5 do CLAUDE.md eles veem tudo e não executam ato clínico nem comercial.
 * Não há o que contar, e inventar uma meta para eles ("abrir 10 relatórios")
 * mediria navegação, não competência. `admin_master` também fica fora: a 0259
 * já o deixa passar por definição, senão a primeira configuração trancaria o
 * dono para fora do próprio sistema.
 */
export const PAPEIS_COM_MISSAO = [
  "receptionist",
  "sdr",
  "clinical_coordinator",
  "planner_dentist",
  "dentist",
  "tsb",
  "asb",
  "commercial_consultant",
  "commercial_assistant",
  "unit_manager",
  "finance_franchisor",
  "purchaser",
  "rislife_consultant",
] as const satisfies readonly UserRole[];

export type PapelComMissao = (typeof PAPEIS_COM_MISSAO)[number];

/**
 * Os indicadores daquela função, ESSENCIAIS PRIMEIRO.
 *
 * A ordem não é enfeite: com até 18 opções numa função, o que aparece primeiro
 * é o que o Admin configura. Deixar o trabalho do dia a dia no meio da lista
 * faria a missão nascer montada de exceções.
 */
export function indicadoresDoPapel(papel: UserRole): readonly Indicador[] {
  const meus = INDICADORES.filter((i) =>
    (i.papeis as readonly UserRole[]).includes(papel)
  );
  return [
    ...meus.filter((i) => i.nivel === "essencial"),
    ...meus.filter((i) => i.nivel === "complementar"),
  ];
}

// -- Os dois eixos do documento ----------------------------------------------

export const ESCOPOS = ["individual", "coletiva"] as const;
export type Escopo = (typeof ESCOPOS)[number];

export const GATILHOS = ["automatica", "aprovacao"] as const;
export type Gatilho = (typeof GATILHOS)[number];

/** Na liberação coletiva: quem conta é escolhido por CARGO ou por PESSOA. */
export const MODOS_DE_GRUPO = ["papeis", "pessoas"] as const;
export type ModoDeGrupo = (typeof MODOS_DE_GRUPO)[number];

export const ESCOPO_ROTULO: Record<Escopo, string> = {
  individual: "Individual",
  coletiva: "Coletiva (por unidade)",
};

export const ESCOPO_AJUDA: Record<Escopo, string> = {
  individual:
    "Cada pessoa é liberada assim que cumpre a própria missão, sem depender dos colegas.",
  coletiva:
    "O sistema real só abre para a unidade quando todos os participantes escolhidos cumprirem a missão.",
};

export const GATILHO_ROTULO: Record<Gatilho, string> = {
  automatica: "Automática",
  aprovacao: "Com aprovação do Admin Master",
};

export const GATILHO_AJUDA: Record<Gatilho, string> = {
  automatica:
    "Cumpriu a missão, o sistema real abre na hora, sem ninguém confirmar.",
  aprovacao:
    "Cumpriu a missão, o Admin Master recebe um aviso e decide. Nada abre sozinho.",
};

export const MODO_ROTULO: Record<ModoDeGrupo, string> = {
  papeis: "Por cargo",
  pessoas: "Por pessoa",
};

export const MODO_AJUDA: Record<ModoDeGrupo, string> = {
  papeis:
    "Conta todo mundo da unidade que tiver um dos cargos marcados. Quem for contratado depois entra no grupo sozinho.",
  pessoas:
    "Conta apenas as pessoas marcadas, pelo nome. Quem for contratado depois NÃO entra sozinho.",
};

export const NIVEL_ROTULO: Record<NivelDoIndicador, string> = {
  essencial: "Essencial",
  complementar: "Complementar",
};

export type ConfiguracaoDoPortao = {
  release_scope: Escopo;
  release_trigger: Gatilho;
  cohort_mode: ModoDeGrupo;
};

/** O padrão mais cauteloso dos quatro — ver o comentário da migração 0271. */
export const PADRAO_DO_PORTAO: ConfiguracaoDoPortao = {
  release_scope: "individual",
  release_trigger: "aprovacao",
  cohort_mode: "papeis",
};

export function ehEscopo(v: string): v is Escopo {
  return (ESCOPOS as readonly string[]).includes(v);
}

export function ehGatilho(v: string): v is Gatilho {
  return (GATILHOS as readonly string[]).includes(v);
}

export function ehModoDeGrupo(v: string): v is ModoDeGrupo {
  return (MODOS_DE_GRUPO as readonly string[]).includes(v);
}

// -- As metas -----------------------------------------------------------------

export type MetaDoTreino = {
  role: UserRole;
  indicator: string;
  minimum_count: number;
};

/**
 * A meta daquela função, indicador por indicador. Indicador sem linha no banco
 * volta como ZERO — e zero é a ausência de exigência, não uma exigência de
 * zero (mesma lei do orçamento, 0229: meta zero apaga a linha).
 */
export function missaoDoPapel(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): { indicador: Indicador; minimo: number }[] {
  return indicadoresDoPapel(papel).map((indicador) => ({
    indicador,
    minimo:
      metas.find((m) => m.role === papel && m.indicator === indicador.chave)
        ?.minimum_count ?? 0,
  }));
}

/** Função sem nenhuma meta não tem missão — e a tela precisa dizer isso. */
export function temMissao(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): boolean {
  return missaoDoPapel(metas, papel).some((m) => m.minimo > 0);
}

/**
 * ⚠️ MISSÃO SÓ DE AÇÕES QUE DEPENDEM DE TERCEIRO É ARMADILHA.
 *
 * "Receber 3 mercadorias" não pode ser cumprido sem alguém ter feito o pedido;
 * "aprovar 5 planos" precisa de 5 planos prontos. Uma missão inteira montada
 * assim trava a pessoa por culpa de outra, e ela não tem como destravar
 * sozinha — o portão viraria castigo por algo que não é dela.
 *
 * A tela AVISA em vez de impedir: pode ser exatamente o que o dono quer numa
 * unidade que já está rodando, e proibir seria decidir no lugar dele.
 */
export function missaoDependeSoDeTerceiros(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): boolean {
  const exigidos = missaoDoPapel(metas, papel).filter((m) => m.minimo > 0);
  return (
    exigidos.length > 0 && exigidos.every((m) => dependeDeTerceiro(m.indicador))
  );
}

/**
 * Lê o que veio do formulário. Texto vazio, lixo e negativo viram ZERO (ou
 * seja, "sem exigência") em vez de derrubar a gravação: a tela tem um campo por
 * indicador, e um deles em branco não pode impedir o Admin de salvar os outros.
 */
export function normalizarMeta(bruto: unknown): number {
  const n = Number(String(bruto ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Uma frase para a lista: "3 × cadastros · 2 × primeiros agendamentos".
 * Devolve `null` quando não há missão — quem chama decide o que dizer, em vez
 * de receber uma frase vazia com cara de erro.
 */
export function resumoDaMissao(
  metas: readonly MetaDoTreino[],
  papel: UserRole
): string | null {
  const partes = missaoDoPapel(metas, papel)
    .filter((m) => m.minimo > 0)
    .map((m) => `${m.minimo} × ${m.indicador.rotulo.toLowerCase()}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

// -- O grupo do teste coletivo (0272) -----------------------------------------

export type ParticipanteDoGrupo = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

/**
 * ⚠️ GRUPO COLETIVO VAZIO É CONFIGURAÇÃO INCOMPLETA, NÃO "TODO MUNDO".
 *
 * A diferença não é de gosto: "todo mundo" inclui quem está de férias, quem
 * entrou ontem e quem nem vai usar o sistema — e bastaria UMA dessas pessoas
 * para a unidade inteira ficar travada sem ninguém entender por quê. Ler o
 * vazio como "todos" seria escolher o comportamento mais destrutivo justamente
 * quando o Admin ainda não escolheu nada.
 */
export function grupoEstaDefinido(
  modo: ModoDeGrupo,
  papeis: readonly UserRole[],
  pessoas: readonly { user_id: string }[]
): boolean {
  return modo === "papeis" ? papeis.length > 0 : pessoas.length > 0;
}

/**
 * Só entram no grupo por cargo as funções que TÊM missão — marcar um cargo sem
 * meta nenhuma criaria um participante que já nasce aprovado, e a liberação
 * coletiva passaria a depender de gente que não foi medida.
 */
export function cargosElegiveis(
  metas: readonly MetaDoTreino[]
): readonly UserRole[] {
  return PAPEIS_COM_MISSAO.filter((p) => temMissao(metas, p));
}

// -- A turma, o certificado e o clique que começa a missão (0273) -------------

export const TIPOS_DE_TURMA = ["novatos", "reciclagem"] as const;
export type TipoDeTurma = (typeof TIPOS_DE_TURMA)[number];

export const TIPO_DE_TURMA_ROTULO: Record<TipoDeTurma, string> = {
  novatos: "Só quem ainda não tem certificação",
  reciclagem: "Reciclagem: todos, inclusive os já certificados",
};

export const TIPO_DE_TURMA_AJUDA: Record<TipoDeTurma, string> = {
  novatos:
    "O caso normal. Quem já passou não é chamado de novo — certificação não se refaz à toa.",
  reciclagem:
    "Para quando o sistema mudar muito e a equipe inteira precisar reaprender o fluxo. Quem já é certificado CONTINUA trabalhando no sistema real enquanto refaz a missão.",
};

export const ESTADOS_DA_MATRICULA = [
  "convocado",
  "em_andamento",
  "concluido",
  "dispensado",
] as const;
export type EstadoDaMatricula = (typeof ESTADOS_DA_MATRICULA)[number];

export const ESTADO_ROTULO: Record<EstadoDaMatricula, string> = {
  convocado: "Convocado",
  em_andamento: "Missão em andamento",
  concluido: "Concluído",
  dispensado: "Dispensado",
};

export type Matricula = {
  id: string;
  campaign_id: string;
  user_id: string;
  role: UserRole;
  status: EstadoDaMatricula;
  invited_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type Candidato = {
  user_id: string;
  full_name: string | null;
  role: UserRole;
  ja_certificado: boolean;
};

/**
 * ⚠️ A LEI DO MARCO — a razão de existir da 0273.
 *
 * Devolve a partir de QUANDO o trabalho da pessoa conta para a missão, ou
 * `null` quando ainda não conta nada.
 *
 * Ordem do dono (26/09/2026): *"só deve contar a partir de quando o usuário
 * clicar ou aceitar iniciar a missão (...) pois o usuário pode estar testando
 * e aprendendo a utilizar o sistema, mas não iniciou a missão."*
 *
 * `null` NÃO é zero: é "não há janela". Quem chamar isto na Etapa 2 tem de
 * tratar os dois casos separadamente — contar desde o começo dos tempos seria
 * exatamente o que esta lei proíbe, e daria uma certificação a quem só brincou
 * bastante no treino.
 */
export function contaDesde(matricula: Pick<Matricula, "started_at">): Date | null {
  if (!matricula.started_at) return null;
  const d = new Date(matricula.started_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A pessoa pode clicar em "aceitar e começar"? */
export function podeIniciar(
  matricula: Pick<Matricula, "status" | "started_at">
): boolean {
  return matricula.status === "convocado" && matricula.started_at === null;
}

/**
 * A missão está valendo agora — ou seja, o que ela fizer no treino conta.
 * Concluída não vale mais: quem já passou não precisa continuar produzindo.
 */
export function missaoEstaValendo(
  matricula: Pick<Matricula, "status" | "started_at">
): boolean {
  return matricula.status === "em_andamento" && matricula.started_at !== null;
}

/**
 * O que dizer para a pessoa, na tela de Início.
 *
 * ⚠️ A frase do estado `convocado` é a mais importante do módulo: é ela que
 * avisa que, até o clique, nada está sendo medido. Sem isso a pessoa evitaria
 * usar o treino com medo de "gastar" a chance — o oposto do que o ambiente de
 * treino existe para permitir.
 */
export function recadoDaMatricula(
  matricula: Pick<Matricula, "status" | "started_at">
): string {
  if (podeIniciar(matricula)) {
    return "Você foi convocado. Enquanto não clicar em começar, nada do que você fizer no treino é contado — use à vontade para aprender.";
  }
  if (missaoEstaValendo(matricula)) {
    return "Sua missão está valendo: o que você fizer no treino a partir de agora conta.";
  }
  if (matricula.status === "concluido") {
    return "Missão concluída.";
  }
  return "Você foi dispensado desta turma.";
}

/**
 * Quantos da prévia entram de verdade, separando quem já passou.
 *
 * ⚠️ Serve para a tela mostrar a conta ANTES de convocar. Descobrir depois que
 * a turma chamou 2 pessoas em vez de 20 (ou o contrário) é caro: convocação
 * errada gasta a confiança da equipe no portão.
 */
export function resumoDaPrevia(candidatos: readonly Candidato[]): {
  total: number;
  jaCertificados: number;
  novos: number;
} {
  const jaCertificados = candidatos.filter((c) => c.ja_certificado).length;
  return {
    total: candidatos.length,
    jaCertificados,
    novos: candidatos.length - jaCertificados,
  };
}

export function ehTipoDeTurma(v: string): v is TipoDeTurma {
  return (TIPOS_DE_TURMA as readonly string[]).includes(v);
}

// -- A política de acesso durante a reciclagem (0274) -------------------------

export const POLITICAS_DE_ACESSO = [
  "mantem",
  "prazo",
  "suspende_agora",
] as const;
export type PoliticaDeAcesso = (typeof POLITICAS_DE_ACESSO)[number];

export const POLITICA_ROTULO: Record<PoliticaDeAcesso, string> = {
  mantem: "Continua trabalhando normalmente",
  prazo: "Continua até uma data, depois suspende",
  suspende_agora: "Suspende o acesso imediatamente",
};

export const POLITICA_AJUDA: Record<PoliticaDeAcesso, string> = {
  mantem:
    "Ninguém perde acesso. A reciclagem fica como pendência, e cobrar é com a liderança. É o único caminho que não pode parar a clínica.",
  prazo:
    "A pessoa trabalha normalmente até a data escolhida. Quem não tiver concluído até lá é suspenso automaticamente, de madrugada.",
  suspende_agora:
    "A pessoa perde o acesso ao sistema real assim que é convocada, e só volta ao concluir a reciclagem. Use quando o fluxo novo não puder ser operado sem treinar.",
};

/** O prazo é obrigatório — e só existe — na política de prazo. */
export function exigePrazo(p: PoliticaDeAcesso): boolean {
  return p === "prazo";
}

export function ehPoliticaDeAcesso(v: string): v is PoliticaDeAcesso {
  return (POLITICAS_DE_ACESSO as readonly string[]).includes(v);
}

/**
 * A política e o tipo da turma combinam?
 *
 * ⚠️ Só RECICLAGEM suspende. Em turma de novatos a pessoa ainda nem tem acesso
 * ao sistema real (a 0259 já a deixa fechada): "suspender" ali seria um comando
 * sem efeito nenhum, com cara de efeito — e o Admin acreditaria ter travado
 * alguém que continua exatamente como estava.
 */
export function politicaCombinaComTipo(
  politica: PoliticaDeAcesso,
  tipo: TipoDeTurma
): boolean {
  return politica === "mantem" || tipo === "reciclagem";
}

/**
 * O que impede esta turma de ser aberta, em uma frase — ou `null` se está de pé.
 *
 * A tela usa isto para explicar ANTES de o banco recusar: um "não foi possível
 * abrir" sem motivo faria o Admin tentar de novo igual.
 */
export function oQueImpedeAbrir(entrada: {
  politica: PoliticaDeAcesso;
  tipo: TipoDeTurma;
  prazo: string | null;
  hoje: string;
}): string | null {
  if (!politicaCombinaComTipo(entrada.politica, entrada.tipo)) {
    return "Suspender acesso só faz sentido na reciclagem: em turma de novatos a pessoa ainda não tem acesso ao sistema real.";
  }
  if (exigePrazo(entrada.politica)) {
    if (!entrada.prazo) return "Escolha a data limite da reciclagem.";
    if (entrada.prazo <= entrada.hoje) {
      return "A data limite precisa ser futura — uma data passada suspenderia todo mundo já na primeira madrugada.";
    }
  }
  return null;
}
